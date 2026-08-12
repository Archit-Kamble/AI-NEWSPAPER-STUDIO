const test = require('node:test');
const assert = require('node:assert/strict');
const { rebalanceFlowAwarePageAssignments } = require('../src/layout/flow-aware-page-balancer');
const { geometryOf } = require('../src/layout/geometry');
const g = geometryOf({}); const left = g.marginXPx; const top = g.regions.inside.content.top;
function story(id, overrides = {}) { return { id, story_type: 'STANDARD', editorial_priority: 3, headline: 'बातमी', body: 'अ'.repeat(100), images: [], ...overrides }; }
function frame(id, overrides = {}) { return { id, section_key: id, x_px: left, y_px: top, width_px: 300, height_px: 220, block_type: 'article', recommendedStoryType: 'STANDARD', headline_font_px: 30, subheading_font_px: 16, body_font_px: 16, margin_px: 12, line_height: 1.45, ...overrides }; }
function plan(items) { return { assignments: items.map(([storyId, frameId]) => ({ storyId, frameId })) }; }
function pairs(result) { return Object.fromEntries(result.finalPlan.assignments.map((item) => [item.storyId, item.frameId])); }

test('flow-aware local repair swaps current copy into better-fitting frames with a strict gain', async () => {
  const stories = [story('short', { body: 'लहान.' }), story('long', { body: 'अ'.repeat(350) })];
  const frames = [frame('large', { width_px: 420, height_px: 280 }), frame('small', { x_px: left + 430, width_px: 180, height_px: 120 })];
  const result = await rebalanceFlowAwarePageAssignments(stories, frames, { initialPlan: plan([['short', 'large'], ['long', 'small']]) });
  assert.deepEqual(pairs(result), { short: 'small', long: 'large' }); assert.equal(result.improvements[0].type, 'SWAP');
  assert.ok(result.finalObjective > result.initialObjective); assert.ok(result.improvements.every((item) => item.delta > 0));
});

test('lead hierarchy and structured semantic frames survive flow-aware rebalancing', async () => {
  const stories = [story('lead', { story_type: 'LEAD', editorial_priority: 5, body: 'लहान.' }), story('ad', { story_type: 'ADVERTISEMENT' }), story('card', { story_type: 'SMART_CARD', smart_card_key: 'r', smart_card_data: {} })];
  const frames = [frame('dominant', { width_px: 430, height_px: 300 }), frame('tiny', { x_px: left + 440, width_px: 120, height_px: 90 }), frame('ad-frame', { block_type: 'advert', recommendedStoryType: 'ADVERTISEMENT' }), frame('card-frame', { recommendedStoryType: 'SMART_CARD' })];
  const result = await rebalanceFlowAwarePageAssignments(stories, frames);
  assert.equal(pairs(result).lead, 'dominant'); assert.equal(pairs(result).ad, 'ad-frame'); assert.equal(pairs(result).card, 'card-frame');
  assert.ok(result.finalPlan.assignments.every((item) => !item.reasons.some((reason) => reason.code === 'HARD_SEMANTIC_INCOMPATIBILITY')));
});

test('precomputed matrix is used once, deterministic, immutable, and can be supplied by caller', async () => {
  const stories = [story('one'), story('two', { body: 'अ'.repeat(300) })]; const frames = [frame('one'), frame('two', { x_px: left + 320, width_px: 170, height_px: 120 })]; const before = structuredClone({ stories, frames });
  const first = await rebalanceFlowAwarePageAssignments(stories, frames);
  const second = await rebalanceFlowAwarePageAssignments(stories, frames, { pairMatrix: { evaluations: first.initialPlan.assignments.length ? (await require('../src/layout/flow-aware-page-planner').buildFlowAwarePairEvaluations(stories, frames)).evaluations : [], diagnostics: first.diagnostics } });
  assert.equal(first.diagnostics.measuredFitPairs + first.diagnostics.skippedFitPairs, first.diagnostics.totalPairs);
  assert.deepEqual({ stories, frames }, before); assert.ok(first.finalObjective >= first.initialObjective); assert.ok(second.finalObjective >= second.initialObjective);
});
