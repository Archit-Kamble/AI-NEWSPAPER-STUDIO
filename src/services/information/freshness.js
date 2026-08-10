// How old a source may be before it stops counting as "current".
//
// Two buckets, not a category for every future provider: a result, a score or
// a weather reading is wrong within the hour, so `current_data` gets a short
// window. General current-affairs context ages more slowly. When a real
// weather/sports/election provider arrives it can sit under `current_data`
// too - the bucket is about how fast the FACT goes stale, not which provider
// answered it.

const FRESHNESS_MS = {
  current_data: 15 * 60 * 1000,
  current_news: 3 * 60 * 60 * 1000,
  ambiguous: 3 * 60 * 60 * 1000,
};

function freshnessMsFor(category) {
  return FRESHNESS_MS[category] || FRESHNESS_MS.current_news;
}

/** A source with no publish date, or one older than its category's window. */
function isStale(publishedAt, category) {
  if (!publishedAt) return true;
  const at = new Date(publishedAt).getTime();
  if (Number.isNaN(at)) return true;
  return Date.now() - at > freshnessMsFor(category);
}

module.exports = { FRESHNESS_MS, freshnessMsFor, isStale };
