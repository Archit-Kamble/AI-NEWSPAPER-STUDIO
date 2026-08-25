// The press package: the Scribus document AND the pictures it points at.
//
// The .sla on its own is not a deliverable, and shipping it alone was a real
// mistake. A Scribus document references its images by path; the paths this
// system writes are relative to the public directory on the server. Once the
// file has been downloaded to somebody's machine those paths resolve to
// nothing, and Scribus opens the edition with every picture frame empty. The
// desk would find that out at the moment they were trying to go to press.
//
// So the export is a package, which is what every layout application calls this
// step - "package for output". One zip containing:
//
//     sahas-2026-08-04.sla
//     uploads/<every picture the edition actually uses>
//
// Unzip it anywhere, open the .sla, and the pictures are where it expects them.
//
// The zip is written here rather than pulled in as a dependency. It is stored
// (uncompressed) because the payload is JPEGs and PNGs, which do not compress -
// so this is a container format, and a container is about a hundred lines.

const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
// The paper's own standing artwork, which the .sla places above the fold.
const { identity } = require('../layout/identity');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// CRC-32, which the zip format requires per entry.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// MS-DOS date and time, which is what a zip entry carries. The edition's own
// date is used rather than the clock, so exporting the same edition twice
// produces the same bytes - a package that changes every time it is generated
// cannot be checked against the one that went to press.
function dosStamp(isoDate) {
  const [y, m, d] = String(isoDate || '2000-01-01').split('T')[0].split('-').map(Number);
  const year = Math.max(1980, y || 1980);
  return {
    date: (((year - 1980) & 0x7f) << 9) | ((m || 1) << 5) | (d || 1),
    time: 0,
  };
}

/**
 * Builds a zip from a list of { name, data } entries.
 *
 * Stored, not deflated: the contents are already-compressed images plus a small
 * XML file, so deflate would spend time to save nothing. Text entries are
 * deflated because XML does compress well.
 */
function buildZip(entries, isoDate) {
  const stamp = dosStamp(isoDate);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = entry.data;
    const crc = crc32(raw);

    // Deflate only where it pays: the .sla is XML, the pictures are not. An
    // entry may say so itself - IDML and DOCX are zips of XML, and IDML's own
    // `mimetype` entry must be STORED and first, the same rule ODF and EPUB
    // carry. Left as the extension rule when nothing says otherwise, so the
    // press package's own bytes are unchanged.
    const deflate = entry.deflate !== undefined ? entry.deflate : entry.name.endsWith('.sla');
    const stored = deflate ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    const method = deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, stored);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(stored.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + stored.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/**
 * Every picture an edition actually uses, read off disk.
 *
 * Only the ones on the page - not the whole uploads folder, which is every
 * photograph the paper has ever received.
 */
async function picturesFor(pages) {
  const wanted = new Set();
  for (const page of pages) {
    for (const section of page.sections || []) {
      for (const image of section.images || []) if (image.url) wanted.add(image.url);
      if (section.image_url) wanted.add(section.image_url);
    }
    // The PAGE's own pictures too: the nameplate artwork the .sla now places
    // above the fold, and any photograph laid across block boundaries. Both
    // are referenced by the press file, and a referenced file that is not in
    // the package is a frame that opens EMPTY in Scribus - which is exactly
    // what tests/press.test.js caught the moment the nameplate was added.
    if (identity.nameplateUrl) wanted.add(identity.nameplateUrl);
    for (const overlay of Array.isArray(page.overlay_images) ? page.overlay_images : []) {
      if (overlay && overlay.url) wanted.add(overlay.url);
    }
  }

  const files = [];
  const missing = [];
  for (const url of wanted) {
    const relative = String(url).replace(/^\/+/, '');
    try {
      files.push({ name: relative, data: await fs.readFile(path.join(PUBLIC_DIR, relative)) });
    } catch {
      missing.push(url);
    }
  }
  return { files, missing };
}

/**
 * The package: the document, its pictures, and a note saying what is in it.
 */
function auditManifest(newspaper, pages, readiness) {
  const sections = pages.flatMap((page) => (page.sections || []).map((section) => ({
    page: page.page_number, sectionKey: section.section_key, newsItemId: section.news_item_id || null,
    reviewStatus: section.status, aiGenerated: Boolean(section.ai_generated),
  })));
  const images = pages.flatMap((page) => (page.sections || []).flatMap((section) => (section.images || []).map((image) => ({
    page: page.page_number, sectionKey: section.section_key, mediaAssetId: image.media_asset_id || null,
    sourceNewsItemId: image.source_news_item_id || null, captionPresent: Boolean(image.caption),
    geometry: { x: image.x_px, y: image.y_px, width: image.width_px, height: image.height_px, rotation: image.rotation || 0, shape: image.shape || 'rect' },
  }))));
  return { schemaVersion: 1, edition: { id: newspaper.id, date: String(newspaper.publication_date).slice(0, 10), pages: pages.length }, readiness: { assessedAt: readiness?.assessedAt || null, readyForPress: Boolean(readiness?.readyForPress), counts: readiness?.counts || null }, sections, images };
}

async function build(newspaper, pages, sla, readiness = null) {
  const date = String(newspaper.publication_date).slice(0, 10);
  const { files, missing } = await picturesFor(pages);
  if (missing.length) { const error = new Error('A press asset disappeared while packaging.'); error.code = 'PRESS_ASSET_MISSING'; error.missing = missing; throw error; }

  const readme = [
    `${newspaper.name} — ${date}`,
    '',
    'Generated by SAHAS.',
    '',
    `  sahas-${date}.sla   the Scribus document, ${pages.length} pages, ${newspaper.color_mode || 'CMYK'}`,
    `  uploads/            ${files.length} photograph${files.length === 1 ? '' : 's'} the pages use`,
    '',
    'Unzip this folder and open the .sla in Scribus. The picture paths are',
    'relative to the .sla, so keep the two together.',
    '',
    'Then: check the page, export as PDF/X-3 or PDF 1.4 with CMYK output,',
    'and send that to the press.',
  ].join('\n');

  const entries = [
    { name: `sahas-${date}.sla`, data: Buffer.from(sla, 'utf8') },
    { name: 'README.txt', data: Buffer.from(readme, 'utf8') },
    { name: 'MANIFEST.json', data: Buffer.from(`${JSON.stringify(auditManifest(newspaper, pages, readiness), null, 2)}\n`, 'utf8') },
    ...files,
  ];

  return { zip: buildZip(entries, newspaper.publication_date), pictures: files.length, missing };
}

module.exports = { build, buildZip, crc32, picturesFor, auditManifest };
