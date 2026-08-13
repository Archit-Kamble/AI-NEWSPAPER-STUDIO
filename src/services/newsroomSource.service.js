// Canonical editorial-only input for edition composition.  This deliberately
// contains no frame geometry, layout key, or fixture knowledge: a source may
// come from an inbox, CMS, or disposable test pool and is normalized before it
// reaches routing and B6 matching.
function text(value) { return String(value ?? '').trim(); }

function normalizeNewsroomSource(item = {}) {
  const sourceId = text(item.sourceId ?? item.source_id ?? item.id);
  if (!sourceId) throw new Error('Newsroom source requires sourceId or id');
  const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).join(', ') : text(item.tags);
  return {
    id: sourceId, sourceId,
    news_item_id: item.news_item_id ?? item.newsItemId ?? null,
    story_type: text(item.storyType ?? item.story_type) || 'STANDARD',
    editorial_priority: Math.min(5, Math.max(1, Math.round(Number(item.editorialPriority ?? item.editorial_priority) || 3))),
    title: text(item.headline ?? item.title), subheading: text(item.subheading),
    body: text(item.body ?? item.description), description: text(item.description ?? item.body),
    category: text(item.category ?? item.section), location: text(item.location),
    tags, reporter_name: text(item.reporter ?? item.reporter_name ?? item.reporterName),
    image_urls: Array.isArray(item.imageReferences ?? item.image_urls) ? [...(item.imageReferences ?? item.image_urls)] : [],
    desired_page_role: text(item.desiredPageRole ?? item.desired_page_role),
    routed_role: text(item.routed_role), routing_mode: text(item.routing_mode),
    continuation_constraint: item.continuation_constraint ?? item.continuationConstraint ?? null,
    standing_feature_constraint: item.standing_feature_constraint ?? item.standingFeatureConstraint ?? null,
  };
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

module.exports = { normalizeNewsroomSource, normalizeNewsroomSources };
