// Pure newsroom-image policy and geometry. Source metadata identifies a
// photograph; SAHAS alone chooses its destination-relative placement.
const path = require('path');

const REQUIRED = 'IMAGE_REQUIRED'; const PREFERRED = 'IMAGE_PREFERRED';
const OPTIONAL = 'IMAGE_OPTIONAL'; const NONE = 'NO_IMAGE';
const text = (value) => String(value ?? '').trim();
function sourceImages(source = {}) {
  const raw = source.images ?? source.imageReferences ?? source.image_urls ?? [];
  return (Array.isArray(raw) ? raw : []).map((item, index) => typeof item === 'string'
    ? { url: text(item), order: index }
    : { url: text(item.url), assetId: item.assetId ?? item.asset_id ?? null, caption: text(item.caption), altText: text(item.altText ?? item.alt_text), width: Number(item.width ?? item.width_px) || null, height: Number(item.height ?? item.height_px) || null, focalPoint: item.focalPoint ?? item.focal_point ?? null, primary: item.primary === true, order: Number.isFinite(Number(item.order)) ? Number(item.order) : index, mimeType: text(item.mimeType ?? item.mime_type) || null })
    .filter((item) => item.url)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.order - b.order || a.url.localeCompare(b.url));
}
function imageRequirement(story = {}, frame = {}) {
  const type = text(frame.recommendedStoryType ?? story.story_type ?? story.storyType).toUpperCase();
  const block = text(frame.block_type ?? frame.blockType).toLowerCase();
  if (block === 'advert' || type === 'ADVERTISEMENT' || type === 'SMART_CARD') return NONE;
  if (block === 'photo' || type === 'PHOTO_FEATURE') return REQUIRED;
  if (type === 'LEAD' || type === 'SECONDARY') return PREFERRED;
  if (type === 'BRIEF' || type === 'SIDEBAR' || type === 'OPINION') return NONE;
  return OPTIONAL;
}
function selectSourceImage(source = {}, frame = {}, used = new Set()) {
  const images = sourceImages(source).filter((item) => !used.has(item.assetId ? `asset:${item.assetId}` : `url:${item.url}`));
  if (!images.length) return null;
  const aspect = Math.max(0.1, Number(frame.width_px) / Math.max(1, Number(frame.height_px)));
  return [...images].sort((a, b) => {
    const aAspect = a.width && a.height ? a.width / a.height : null; const bAspect = b.width && b.height ? b.width / b.height : null;
    const aDistance = aAspect ? Math.abs(Math.log(aAspect / aspect)) : 10; const bDistance = bAspect ? Math.abs(Math.log(bAspect / aspect)) : 10;
    return Number(b.primary) - Number(a.primary) || aDistance - bDistance || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0) || a.order - b.order || a.url.localeCompare(b.url);
  })[0];
}
function placementFor(frame, image, requirement) {
  const margin = Number(frame.margin_px) || 12; const roomW = Math.max(20, Number(frame.width_px) - margin * 2); const roomH = Math.max(20, Number(frame.height_px) - margin * 2);
  const share = requirement === REQUIRED ? 0.58 : requirement === PREFERRED ? 0.42 : 0.32;
  const aspect = image.width && image.height ? image.width / image.height : Math.max(0.6, roomW / roomH);
  let width = Math.round(roomW * (requirement === REQUIRED ? 1 : share)); let height = Math.round(width / aspect);
  const maxHeight = Math.round(roomH * (requirement === REQUIRED ? 1 : share)); if (height > maxHeight) { height = maxHeight; width = Math.round(height * aspect); }
  width = Math.min(roomW, Math.max(20, width)); height = Math.min(roomH, Math.max(20, height));
  const x = requirement === REQUIRED ? margin + Math.round((roomW - width) / 2) : margin;
  const y = requirement === REQUIRED ? margin + Math.round((roomH - height) / 2) : margin + Math.round(roomH * 0.34);
  return { x, y: Math.min(margin + roomH - height, y), width, height, shape: 'rect', standOffPx: 6, treatment: 'contain', cropMode: image.focalPoint ? 'focal-contain' : 'center-contain', caption: image.caption || '' };
}
function buildImageIntents(pagePlan, used = new Set()) {
  const stories = new Map(pagePlan.stories.map((story) => [String(story.id), story])); const frames = new Map(pagePlan.frames.map((frame) => [String(frame.id), frame]));
  const assignments = pagePlan.assignments.map((assignment) => ({ assignment, story: stories.get(String(assignment.storyId)), frame: frames.get(String(assignment.frameId)) }));
  // A template photo slot is a package companion, not another prose story.
  // Associate it with the highest-priority assigned story occupying the same
  // horizontal band, with stable frame/story tie-breaks.
  const companions = (pagePlan.page.sections || []).filter((section) => String(section.block_type).toLowerCase() === 'photo').map((section) => {
    const centre = Number(section.y_px) + Number(section.height_px) / 2;
    const owner = [...assignments].sort((a, b) => {
      const aInside = centre >= Number(a.frame?.y_px) && centre <= Number(a.frame?.y_px) + Number(a.frame?.height_px) ? 1 : 0;
      const bInside = centre >= Number(b.frame?.y_px) && centre <= Number(b.frame?.y_px) + Number(b.frame?.height_px) ? 1 : 0;
      return bInside - aInside || Number(b.story?.editorial_priority || 0) - Number(a.story?.editorial_priority || 0) || String(a.story?.id).localeCompare(String(b.story?.id));
    })[0];
    if (!owner) return null;
    if ((section.images || []).length) return { page: pagePlan.page.page_number, storyId: owner.story.id, frameId: owner.frame.id, destinationSectionId: section.id, destinationSectionKey: section.section_key, companion: true, requirement: REQUIRED, image: null, placement: null, state: 'IMAGE_EXISTING_PRESERVED' };
    const frame = { id: section.id, section_id: section.id, section_key: section.section_key, width_px: section.width_px, height_px: section.height_px, margin_px: section.margin_px, block_type: 'photo', recommendedStoryType: 'PHOTO_FEATURE' };
    const image = selectSourceImage(owner.story, frame, used); if (image) used.add(image.assetId ? `asset:${image.assetId}` : `url:${image.url}`);
    return { page: pagePlan.page.page_number, storyId: owner.story.id, frameId: owner.frame.id, destinationSectionId: section.id, destinationSectionKey: section.section_key, companion: true, requirement: REQUIRED, image, placement: image ? placementFor(frame, image, REQUIRED) : null, state: image ? 'IMAGE_PLANNED' : 'IMAGE_REQUIRED_MISSING' };
  }).filter(Boolean);
  const companionStories = new Set(companions.map((intent) => String(intent.storyId)));
  const prose = assignments.map(({ assignment, story, frame }) => { const packageHasCompanion = companionStories.has(String(assignment.storyId)); const requirement = packageHasCompanion ? NONE : imageRequirement(story, frame); const image = requirement === NONE ? null : selectSourceImage(story, frame, used); if (image) used.add(image.assetId ? `asset:${image.assetId}` : `url:${image.url}`); return { page: pagePlan.page.page_number, storyId: assignment.storyId, frameId: assignment.frameId, destinationSectionId: frame?.section_id, destinationSectionKey: frame?.section_key, companion: false, requirement, image, placement: image ? placementFor(frame, image, requirement) : null, state: packageHasCompanion ? 'IMAGE_SATISFIED_BY_COMPANION' : image ? 'IMAGE_PLANNED' : requirement === REQUIRED ? 'IMAGE_REQUIRED_MISSING' : 'IMAGE_NOT_REQUIRED' }; });
  return [...companions, ...prose];
}
function safeLocalAssetPath(url, publicRoot) { const clean = text(url); if (!clean.startsWith('/uploads/') || clean.includes('..')) return null; const resolved = path.resolve(publicRoot, `.${clean}`); return resolved.startsWith(path.resolve(publicRoot, 'uploads') + path.sep) ? resolved : null; }

module.exports = { REQUIRED, PREFERRED, OPTIONAL, NONE, sourceImages, imageRequirement, selectSourceImage, placementFor, buildImageIntents, safeLocalAssetPath };
