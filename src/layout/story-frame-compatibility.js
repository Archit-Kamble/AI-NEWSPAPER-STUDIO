// Candidate story-to-frame compatibility, deliberately separate from the
// current-page analyzer. This primitive describes one possible assignment; it
// never selects one, changes geometry, or knows anything about persistence.

// Small, documented scoring contract. Each component is 0..100; the final
// score is their equal average. Semantic fit matters most operationally, but
// equal components keep V1 explainable until desk-reviewed assignments can
// calibrate production weights.
const COMPATIBILITY_V1 = Object.freeze({
  hardRejectScore: 0,
  dominantRatio: 0.7,
  compactRatio: 0.35,
  priorityHigh: 4,
  priorityLow: 2,
  photoMinimumAreaRatio: 0.12,
});

const round = (value) => Number(Number(value).toFixed(4));
const clamp = (value) => Math.min(100, Math.max(0, value));

function typeOf(value) {
  const raw = value?.story_type ?? value?.storyType ?? value?.recommendedStoryType ?? 'STANDARD';
  return String(raw).trim().toUpperCase() || 'STANDARD';
}

function priorityOf(story) {
  const value = Number(story?.editorial_priority ?? story?.editorialPriority);
  return Number.isFinite(value) ? Math.min(5, Math.max(1, Math.round(value))) : 3;
}

function dimensions(frame) {
  const width = Number(frame?.width_px ?? frame?.width ?? 0);
  const height = Number(frame?.height_px ?? frame?.height ?? 0);
  return { width: Math.max(0, width), height: Math.max(0, height), area: Math.max(0, width) * Math.max(0, height) };
}

function frameKind(frame) {
  // `story_type` on a persisted page section belongs to its present occupant,
  // not its physical frame. Composition callers supply the template's explicit
  // recommendation as `recommendedStoryType`; only a standalone synthetic
  // frame may use its legacy story_type fallback.
  const semantic = String(frame?.recommendedStoryType ?? frame?.recommended_story_type
    ?? frame?.story_type ?? frame?.storyType ?? 'STANDARD').trim().toUpperCase() || 'STANDARD';
  const block = String(frame?.block_type ?? frame?.blockType ?? '').trim().toLowerCase();
  if (semantic === 'ADVERTISEMENT' || block === 'advert') return 'ADVERTISEMENT';
  if (semantic === 'SMART_CARD') return 'SMART_CARD';
  return semantic;
}

function hasImage(story) {
  return Boolean(
    String(story?.image_url ?? story?.imageUrl ?? '').trim()
    || (Array.isArray(story?.images) && story.images.length)
    || (Array.isArray(story?.image_urls) && story.image_urls.length),
  );
}

function sourceAspect(story) {
  const image = story?.images?.[0] || story?.image || story?.imageMetadata;
  const width = Number(image?.source_width_px ?? image?.sourceWidthPx ?? image?.width_px ?? image?.width);
  const height = Number(image?.source_height_px ?? image?.sourceHeightPx ?? image?.height_px ?? image?.height);
  return width > 0 && height > 0 ? width / height : null;
}

function structuredCard(story) {
  const key = story?.smart_card_key ?? story?.smartCardKey;
  const data = story?.smart_card_data ?? story?.smartCardData;
  return Boolean(key && data && typeof data === 'object');
}

function editorialFrames(context = {}) {
  return (context.editorialFrames || []).filter((frame) => {
    const kind = frameKind(frame);
    return kind !== 'ADVERTISEMENT' && kind !== 'SMART_CARD';
  });
}

function prominence(frame, context) {
  const own = dimensions(frame);
  const candidates = editorialFrames(context);
  const areas = candidates.map((item) => dimensions(item).area).filter((area) => area > 0);
  const largest = Math.max(own.area, ...areas, 1);
  const areaRatio = own.area / largest;
  const ranked = candidates.includes(frame) ? candidates : [...candidates, frame];
  const rank = ranked
    .map((item, index) => ({ item, index, area: dimensions(item).area }))
    .sort((a, b) => b.area - a.area || a.index - b.index)
    .findIndex((item) => item.item === frame) + 1;
  return { ...own, areaRatio, rank: rank || 1, editorialFrameCount: candidates.length + 1 };
}

function reason(code, impact, evidence) {
  return { code, impact, evidence };
}

function scoreStoryForFrame(story = {}, frame = {}, context = {}) {
  const storyType = typeOf(story);
  const frameType = frameKind(frame);
  const priority = priorityOf(story);
  const geometry = prominence(frame, context);
  const reasons = [];

  const impossible = (frameType === 'ADVERTISEMENT' && storyType !== 'ADVERTISEMENT')
    || (storyType === 'ADVERTISEMENT' && frameType !== 'ADVERTISEMENT')
    || (storyType === 'SMART_CARD' && frameType === 'ADVERTISEMENT');
  if (impossible) {
    if (frameType === 'ADVERTISEMENT' && storyType !== 'ADVERTISEMENT') {
      reasons.push(reason('EDITORIAL_IN_AD_FRAME', -100, { storyType, frameType }));
    }
    reasons.push(reason('HARD_SEMANTIC_INCOMPATIBILITY', -100, { storyType, frameType }));
    return {
      score: COMPATIBILITY_V1.hardRejectScore,
      subscores: { semanticType: 0, priority: 0, geometry: 0, imagery: 0 },
      hardReject: true,
      reasons,
    };
  }

  let semanticType = 70;
  if (storyType === frameType) {
    semanticType = 100;
    reasons.push(reason('TYPE_FRAME_MATCH', 30, { storyType, frameType }));
  } else if (frameType === 'ADVERTISEMENT') {
    semanticType = storyType === 'ADVERTISEMENT' ? 100 : 20;
    reasons.push(reason(storyType === 'ADVERTISEMENT' ? 'AD_FRAME_MATCH' : 'EDITORIAL_IN_AD_FRAME', semanticType - 70, { storyType, frameType }));
  } else if (frameType === 'SMART_CARD') {
    semanticType = storyType === 'SMART_CARD' ? 100 : 35;
    reasons.push(reason(storyType === 'SMART_CARD' ? 'SMART_CARD_FRAME_MATCH' : 'EDITORIAL_IN_SMART_CARD_FRAME', semanticType - 70, { storyType, frameType }));
  } else if (storyType === 'ADVERTISEMENT' || storyType === 'SMART_CARD') {
    semanticType = 20;
    reasons.push(reason('TYPE_FRAME_MISMATCH', -50, { storyType, frameType }));
  }

  let priorityScore = 75;
  if (priority >= COMPATIBILITY_V1.priorityHigh) {
    priorityScore = geometry.areaRatio >= COMPATIBILITY_V1.dominantRatio ? 100 : 30;
    reasons.push(reason(priorityScore === 100 ? 'PRIORITY_PROMINENCE_MATCH' : 'PRIORITY_PROMINENCE_MISMATCH',
      priorityScore - 75, { priority, frameAreaRatio: round(geometry.areaRatio), frameSizeRank: geometry.rank }));
  } else if (priority <= COMPATIBILITY_V1.priorityLow) {
    priorityScore = geometry.areaRatio > COMPATIBILITY_V1.dominantRatio ? 35 : 90;
    reasons.push(reason(priorityScore === 90 ? 'PRIORITY_PROMINENCE_MATCH' : 'PRIORITY_PROMINENCE_MISMATCH',
      priorityScore - 75, { priority, frameAreaRatio: round(geometry.areaRatio), frameSizeRank: geometry.rank }));
  }

  let geometric = 75;
  if (storyType === 'LEAD') {
    geometric = geometry.areaRatio >= COMPATIBILITY_V1.dominantRatio ? 100 : 15;
    reasons.push(reason(geometric === 100 ? 'LEAD_FRAME_DOMINANT' : 'LEAD_FRAME_TOO_WEAK', geometric - 75,
      { frameAreaRatio: round(geometry.areaRatio), frameSizeRank: geometry.rank }));
  } else if (storyType === 'BRIEF') {
    geometric = geometry.areaRatio <= COMPATIBILITY_V1.compactRatio ? 95 : 20;
    reasons.push(reason(geometric === 95 ? 'BRIEF_FRAME_COMPACT' : 'BRIEF_FRAME_TOO_LARGE', geometric - 75,
      { frameAreaRatio: round(geometry.areaRatio), frameSizeRank: geometry.rank }));
  } else if (storyType === 'STANDARD') {
    geometric = geometry.areaRatio >= 0.15 && geometry.areaRatio <= 0.8 ? 90 : 65;
    reasons.push(reason('STANDARD_FRAME_FLEXIBLE', geometric - 75, { frameAreaRatio: round(geometry.areaRatio) }));
  }

  let imagery = 80;
  if (storyType === 'PHOTO_FEATURE') {
    if (!hasImage(story)) {
      imagery = 0;
      reasons.push(reason('PHOTO_FEATURE_NO_IMAGE', -80, { hasImage: false }));
    } else {
      const frameAspect = geometry.height ? geometry.width / geometry.height : 0;
      const source = sourceAspect(story);
      const enoughArea = geometry.areaRatio >= COMPATIBILITY_V1.photoMinimumAreaRatio;
      const landscapeMatch = source === null || source <= 1.15 || frameAspect >= 1;
      imagery = enoughArea && landscapeMatch ? 100 : 45;
      reasons.push(reason(imagery === 100 ? 'PHOTO_FEATURE_FRAME_MATCH' : 'PHOTO_FEATURE_FRAME_WEAK', imagery - 80,
        { hasImage: true, frameAreaRatio: round(geometry.areaRatio), frameAspect: round(frameAspect), sourceAspect: source && round(source) }));
    }
  } else if (storyType === 'SMART_CARD') {
    imagery = structuredCard(story) ? 100 : 30;
    reasons.push(reason(structuredCard(story) ? 'SMART_CARD_DATA_PRESENT' : 'SMART_CARD_DATA_MISSING', imagery - 80,
      { structuredCard: structuredCard(story) }));
  } else if (storyType === 'ADVERTISEMENT') {
    imagery = hasImage(story) ? 90 : 70;
  }

  return {
    score: round(clamp((semanticType + priorityScore + geometric + imagery) / 4)),
    subscores: { semanticType, priority: priorityScore, geometry: geometric, imagery },
    hardReject: false,
    reasons,
  };
}

module.exports = { scoreStoryForFrame, COMPATIBILITY_V1 };
