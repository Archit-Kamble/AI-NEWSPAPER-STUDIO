const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSourcesToEditionPages, storyPacketFromNewsItem, composePagePlan, projectComposedStoryIntoSection } = require('../src/services/editionComposition.service');

test('frame-independent sources route deterministically by semantic page role', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const routed = routeSourcesToEditionPages({ pages, sources: [
    { id: 'z', desired_page_role: 'LOCAL', editorial_priority: 2 },
    { id: 'a', desired_page_role: 'LOCAL', editorial_priority: 4 },
    { id: 'f', desired_page_role: 'FEATURES', editorial_priority: 3 },
  ] });
  assert.deepEqual(routed.buckets.get(2).map((source) => source.id), ['a', 'z']);
  assert.deepEqual(routed.buckets.get(3).map((source) => source.id), ['f']);
});

test('newsroom packets retain source copy and do not invent image placement', () => {
  const packet = storyPacketFromNewsItem({ id: 'source', title: 'मथळा', description: 'पुरविलेली बातमी', image_urls: ['/x.jpg'] });
  assert.equal(packet.body, 'पुरविलेली बातमी');
  assert.equal(packet.imagePlacementNeedsReview, true);
  assert.deepEqual(packet.images, []);
});

test('article copy is not fabricated as a deck and is counted only once', async () => {
  const packet = storyPacketFromNewsItem({ id: 'market', title: 'बाजार', description: 'बातमीची पूर्ण प्रत' });
  assert.equal(packet.subheading, '');
  assert.equal(packet.body, 'बातमीची पूर्ण प्रत');
});

test('four-page routing gives general and opinion sources deterministic fallback capacity', () => {
  const pages = [{ page_number: 1 }, { page_number: 2 }, { page_number: 3 }, { page_number: 4 }];
  const routed = routeSourcesToEditionPages({ pages, capacities: new Map([[1, 1], [2, 1], [3, 1], [4, 3]]), sources: [
    { id: 'opinion', desired_page_role: 'OPINION', editorial_priority: 4 },
    { id: 'general', desired_page_role: 'GENERAL', editorial_priority: 3 },
  ] });
  assert.equal(routed.buckets.get(3)[0].id, 'opinion');
  assert.equal(routed.buckets.get(4)[0].id, 'general');
});

test('invalid baseline blocks before an AI call', async () => {
  let calls = 0;
  const page = { id: 'page', page_number: 2, sections: [{ id: 'frame', section_key: 'frame', width_px: 200, height_px: 100, x_px: 0, y_px: 0 }] };
  const plan = { page, frames: [{ id: 'frame', section_key: 'frame' }], assignments: [{ storyId: 'story', frameId: 'frame' }] };
  const result = await composePagePlan({ pagePlan: plan, sourcesById: new Map([['story', { id: 'story' }]]), newspaper: {}, askForJson: async () => { calls += 1; return {}; } });
  assert.equal(result.error, 'BASELINE_PREFLIGHT_INVALID');
  assert.equal(calls, 0);
});

test('composed projection mirrors persisted semantics but preserves frame geometry', () => {
  const section = { id: 7, section_key: 'f', x_px: 10, y_px: 20, width_px: 100, height_px: 80, body_font_px: 16 };
  const candidate = { source: { category: 'स्थानिक', reporterName: 'वार्ताहर' }, result: { editorial: { storyType: 'LEAD', editorialPriority: 5 } }, compiled: { headline: 'मथळा', subheading: '', body: 'प्रत', kicker: '', caption: '', presentation: { annotations: [] } } };
  const projected = projectComposedStoryIntoSection(section, candidate);
  assert.equal(projected.story_type, 'LEAD'); assert.equal(projected.editorial_priority, 5);
  assert.equal(projected.width_px, 100); assert.equal(projected.y_px, 20);
});
