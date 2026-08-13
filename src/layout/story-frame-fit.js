// Canonical current-copy ↔ destination-frame fit. This is intentionally an
// async measurement primitive, not a compatibility verdict or assignment rule.

const { projectStoryIntoFrame } = require('./composition-adapter');
const { measureFlowUtilization, UTILIZATION_V1 } = require('./composed-layout-quality');

const FIT_V1 = Object.freeze({
  goodMinimum: 0.7,
  tightMinimum: 0.9,
  underfillMinimum: UTILIZATION_V1.severelyUnderfilledBodyRatio,
});

const TEXT_TYPES = new Set(['LEAD', 'SECONDARY', 'STANDARD', 'OPINION', 'ANALYSIS', 'SIDEBAR', 'BRIEF', 'PHOTO_FEATURE', 'DATA']);
const STRUCTURED_TYPES = new Set(['SMART_CARD', 'ADVERTISEMENT', 'QUOTE']);
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
  const { storyPolicy } = await import('../../public/editor/layout/story-types.js');
  const policy = storyPolicy(storyType);
  const placement = imagePlacement(story, frame, context);
  // Projection is an allowlisted ownership boundary: destination geometry and
  // presentation survive, while story content/semantics travel.
  const projected = projectStoryIntoFrame({ ...story, images: placement.images }, frame);
  const measured = await measureFlowUtilization(projected, placement.images);
  const raw = measured.bodyFillRatio;
  const fitClass = classify(raw);
  const policyFitClass = raw < policy.bodyFill.min ? 'BELOW_POLICY_RANGE'
    : raw > policy.bodyFill.max ? 'ABOVE_POLICY_RANGE' : 'GOOD_POLICY_FIT';
  // Raw > 1 is physical overflow. Editorial density is separately governed
  // by the one semantic policy catalog, including photo-feature low density.
  const distance = Math.abs(policy.bodyFill.target - raw);
  const fitScore = Number.isFinite(raw) ? Math.round(Math.max(0, 100 - (distance * 140))) : 0;
  return {
    applicable: true, storyType, editorialPriority: Number(story.editorial_priority ?? story.editorialPriority) || 3,
    ...measured, rawBodyFillRatio: raw, underfillChars: Math.max(0, measured.writableBodyCharBudget - measured.authoredBodyCharsUsed),
    overflowChars: Math.max(0, measured.totalBodyCharsUsed - measured.bodyCharBudget),
    rawSourceChars: String(story.body || '').length,
    sourceScaleStatus: String(story.body || '').length >= Math.round(measured.writableBodyCharBudget * policy.bodyFill.min) ? 'SOURCE_SCALE_OK' : String(story.body || '').length >= Math.round(measured.writableBodyCharBudget * policy.bodyFill.min * 0.5) ? 'SOURCE_SCALE_THIN' : 'SOURCE_SCALE_SEVERELY_THIN',
    imagePlacementStatus: placement.status, imagePlacementUnresolved: placement.status === 'UNRESOLVED_DESTINATION_PLACEMENT',
    fitClass, fitScore, textDemandRatio: raw,
    policyMinFill: policy.bodyFill.min, policyTargetFill: policy.bodyFill.target, policyMaxFill: policy.bodyFill.max, policyFitClass,
    copyDemandClass: raw > 1 ? 'OVERFLOWING' : raw >= FIT_V1.goodMinimum ? 'HEAVY' : raw >= FIT_V1.underfillMinimum ? 'MEDIUM' : 'LIGHT',
  };
}

module.exports = { measureStoryFrameFit, FIT_V1 };
