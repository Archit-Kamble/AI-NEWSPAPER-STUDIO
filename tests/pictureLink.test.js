// A PICTURE FROM A LINK - and the one route that makes THIS SERVER fetch an
// address somebody typed.
//
// A server-side fetch is not a browser fetch. The browser that typed the URL is
// outside; this server is inside, and "http://localhost:3000/api/..." or
// "http://169.254.169.254/" reaches things the caller never could - the
// newsroom's own API with the server's own network position, or a cloud
// provider's metadata service and the credentials in it. Every check below is
// the reason this route is safe, and none of it is optional.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { signIn } = require('./helpers/desk');
const pictureLink = require('../src/services/pictureLink.service');

test.after(() => pool.end());

async function ensureOwner() {
  const hash = await bcrypt.hash('admin123', 4);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active)
     VALUES ('Owner', 'admin@esahas.com', $1, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin', is_active = TRUE`,
    [hash],
  );
}

test('an address only this server can reach is not one it will fetch', () => {
  // Loopback, the private ranges, carrier-grade NAT, and link-local - which is
  // where a cloud metadata service lives and is the single most valuable thing
  // an SSRF can reach.
  for (const inside of [
    '127.0.0.1', '127.1.1.1', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1',
  ]) {
    assert.equal(pictureLink.isPrivateAddress(inside), true, `${inside} should be refused`);
  }
  for (const outside of ['8.8.8.8', '1.1.1.1', '203.0.113.7', '2606:4700:4700::1111']) {
    assert.equal(pictureLink.isPrivateAddress(outside), false, `${outside} is public`);
  }
  // Anything unparseable is not a public address - the safe way round.
  assert.equal(pictureLink.isPrivateAddress('not-an-address'), true);
  assert.equal(pictureLink.isPrivateAddress(''), true);
});

test('only http and https, and only a name that resolves outside', async () => {
  for (const scheme of ['file:///etc/passwd', 'gopher://x/', 'ftp://example.com/a.png', 'data:image/png;base64,AAAA']) {
    const result = await pictureLink.safeUrl(scheme);
    assert.ok(result.error, `${scheme} should be refused`);
    assert.match(result.error, /http:\/\/ or https:\/\//);
  }
  assert.match((await pictureLink.safeUrl('not a url')).error, /not a web address/);

  // THE RESOLVED ADDRESS DECIDES, not the hostname. A hostname is free to
  // resolve wherever its owner likes, and `internal.example.com` pointing at
  // 127.0.0.1 is the ordinary way this attack is written.
  const loopback = await pictureLink.safeUrl('http://localhost/logo.png');
  assert.ok(loopback.error, 'localhost resolves inside and is refused');
  assert.match(loopback.error, /not on the public internet/);
});

test('the route refuses every inside address, through the real API', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  try {
    await ensureOwner();
    const desk = await signIn(port);
    const started = await (await desk('/api/newspapers/start', {
      // FOUR, not two: the supported page counts are a real list and `start`
      // answers INVALID_EDITION_PAGE_COUNT for anything else - a paper is
      // printed on folded sheets.
      method: 'POST', body: JSON.stringify({ publicationDate: '2099-06-06', pageCount: 4 }),
    })).json();
    assert.ok(started.newspaper, `the edition could not be started: ${JSON.stringify(started)}`);
    editionId = started.newspaper.id;
    const pages = await (await desk(`/api/newspapers/${editionId}/pages`)).json();
    const block = pages[0].sections.find((s) => s.block_type === 'article');

    const post = (link) => desk(
      `/api/pages/${pages[0].id}/sections/${block.section_key}/images/from-link`,
      { method: 'POST', body: JSON.stringify({ link }) },
    );

    for (const attack of [
      `http://localhost:${port}/api/newspapers`,
      'http://127.0.0.1/epaper',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/router.png',
      'http://10.0.0.1/a.png',
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const response = await post(attack);
      assert.equal(response.status, 400, `"${attack}" was not refused`);
      // eslint-disable-next-line no-await-in-loop
      const body = await response.json();
      assert.ok(body.error, `"${attack}" was refused without saying why`);
    }

    // AND NOTHING WAS PLACED. A refusal that still left a picture on the block
    // would be no refusal at all.
    const images = await (await desk(`/api/pages/${pages[0].id}/sections/${block.section_key}/images`)).json();
    assert.equal(images.length, 0);
  } finally {
    if (editionId) {
      const desk = await signIn(port);
      await desk(`/api/newspapers/${editionId}`, { method: 'DELETE' });
    }
    server.close();
  }
});

test('the bytes decide, not the remote server\'s claim', () => {
  // A remote Content-Type is that server's claim, exactly as an upload's
  // mimetype is the caller's - and this codebase has already had stored XSS
  // from trusting one. The check is the SAME looksLikeImage() an upload goes
  // through, so there is one answer to "is this a picture" and not two.
  const { looksLikeImage } = require('../src/middleware/upload');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const html = Buffer.from('<script>alert(1)</script>', 'utf8');
  assert.equal(looksLikeImage(png, '.png'), true);
  assert.equal(looksLikeImage(html, '.png'), false, 'a page calling itself a PNG is not a PNG');
  assert.equal(looksLikeImage(png, '.jpg'), false, 'nor is a PNG a JPEG');

  // The extension comes from THIS PAPER'S type map, never from the URL - a
  // name the request can choose is how a picture becomes an HTML page, which
  // this codebase has had once already.
  const source = require('node:fs').readFileSync(
    require.resolve('../src/services/pictureLink.service'), 'utf8',
  );
  assert.match(source, /IMAGE_TYPES\.get\(declared\)/, 'the extension comes from the type map');
  assert.doesNotMatch(source, /path\.extname\(\s*url/, 'never from the URL');
  assert.match(source, /looksLikeImage/, 'and the bytes are checked');
  assert.match(source, /AbortController/, 'and the fetch is bounded');
});
