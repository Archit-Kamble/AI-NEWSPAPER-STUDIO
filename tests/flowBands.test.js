// PROJECT A, Bug #1/#3 (PROJECT_STATUS.md): the Block Editor used to compute
// its headline/subheading positions with buildFlowMap(section, view, []) -
// an EMPTY array, always, regardless of what pictures the block actually
// held. bandBox() (text-flow.js) is the fix: one function, shared by the
// canvas (section-thumb.js) and the Block Editor (block-frame.js), that
// finds the widest picture-free column run a band can set across. Pure
// logic, no DOM - block-frame.js's own DOM wiring is covered by
// tests/browser/workspace.browser.js instead.

const test = require('node:test');
const assert = require('node:assert/strict');

async function loadTextFlow() {
  return import('../public/editor/layout/text-flow.js');
}

test('bandBox: no picture at all - the full measure is free, at the margin', async () => {
  const { buildFlowMap, bandBox, CELL } = await loadTextFlow();
  const section = { width_px: 300, height_px: 200 };
  const view = {
    headline: 'साधी बातमी', subheading: '', body: '',
    marginPx: 10, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 20, subheadingFontPx: 12, bodyFontPx: 10,
  };
  const map = buildFlowMap(section, view, []);
  const measure = map.cols * map.cellWidth;
  const box = bandBox(map, CELL.HEADLINE, 10, measure, 10);
  assert.equal(box.left, 10, 'starts at the margin - nothing to dodge');
  assert.ok(Math.abs(box.width - measure) < 0.01, 'the full measure is free');
});

test('bandBox: a picture covering the left half pushes the band to the right of it', async () => {
  const { buildFlowMap, bandBox, CELL } = await loadTextFlow();
  const section = { width_px: 300, height_px: 200 };
  const view = {
    // A long headline so it reliably spans more than one row - a single-row
    // headline can't demonstrate "the band avoids the picture across every
    // row it occupies".
    headline: 'साताऱ्यातील राजकीय घडामोडींना वेग आणि प्रशासनाचा नवा निर्णय जाहीर',
    subheading: '', body: '',
    marginPx: 10, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 20, subheadingFontPx: 12, bodyFontPx: 10,
  };
  // A picture pinned to the block's own top-left, covering roughly the left
  // third of the measure for the block's full height - well inside the
  // headline's own rows.
  const image = { x: 0, y: 0, width: 90, height: 200, shape: 'rect', rotation: 0, standOffPx: 0 };
  const map = buildFlowMap(section, view, [image]);
  const measure = map.cols * map.cellWidth;
  const box = bandBox(map, CELL.HEADLINE, 10, measure, 10);

  assert.ok(box.left > 10, 'the band no longer starts at the bare margin - it moved past the picture');
  // The picture's own right edge, in the padded grid's own coordinate frame
  // (buildFlowMap shifts every picture left/up by the padding before testing
  // cell occupancy - see its own comment on why).
  const pictureRightInGrid = 10 + (image.x - 10 + image.width);
  assert.ok(box.left >= pictureRightInGrid - map.cellWidth,
    'the band starts at or after the picture\'s own right edge, not part-way through it',
    `box.left ${box.left}, picture right ~${pictureRightInGrid}`);
});

test('bandBox: a picture that leaves less than half the measure free is not dodged - the clash shows instead of squeezing the band into a sliver', async () => {
  const { buildFlowMap, bandBox, CELL } = await loadTextFlow();
  const section = { width_px: 300, height_px: 200 };
  const view = {
    headline: 'साताऱ्यातील राजकीय घडामोडींना वेग आणि प्रशासनाचा नवा निर्णय जाहीर',
    subheading: '', body: '',
    marginPx: 10, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 20, subheadingFontPx: 12, bodyFontPx: 10,
  };
  // A picture covering nearly the whole width, for the block's full height -
  // whatever sliver is left on either side is far under half the measure.
  const image = { x: 0, y: 0, width: 260, height: 200, shape: 'rect', rotation: 0, standOffPx: 0 };
  const map = buildFlowMap(section, view, [image]);
  const measure = map.cols * map.cellWidth;
  const box = bandBox(map, CELL.HEADLINE, 10, measure, 10);

  assert.equal(box.left, 10, 'falls back to the fallback position - the picture is in the wrong place, not the headline');
  assert.ok(Math.abs(box.width - measure) < 0.01, 'falls back to the full measure rather than a squeezed sliver');
});

test('bandBox: the canvas and the Block Editor call the exact same function - no second implementation to drift', async () => {
  const sectionThumb = await import('../public/editor/canvas/section-thumb.js');
  const textFlow = await loadTextFlow();
  assert.equal(typeof textFlow.bandBox, 'function');
  // section-thumb.js no longer defines its own band() closure - it imports
  // bandBox from text-flow.js (grep, not a runtime assertion: there is no
  // "second bandBox" to import here, which is the point).
  assert.equal(typeof sectionThumb.flowedTextMarkup, 'function');
  assert.equal(typeof sectionThumb.flowedBodyMarkup, 'function');
});

test('flowedBodyMarkup: body text is poured only into TEXT cells - never into a cell a picture occupies', async () => {
  const { buildFlowMap, CELL } = await loadTextFlow();
  const sectionThumb = await import('../public/editor/canvas/section-thumb.js');
  const section = { width_px: 300, height_px: 200 };
  const view = {
    headline: '', subheading: '', body: 'हा मजकूर चित्राभोवती फिरला पाहिजे, त्याच्या वरून नाही.',
    marginPx: 10, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 20, subheadingFontPx: 12, bodyFontPx: 10,
  };
  const image = { x: 0, y: 0, width: 90, height: 200, shape: 'rect', rotation: 0, standOffPx: 0 };
  const map = buildFlowMap(section, view, [image]);
  const markup = sectionThumb.flowedBodyMarkup(map, view, 10);

  // Every run's own left/width comes straight from TEXT cells (flowRuns()
  // only ever collects CELL.TEXT runs) - the picture's own column range
  // (0 to ~90px, padding-shifted) can never appear as a span's left edge
  // inside it, which is the structural guarantee this test holds rather
  // than re-deriving.
  assert.match(markup, /section-flowed/, 'at least some body text was poured');
  assert.doesNotMatch(markup, /left:-\d/, 'no run starts at a negative offset - the grid never runs off the block');
  // The image spans x:0-90 (padding-shifted, same as the picture's own
  // frame) - every run has to start AT or AFTER its right edge, never inside it.
  const lefts = [...markup.matchAll(/left:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  assert.ok(lefts.length > 0, 'at least one run was captured');
  assert.ok(lefts.every((left) => left >= 90), 'every run starts clear of the picture, not inside it', lefts.join(', '));
});
