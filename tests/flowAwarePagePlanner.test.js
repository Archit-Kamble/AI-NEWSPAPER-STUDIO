const test = require('node:test');
const assert = require('node:assert/strict');
const { planPageAssignments } = require('../src/layout/page-assignment');
const { buildFlowAwarePairEvaluations, planFlowAwarePageAssignments, FLOW_AWARE_V1 } = require('../src/layout/flow-aware-page-planner');
const { geometryOf } = require('../src/layout/geometry');
const g = geometryOf({}); const left = g.marginXPx; const top = g.regions.inside.content.top;
function story(id, overrides = {}) { return { id, story_type: 'STANDARD', editorial_priority: 3, headline: 'बातमी', body: 'अ'.repeat(100), images: [], ...overrides }; }
function frame(id, overrides = {}) { return { id, section_key: id, block_type: 'article', recommendedStoryType: 'STANDARD', x_px: left, y_px: top, width_px: 300, height_px: 220, headline_font_px: 30, subheading_font_px: 16, body_font_px: 16, margin_px: 12, line_height: 1.45, ...overrides }; }
function pairs(plan) { return Object.fromEntries(plan.assignments.map((item) => [item.storyId, item.frameId])); }

test('flow-aware assignment prefers a good current-copy fit where semantic fit is comparable', async () => {
  const stories = [story('short', { body: 'लहान.' }), story('long', { body: 'अ'.repeat(350) })];
  const frames = [frame('large', { width_px: 420, height_px: 280 }), frame('small', { x_px: left + 430, width_px: 180, height_px: 120 })];
  const semantic = planPageAssignments(stories, frames);
  const flow = await planFlowAwarePageAssignments(stories, frames);
  assert.deepEqual(pairs(flow), { short: 'small', long: 'large' });
  assert.equal(flow.diagnostics.assignmentChanges.length, 0);
});

test('lead hierarchy and priority survive better-fit pressure', async () => {
  const stories = [story('lead', { story_type: 'LEAD', editorial_priority: 5, body: 'लहान.' }), story('standard', { body: 'अ'.repeat(600) })];
  const frames = [frame('dominant', { width_px: 430, height_px: 300 }), frame('tiny', { x_px: left + 440, width_px: 130, height_px: 90 })];
  const plan = await planFlowAwarePageAssignments(stories, frames);
  assert.equal(pairs(plan).lead, 'dominant');
  assert.equal(plan.unassignedStories.length, 0);
});

test('hard rejects skip fit measurement and structured fit uses semantic-only weighting', async () => {
  const stories = [story('ad', { story_type: 'ADVERTISEMENT' }), story('smart', { story_type: 'SMART_CARD', smart_card_key: 'r', smart_card_data: {} })];
  const frames = [frame('ad-frame', { block_type: 'advert', recommendedStoryType: 'ADVERTISEMENT' }), frame('card-frame', { recommendedStoryType: 'SMART_CARD' })];
  const matrix = await buildFlowAwarePairEvaluations(stories, frames);
  assert.equal(matrix.diagnostics.hardRejectedPairs, 2); assert.equal(matrix.diagnostics.measuredFitPairs, 2);
  assert.equal(matrix.evaluations[0][0].fit.applicable, false); assert.equal(matrix.evaluations[0][0].fitContributionApplied, 0);
  const plan = await planFlowAwarePageAssignments(stories, frames);
  assert.deepEqual(pairs(plan), { ad: 'ad-frame', smart: 'card-frame' });
});

test('unresolved image placement reduces fit weight, is deterministic, immutable and bounded', async () => {
  const stories = [story('photo', { story_type: 'PHOTO_FEATURE', body: 'अ'.repeat(300), images: [{ x_px: 0, y_px: 0, width_px: 200, height_px: 100 }] })];
  const frames = [frame('other', { width_px: 360, height_px: 220 })]; const before = structuredClone({ stories, frames });
  const first = await planFlowAwarePageAssignments(stories, frames);
  assert.equal(first.pairEvaluations[0][0].fitContributionApplied, FLOW_AWARE_V1.unresolvedImageFitWeight);
  assert.deepEqual(first, await planFlowAwarePageAssignments(stories, frames)); assert.deepEqual({ stories, frames }, before);
  assert.ok(first.score >= 0 && first.score <= 100);
});
