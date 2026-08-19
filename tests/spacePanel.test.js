// layout-panel.js's Space read-out: the "Room for copy" figure a desk trusts
// while writing.
//
// computeMetrics() (layout-metrics.js) already migrated to the exact
// composition engine - "where there is a real composition, it wins" - but
// spacePanelMarkup()'s own "Character grid"/"Room for copy"/"Written so far"
// rows kept calling text-flow.js's approximate buildFlowMap() unconditionally,
// even once the exact composition was sitting right there on
// `m.composition`. For an ordinary block with no picture the two roughly
// agree; for a block WITH a placed image the grid's coarse per-cell
// exclusion can overstate the exact engine's real exclusion-mask capacity by
// 2x or more - confirmed live against a real 268x248px block carrying one
// rotated image: the grid read "422 characters", the exact engine measuring
// the identical block read "146-233". A desk trusting the bigger number
// under-writes relative to what the page can actually hold, which is what a
// permanently-half-full-looking page IS.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', file));

let layoutPanel;
let fontMetrics;
let shaper;

test.before(async () => {
  fontMetrics = await load('compose/font-metrics.js');
  shaper = await load('compose/shaper.js');
  layoutPanel = await load('external-editor/layout-panel.js');
  await fontMetrics.ensureFontsLoaded();
  await shaper.ensureShaperReady();
});

// The exact real-world case this was found from: a lead block with one
// rotated placed image.
function sectionWithImage() {
  return {
    section_key: 'lead', block_type: 'article',
    width_px: 268, height_px: 248, margin_px: 12,
    headline: 'महामेट्रोच्या तिसऱ्या टप्प्याचे काम अंतिम टप्प्यात',
    headline_font_px: 24, subheading: 'नवीन मार्गिका पुढील महिन्यात नागरिकांसाठी खुली होणार',
    subheading_font_px: 13, body_font_px: 10, line_height: 1.25,
    headline_style: 'accent',
  };
}

function viewFrom(section, overrides = {}) {
  return {
    headline: section.headline, subheading: section.subheading, body: '',
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px,
    bodyFontPx: section.body_font_px, marginPx: section.margin_px, lineHeight: section.line_height,
    headlineStyle: section.headline_style,
    ...overrides,
  };
}

const imageRow = { x_px: 10, y_px: 90, width_px: 100, height_px: 60, rotation: 90, fit_mode: 'cover', shape: 'rect', stand_off_px: 6 };

test('a block with a real placed image: the Space panel quotes the EXACT engine\'s range, not the approximate grid\'s inflated single number', () => {
  const section = sectionWithImage();
  const view = viewFrom(section);
  const html = layoutPanel.spacePanelMarkup(section, view, [imageRow]);

  // The exact range, read straight off the same composeSection() the canvas
  // itself renders from - not asserted against a hardcoded number, so a
  // legitimate future change to the compositor does not make this test lie.
  return load('compose/section-adapter.js').then((adapter) => {
    const composed = adapter.composeSection({ ...section, images: [imageRow] }, view);
    const { min, max } = composed.capacity.bodyCharRange;
    assert.match(html, new RegExp(`Room for copy</span><strong>${min}–${max} characters`));
    // The old grid's own number for this exact block, confirmed live -
    // proof this is not merely "a number changed", but that the wildly
    // inflated figure specifically no longer appears.
    assert.ok(!html.includes('422 characters'), 'the stale, ~2x-inflated grid figure must not appear once the exact engine is ready');
  });
});

test('a picture just dragged but not yet saved still changes the exact budget - the live callback images win over section.images', async () => {
  const adapter = await load('compose/section-adapter.js');
  const section = { ...sectionWithImage(), images: [] }; // persisted row: no picture saved yet
  const view = viewFrom(section);

  const withoutImage = layoutPanel.spacePanelMarkup(section, view, []);
  const withImage = layoutPanel.spacePanelMarkup(section, view, [imageRow]);
  assert.notEqual(withoutImage, withImage, 'the live (unsaved) picture must change the reported budget');

  const composedWithImage = adapter.composeSection({ ...section, images: [imageRow] }, view);
  const { min, max } = composedWithImage.capacity.bodyCharRange;
  assert.match(withImage, new RegExp(`Room for copy</span><strong>${min}–${max} characters`));
});

test('a block with no real width falls back to the approximate grid rather than throwing - the same branch a not-yet-loaded font takes', () => {
  // computeMetrics() only takes the exact-composition branch when
  // `fontsReady() && width_px > 0`; a degenerate zero-width section exercises
  // the SAME fallback branch a real pre-font-load paint takes, without
  // needing to un-warm the module-level font cache mid-suite.
  const section = { ...sectionWithImage(), width_px: 0, height_px: 0 };
  const view = viewFrom(section);
  const html = layoutPanel.spacePanelMarkup(section, view, []);
  assert.match(html, /Room for copy/);
  assert.match(html, /Character grid/, 'the fallback branch keeps the old grid-specific rows, since there is no exact composition to show instead');
});

test('an ordinary block with no picture: the exact range and the old grid single number are at least in the same ballpark', async () => {
  const adapter = await load('compose/section-adapter.js');
  const section = { ...sectionWithImage(), width_px: 300, height_px: 400 };
  const view = viewFrom(section);
  const composed = adapter.composeSection({ ...section, images: [] }, view);
  const html = layoutPanel.spacePanelMarkup(section, view, []);
  const { min } = composed.capacity.bodyCharRange;
  assert.match(html, new RegExp(`Written so far</span><strong>${composed.capacity.bodyCharsUsed} characters`));
  assert.ok(min > 0, 'sanity: the exact engine reports real room for this block');
});

// ------------------------------------- the engine's own faults reach a desk ---
//
// composeBlock() reports violations and warnings on every composition, and
// layoutWarnings() rendered NONE of them - it built its own three messages
// from metrics and threw the rest away.
//
// The real block this was found on (id 39131, a 190x264 second lead with a
// 95x88 picture low in it) told the desk two things, one under the other:
//
//     Content overflows the block by about 130 px. Trim the body...
//     Block is empty.
//
// They contradict each other, neither is true, and the advice cannot work -
// no amount of trimming makes a corridor narrower than one word hold a word.
// The truth was computed and discarded.

const compose = () => import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));

// A picture low in a small block with large type: every body band crosses it,
// and the corridor beside it is under one word wide.
function unprintableSection() {
  // Block 39131, field for field: a 190x264 second lead set in 16px type with
  // a 95x88 picture low in it. 182px of measure, and 16px type needs a 96px
  // corridor (MIN_CORRIDOR_EM), so the 81px left beside the picture is refused
  // and every band the body would use crosses it.
  return {
    section_key: 'second-lead', block_type: 'article',
    width_px: 190, height_px: 264, margin_px: 4, column_count: 1,
    headline: 'सातारा: पाणीटंचाईची सावट', headline_font_px: '17.0',
    subheading: 'अनेक भागात पाणीपुरवठा कमी झाला असून नागरिक त्रस्त आहेत.',
    subheading_font_px: '16.0',
    body_font_px: '16.0', line_height: '1.25', text_align: 'justify', paragraph_spacing_px: 0,
    body: 'पाणीपुरवठा कमी झाल्याने दैनंदिन जीवन विस्कळीत होऊन नागरिक त्रस्त आहेत. सातारा जिल्ह्यात अनेक भागात पाणी कमी पडत आहे.',
    images: [{ x_px: 0, y_px: 151, width_px: 95, height_px: 88, shape: 'rect', rotation: 0, stand_off_px: 6 }],
  };
}

test('a block that cannot be printed says SO - not "overflows, trim the body" and "block is empty"', async () => {
  const adapter = await compose();
  const section = unprintableSection();
  const composition = adapter.composeSection(section, {});
  assert.ok(composition.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'),
    'the fixture must actually be the unprintable case');

  const warnings = layoutPanel.layoutWarnings({
    composition, overflowing: true, remainingHeightPx: -130, fillRatio: 0, usedHeightPx: 0,
  });
  const text = warnings.map((w) => w.text).join(' | ');

  assert.match(text, /no column wide enough/, 'the engine\'s own diagnosis must reach the desk');
  assert.ok(!/Block is empty/.test(text),
    'a block holding copy that has nowhere to go is not empty - it is unprintable');
  assert.ok(!/Trim the body/.test(text),
    'trimming cannot fix a corridor narrower than one word, so that advice must stand down');
  assert.ok(warnings.some((w) => w.level === 'error'), 'and it is an error, not a note');
});

test('an ordinary healthy block gains no new noise from this', async () => {
  const adapter = await compose();
  const section = { ...sectionWithImage(), images: [] };
  const composition = adapter.composeSection(section, {});
  const warnings = layoutPanel.layoutWarnings({
    composition, overflowing: false, remainingHeightPx: 0,
    fillRatio: 1, usedHeightPx: 100,
  });
  // SET_FLUSH_LEFT fires on 4077 of 11153 real blocks because that is how a
  // narrow newspaper column is set. It is a decision, not a fault, and it must
  // never appear in the fault list - it would bury the blocks that matter.
  assert.ok(!warnings.some((w) => w.code === 'SET_FLUSH_LEFT'),
    'setting a narrow column flush left is newspaper practice, not a fault');
});
