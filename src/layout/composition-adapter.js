// The explicit boundary between movable story content and fixed frame design.
// These helpers are pure and use allowlists: composition must never transfer
// source geometry or typography merely because two objects were spread.

const STORY_FIELDS = [
  'news_item_id', 'story_type', 'editorial_priority', 'kicker', 'headline', 'subheading', 'body', 'caption',
  'reporter_name', 'category', 'location', 'tags', 'language', 'status', 'ai_generated', 'ai_notes',
  'image_url', 'smart_card_key', 'smart_card_data',
];

function idOf(section) { return section?.id ?? section?.section_id ?? section?.section_key; }
function text(value) { return String(value ?? '').trim(); }
function hasIndependentCopy(section) { return Boolean(text(section?.headline) || text(section?.body) || text(section?.caption) || section?.news_item_id); }
function hasImageEvidence(section) { return Boolean(text(section?.image_url) || (Array.isArray(section?.images) && section.images.length)); }

function storyPacketFromSection(section = {}) {
  const packet = { id: idOf(section), news_item_id: section.news_item_id ?? null };
  for (const field of STORY_FIELDS) if (Object.hasOwn(section, field)) packet[field] = section[field];
  packet.images = Array.isArray(section.images) ? section.images.map((image) => ({
    media_asset_id: image.media_asset_id, url: image.url, source_width_px: image.source_width_px,
    source_height_px: image.source_height_px, x_px: image.x_px, y_px: image.y_px,
    width_px: image.width_px, height_px: image.height_px, shape: image.shape, rotation: image.rotation,
    stand_off_px: image.stand_off_px, mask: image.mask,
  })) : [];
  // Existing image placements are source-frame-relative; never claim they are
  // valid in a destination frame before image-treatment work exists.
  packet.imagePlacementNeedsReview = packet.images.length > 0;
  return packet;
}

function frameDescriptorFromSection(section = {}, templateSection = null) {
  const recommendation = templateSection?.storyType ?? section.recommendedStoryType ?? section.recommended_story_type
    ?? (String(section.block_type || section.blockType || '').toLowerCase() === 'advert' ? 'ADVERTISEMENT' : 'STANDARD');
  return {
    id: idOf(section), section_id: section.id ?? section.section_id, section_key: section.section_key,
    x_px: section.x_px, y_px: section.y_px, width_px: section.width_px, height_px: section.height_px, z_index: section.z_index,
    block_type: section.block_type ?? section.blockType ?? 'article', recommendedStoryType: recommendation,
    editorialPriority: templateSection?.editorialPriority ?? 3, feature_key: section.feature_key ?? templateSection?.featureKey ?? null,
    headline_font_px: section.headline_font_px, subheading_font_px: section.subheading_font_px, body_font_px: section.body_font_px,
    column_count: section.column_count, margin_px: section.margin_px, line_height: section.line_height, border_style: section.border_style, headline_style: section.headline_style,
  };
}

function projectStoryIntoFrame(story = {}, frame = {}) {
  const result = { ...frame };
  for (const field of STORY_FIELDS) if (Object.hasOwn(story, field)) result[field] = story[field];
  result.images = Array.isArray(story.images) ? story.images : [];
  result.imagePlacementNeedsReview = Boolean(story.imagePlacementNeedsReview && story.images?.length);
  return result;
}

function compositionInputForPage(page = {}, template = {}, options = {}) {
  const templateByKey = new Map((template.sections || []).map((item) => [item.key, item]));
  const continuationSources = options.continuationSourceIds || new Set();
  const movableStories = [], candidateFrames = [], lockedSections = [], accounted = [];
  for (const section of page.sections || []) {
    const frame = frameDescriptorFromSection(section, templateByKey.get(section.section_key));
    const sourceId = section.id ?? section.section_id;
    let reason = null;
    if (section.continued_from_section_id) reason = 'CONTINUATION_FRAGMENT';
    else if (continuationSources.has(sourceId)) reason = 'CONTINUATION_SOURCE';
    else if (frame.feature_key) reason = 'STANDING_FEATURE';
    else if (!hasIndependentCopy(section) && hasImageEvidence(section)) reason = 'IMAGE_ONLY_COMPANION';
    // Old populated editions may not yet have ADVERTISEMENT persisted on sold
    // copy. Preserve such physical advert slots rather than misrepresenting
    // their content as movable editorial journalism; an explicitly semantic
    // advertisement remains eligible for its advert frame.
    else if (frame.block_type === 'advert' && hasIndependentCopy(section)
      && String(section.story_type ?? section.storyType ?? '').toUpperCase() !== 'ADVERTISEMENT') reason = 'NON_MOVABLE_PHYSICAL_SLOT';
    if (reason) lockedSections.push({ sectionId: sourceId, sectionKey: section.section_key, reason });
    else {
      candidateFrames.push(frame);
      if (hasIndependentCopy(section)) movableStories.push(storyPacketFromSection(section));
    }
    accounted.push(section.section_key);
  }
  return { movableStories, candidateFrames, lockedSections, diagnostics: { accountedSectionKeys: accounted, sectionCount: accounted.length } };
}

module.exports = { storyPacketFromSection, frameDescriptorFromSection, projectStoryIntoFrame, compositionInputForPage };
