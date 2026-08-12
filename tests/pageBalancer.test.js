const test = require('node:test');
const assert = require('node:assert/strict');
const { rebalancePageAssignments, candidatePage } = require('../src/layout/page-balancer');
const { geometryOf } = require('../src/layout/geometry');
const { analyzeLayout } = require('../src/layout/layout-quality');

const geometry = geometryOf({});
const top = geometry.regions.inside.content.top;
const left = geometry.marginXPx;

function story(id, overrides = {}) {
  return { id, story_type: 'STANDARD', editorial_priority: 3, headline: `Story ${id}`, body: 'Printable copy.', ...overrides };
}
function frame(id, overrides = {}) {
  return { id, block_type: 'article', story_type: 'STANDARD', x_px: left, y_px: top, width_px: 150, height_px: 120, ...overrides };
}
function plan(assignments) {
  return { assignments: assignments.map(([storyId, frameId]) => ({ storyId, frameId })) };
}
function pairs(result) { return Object.fromEntries(result.finalPlan.assignments.map((item) => [item.storyId, item.frameId])); }

test('already optimal B5A assignment remains unchanged at a local optimum', () => {
  const stories = [story('lead', { story_type: 'LEAD', editorial_priority: 5 }), story('brief', { story_type: 'BRIEF', editorial_priority: 1 })];
  const frames = [frame('large', { width_px: 420, height_px: 280 }), frame('small', { x_px: left + 440, width_px: 120, height_px: 100 })];
  const result = rebalancePageAssignments(stories, frames);
  assert.deepEqual(pairs(result), { lead: 'large', brief: 'small' });
  assert.equal(result.iterations, 0);
  assert.equal(result.terminationReason, 'LOCAL_OPTIMUM');
});

test('a poor semantic assignment is improved by a swap and canonical analyzer quality rises', () => {
  const stories = [story('lead', { story_type: 'LEAD', editorial_priority: 5 }), story('brief', { story_type: 'BRIEF', editorial_priority: 1 })];
  const frames = [frame('large', { width_px: 420, height_px: 280 }), frame('small', { x_px: left + 440, width_px: 120, height_px: 100 })];
  const initialPlan = plan([['lead', 'small'], ['brief', 'large']]);
  const result = rebalancePageAssignments(stories, frames, { initialPlan });
  assert.deepEqual(pairs(result), { lead: 'large', brief: 'small' });
  assert.equal(result.improvements[0].type, 'SWAP');
  assert.ok(result.finalObjective > result.initialObjective);
  assert.ok(result.improvements.every((item) => item.delta > 0));
  assert.ok(result.diagnostics.layoutQuality.score > analyzeLayout(candidatePage([1, 0], stories, frames, {})).score);
});

test('a story moves into an empty better frame without claiming a whitespace change from a swap', () => {
  const stories = [story('brief', { story_type: 'BRIEF', editorial_priority: 2 })];
  const frames = [frame('large', { width_px: 400, height_px: 260 }), frame('compact', { x_px: left + 420, width_px: 110, height_px: 96 })];
  const result = rebalancePageAssignments(stories, frames, { initialPlan: plan([['brief', 'large']]) });
  assert.deepEqual(pairs(result), { brief: 'compact' });
  assert.equal(result.improvements[0].type, 'MOVE');
  assert.ok(result.finalObjective > result.initialObjective);
});

test('an unassigned priority-five story replaces a low-value assigned story when beneficial', () => {
  const stories = [story('low', { editorial_priority: 1 }), story('lead', { story_type: 'LEAD', editorial_priority: 5 })];
  const frames = [frame('dominant', { width_px: 430, height_px: 280 })];
  const result = rebalancePageAssignments(stories, frames, { initialPlan: plan([['low', 'dominant']]) });
  assert.deepEqual(pairs(result), { lead: 'dominant' });
  assert.equal(result.improvements[0].type, 'REPLACE');
  assert.equal(result.finalPlan.unassignedStories[0].storyId, 'low');
});

test('advertisements and Smart Cards remain in their compatible special frames', () => {
  const stories = [
    story('ad', { story_type: 'ADVERTISEMENT', headline: 'Sale' }),
    story('card', { story_type: 'SMART_CARD', smart_card_key: 'rashi', smart_card_data: { items: [] } }),
  ];
  const frames = [
    frame('ad-frame', { block_type: 'advert', story_type: 'ADVERTISEMENT' }),
    frame('card-frame', { block_type: 'feature', story_type: 'SMART_CARD', x_px: left + 180 }),
  ];
  const result = rebalancePageAssignments(stories, frames, { initialPlan: plan([['ad', 'ad-frame'], ['card', 'card-frame']]) });
  assert.deepEqual(pairs(result), { ad: 'ad-frame', card: 'card-frame' });
  assert.ok(result.finalPlan.assignments.every((item) => item.score >= 0));
});

test('realistic seven-story candidate is deterministic, immutable, and strictly improves', () => {
  const stories = [
    story('lead', { story_type: 'LEAD', editorial_priority: 5 }), story('secondary', { story_type: 'SECONDARY', editorial_priority: 4 }),
    story('standard'), story('brief', { story_type: 'BRIEF', editorial_priority: 2 }),
    story('photo', { story_type: 'PHOTO_FEATURE', editorial_priority: 4, images: [{ source_width_px: 1200, source_height_px: 700 }] }),
    story('ad', { story_type: 'ADVERTISEMENT', headline: 'Offer' }), story('card', { story_type: 'SMART_CARD', smart_card_key: 'weather', smart_card_data: { items: [] } }),
  ];
  const frames = [
    frame('dominant', { width_px: 390, height_px: 280 }), frame('medium', { x_px: left + 400, width_px: 210, height_px: 180 }),
    frame('compact', { y_px: top + 290, width_px: 110, height_px: 96 }), frame('image', { x_px: left + 120, y_px: top + 290, width_px: 300, height_px: 180 }),
    frame('standard', { x_px: left + 430, y_px: top + 290, width_px: 180, height_px: 180 }),
    frame('ad-frame', { block_type: 'advert', story_type: 'ADVERTISEMENT', y_px: top + 480, width_px: 280, height_px: 100 }),
    frame('card-frame', { block_type: 'feature', story_type: 'SMART_CARD', x_px: left + 300, y_px: top + 480, width_px: 310, height_px: 100 }),
  ];
  const initialPlan = plan([['lead', 'compact'], ['secondary', 'medium'], ['standard', 'dominant'], ['brief', 'image'], ['photo', 'standard'], ['ad', 'ad-frame'], ['card', 'card-frame']]);
  const frozen = structuredClone({ stories, frames, initialPlan });
  const first = rebalancePageAssignments(stories, frames, { initialPlan });
  assert.ok(first.finalObjective > first.initialObjective);
  assert.ok(first.improvements.length > 0);
  assert.deepEqual(first, rebalancePageAssignments(stories, frames, { initialPlan }));
  assert.deepEqual({ stories, frames, initialPlan }, frozen);
  assert.ok(first.finalPlan.assignments.every((item) => item.reasons.every((reason) => reason.code !== 'HARD_SEMANTIC_INCOMPATIBILITY')));
});

test('iteration limit is explicit and objective never declines', () => {
  const result = rebalancePageAssignments([story('brief', { story_type: 'BRIEF' })], [frame('large', { width_px: 400, height_px: 260 }), frame('small', { x_px: left + 410, width_px: 100, height_px: 90 })], {
    initialPlan: plan([['brief', 'large']]), maxIterations: 0,
  });
  assert.equal(result.terminationReason, 'ITERATION_LIMIT');
  assert.equal(result.finalObjective, result.initialObjective);
});
