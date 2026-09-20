// WHERE A LINE'S BASELINE ACTUALLY LANDS, and why the plate has to be told.
//
// render.js draws every composed line as one span at `top: line.y` with
// `line-height: line.height`, and a browser centres the face's own box in that
// line box. So the ink sits half the leading below the band's top, while
// compose.js states `line.baseline` as `y + fontPx x faceAscent()` - the box's
// ascent from the top, with no half-leading in it. The two are the same number
// whenever the leading is no wider than the face's box, which is every body
// line; they part company on DISPLAY type, whose `displayLineHeight` is wider.
//
// Measured on the front page's 28px lead headline at 1.33: 3.08px on the page,
// 13px at 220 dpi - the headline printed in a different place from the one the
// desk passed. The canvas is the authority, so the writers place type where
// render.js paints it, and the compositor's own `baseline` is left alone (it is
// what baselineAfter() specifies the next flow against).

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src/services/export/print-model');

let compose;
let render;

test.before(async () => {
  await model.ensureComposeReady();
  require('../public/editor/layout/typefaces.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
  compose = await import('../public/editor/compose/compose.js');
  render = await import('../public/editor/compose/render.js');
});

const BODY = 'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले. '
  + 'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाल्याने नागरिकांना दिलासा मिळाला. ';

const block = (overrides = {}) => compose.composeBlock({
  width: 260, height: 400, marginPx: 1, bodyFontPx: 6.4,
  headline: 'ओबीसी मंत्रालयाला मंत्रिमंडळ उपसमितीच्या बैठकीत अधिकाऱ्यांना तंबी',
  subheading: 'निधीवरून खडाजंगी; बैठकीतून दोघे बाहेर',
  headlineFontPx: 28, subheadingFontPx: 11.4, body: BODY.repeat(4),
  // The front page's own display cut: Mukta's box is 1.11 em, so a 1.33
  // leading really does leave half-leading to put the type in the wrong place.
  // The paper's sans has a 1.30 em box and hides this fault almost entirely.
  // Locked, like the measured pages: the size is the design's, not whatever
  // the auto-fit would shrink this fixture's long headline to.
  displayFamily: 'mukta-heavy', headlineLocked: true, subheadingLocked: true, ...overrides,
});

test('a body line is painted exactly where the compositor said, to the decimal', () => {
  const composition = block();
  for (const line of composition.bodyLines) {
    assert.ok(Math.abs(render.paintedBaseline(line) - line.baseline) < 0.001,
      `body line moved: stated ${line.baseline}, painted ${render.paintedBaseline(line)}`);
  }
});

test('a display line is painted HALF THE LEADING lower, which is what the canvas draws', () => {
  const composition = block({ displayLineHeight: 1.33 });
  const line = composition.bands.headline.lines[0];
  // The face's own box, from its hhea - which is what CSS lays a line out with.
  const { faceAscent, faceDescent } = require('../public/editor/compose/font-metrics.js');
  const box = line.fontPx * (faceAscent(line.family, line.weight) + faceDescent(line.family, line.weight));
  const halfLeading = (line.height - box) / 2;
  assert.equal(line.family, 'mukta-heavy');
  assert.ok(halfLeading > 1, `this fixture must actually have leading to halve (${halfLeading})`);
  assert.ok(Math.abs(render.paintedBaseline(line) - (line.baseline + halfLeading)) < 0.001);
});

test('a drop cap and a list marker are unchanged - they carry their own line box', async () => {
  const composition = compose.composeBlock({
    width: 200, height: 260, marginPx: 1, bodyFontPx: 6.4,
    body: BODY.repeat(3), headline: 'चाचणी मथळा', dropCapLines: 3,
  });
  const cap = composition.dropCap;
  assert.ok(cap && cap.text, 'the fixture must set a cap');
  assert.ok(Math.abs(render.paintedBaseline(cap) - cap.baseline) < 0.001);

  const listed = compose.composeBlock({
    width: 200, height: 300, marginPx: 1, bodyFontPx: 6.4,
    body: 'पहिला मुद्दा येथे आहे.\n\nदुसरा मुद्दा येथे आहे.\n\nतिसरा मुद्दा येथे आहे.',
    listStyle: 'number',
  });
  for (const marker of listed.listMarkers || []) {
    assert.ok(Math.abs(render.paintedBaseline(marker) - marker.baseline) < 0.001);
  }
});

// The rule has to reach the plate, not merely exist: this is the assertion that
// fails if a writer goes back to `line.baseline`.
test('the press walk places a headline where the canvas paints it', async () => {
  const newspaper = {
    id: 1, publication_date: '2026-08-24', page_width_px: 660, page_height_px: 1060,
    margin_x_px: 20, margin_y_px: 20, matter_width_px: 620, matter_height_px: 1020,
  };
  const section = {
    section_key: 'lead', block_type: 'article',
    x_px: 40, y_px: 60, width_px: 260, height_px: 400, margin_px: 1,
    kicker: '', headline: 'ओबीसी मंत्रालयाला मंत्रिमंडळ उपसमितीच्या बैठकीत तंबी',
    subheading: 'निधीवरून खडाजंगी', body: BODY.repeat(4),
    headline_font_px: 28, subheading_font_px: 11.4, body_font_px: 6.4, line_height: 1.45,
    display_line_height: 1.33, display_family: 'mukta-heavy',
    headline_locked: true, subheading_locked: true,
    text_align: 'justify', font_family: 'serif', font_weight: 400,
    column_count: null, reporter_name: '', location: '', category: 'बातमी',
    background_color: null, border_style: 'none', headline_style: 'plain',
    drop_cap_lines: 0, images: [],
  };
  const built = await model.buildPrintModel(newspaper, [{ id: 1, page_number: 1, sections: [section] }]);
  const { composeSection } = await import('../public/editor/compose/section-adapter.js');
  const composition = composeSection(section, {});
  const line = composition.bands.headline.lines[0];
  const items = built.pages[0].items.filter((item) => item.kind === 'text'
    && (item.runs || []).map((run) => run.text).join('') === line.text);
  assert.ok(items.length, 'the walk must emit the headline');
  // mm from the page top: the block's own y plus where the line is painted in it.
  const expected = model.mm(section.y_px + render.paintedBaseline(line));
  assert.ok(Math.abs(items[0].baseline - expected) < 0.01,
    `plate baseline ${items[0].baseline} against the canvas's ${expected}`);
  assert.ok(Math.abs(items[0].baseline - model.mm(section.y_px + line.baseline)) > 0.3,
    'and it is NOT the compositor\'s own baseline - that is the fault this holds');
});
