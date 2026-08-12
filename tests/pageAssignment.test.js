const test = require('node:test');
const assert = require('node:assert/strict');
const { planPageAssignments } = require('../src/layout/page-assignment');

function story(id, overrides = {}) {
  return { id, story_type: 'STANDARD', editorial_priority: 3, ...overrides };
}
function frame(id, overrides = {}) {
  return { id, block_type: 'article', story_type: 'STANDARD', width_px: 200, height_px: 180, ...overrides };
}
const pairs = (result) => Object.fromEntries(result.assignments.map((item) => [item.storyId, item.frameId]));

test('planner globally maximizes assignment instead of greedy local selection', () => {
  // B needs the dominant frame far more than A; global matching gives A the
  // flexible compact frame and B the dominant one.
  const large = frame('large', { width_px: 440, height_px: 300 });
  const compact = frame('compact', { width_px: 120, height_px: 100 });
  const result = planPageAssignments([
    story('a', { story_type: 'STANDARD', editorial_priority: 3 }),
    story('b', { story_type: 'LEAD', editorial_priority: 5 }),
  ], [large, compact]);
  assert.deepEqual(pairs(result), { a: 'compact', b: 'large' });
});

test('lead, brief, photo feature, advertisement and Smart Card choose their compatible frames', () => {
  const leadFrame = frame('lead', { width_px: 420, height_px: 300 });
  const briefFrame = frame('brief', { width_px: 100, height_px: 100 });
  const photoFrame = frame('photo', { width_px: 400, height_px: 220 });
  const advertFrame = frame('advert', { block_type: 'advert', story_type: 'ADVERTISEMENT', width_px: 300, height_px: 180 });
  const cardFrame = frame('card', { block_type: 'feature', story_type: 'SMART_CARD', width_px: 240, height_px: 180 });
  const result = planPageAssignments([
    story('lead', { story_type: 'LEAD', editorial_priority: 5 }),
    story('brief', { story_type: 'BRIEF', editorial_priority: 2 }),
    story('photo', { story_type: 'PHOTO_FEATURE', editorial_priority: 4, images: [{ source_width_px: 1200, source_height_px: 700 }] }),
    story('advert', { story_type: 'ADVERTISEMENT', editorial_priority: 1 }),
    story('card', { story_type: 'SMART_CARD', smart_card_key: 'rashi', smart_card_data: { items: [] } }),
  ], [leadFrame, briefFrame, photoFrame, advertFrame, cardFrame]);
  assert.deepEqual(pairs(result), { lead: 'lead', brief: 'brief', photo: 'photo', advert: 'advert', card: 'card' });
});

test('hard-rejected pairs are never selected and all-invalid stories remain unassigned', () => {
  const advert = frame('advert', { block_type: 'advert', story_type: 'ADVERTISEMENT' });
  const card = frame('card', { block_type: 'feature', story_type: 'SMART_CARD' });
  const result = planPageAssignments([
    story('smart', { story_type: 'SMART_CARD', smart_card_key: 's', smart_card_data: {} }),
    story('ad', { story_type: 'ADVERTISEMENT' }),
    story('normal'),
  ], [advert, card]);
  assert.equal(pairs(result).smart, 'card');
  assert.equal(pairs(result).ad, 'advert');
  assert.equal(result.unassignedStories[0].storyId, 'normal');
  assert.ok(result.diagnostics.hardRejectedPairCount >= 2);
});

test('a story with only hard-rejected frames remains unassigned', () => {
  const result = planPageAssignments([
    story('smart', { story_type: 'SMART_CARD', smart_card_key: 's', smart_card_data: {} }),
  ], [frame('advert', { block_type: 'advert', story_type: 'ADVERTISEMENT' })]);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.unassignedStories, [{ storyId: 'smart', reason: 'NO_COMPATIBLE_FRAME', priority: 3 }]);
  assert.deepEqual(result.emptyFrames, [{ frameId: 'advert' }]);
});

test('different counts yield explicit empty frames and priority-aware unassigned stories', () => {
  const result = planPageAssignments([
    story('lead', { story_type: 'LEAD', editorial_priority: 5 }),
    story('brief', { story_type: 'BRIEF', editorial_priority: 1 }),
    story('standard'),
  ], [frame('only', { width_px: 420, height_px: 300 })]);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.unassignedStories.length, 2);
  assert.equal(result.emptyFrames.length, 0);

  const spare = planPageAssignments([story('one')], [frame('one'), frame('two')]);
  assert.equal(spare.emptyFrames.length, 1);
});

test('higher-priority story wins when only one compatible frame is available', () => {
  const result = planPageAssignments([
    story('low', { editorial_priority: 1 }),
    story('high', { editorial_priority: 5 }),
  ], [frame('only')]);
  assert.deepEqual(pairs(result), { high: 'only' });
  assert.deepEqual(result.unassignedStories, [{ storyId: 'low', reason: 'UNASSIGNED_BY_GLOBAL_MATCH', priority: 1 }]);
});

test('planner is deterministic, immutable, bounded, and supports legacy metadata', () => {
  const stories = [story('one', { story_type: undefined, editorial_priority: undefined }), story('two')];
  const frames = [frame('one', { story_type: undefined }), frame('two')];
  const context = { editorialFrames: frames };
  const original = structuredClone({ stories, frames, context });
  const first = planPageAssignments(stories, frames, context);
  assert.deepEqual(first, planPageAssignments(stories, frames, context));
  assert.deepEqual({ stories, frames, context }, original);
  assert.ok(first.score >= 0 && first.score <= 100);
});

test('equal-score choices resolve by original frame order', () => {
  const result = planPageAssignments([story('first')], [frame('a'), frame('b')]);
  assert.deepEqual(pairs(result), { first: 'a' });
  assert.ok(Number.isFinite(result.diagnostics.compatibilityTotal));
  assert.ok(Number.isFinite(result.diagnostics.averageCompatibility));
});
