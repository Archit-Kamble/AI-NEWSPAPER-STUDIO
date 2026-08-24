// FOUR DESTINATIONS, ONE COMPOSITION.
//
// These do not restate what compose.js decided - tests/printModel.test.js
// already checks the shared walk against the press file that goes to the
// plate. What is checked here is that each WRITER renders that walk into a
// file its own application will actually open, and that the two promises this
// feature makes are kept:
//
//   the press PDF is CMYK, with the type embedded and readable;
//   the Word document is the COPY, and says so, rather than a bad page.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const exportService = require('../src/services/export');
const { buildPrintModel, ensureComposeReady } = require('../src/services/export/print-model');
const { cmykOf } = require('../src/services/export/pdf.writer');

test.before(async () => { await ensureComposeReady(); });

const newspaper = {
  id: 1, publication_date: '2026-08-24', page_width_px: 660, page_height_px: 1060,
  margin_x_px: 20, margin_y_px: 20, matter_width_px: 620, matter_height_px: 1020,
};

const section = {
  section_key: 'lead', block_type: 'article',
  x_px: 40, y_px: 260, width_px: 260, height_px: 400, margin_px: 1,
  headline: 'शेतकऱ्यांसाठी नवी योजना जाहीर', subheading: 'निर्णय एकमताने घेण्यात आला',
  body: 'ज्ञानेश्वर महाराजांच्या पालखीचे प्रस्थान उद्या सकाळी होणार असल्याचे कळते. '
    + 'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाल्याने नागरिकांना दिलासा मिळाला.',
  headline_font_px: 24, subheading_font_px: 13, body_font_px: 6.4, line_height: 1.45,
  text_align: 'justify', font_family: 'serif', font_weight: 400, column_count: null,
  reporter_name: 'साहस वार्ता', location: 'सातारा', category: 'बातमी',
  background_color: null, border_style: 'none', headline_style: 'plain',
  drop_cap_lines: 0, images: [],
};
const pages = () => [{ id: 1, page_number: 1, sections: [section] }];

// ------------------------------------------------------------------ colour ---

test('every colour that reaches a press file is CMYK, and black is one plate', () => {
  // Four-plate black on small Devanagari counters shows as a registration
  // fringe. Type must print on the K plate alone.
  assert.deepEqual(cmykOf(null), [0, 0, 0, 1], 'black is 100% K and nothing else');
  assert.deepEqual(cmykOf('#000000'), [0, 0, 0, 1]);
  assert.deepEqual(cmykOf('#ffffff'), [0, 0, 0, 0], 'white is no ink at all, not four plates of nothing');
  const red = cmykOf('#c8102e');
  assert.equal(red.length, 4);
  assert.ok(red[1] > 0.8 && red[2] > 0.6, `the paper's red separates as magenta+yellow: ${red}`);
  assert.ok(red.every((n) => n >= 0 && n <= 1), 'every separation is in range');
});

// -------------------------------------------------------------------- PDF ---

test('the press PDF embeds its type, states CMYK, and the copy can still be read out of it', async () => {
  const built = await exportService.exportEdition('pdf', newspaper, pages());
  const pdf = built.body;
  assert.equal(built.filename, 'sahas-2026-08-24.pdf');
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4', 'a real PDF header');
  assert.ok(pdf.subarray(-6).toString().includes('%%EOF'), 'and a real trailer');

  const text = pdf.toString('latin1');
  assert.ok(text.includes('/FontFile2'), 'the publication face is EMBEDDED, not referenced by name');
  assert.ok(text.includes('/CIDFontType2') && text.includes('/Identity-H'),
    'as a CID-keyed font, which is the only kind that can carry shaped Devanagari');
  assert.ok(text.includes('/CIDToGIDMap /Identity'),
    'with identity mapping, so the codes drawn ARE the shaper\'s own glyph ids');
  assert.ok(!/\/DeviceRGB/.test(text), 'not one RGB colour space reaches the file');
  // The drawing operators live in Flate streams, so this has to be read the
  // way a viewer reads it, not with a string search over the raw file.
  const drawn = pdfContent(pdf);
  assert.ok(drawn.includes('/ActualText'),
    'every run says what it says, so the proof can still be selected and searched');
  // `k` is the DeviceCMYK fill operator; `rg` and `g` are the RGB and grey
  // ones. A press file uses the first and never the other two.
  assert.match(drawn, /^[\d.]+ [\d.]+ [\d.]+ [\d.]+ k$/m, 'colour is laid down with the CMYK operator');
  assert.ok(!/^[\d.]+ [\d.]+ [\d.]+ rg$/m.test(drawn), 'and never with the RGB one');
});

test('the press PDF draws one page per page, at the paper\'s own size in points', async () => {
  const built = await exportService.exportEdition('pdf', newspaper, [
    { id: 1, page_number: 1, sections: [section] },
    { id: 2, page_number: 2, sections: [] },
  ]);
  const text = built.body.toString('latin1');
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 2, 'two pages');
  // 660 editor px = 330 mm = 935.433 pt.
  assert.ok(/\/MediaBox \[0 0 935\.4\d* 1502\.3\d*\]/.test(text), 'the sheet is the paper, in points');
  assert.ok(text.includes('/TrimBox'), 'and it states its trim');
});

// ------------------------------------------------------------------- IDML ---

test('the InDesign package is a real IDML: mimetype first and stored, one story per composed line', async () => {
  const built = await exportService.exportEdition('indesign', newspaper, pages());
  const zip = built.body;
  assert.equal(built.filename, 'sahas-2026-08-24.idml');
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'a zip local header');

  // The first entry must be `mimetype`, STORED - the rule IDML shares with
  // ODF and EPUB, so a reader can identify the package from the raw bytes.
  const nameLength = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'mimetype');
  assert.equal(zip.readUInt16LE(8), 0, 'and stored, not deflated');

  const names = entryNames(zip);
  assert.ok(names.includes('designmap.xml'));
  assert.ok(names.includes('META-INF/container.xml'));
  assert.ok(names.includes('Resources/Fonts.xml'));
  assert.ok(names.some((n) => n.startsWith('Spreads/Spread_spread1.xml')));
  assert.ok(names.filter((n) => n.startsWith('Stories/')).length > 5,
    'one story per composed line, never a shared story InDesign could reflow');
});

test('an InDesign text frame carries no inset, or the compositor\'s own padding is doubled', async () => {
  const built = await exportService.exportEdition('indesign', newspaper, pages());
  const spread = readEntry(built.body, 'Spreads/Spread_spread1.xml');
  assert.ok(spread.includes('InsetSpacing="0 0 0 0"'));
  assert.ok(spread.includes('AutoSizingType="Off"'), 'and never resizes itself around the type');
  assert.ok(/PageWidth|GeometricBounds="0 0 1502\.3\d* 935\.4\d*"/.test(spread), 'the page is the paper');
});

// ------------------------------------------------------------------- DOCX ---

test('the Word document is the COPY, in the publication face, and says it is not the page', async () => {
  const built = await exportService.exportEdition('word', newspaper, pages());
  assert.equal(built.filename, 'sahas-2026-08-24.docx');
  const names = entryNames(built.body);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) {
    assert.ok(names.includes(part), `a .docx needs ${part}`);
  }
  const document = readEntry(built.body, 'word/document.xml');
  assert.ok(document.includes('शेतकऱ्यांसाठी नवी योजना जाहीर'), 'the headline is there');
  assert.ok(document.includes('ज्ञानेश्वर'), 'and the story');
  // w:cs and w:szCs are what stop Word applying the LATIN font and size to
  // Devanagari - the two mistakes that make an Indic .docx open wrong.
  assert.ok(/w:cs="Noto Serif Devanagari"/.test(document), 'the complex-script font is named');
  assert.ok(/<w:szCs w:val="\d+"\/>/.test(document), 'and the complex-script size');
  assert.ok(built.warnings.some((warning) => /copy, not its layout/i.test(warning)),
    'and the desk is told it is not the page');
});

// ---------------------------------------------------------------- the door ---

test('an unknown format is refused by name, not by producing something wrong', async () => {
  await assert.rejects(
    () => exportService.exportEdition('pages', newspaper, pages()),
    (error) => error.code === 'UNKNOWN_EXPORT_FORMAT',
  );
});

test('all four render the SAME edition - none of them is a second layout engine', async () => {
  const model = await buildPrintModel(newspaper, pages());
  const lines = model.pages[0].items.filter((item) => item.kind === 'text');
  const [pdf, idml, word] = await Promise.all([
    exportService.exportEdition('pdf', newspaper, pages()),
    exportService.exportEdition('indesign', newspaper, pages()),
    exportService.exportEdition('word', newspaper, pages()),
  ]);
  const idmlStories = entryNames(idml.body).filter((n) => n.startsWith('Stories/')).length;
  assert.equal(idmlStories, lines.length, 'InDesign gets exactly the composed lines, no more');
  // The PDF draws glyphs, so its evidence is that it carries one marked-content
  // span per run rather than per line.
  const runs = lines.reduce((total, item) => total + item.runs.length, 0);
  assert.equal((pdfContent(pdf.body).match(/\/ActualText/g) || []).length, runs,
    'the PDF marks exactly the runs the model produced');
  assert.ok(word.body.length > 0);
});

// ------------------------------------------------------------------ helpers ---

/** Entry names, read straight out of the zip's local headers. */
function entryNames(zip) {
  const names = [];
  let at = 0;
  while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    const compressed = zip.readUInt32LE(at + 18);
    names.push(zip.subarray(at + 30, at + 30 + nameLength).toString('utf8'));
    at += 30 + nameLength + extraLength + compressed;
  }
  return names;
}

/** Every content stream in a PDF, inflated - what a viewer actually executes. */
function pdfContent(pdf) {
  const raw = pdf.toString('latin1');
  const out = [];
  // `endstream` CONTAINS `stream`, so a bare /stream\n/ marker matches the end
  // of the previous object and every inflate after it fails. A stream always
  // follows its own dictionary, so that is what is matched.
  const marker = />>\s*stream\r?\n/g;
  let match = marker.exec(raw);
  while (match) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const body = pdf.subarray(start, end);
    try { out.push(zlib.inflateSync(body).toString('latin1')); } catch { /* a font or an image */ }
    marker.lastIndex = end;
    match = marker.exec(raw);
  }
  return out.join('\n');
}

function readEntry(zip, wanted) {
  let at = 0;
  while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
    const method = zip.readUInt16LE(at + 8);
    const compressedSize = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extraLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extraLength;
    if (name === wanted) {
      const body = zip.subarray(start, start + compressedSize);
      return (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8');
    }
    at = start + compressedSize;
  }
  throw new Error(`no such entry: ${wanted}`);
}
