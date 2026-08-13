// Canonical editorial-only input for edition composition.  This deliberately
// contains no frame geometry, layout key, or fixture knowledge: a source may
// come from an inbox, CMS, or disposable test pool and is normalized before it
// reaches routing and B6 matching.
function text(value) { return String(value ?? '').trim(); }
const { sourceImages } = require('../layout/newsroom-image-composition');

function normalizeNewsroomSource(item = {}) {
  const sourceId = text(item.sourceId ?? item.source_id ?? item.id);
  if (!sourceId) throw new Error('Newsroom source requires sourceId or id');
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).join(', ') : text(item.tags);
  return {
    id: sourceId, sourceId,
    // DB newsroom rows are linked back to their canonical reporter item; a
    // generic external packet may instead have no database identity at all.
    news_item_id: item.news_item_id ?? item.newsItemId ?? (Number.isInteger(Number(item.id)) ? Number(item.id) : null),
    story_type: text(item.storyType ?? item.story_type) || 'STANDARD',
    editorial_priority: Math.min(5, Math.max(1, Math.round(Number(item.editorialPriority ?? item.editorial_priority) || 3))),
    title: text(item.headline ?? item.title), subheading: text(item.subheading),
    body: text(item.body ?? item.description), description: text(item.description ?? item.body),
    category: text(item.category ?? item.section), location: text(item.location),
    tags, reporter_name: text(item.reporter ?? item.reporter_name ?? item.reporterName),
    images: sourceImages(item),
    image_urls: sourceImages(item).map((image) => image.url),
    desired_page_role: text(item.desiredPageRole ?? item.desired_page_role),
    routed_role: text(item.routed_role), routing_mode: text(item.routing_mode),
    continuation_constraint: item.continuation_constraint ?? item.continuationConstraint ?? null,
    standing_feature_constraint: item.standing_feature_constraint ?? item.standingFeatureConstraint ?? null,
  };
}

function sourceSnapshot(sources = []) {
  const normalized = normalizeNewsroomSources(sources);
  const crypto = require('crypto');
  const identity = normalized.map((item) => ({ id: item.sourceId, newsItemId: item.news_item_id, storyType: item.story_type, priority: item.editorial_priority, title: item.title, body: item.body, desiredRole: item.desired_page_role, images: item.images }));
  return { sources: normalized, sourceIds: normalized.map((item) => item.sourceId), hash: crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

async function loadNewsroomSourcesForEdition(newspaperId, { repository = require('../repositories/news.repository') } = {}) {
  const rows = await repository.findForComposition(newspaperId);
  return sourceSnapshot(rows);
}

function normalizeNewsroomSources(items = []) {
  const seen = new Set();
  const normalized = items.map(normalizeNewsroomSource);
  for (const item of normalized) {
    if (seen.has(item.sourceId)) throw new Error(`Duplicate newsroom sourceId: ${item.sourceId}`);
    seen.add(item.sourceId);
  }
  // Input order is never an editorial decision.  Every downstream tie-break
  // receives this stable semantic identity order.
  return normalized.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

module.exports = { normalizeNewsroomSource, normalizeNewsroomSources, sourceSnapshot, loadNewsroomSourcesForEdition };
