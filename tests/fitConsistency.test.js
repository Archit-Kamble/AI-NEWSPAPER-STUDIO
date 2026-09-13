// A real bug, found by measuring a live block rather than assuming: a 268x304
// block carrying a headline, a subheading and 436 characters of real Marathi
// body copy was reported as "436 of 360 characters" - over budget, flagged
// overflowing - while the actual rendered content used about 79% of the
// block's real height, comfortably inside it. Two things caused it, both
// fixed here:
//
//   1. layout-metrics.js#computeMetrics estimated text height with its own
//      copy of the character-grid's formula, at a hardcoded 1.25 line height
//      instead of the Devanagari-safe 1.45 text-flow.js already enforced -
//      so its "how full is this block" answer and the grid's disagreed.
//   2. AVG_CHAR_WIDTH_RATIO (0.5) overstated real glyph width by 25-40%
//      against measured Noto Serif Devanagari and Georgia rendering, so the
//      grid always believed noticeably fewer characters fit per line than
//      actually do - understating real capacity and, through the AI brief
//      that number becomes, under-filling every block that used it.

const test = require('node:test');
const assert = require('node:assert/strict');

test('a block section-model.js resolves floors line height at the Devanagari-safe minimum', async () => {
  const { draftFromSection } = await import('../public/editor/section-model.js');
  const { MIN_LINE_HEIGHT } = await import('../public/editor/layout/text-flow.js');

  assert.equal(draftFromSection({ line_height: null }).lineHeight, MIN_LINE_HEIGHT);
  assert.equal(draftFromSection({}).lineHeight, MIN_LINE_HEIGHT);
  // Even an explicit value below the floor is floored - this is a property of
  // the script, not a taste setting (text-flow.js's own words for it). The
  // draft floors at the tightest MEASURED face (Noto Sans Devanagari's ink box,
  // 1.305 em); the compositor then floors every block again at its own face's
  // ink, which the test below holds for the serif.
  const { MIN_MEASURED_LINE_HEIGHT } = await import('../public/editor/layout/text-flow.js');
  assert.equal(draftFromSection({ line_height: 1.0 }).lineHeight, MIN_MEASURED_LINE_HEIGHT);
  // A value above the floor is left alone.
  assert.equal(draftFromSection({ line_height: 1.8 }).lineHeight, 1.8);
});

test('layout-metrics and text-flow can no longer silently disagree about line height', async () => {
  const { computeMetrics } = await import('../public/editor/layout/layout-metrics.js');
  const { estimateHeight } = await import('../public/editor/layout/text-flow.js');

  const section = { width_px: 268, height_px: 304 };
  const view = { headlineFontPx: 24, subheadingFontPx: 13, bodyFontPx: 12, lineHeight: 1.45 };
  const headline = 'साताऱ्यातील राजकीय घडामोडींना वेग';

  const metrics = computeMetrics(section, { ...view, headline });
  const directEstimate = estimateHeight(headline, view.headlineFontPx, section.width_px - 24);

  // Not "close" - identical, because computeMetrics now calls the same
  // function rather than keeping a second copy that could drift again.
  assert.equal(metrics.headlineHeightPx, directEstimate);
});

test('the reported fit no longer falsely claims overflow for a block that visibly still has room', async () => {
  const { buildFlowMap, flowFit } = await import('../public/editor/layout/text-flow.js');

  // The exact scenario measured live: a 268x304 anchor block, a headline and
  // subheading typical of a district political story, and 436 characters of
  // body copy that real, rendered measurement showed using about 79% of the
  // block's real height - not overflowing.
  const section = { width_px: 268, height_px: 304 };
  const view = {
    headline: 'साताऱ्यातील राजकीय घडामोडींना वेग',
    subheading: 'स्थानिक नेत्यांच्या भेटीगाठींमुळे तर्कवितर्कांना उधाण',
    headlineFontPx: 24,
    subheadingFontPx: 13,
    bodyFontPx: 12,
    lineHeight: 1.45,
    marginPx: 12,
    body: 'सातारा : जिल्ह्यातील राजकीय घडामोडींना गेल्या काही दिवसांपासून वेग आला असून विविध पक्षांच्या नेत्यांमध्ये सातत्याने बैठका होत आहेत. आगामी निवडणुकांच्या पार्श्वभूमीवर स्थानिक पातळीवर मोर्चेबांधणी सुरू झाली असून कार्यकर्त्यांमध्येही उत्साहाचे वातावरण आहे. जिल्ह्यातील ज्येष्ठ नेत्यांनी घेतलेल्या भूमिकेमुळे तालुक्यातील समीकरणे बदलण्याची शक्यता वर्तवली जात आहे. यासंदर्भात लवकरच अधिकृत घोषणा होण्याची शक्यता राजकीय वर्तुळात व्यक्त होत आहे.',
  };

  const map = buildFlowMap(section, view, []);
  const fit = flowFit(map);

  assert.equal(view.body.length, 436, 'the fixture body is the exact 436-character sample that was measured live');
  assert.ok(!fit.overflowing, `budget grew to ${map.bodyCharBudget}; 436 characters no longer reads as overflowing it`);
  assert.ok(fit.ratio < 1, 'the ratio itself should read under 100%, not clamped there by an undercounted budget');
});

// Last in this file on purpose: it loads the real fonts, and the planner tests
// above assert the numbers of the path used BEFORE fonts have loaded.
test('a serif block asking for the sans floor still sets at the serif\'s own ink box, and a sans block at its own', async () => {
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
  // The serif has always been floored at its hhea box; lowering the draft's
  // clamp must not move it by a hair.
  assert.equal(metrics.minLineHeightFor('serif', 400), 1.5550000000000002);
  // Noto Sans Devanagari's measured ink is 1.305 em - no matra of it reaches
  // past that - so that, and not the serif's 1.45, is its floor.
  assert.equal(metrics.minLineHeightFor('sans', 400), 1.305);
  // A face nobody has measured keeps the conservative floor.
  assert.ok(metrics.minLineHeightFor('tiro', 400) >= 1.45);
});
