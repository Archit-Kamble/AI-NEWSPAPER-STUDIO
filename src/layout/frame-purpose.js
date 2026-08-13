// Canonical publication ownership for physical page frames.
//
// A frame's physical kind, its preferred occupant semantics and its content
// owner are separate axes.  This resolver is the only compatibility fallback
// for old persisted pages; built-in templates declare ownership explicitly.

const PURPOSE = Object.freeze({
  EDITORIAL_STORY: 'EDITORIAL_STORY',
  IMAGE_COMPANION: 'IMAGE_COMPANION',
  STANDING_FEATURE: 'STANDING_FEATURE',
  ADVERT: 'ADVERT',
  FIXED_FURNITURE: 'FIXED_FURNITURE',
  UTILITY: 'UTILITY',
  OPTIONAL_RESERVED: 'OPTIONAL_RESERVED',
});
const REQUIREMENT = Object.freeze({
  REQUIRED_CONTENT: 'REQUIRED_CONTENT',
  OPTIONAL_CONTENT: 'OPTIONAL_CONTENT',
  EXTERNALLY_SUPPLIED: 'EXTERNALLY_SUPPLIED',
  STRUCTURAL_NO_CONTENT: 'STRUCTURAL_NO_CONTENT',
});
const VALID_PURPOSES = new Set(Object.values(PURPOSE));
const VALID_REQUIREMENTS = new Set(Object.values(REQUIREMENT));
const text = (value) => String(value ?? '').trim();

function resolveFramePurpose(section = {}, templateSection = null) {
  const explicitPurpose = text(templateSection?.framePurpose ?? section.frame_purpose ?? section.framePurpose).toUpperCase();
  const explicitRequirement = text(templateSection?.publicationRequirement ?? section.publication_requirement ?? section.publicationRequirement).toUpperCase();
  const blockType = text(section.block_type ?? section.blockType ?? templateSection?.blockType).toLowerCase();
  const featureKey = text(section.feature_key ?? section.featureKey ?? templateSection?.featureKey).toLowerCase() || null;
  const smartCardKey = text(section.smart_card_key ?? section.smartCardKey).toLowerCase() || null;
  let purpose = VALID_PURPOSES.has(explicitPurpose) ? explicitPurpose : null;
  let inferred = !purpose;
  if (!purpose) {
    if (blockType === 'advert') purpose = PURPOSE.ADVERT;
    else if (featureKey) purpose = featureKey === 'sudoku' || featureKey === 'sudoku-solution' ? PURPOSE.UTILITY : PURPOSE.STANDING_FEATURE;
    else if (smartCardKey === 'sudoku' || smartCardKey === 'sudoku-solution') purpose = PURPOSE.UTILITY;
    // Compatibility for legacy photo-only slots. New templates must name an
    // owner; the manifest reports an orphan until that ownership is explicit.
    else if (blockType === 'photo') purpose = PURPOSE.IMAGE_COMPANION;
    else if (['article', 'briefs'].includes(blockType)) purpose = PURPOSE.EDITORIAL_STORY;
  }
  let publicationRequirement = VALID_REQUIREMENTS.has(explicitRequirement) ? explicitRequirement : null;
  if (!publicationRequirement) {
    if (purpose === PURPOSE.ADVERT) publicationRequirement = REQUIREMENT.EXTERNALLY_SUPPLIED;
    else if (purpose === PURPOSE.FIXED_FURNITURE) publicationRequirement = REQUIREMENT.STRUCTURAL_NO_CONTENT;
    else if (purpose === PURPOSE.OPTIONAL_RESERVED) publicationRequirement = REQUIREMENT.OPTIONAL_CONTENT;
    else if (purpose) publicationRequirement = REQUIREMENT.REQUIRED_CONTENT;
  }
  const packageOwnerSection = text(templateSection?.packageOwnerKey ?? section.package_owner_section ?? section.packageOwnerSection) || null;
  const standingFeatureKind = purpose === PURPOSE.STANDING_FEATURE ? featureKey || smartCardKey : null;
  const utilityKind = purpose === PURPOSE.UTILITY
    ? text(templateSection?.utilityKey ?? section.utility_key ?? featureKey ?? smartCardKey).toLowerCase() || null
    : null;
  const advertPolicy = purpose === PURPOSE.ADVERT
    ? text(templateSection?.advertPolicy ?? section.advert_policy).toUpperCase() || 'REQUIRED_EXTERNAL'
    : null;
  const errors = [];
  if (!purpose) errors.push('FRAME_PURPOSE_UNKNOWN');
  if (purpose && !publicationRequirement) errors.push('REQUIRED_FRAME_POLICY_MISSING');
  if (purpose === PURPOSE.IMAGE_COMPANION && !packageOwnerSection) errors.push('IMAGE_COMPANION_ORPHAN');
  if (purpose === PURPOSE.STANDING_FEATURE && !standingFeatureKind) errors.push('REQUIRED_FRAME_POLICY_MISSING');
  if (purpose === PURPOSE.UTILITY && !utilityKind) errors.push('REQUIRED_FRAME_POLICY_MISSING');
  return { purpose, publicationRequirement, semanticRecommendation: templateSection?.storyType ?? section.recommendedStoryType ?? section.story_type ?? null,
    packageOwnerSection, standingFeatureKind, utilityKind, advertPolicy, explicit: !inferred, inferred, errors };
}

module.exports = { PURPOSE, REQUIREMENT, resolveFramePurpose };
