// Canonical current-copy ↔ destination-frame fit. This is intentionally an
// async measurement primitive, not a compatibility verdict or assignment rule.

const { projectStoryIntoFrame } = require('./composition-adapter');
const { measureFlowUtilization, UTILIZATION_V1 } = require('./composed-layout-quality');

const FIT_V1 = Object.freeze({
  goodMinimum: 0.7,
  tightMinimum: 0.9,
  underfillMinimum: UTILIZATION_V1.severelyUnderfilledBodyRatio,
});

const TEXT_TYPES = new Set(['LEAD', 'SECONDARY', 'STANDARD', 'OPINION', 'ANALYSIS', 'SIDEBAR', 'BRIEF', 'PHOTO_FEATURE']);
const STRUCTURED_TYPES = new Set(['SMART_CARD', 'ADVERTISEMENT', 'QUOTE', 'DATA']);
const typeOf = (value) => String(value?.story_type ?? value?.storyType ?? 'STANDARD').trim().toUpperCase() || 'STANDARD';

function imagePlacement(story, frame, context) {
  const candidate = context?.candidateImages ?? context?.candidate_images;
  if (Array.isArray(candidate)) return { status: 'PROVIDED_CANDIDATE_PLACEMENT', images: candidate };
  const sameSection = String(story?.id ?? story?.section_id ?? '') === String(frame?.id ?? frame?.section_id ?? '');
  if (sameSection && Array.isArray(story?.images) && story.images.length) return { status: 'VALID_CURRENT_PLACEMENT', images: story.images };
  if (Array.isArray(story?.images) && story.images.length) return { status: 'UNRESOLVED_DESTINATION_PLACEMENT', images: [] };
  return { status: 'NO_IMAGE', images: [] };
}

function classify(rawRatio) {
  if (!Number.isFinite(rawRatio)) return 'OVERFLOW';
  if (rawRatio > 1) return 'OVERFLOW';
  if (rawRatio >= FIT_V1.tightMinimum) return 'TIGHT_FIT';
  if (rawRatio >= FIT_V1.goodMinimum) return 'GOOD_FIT';
  if (rawRatio < FIT_V1.underfillMinimum) return 'SEVERE_UNDERFILL';
  return 'UNDERFILL';
}

async function measureStoryFrameFit(story = {}, frame = {}, context = {}) {
  const storyType = typeOf(story);
  if (STRUCTURED_TYPES.has(storyType) || !TEXT_TYPES.has(storyType)) {
    return { applicable: false, reason: 'STRUCTURED_RENDERER', storyType, fitClass: 'NOT_APPLICABLE', fitScore: null, imagePlacementStatus: 'NO_IMAGE' };
  }
  const placement = imagePlacement(story, frame, context);
  // Projection is an allowlisted ownership boundary: destination geometry and
  // presentation survive, while story content/semantics travel.
  const projected = projectStoryIntoFrame({ ...story, images: placement.images }, frame);
  const measured = await measureFlowUtilization(projected, placement.images);
  const raw = measured.bodyFillRatio;
  const fitClass = classify(raw);
  // Distance is measured from the useful target band, without clamping raw
  // overflow first: a 7× overset frame cannot look nearly as good as a fit.
  const fitScore = Number.isFinite(raw)
    ? Math.round(Math.max(0, 100 - (Math.abs(0.82 - raw) * 140)))
    : 0;
  return {
    applicable: true, storyType, editorialPriority: Number(story.editorial_priority ?? story.editorialPriority) || 3,
    ...measured, rawBodyFillRatio: raw, underfillChars: Math.max(0, measured.bodyCharBudget - measured.bodyCharsUsed),
    overflowChars: Math.max(0, measured.bodyCharsUsed - measured.bodyCharBudget),
    imagePlacementStatus: placement.status, imagePlacementUnresolved: placement.status === 'UNRESOLVED_DESTINATION_PLACEMENT',
    fitClass, fitScore, textDemandRatio: raw,
    copyDemandClass: raw > 1 ? 'OVERFLOWING' : raw >= FIT_V1.goodMinimum ? 'HEAVY' : raw >= FIT_V1.underfillMinimum ? 'MEDIUM' : 'LIGHT',
  };
}

module.exports = { measureStoryFrameFit, FIT_V1 };
