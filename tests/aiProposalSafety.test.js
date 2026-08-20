// A proposal is measured against one exact block snapshot. It may only enter
// the draft while the live block still has that same typography, columns,
// pictures and words; otherwise a response that fitted at 10px can be accepted
// into a 14px body and overflow immediately.

const test = require('node:test');
const assert = require('node:assert/strict');

let adapter;
let panel;

test.before(async () => {
  adapter = await import('../public/editor/compose/section-adapter.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  panel = await import('../public/editor/external-editor/ai-panel.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
});

const SECTION = {
  width_px: 307, height_px: 296, margin_px: 1, column_count: 1,
  headline_font_px: 16, subheading_font_px: 15, body_font_px: 6.4,
  line_height: 1.45, block_type: 'article', location: 'सातारा',
};
const VIEW = {
  headline: 'शहरातील रस्त्यांच्या दुरुस्तीला सुरुवात',
  subheading: 'नागरिकांच्या मागणीनंतर कामाला वेग',
  body: 'सातारा शहरातील प्रमुख रस्त्यांच्या दुरुस्तीचे काम सुरू करण्यात आले आहे.',
  bodyFontPx: 6.4, headlineFontPx: 16, subheadingFontPx: 15,
  marginPx: 1, lineHeight: 1.45, columnCount: 1,
};

test('an exact-fit proposal can be accepted only against the snapshot it was measured on', () => {
  const proposal = {
    headline: VIEW.headline, subheading: VIEW.subheading, body: VIEW.body,
  };
  const composed = adapter.composeSection({ ...SECTION, images: [] }, { ...VIEW, ...proposal });

  assert.equal(panel.proposalSnapshotMatches(SECTION, VIEW, [], proposal, composed.fingerprint), true);
  assert.equal(panel.proposalSnapshotMatches(
    SECTION, { ...VIEW, bodyFontPx: 14 }, [], proposal, composed.fingerprint,
  ), false, 'a live body-size change invalidates the measured proposal');
  assert.equal(panel.proposalSnapshotMatches(
    SECTION, { ...VIEW, columnCount: 2 }, [], proposal, composed.fingerprint,
  ), false, 'a live column change invalidates the measured proposal');
  assert.equal(panel.proposalSnapshotMatches(
    SECTION, VIEW, [{ x_px: 120, y_px: 100, width_px: 100, height_px: 100 }],
    proposal, composed.fingerprint,
  ), false, 'a live picture change invalidates the measured proposal');
});

test('an overset or headline-underfilled proposal is never accept-enabled', () => {
  assert.equal(panel.proposalCannotPrint({ overflowing: true }), true);
  assert.equal(panel.proposalCannotPrint({ displayOverflowing: true }), true);
  assert.equal(panel.proposalCannotPrint({ engineState: 'OVERSET' }), true);
  assert.equal(panel.proposalCannotPrint({ state: 'HEADLINE_UNDERFILLED' }), true);
  assert.equal(panel.proposalCannotPrint({ state: 'SOURCE_LIMITED_UNDERFILL' }), false,
    'an honest lack of factual material remains an editorial decision, not invented filler');
});
