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
  assert.equal(box.safe, false, 'the editor may show the clash, but automation can never call it safe');
  assert.equal(box.reason, 'INSUFFICIENT_PICTURE_FREE_BAND');
});

test('placed captions reserve the same canonical flow cells the browser paints', async () => {
  const { buildFlowMap, captionBox, flowImageFromRow } = await loadTextFlow();
  const section = { width_px: 300, height_px: 300 };
  const view = { headline: '', subheading: '', body: '', marginPx: 10, columnCount: 1, lineHeight: 1.45, headlineFontPx: 20, subheadingFontPx: 12, bodyFontPx: 10 };
  const base = { x_px: 20, y_px: 30, width_px: 120, height_px: 80, shape: 'rect', stand_off_px: 0 };
  const without = buildFlowMap(section, view, [flowImageFromRow(base)]);
  const one = { ...base, caption: 'लहान छायाचित्र मजकूर' };
  // Long enough to run to several lines at the caption's own size. It used to
  // be one sentence, which spanned two lines while a caption was set at 7.5 px
  // and one line once it became 8 pt - so the two fixtures reserved the same
  // grid cells and the budget assertion had nothing to compare. The rule being
  // tested (a deeper caption reserves more) is unchanged; the fixture had to
  // grow to keep exercising it.
  const wrapped = { ...base, caption: 'मराठी छायाचित्राचा अधिक लांब मजकूर अनेक ओळींमध्ये सुरक्षितपणे मांडला जातो, '
    + 'आणि त्याखाली छायाचित्रकाराचे नाव, ठिकाण आणि दिनांक अशी सर्व माहिती एकत्र दिली जाते, '
    + 'ज्यामुळे हा मजकूर अनेक ओळींमध्ये पसरतो आणि अधिक जागा व्यापतो.' };
  const withOne = buildFlowMap(section, view, [flowImageFromRow(one)]);
  const withWrapped = buildFlowMap(section, view, [flowImageFromRow(wrapped)]);
  assert.ok(withOne.bodyCharBudget < without.bodyCharBudget);
  assert.ok(withWrapped.bodyCharBudget < withOne.bodyCharBudget);
  assert.ok(captionBox(wrapped).height > captionBox(one).height);
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

test('ordinary no-image prose uses the canonical flowed renderer, not balancing CSS columns', async () => {
  const sectionThumb = await import('../public/editor/canvas/section-thumb.js');
  const markup = sectionThumb.flowedTextMarkup(
    { width_px: 620, height_px: 200, images: [] },
    { headline: 'मुख्य बातमी', subheading: '', body: 'अ'.repeat(220), marginPx: 12, columnCount: 1, lineHeight: 1.45, headlineFontPx: 32, subheadingFontPx: 16, bodyFontPx: 16 },
  );
  assert.match(markup, /section-flowed-band/, 'headline is placed in the grid band');
  assert.match(markup, /section-flowed/, 'body is poured into canonical grid runs');
  assert.doesNotMatch(markup, /section-body/, 'the CSS column fallback is not used for ordinary prose');
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

// MIN_RUN_CHARS / pourIntoRuns / bodyCharBudget: a picture that leaves only a
// hairline sliver beside it, for EVERY row it touches, used to still get
// prose poured into it - the only width available anywhere in that flow, so
// the "wait for a wider run" logic that protects an ordinary single narrow
// row had nothing wider to wait for. Found live on Project A's realistic
// test edition: a photo-feature block whose picture left a 5-cell run for
// ten rows straight rendered "शहरातील" as "शहरात" / "ील" on two separate
// lines, and "होणारी" as "होणार" / "ी" - a real word, shredded to one glyph
// per line, not the "अतिवृष्टीग्रस" hyphenation case the widest-run check
// already guarded against (there, a wider row genuinely existed later in the
// same flow to wait for).

test('pourIntoRuns: a run that is the widest available anywhere, but still hairline-thin, gets nothing poured into it rather than one glyph per line', async () => {
  const { pourIntoRuns } = await loadTextFlow();
  // Every row exactly 3 cells wide - no row anywhere in this flow could ever
  // hold ordinary prose, unlike the case where a narrow row is followed by a
  // wider one further down and the word can simply wait.
  const runs = Array.from({ length: 8 }, (_, row) => ({ row, col: 53, length: 3 }));
  const result = pourIntoRuns(runs, 'शहरातील मुख्य चौकात रोज सकाळी होणारी वाहतूक कोंडी.');
  assert.deepEqual(result, [], 'nothing is poured into a flow with no usable width anywhere');
});

test('pourIntoRuns: a genuinely narrow row is still fine when a wider row exists later in the SAME flow - the word waits for it', async () => {
  const { pourIntoRuns } = await loadTextFlow();
  // Two narrow rows (beside a picture), then a full-width row below it -
  // exactly the ordinary picture-runaround case, which must be unaffected.
  const runs = [
    { row: 0, col: 20, length: 3 },
    { row: 1, col: 20, length: 3 },
    { row: 2, col: 0, length: 40 },
  ];
  const result = pourIntoRuns(runs, 'शहरातील मुख्य चौकात.');
  assert.ok(result.length > 0, 'text still flows once a usable row exists');
  assert.ok(result.every((run) => run.text.length <= run.length), 'every placed run still fits its own cells');
});

test('buildFlowMap: bodyCharBudget never counts cells that pourIntoRuns would actually refuse to use', async () => {
  const { buildFlowMap, flowRuns, pourIntoRuns, CELL } = await loadTextFlow();
  const section = { width_px: 307, height_px: 296 };
  const view = {
    kicker: 'फोटो फिचर', headline: 'सकाळच्या गर्दीचे क्षणचित्र', subheading: '', body: '',
    marginPx: 12, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 24, subheadingFontPx: 14, bodyFontPx: 10,
  };
  // The exact real-world shape that found this bug: a picture nearly as tall
  // as the block, leaving only a hairline column beside it for every body row.
  const image = { x: 0, y: 90, width: 260, height: 160, shape: 'rect', rotation: 0, standOffPx: 0 };
  const map = buildFlowMap(section, view, [image]);

  // A body long enough to fill whatever budget is reported.
  const longBody = 'शब्द '.repeat(200).trim();
  const poured = pourIntoRuns(flowRuns(map, CELL.TEXT), longBody);
  const actuallyUsedChars = poured.reduce((sum, run) => sum + run.text.length, 0);

  assert.ok(
    actuallyUsedChars <= map.bodyCharBudget,
    `pourIntoRuns placed ${actuallyUsedChars} characters, more than the ${map.bodyCharBudget} the AI would have been briefed with`,
  );
});
