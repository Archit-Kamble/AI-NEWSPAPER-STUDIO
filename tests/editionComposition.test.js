const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSourcesToEditionPages, storyPacketFromNewsItem } = require('../src/services/editionComposition.service');

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
