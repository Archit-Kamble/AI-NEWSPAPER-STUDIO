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

// What a DESK may ask for, which is a different question from how fast a fact
// goes stale. Checking one claim wants the tightest window there is; making up
// tomorrow's paper on a quiet Tuesday wants three days, and measured on the
// real feeds the 3h news window called 122 of 150 candidates stale - most of a
// day's district reporting, thrown away for being this morning's rather than
// this hour's. So the window is stated by the caller and the categories above
// remain the default when nobody says.
const DESK_WINDOWS = {
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};
const DEFAULT_DESK_WINDOW = '24h';

function deskWindowMs(key) {
  return DESK_WINDOWS[String(key || '').toLowerCase()] || DESK_WINDOWS[DEFAULT_DESK_WINDOW];
}

function freshnessMsFor(category) {
  return FRESHNESS_MS[category] || FRESHNESS_MS.current_news;
}

/**
 * A source with no publish date, or older than the window it is judged
 * against. `windowMs`, when given, replaces the category's own window - the
 * category says how fast the fact ages, the caller says how far back this
 * particular job may reach.
 */
function isStale(publishedAt, category, windowMs) {
  if (!publishedAt) return true;
  const at = new Date(publishedAt).getTime();
  if (Number.isNaN(at)) return true;
  const limit = Number(windowMs) > 0 ? Number(windowMs) : freshnessMsFor(category);
  return Date.now() - at > limit;
}

module.exports = { FRESHNESS_MS, DESK_WINDOWS, DEFAULT_DESK_WINDOW, deskWindowMs, freshnessMsFor, isStale };
