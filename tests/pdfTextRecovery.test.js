// WHAT THE PRESS PDF SAYS, AS OPPOSED TO WHAT IT DRAWS.
//
// The press file draws GLYPH IDS, because Devanagari cannot be printed by
// handing a PDF a Unicode string and a font - a PDF viewer does no shaping at
// all, so the shaper's own output is what goes in the file. That prints
// correctly and cannot be read back: shaping is many-to-many, so no per-glyph
// /ToUnicode table can undo it. `सूर्यास्त` is nine codepoints drawn as four
// glyphs, and asking each glyph what it "means" has no answer.
//
// /ActualText is the operator for exactly that - it tells a reader what a span
// of marked content MEANS, whatever it was drawn with - and pdf.writer.js
// emits one per run. A production audit reported the opposite ("zero
// occurrences in a 2.76 MB export"), which was a grep of the raw file: every
// content stream is /FlateDecode, so the spans were there and deflated.
//
// This is the check that grep could not make. It decompresses the streams and
// reads them, so the claim is about the document rather than about its bytes -
// and it fails if a future change drops the marked content, which would leave
// a press archive nobody can search for a complex Marathi word.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

require('dotenv').config();

const { buildPdf } = require('../src/services/export/pdf.writer');

// buildPdf takes the compositor's own shaper and metrics - the SAME ones the
// canvas measures with, which is what makes the plate and the screen one page.
// In Node the shaper is never optional: without HarfBuzz the engine falls back
// to raw hmtx advances and overstates a conjunct by up to 80%.
async function compositorDeps() {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  await Promise.all([ensureFontsLoaded(), shaper.ensureShaperReady()]);
  return { shapeRun: shaper.shapeRun, faceMetrics: metrics.faceMetrics };
}

/** Every content stream, decompressed, as text. */
function contentStreams(pdf) {
  const raw = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'latin1');
  const text = raw.toString('latin1');
  const out = [];
  const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let match = re.exec(text);
  while (match) {
    const start = match.index + match[0].length;
    try {
      out.push(zlib.inflateSync(raw.subarray(start, start + Number(match[1]))).toString('latin1'));
    } catch { /* an image stream is not a content stream */ }
    match = re.exec(text);
  }
  return out;
}

// UTF-16BE, which is what /ActualText speaks. Node has no 'utf16be' decoder,
// so the bytes are swapped into the little-endian one it does have.
function fromUtf16be(hex) {
  const bytes = Buffer.from(hex, 'hex');
  const swapped = Buffer.allocUnsafe(bytes.length);
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1];
    swapped[i + 1] = bytes[i];
  }
  return swapped.toString('utf16le');
}

// Built through the real walk rather than by hand: an item shape invented for
// a test is an item shape the writer never sees, and the first version of this
// check produced a valid PDF with no text in it at all for exactly that reason.
const newspaper = {
  id: 1, publication_date: '2026-08-24', page_width_px: 660, page_height_px: 1060,
  margin_x_px: 20, margin_y_px: 20, matter_width_px: 620, matter_height_px: 1020,
};

// The hardest thing this paper sets: a conjunct carrying an above-base matra,
// and one carrying a below-base sign. Both are many-to-many under shaping, so
// neither can be described by a per-glyph table.
const SAYS = 'सूर्यास्त आणि दिनमान';

function pageOf(sections) {
  return [{
    id: 1, page_number: 2, template_key: 'local', prints_colour: false, sections,
  }];
}

test('a run of Devanagari is drawn as glyphs and still says what it means', async () => {
  const printModel = require('../src/services/export/print-model');
  await printModel.ensureComposeReady();

  const built = await printModel.buildPrintModel(newspaper, pageOf([{
    section_key: 'lead', block_type: 'article',
    x_px: 40, y_px: 60, width_px: 260, height_px: 400, margin_px: 1,
    headline: SAYS,
    body: `${SAYS} ${SAYS} ${SAYS} ${SAYS}`,
    body_font_px: 6.4, status: 'ready',
  }]));

  const { pdf } = await buildPdf(built, await compositorDeps());
  const streams = contentStreams(pdf);
  assert.ok(streams.length, 'the file has at least one content stream');

  const spans = [];
  for (const stream of streams) {
    for (const [, hex] of stream.matchAll(/\/ActualText <FEFF([0-9A-Fa-f]+)>/g)) {
      spans.push(fromUtf16be(hex));
    }
  }

  assert.ok(spans.length > 0, 'every drawn run carries /ActualText');
  assert.ok(
    spans.some((span) => span.includes('सूर्यास्त')),
    `the exact conjunct is recoverable from the file, got ${spans.length} spans`,
  );
  assert.ok(
    spans.some((span) => span.includes('दिनमान')),
    'and so is a cluster with a below-base sign',
  );

  // The marked content has to be CLOSED, or every reader after it is inside a
  // span that never ends.
  const opens = streams.reduce((n, s) => n + (s.match(/BDC/g) || []).length, 0);
  const closes = streams.reduce((n, s) => n + (s.match(/EMC/g) || []).length, 0);
  assert.equal(opens, closes, 'every BDC is matched by an EMC');
});
