// Every candidate story for one edition, fetched once.
//
// The Newsdesk Run is briefed in TAGS ("page one: local x2, state politics
// x1"), and the fan-out is per tag - never per page and never per block. Two
// pages both asking for state politics is one retrieval; asking twice would
// spend the request, return the same items to be deduplicated later, and make
// the run's cost a function of the page count rather than of what was asked
// for.
//
// The feed half and the open-web half are fetched differently on purpose:
//
//   * A publisher's feed is not a search engine. There is no query to send it,
//     so every tag matches against ONE fetch of each feed (rss.searchMany).
//     Thirteen tags cost eight requests, not two hundred.
//   * Google News's search endpoint IS a search engine, so it genuinely needs
//     one request per query. Those are bounded rather than fired in a burst -
//     a district daily asking a dozen questions at once looks like a scraper.
//
// Nothing here decides what is worth printing. Every item comes back with its
// trust tier and its staleness stated, and the planner - which can see the
// whole pool at once - is what judges them.

const information = require('../information');
const rss = require('../information/providers/rss');
const websearch = require('../information/providers/websearch');
const trust = require('../information/trust');
const { mapLimit } = require('./parallel');

/** Open-web searches in the air at once. Politeness, not a rate limit. */
const WEB_CONCURRENCY = 3;

/** Items kept per tag, per source kind. A pool is for choosing from, not reading. */
const PER_TAG_LIMIT = 25;

/** The freshness category every newsdesk query is judged against. */
const CATEGORY = 'current_news';

let tagsModule;
// Same dynamic import() the character grid, the ink palette and the block
// kinds already reach the browser's catalogues with.
async function tags() {
  if (!tagsModule) tagsModule = await import('../../../public/editor/layout/news-tags.js');
  return tagsModule;
}

function timeoutMs() {
  return Number(process.env.INFORMATION_TIMEOUT_MS) || 8000;
}

/** A URL as an identity: scheme, host and path, without the tracking tail. */
function urlKey(url) {
  try {
    const parsed = new URL(String(url));
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

/**
 * The candidate pool for a brief.
 *
 * @param {{tagKeys: string[], place: string}} brief
 * @returns {{items, byTag, errors, stats}} every item carrying the tags whose
 *   query found it - an item CAN belong to two, and that is information the
 *   planner uses rather than a conflict to resolve here.
 */
async function retrieve({ tagKeys = [], place = '', windowMs } = {}) {
  const { retrievalPlanFor } = await tags();
  const plan = retrievalPlanFor(tagKeys, { place });
  if (!plan.length) return { items: [], byTag: {}, errors: [], stats: { feedsFetched: 0, webQueries: 0 } };

  const errors = [];

  // --- the feeds: one fetch each, matched against every tag ------------------
  const feedQueries = plan.map((entry) => ({
    key: entry.tagKey,
    query: entry.query,
    feeds: rss.feedsForScopes(entry.scopes),
  }));
  const feedResult = rss.isConfigured()
    ? await rss.searchMany(feedQueries, { timeoutMs: timeoutMs() })
    : { byKey: new Map(), errors: [], feedsFetched: 0 };
  errors.push(...feedResult.errors.map((e) => ({ ...e, where: 'feeds' })));

  // --- the open web: one request per asking tag, bounded --------------------
  const webPlan = plan.filter((entry) => entry.openWeb);
  const webResults = await mapLimit(webPlan, WEB_CONCURRENCY, async (entry) => ({
    tagKey: entry.tagKey,
    ...(await websearch.search(entry.query, { timeoutMs: timeoutMs() })),
  }));
  for (const result of webResults) {
    if (result.error) errors.push({ where: 'open-web', error: result.error });
    for (const e of result.errors || []) errors.push({ ...e, where: 'open-web' });
  }

  // --- merge -----------------------------------------------------------------
  // Keyed on the URL, so the same story reached through two tags is ONE
  // candidate carrying both. A verified feed copy always wins over an
  // open-web copy of the same URL: the item is the same, and the difference
  // is only in how we came to it.
  const merged = new Map();
  const add = (raw, tagKey, openWeb) => {
    for (const item of information.annotate(raw.slice(0, PER_TAG_LIMIT), { category: CATEGORY, openWeb, windowMs })) {
      const key = urlKey(item.url);
      if (!key) continue;
      const existing = merged.get(key);
      if (existing) {
        existing.tags.add(tagKey);
        if (existing.openWeb && !openWeb) { existing.openWeb = false; existing.trust = item.trust; }
        continue;
      }
      merged.set(key, { ...item, tags: new Set([tagKey]) });
    }
  };

  for (const entry of plan) add(feedResult.byKey.get(entry.tagKey) || [], entry.tagKey, false);
  for (const result of webResults) if (result.items) add(result.items, result.tagKey, true);

  // Best first, so a pool that has to be truncated for a prompt keeps the
  // stories most worth printing: a checked publisher beats an unchecked one,
  // and a fresh item beats a stale one.
  const rank = (item) => (trust.CAN_VERIFY_ALONE.has(item.trust) ? 0 : 1) + (item.stale ? 2 : 0);
  const items = [...merged.values()]
    .map((item, index) => ({ ...item, tags: [...item.tags], id: `s${String(index + 1).padStart(3, '0')}` }))
    .sort((a, b) => rank(a) - rank(b) || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));

  const byTag = {};
  for (const entry of plan) byTag[entry.tagKey] = items.filter((item) => item.tags.includes(entry.tagKey)).length;

  return {
    items,
    byTag,
    errors,
    stats: {
      feedsFetched: feedResult.feedsFetched,
      webQueries: webPlan.length,
      verified: items.filter((item) => !item.openWeb && trust.CAN_VERIFY_ALONE.has(item.trust)).length,
      unverified: items.filter((item) => item.openWeb).length,
      stale: items.filter((item) => item.stale).length,
    },
  };
}

module.exports = { retrieve, urlKey, CATEGORY, PER_TAG_LIMIT };
