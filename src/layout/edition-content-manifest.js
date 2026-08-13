const { getTemplate } = require('./templates');
const { PURPOSE, REQUIREMENT, resolveFramePurpose } = require('./frame-purpose');

const text = (value) => String(value ?? '').trim();
const READY = new Set(['ready', 'published']);
const hasCopy = (section) => Boolean(text(section.headline) || text(section.subheading) || text(section.body) || text(section.caption));
const hasImages = (section) => Boolean(text(section.image_url) || (section.images || []).length);
const hasAdvert = (section) => hasCopy(section) || hasImages(section);
const hasStructuredCard = (section, expected) => Boolean(
  text(section.smart_card_key).toLowerCase() === text(expected).toLowerCase()
  && section.smart_card_data && typeof section.smart_card_data === 'object',
);

function contentState(section, descriptor, sectionsByKey) {
  if (descriptor.errors.length) return descriptor.errors[0];
  if (descriptor.publicationRequirement === REQUIREMENT.STRUCTURAL_NO_CONTENT) return 'STRUCTURAL';
  if (descriptor.publicationRequirement === REQUIREMENT.OPTIONAL_CONTENT && !hasCopy(section) && !hasImages(section)) return 'OPTIONAL_EMPTY';
  if (descriptor.purpose === PURPOSE.EDITORIAL_STORY) return hasCopy(section) ? 'CONTENT_PRESENT' : 'EDITORIAL_REQUIRED_MISSING';
  if (descriptor.purpose === PURPOSE.ADVERT) return hasAdvert(section) ? 'ADVERT_PRESENT' : 'ADVERT_REQUIRED_MISSING';
  if (descriptor.purpose === PURPOSE.STANDING_FEATURE) {
    if (!hasCopy(section) || !hasStructuredCard(section, descriptor.standingFeatureKind)) return 'FEATURE_REQUIRED_MISSING';
    return section.ai_generated && !READY.has(String(section.status)) ? 'FEATURE_NEEDS_REVIEW' : 'FEATURE_READY';
  }
  if (descriptor.purpose === PURPOSE.UTILITY) {
    if (!hasStructuredCard(section, descriptor.utilityKind)) return 'UTILITY_REQUIRED_MISSING';
    return section.ai_generated && !READY.has(String(section.status)) ? 'UTILITY_NEEDS_REVIEW' : 'UTILITY_READY';
  }
  if (descriptor.purpose === PURPOSE.IMAGE_COMPANION) {
    const owner = sectionsByKey.get(descriptor.packageOwnerSection);
    if (!owner) return 'IMAGE_COMPANION_ORPHAN';
    return hasImages(section) ? 'IMAGE_COMPANION_READY' : 'IMAGE_REQUIRED_MISSING';
  }
  return 'FRAME_PURPOSE_UNKNOWN';
}

function buildEditionContentManifest(pages = []) {
  const frames = [];
  for (const page of [...pages].sort((a, b) => Number(a.page_number) - Number(b.page_number) || Number(a.id) - Number(b.id))) {
    const template = getTemplate(page.template_key);
    const templateByKey = new Map(template.sections.map((item) => [item.key, item]));
    const sectionsByKey = new Map((page.sections || []).map((section) => [section.section_key, section]));
    for (const section of [...(page.sections || [])].sort((a, b) => Number(a.z_index) - Number(b.z_index) || String(a.section_key).localeCompare(String(b.section_key)))) {
      const descriptor = resolveFramePurpose(section, templateByKey.get(section.section_key));
      const state = contentState(section, descriptor, sectionsByKey);
      frames.push({ page: Number(page.page_number), pageId: page.id, sectionId: section.id ?? section.section_id, sectionKey: section.section_key,
        physicalBlockType: section.block_type ?? templateByKey.get(section.section_key)?.blockType ?? null, ...descriptor,
        contentState: state, reviewState: section.status || 'empty', provenanceState: section.news_item_id ? 'SOURCE_LINKED' : 'NO_SOURCE',
        sourceNewsItemId: section.news_item_id ?? null });
    }
  }
  const required = frames.filter((frame) => frame.publicationRequirement === REQUIREMENT.REQUIRED_CONTENT || frame.publicationRequirement === REQUIREMENT.EXTERNALLY_SUPPLIED);
  const incompleteStates = new Set(['FRAME_PURPOSE_UNKNOWN','REQUIRED_FRAME_POLICY_MISSING','IMAGE_COMPANION_ORPHAN','EDITORIAL_REQUIRED_MISSING','IMAGE_REQUIRED_MISSING','FEATURE_REQUIRED_MISSING','FEATURE_NEEDS_REVIEW','ADVERT_REQUIRED_MISSING','UTILITY_REQUIRED_MISSING','UTILITY_NEEDS_REVIEW']);
  const blockedStates = new Set(['FRAME_PURPOSE_UNKNOWN','REQUIRED_FRAME_POLICY_MISSING','IMAGE_COMPANION_ORPHAN']);
  const incomplete = required.filter((frame) => incompleteStates.has(frame.contentState));
  const editorialRequired = frames.filter((frame) => frame.purpose === PURPOSE.EDITORIAL_STORY && frame.publicationRequirement === REQUIREMENT.REQUIRED_CONTENT);
  const editorialUnresolved = editorialRequired.filter((frame) => frame.contentState !== 'CONTENT_PRESENT');
  const packageFrames = frames.filter((frame) => frame.purpose === PURPOSE.IMAGE_COMPANION && frame.publicationRequirement === REQUIREMENT.REQUIRED_CONTENT);
  const packageUnresolved = packageFrames.filter((frame) => frame.contentState !== 'IMAGE_COMPANION_READY');
  const editorialBlocked = [...editorialRequired, ...packageFrames].some((frame) => frame.errors.length);
  const counts = {};
  for (const value of Object.values(PURPOSE)) counts[value] = frames.filter((frame) => frame.purpose === value).length;
  return { schemaVersion: 1, physicalFrameCount: frames.length, framePurposeCounts: counts,
    unknownPurposeCount: frames.filter((frame) => !frame.purpose).length,
    ambiguousPurposeCount: frames.filter((frame) => frame.errors.includes('FRAME_PURPOSE_AMBIGUOUS')).length,
    editorialCompositionState: editorialBlocked ? 'BLOCKED' : editorialUnresolved.length || packageUnresolved.length ? 'PARTIALLY_COMPOSED' : 'FULLY_COMPOSED',
    editorialDemand: { required: editorialRequired.length, present: editorialRequired.length - editorialUnresolved.length, unresolved: editorialUnresolved.length },
    imagePackages: { required: packageFrames.length, resolved: packageFrames.length - packageUnresolved.length, unresolved: packageUnresolved.length,
      orphaned: packageFrames.filter((frame) => frame.contentState === 'IMAGE_COMPANION_ORPHAN').length },
    publicationContentState: incomplete.some((frame) => blockedStates.has(frame.contentState)) ? 'BLOCKED' : incomplete.length ? 'INCOMPLETE' : 'COMPLETE',
    incompleteCount: incomplete.length, frames };
}

module.exports = { buildEditionContentManifest, contentState, hasCopy, hasImages, hasAdvert, hasStructuredCard };
