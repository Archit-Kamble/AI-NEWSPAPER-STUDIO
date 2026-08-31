// A PICTURE FROM A LINK.
//
// The desk's report, as part of what "Write empty blocks" should be able to do:
// "picture link — it should be able to provide an image link to download and
// add this image to that block." A wire photograph, an agency link, a picture
// somebody sent by email: the desk has the URL and had no way to give it to a
// block short of downloading it by hand and uploading it again.
//
// THIS IS THE ONE PLACE THE SERVER FETCHES A URL SOMEBODY TYPED, and that makes
// it the most dangerous route in the product. Everything below is the reason it
// is safe, and none of it is optional:
//
//   * A SERVER-SIDE FETCH IS NOT A BROWSER FETCH. The browser that typed the
//     URL is outside; this server is inside. "http://localhost:3000/api/..."
//     or "http://169.254.169.254/" reaches things the caller never could - the
//     newsroom's own API with the server's own network position, or a cloud
//     provider's metadata service and the credentials in it. That is SSRF, and
//     it is why the address is resolved and checked BEFORE anything is read.
//
//   * THE BYTES ARE CHECKED, NOT THE URL'S PROMISE. A remote server's
//     Content-Type is that server's claim, exactly as an upload's mimetype is
//     the caller's claim - and this codebase has already had stored XSS from
//     trusting one. The signature check is the SAME `looksLikeImage()` an
//     upload goes through, and the extension comes from this paper's own type
//     map, never from the URL.
//
//   * IT IS BOUNDED. A timeout, a redirect limit, and a byte ceiling enforced
//     while reading rather than from a Content-Length nobody has to send.

const dns = require('node:dns').promises;
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { uploadsDir, looksLikeImage, IMAGE_TYPES } = require('../middleware/upload');

const TIMEOUT_MS = 12000;
const MAX_BYTES = 12 * 1024 * 1024;   // a newspaper photograph, generously
const MAX_REDIRECTS = 3;

/**
 * Is this address one the public internet can reach, or one only this server
 * can?
 *
 * Loopback, link-local (which is where a cloud metadata service lives), the
 * private ranges and the unspecified address are all "inside". Checked on the
 * RESOLVED address rather than on the hostname, because a hostname is free to
 * resolve wherever its owner likes - `internal.example.com` pointing at
 * 127.0.0.1 is the ordinary way this attack is written.
 */
function isPrivateAddress(address) {
  const ip = String(address || '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;         // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // An IPv4 address wearing an IPv6 coat is still that address.
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // unparseable is not a public address
}

/** The URL, checked as far as it can be before a byte is read. */
async function safeUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { return { error: 'That is not a web address.' }; }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { error: 'A picture link must be an http:// or https:// address.' };
  }
  let resolved;
  try {
    resolved = await dns.lookup(url.hostname, { all: true });
  } catch {
    return { error: 'That address could not be found.' };
  }
  // EVERY address it resolves to, not just the first: a name that answers with
  // one public address and one loopback address is still a way in.
  if (!resolved.length || resolved.some((entry) => isPrivateAddress(entry.address))) {
    return { error: 'That address is not on the public internet, so this paper will not fetch it.' };
  }
  return { url };
}

/**
 * Downloads the picture at `link` into public/uploads and returns what
 * sectionImage.add() needs.
 *
 * Redirects are followed by hand rather than by `fetch`, because every hop has
 * to go through safeUrl() again - a public URL that redirects to
 * http://169.254.169.254/ is the same attack with one more step in it.
 */
async function fetchPicture(link) {
  let current = link;
  let response = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = await safeUrl(current);
    if (checked.error) return checked;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetch(checked.url, { redirect: 'manual', signal: controller.signal });
    } catch {
      return { error: 'That picture could not be fetched. Check the link and try again.' };
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), checked.url).toString();
      response = null;
      continue;
    }
    break;
  }

  if (!response) return { error: 'That link redirects too many times.' };
  if (!response.ok) return { error: `That link answered ${response.status}.` };

  // The remote server's Content-Type is its own claim and decides only which
  // extension to TRY; the bytes decide whether it was true.
  const declared = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extension = IMAGE_TYPES.get(declared);
  if (!extension) {
    return { error: 'That link is not a JPEG, PNG, GIF, WebP, BMP or TIFF picture.' };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // Enforced on what actually arrived, never on a Content-Length nobody has to
  // send honestly.
  if (buffer.length > MAX_BYTES) {
    return { error: 'That picture is larger than this paper accepts (12 MB).' };
  }
  if (!buffer.length) return { error: 'That link returned an empty file.' };
  if (!looksLikeImage(buffer.subarray(0, 16), extension)) {
    return { error: 'That file is not the picture it says it is.' };
  }

  // The name on disk is this paper's, never the URL's - a name the request can
  // choose is how a picture becomes an HTML page, which this codebase has
  // already had once.
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  await fsp.writeFile(path.join(uploadsDir, filename), buffer);

  return {
    picture: {
      url: `/uploads/${filename}`,
      filename,
      mimeType: declared,
      bytes: buffer.length,
    },
  };
}

module.exports = { fetchPicture, safeUrl, isPrivateAddress };
