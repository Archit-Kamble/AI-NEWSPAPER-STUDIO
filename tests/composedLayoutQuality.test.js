const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeComposedLayout, flowView } = require('../src/layout/composed-layout-quality');
const { geometryOf } = require('../src/layout/geometry');

const g = geometryOf({}); const left = g.marginXPx; const top = g.regions.inside.content.top;
function section(overrides = {}) { return { section_key: 'story', x_px: left, y_px: top, width_px: 400, height_px: 300, headline: 'मोठी बातमी', body: 'थोडी बातमी.', story_type: 'STANDARD', editorial_priority: 4, headline_font_px: 30, subheading_font_px: 16, body_font_px: 16, margin_px: 12, line_height: 1.45, images: [], ...overrides }; }
function page(sections) { return { page_number: 2, sections }; }

test('canonical flow detects a giant frame with tiny copy while frame occupancy remains occupied', async () => {
  const result = await analyzeComposedLayout(page([section()]));
  assert.equal(result.metrics.occupancyRatio > 0, true);
  assert.ok(result.metrics.effectiveUtilizationRatio < result.metrics.occupancyRatio);
  assert.ok(result.findings.some((item) => item.code === 'SEVERELY_UNDERFILLED_SECTION'));
  assert.ok(result.findings.some((item) => item.code === 'UNDERFILLED_DOMINANT_FRAME'));
});

test('near-capacity body is not severely underfilled and direct buildFlowMap cannot drift', async () => {
  const { buildFlowMap, flowImageFromRow } = await import('../public/editor/layout/text-flow.js');
  const first = section(); const base = buildFlowMap(first, flowView(first), []);
  const filled = section({ body: 'अ'.repeat(Math.max(1, Math.floor(base.bodyCharBudget * 0.9))) });
  const result = await analyzeComposedLayout(page([filled]));
  assert.equal(result.sections[0].bodyCharBudget, buildFlowMap(filled, flowView(filled), []).bodyCharBudget);
  assert.ok(!result.findings.some((item) => item.code === 'SEVERELY_UNDERFILLED_SECTION'));
  const image = { x_px: 140, y_px: 100, width_px: 120, height_px: 120 };
  const withImage = section({ images: [image] });
  const imageResult = await analyzeComposedLayout(page([withImage]));
  assert.equal(imageResult.sections[0].bodyCharBudget, buildFlowMap(withImage, flowView(withImage), [flowImageFromRow(image)]).bodyCharBudget);
});

test('markup is measured as canonical plain text, overflow retains raw evidence, and special renderers are excluded', async () => {
  const markup = section({ body: '<b>थोडी</b> बातमी.' });
  const result = await analyzeComposedLayout(page([markup, section({ section_key: 'overflow', body: 'अ'.repeat(10000) }), section({ section_key: 'card', story_type: 'SMART_CARD', smart_card_key: 'r', smart_card_data: {} }), section({ section_key: 'ad', story_type: 'ADVERTISEMENT' })]));
  assert.equal(result.sections[0].bodyCharsUsed, 'थोडी बातमी.'.length);
  assert.ok(result.sections.find((item) => item.sectionKey === 'overflow').bodyFillRatio > 1);
  assert.ok(result.sections.find((item) => item.sectionKey === 'card').measured === false);
  assert.ok(result.sections.find((item) => item.sectionKey === 'ad').measured === false);
});

test('compact briefs and photo features contribute without generic underfill finding or mutation', async () => {
  const input = page([section({ section_key: 'brief', story_type: 'BRIEF', width_px: 100, height_px: 90 }), section({ section_key: 'photo', story_type: 'PHOTO_FEATURE', images: [{ x_px: 0, y_px: 0, width_px: 380, height_px: 270 }] })]);
  const before = structuredClone(input); const result = await analyzeComposedLayout(input);
  assert.ok(!result.findings.some((item) => item.sectionKey === 'brief' && item.code === 'SEVERELY_UNDERFILLED_SECTION'));
  assert.ok(result.sections.find((item) => item.sectionKey === 'photo').imageRatio > 0);
  assert.deepEqual(input, before);
});
