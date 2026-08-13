const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreStoryForFrame } = require('../src/layout/story-frame-compatibility');
const { storyPacketFromSection, frameDescriptorFromSection, projectStoryIntoFrame, compositionInputForPage } = require('../src/layout/composition-adapter');

function section(overrides = {}) { return { id: 1, section_key: 'one', x_px: 10, y_px: 20, width_px: 100, height_px: 80, z_index: 2, block_type: 'article', story_type: 'LEAD', editorial_priority: 5, headline: 'Headline', body: 'Body', reporter_name: 'Byline', feature_key: null, headline_font_px: 50, images: [], ...overrides }; }

test('template recommendation, not current story, defines frame semantics', () => {
  const current = section({ story_type: 'BRIEF' });
  const frame = frameDescriptorFromSection(current, { key: 'one', storyType: 'QUOTE' });
  assert.equal(frame.recommendedStoryType, 'QUOTE');
  current.story_type = 'LEAD';
  assert.equal(frameDescriptorFromSection(current, { key: 'one', storyType: 'QUOTE' }).recommendedStoryType, 'QUOTE');
  assert.equal(frameDescriptorFromSection(section({ block_type: 'feature' }), { key: 'one', storyType: 'QUOTE' }).recommendedStoryType, 'QUOTE');
});

test('explicit advert frame hard-rejects editorial content', () => {
  const result = scoreStoryForFrame({ story_type: 'STANDARD' }, frameDescriptorFromSection(section({ block_type: 'advert' }), { storyType: 'ADVERTISEMENT' }));
  assert.equal(result.hardReject, true);
});

test('legacy occupied advert slots are locked instead of treated as editorial movable stories', () => {
  const advert = section({ id: 9, section_key: 'sold', block_type: 'advert', story_type: 'STANDARD' });
  const input = compositionInputForPage({ sections: [advert] }, { sections: [{ key: 'sold', storyType: 'ADVERTISEMENT' }] });
  assert.deepEqual(input.lockedSections, [{ sectionId: 9, sectionKey: 'sold', reason: 'NON_MOVABLE_PHYSICAL_SLOT' }]);
});

test('allowlisted projection transfers story content but preserves target frame identity and treatment', () => {
  const packet = storyPacketFromSection(section({ id: 'story', images: [{ x_px: 5, y_px: 4, width_px: 30, height_px: 20, url: 'x' }] }));
  const target = frameDescriptorFromSection(section({ id: 'target', section_key: 'target-key', x_px: 300, block_type: 'feature', feature_key: 'weather', headline_font_px: 22, column_count: 3 }), { storyType: 'SMART_CARD', featureKey: 'weather' });
  const projected = projectStoryIntoFrame(packet, target);
  assert.equal(packet.x_px, undefined);
  assert.equal(projected.id, 'target'); assert.equal(projected.section_key, 'target-key'); assert.equal(projected.x_px, 300);
  assert.equal(projected.block_type, 'feature'); assert.equal(projected.feature_key, 'weather'); assert.equal(projected.headline_font_px, 22); assert.equal(projected.column_count, 3);
  assert.equal(projected.headline, 'Headline'); assert.equal(projected.reporter_name, 'Byline'); assert.equal(projected.story_type, 'LEAD');
  assert.equal(projected.imagePlacementNeedsReview, true);
});

test('composition input locks continuations, standing features and image-only companions while retaining standalone photo stories', () => {
  const source = section({ id: 10, section_key: 'source' });
  const page = { sections: [
    source, section({ id: 11, section_key: 'fragment', continued_from_section_id: 10 }),
    section({ id: 12, section_key: 'standing', feature_key: 'rashi', smart_card_key: 'rashi', smart_card_data: {} }),
    section({ id: 13, section_key: 'image-only', headline: '', body: '', images: [{ url: 'photo' }] }),
    section({ id: 14, section_key: 'photo-story', story_type: 'PHOTO_FEATURE', headline: 'Photo caption', images: [{ url: 'photo' }] }),
  ] };
  const template = { sections: page.sections.map((item) => ({ key: item.section_key, storyType: item.story_type || 'STANDARD', featureKey: item.feature_key || null })) };
  const input = compositionInputForPage(page, template, { continuationSourceIds: new Set([10]) });
  assert.deepEqual(input.lockedSections.map((item) => item.reason), ['CONTINUATION_SOURCE', 'CONTINUATION_FRAGMENT', 'STANDING_FEATURE', 'IMAGE_ONLY_COMPANION']);
  assert.deepEqual(input.movableStories.map((item) => item.id), [14]);
  assert.equal(input.diagnostics.sectionCount, 5);
  assert.equal(new Set(input.diagnostics.accountedSectionKeys).size, 5);
});

test('continuation source is locked along with its landing fragment', () => {
  const original = section({ id: 'original', section_key: 'original', headline: 'मूळ', body: 'प्रत' });
  const landing = section({ id: 'landing', section_key: 'landing', continued_from_section_id: 'original' });
  const input = compositionInputForPage({ sections: [original, landing] }, { sections: [] }, { continuationSourceIds: new Set(['original']) });
  assert.deepEqual(input.lockedSections.map((item) => item.reason).sort(), ['CONTINUATION_FRAGMENT', 'CONTINUATION_SOURCE']);
});
