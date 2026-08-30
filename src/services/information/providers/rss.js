// The one source this phase implements: RSS/Atom feeds, nothing else.
//
// Not arbitrary webpage scraping - deliberately. A feed is a bounded, known
// shape (a flat list of items, each with a title/link/description/date); a
// webpage is unbounded HTML that may be rendered by JavaScript this process
// never runs, may be enormous, and is exactly the surface a prompt-injection
// attempt would use. RSS/Atom is the smallest source type that is genuinely
// useful and genuinely safe to add first.

const DEFAULT_TIMEOUT_MS = 8000;

function feedsFromEnv(name) {
  return String(process.env[name] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// The original, flat list - every configured feed, asked for every query.
// Kept working exactly as it did before scope routing existed: a newsroom
// that only ever set this one variable sees no change in behaviour.
function configuredFeeds() {
  return feedsFromEnv('INFORMATION_RSS_FEEDS');
}

function nationalFeeds() {
  return feedsFromEnv('INFORMATION_RSS_FEEDS_NATIONAL');
}

function maharashtraFeeds() {
  return feedsFromEnv('INFORMATION_RSS_FEEDS_MAHARASHTRA');
}

function isConfigured() {
  return configuredFeeds().length > 0 || nationalFeeds().length > 0 || maharashtraFeeds().length > 0;
}

/**
 * The feeds worth asking for these scopes (`routing.scopesFor()`'s output).
 *
 * Falls back to the flat legacy list only when NEITHER scoped variable is
 * set at all - once a newsroom configures scoped feeds, an empty result for
 * a scope it did not configure means "nothing for that scope" and stays
 * empty, rather than silently reaching for the flat list.
 */
function feedsForScopes(scopes) {
  const byScope = { national: nationalFeeds, maharashtra: maharashtraFeeds };
  const named = [...new Set((scopes || []).flatMap((scope) => (byScope[scope] ? byScope[scope]() : [])))];
  if (named.length || nationalFeeds().length || maharashtraFeeds().length) return named;
  return configuredFeeds();
}

// ---- a small RSS/Atom reader, not a general XML parser --------------------
//
// Node ships nothing to parse XML with, and a package for "read a handful of
// flat tags out of a feed" is more than a first RSS-only pass needs. This is
// regular expressions over a known-simple grammar (RSS 2.0 / Atom's flat
// per-item tags), not a real parser: a value containing an unescaped `<`, or
// the same tag name nested at two levels, is exactly what this does NOT
// attempt to handle. That trade is deliberate here and would not be if this
// grew into a general feed reader.

function unwrapCdata(raw) {
  const match = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(String(raw).trim());
  return match ? match[1] : raw;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Source text is untrusted DATA. This strips markup rather than rendering it,
// so nothing from a feed - including text shaped like an instruction - is
// ever interpreted as anything but a string of characters.
//
// Entities decoded BEFORE tags are stripped: a feed that HTML-escapes its
// markup (`&lt;p&gt;...&lt;/p&gt;`, common outside a CDATA block) has no
// literal `<` for the tag-stripper to see until the entities are decoded.
function stripHtml(raw) {
  return decodeEntities(String(raw)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(raw) {
  return raw ? stripHtml(unwrapCdata(raw)) : '';
}

function tag(xml, name) {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
  return match ? match[1] : '';
}

function allBlocks(xml, name) {
  return xml.match(new RegExp(`<${name}[\\s>][\\s\\S]*?<\\/${name}>`, 'gi')) || [];
}

// A source with no parseable date is treated as STALE and dropped, never as
// fresh (freshness.js) - which is the right way round, and it makes this
// function load-bearing: every date it fails to read silently deletes a whole
// publisher from the retrieval. Measured against the nine researched feeds,
// this used to read five of them:
//
//   PIB (the only OFFICIAL .gov.in source)  0 of  20 items dated
//   The Hindu                               0 of  60
//   Hindustan Times                         0 of 100
//   NDTV                                    0 of  20
//
// 200 of 539 items, including both of the highest-trust sources in the set,
// discarded as stale - so nearly every query came back `insufficient` and
// every "Write empty blocks" refused. Two causes, and neither is exotic:
//
//   * The Hindu, HT and NDTV wrap the date in CDATA, exactly as they wrap
//     their titles. `unwrapCdata` already existed and was already applied to
//     the title, link and description through cleanText() - the date was the
//     one field that never got it, so `new Date('<![CDATA[Thu, 20 Aug 2026
//     02:04:59 +0530]]>')` was an Invalid Date.
//   * PIB writes `17/08/2026 12:08 IST`. Day first, and a timezone ABBREVIATION
//     rather than an offset - `new Date` reads "17" as a month and gives up.
//     RFC 822 allows a named zone and IST is not one of the names it names, so
//     this is handled here rather than hoped for.
const DAY_FIRST = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(IST)?\s*$/i;

function parseDate(raw) {
  if (!raw) return null;
  const text = unwrapCdata(String(raw)).trim();
  if (!text) return null;

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  const dayFirst = DAY_FIRST.exec(text);
  if (dayFirst) {
    const [, d, m, y, hh, mm, ss, ist] = dayFirst;
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    // IST is +05:30. Without it the string is read as the server's own local
    // time, which is what `new Date` would have done for a well-formed one.
    const iso = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${mm}:${pad(ss || 0)}${ist ? '+05:30' : ''}`;
    const built = new Date(iso);
    if (!Number.isNaN(built.getTime())) return built.toISOString();
  }
  return null;
}

function looksLikeFeed(xml) {
  return /<rss[\s>]/i.test(xml) || /<feed[\s>]/i.test(xml);
}

// The channel/feed-level title, read as everything before the first item -
// crude, but the per-item title tags never appear before their own item does.
function feedTitle(xml) {
  const cut = xml.search(/<(item|entry)[\s>]/i);
  const head = cut === -1 ? xml : xml.slice(0, cut);
  return cleanText(tag(head, 'title'));
}

function parseFeed(xml) {
  if (!looksLikeFeed(xml)) return { error: 'Response was not an RSS or Atom feed', condition: 'malformed' };

  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const publisher = feedTitle(xml);
  const blocks = allBlocks(xml, isAtom ? 'entry' : 'item');

  const items = blocks.map((block) => {
    const title = cleanText(tag(block, 'title'));
    let link = '';
    if (isAtom) {
      const href = /<link\b[^>]*href="([^"]*)"/i.exec(block);
      link = href ? href[1] : cleanText(tag(block, 'link'));
    } else {
      link = cleanText(tag(block, 'link'));
    }
    const description = cleanText(tag(block, isAtom ? 'summary' : 'description') || tag(block, 'content'));
    const publishedAt = parseDate(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated'));
    // AN ITEM MAY NAME ITS OWN PUBLISHER, and on a search endpoint it always
    // does: Google News carries `<source url="...">The Times of India</source>`
    // per item, because the items come from many papers rather than one. Taken
    // when present, because otherwise every hit inherits the CHANNEL's title -
    // which collapsed 51 district stories from a dozen papers into a single
    // "Google News" source, and `onePerPublisher()` then threw all but one
    // away as duplicates of one voice.
    const itemSource = cleanText(tag(block, 'source'));
    const sourceUrl = (/<source\b[^>]*url="([^"]*)"/i.exec(block) || [])[1] || '';
    return {
      title, link, description, publishedAt,
      publisher: itemSource || publisher,
      publisherUrl: sourceUrl || undefined,
    };
  }).filter((item) => item.title || item.link);

  return { items };
}

async function fetchFeed(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!response.ok) return { error: `RSS feed returned ${response.status}`, condition: 'unavailable' };
    const text = await response.text();
    return parseFeed(text);
  } catch (error) {
    return error.name === 'AbortError'
      ? { error: 'RSS feed timed out', condition: 'timeout' }
      : { error: error.message, condition: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

// A real shared WORD, not a substring - a temporal word like "आज" would
// otherwise match nearly every item in every feed.
//
// `\p{M}` (combining mark) has to sit beside `\p{L}` here, or this silently
// breaks on real Marathi. Devanagari vowels attached to a consonant - ा
// (U+093E), ि, ी, ् (virama) and the rest - are Unicode category Mn/Mc, not
// L, so `[^\p{L}\p{N}]+` treats them as WORD BOUNDARIES. Measured directly:
// "सातारा" split into "स", "त", "र" - three one-character fragments, every
// one below the 3-character floor, so the query lost its only real word and
// silently matched everything. This was true from the day this function was
// written; it surfaced only once real Marathi feeds were connected in Phase
// 9 and a district query returned 91 unrelated items.
// The tokenizer and the noise list moved to ../words.js when duplicate
// detection became a second caller. Same functions, same \p{M} lesson, one
// implementation - see that file's header.
const { significantWords, contentWords: queryWordsFor } = require('../words');

function matchesQuery(item, queryWords) {
  // No words to match on means NOTHING matches, not everything. It read
  // `return true` here, so a blank seed handed the model the entire contents
  // of every configured feed - measured: 539 unrelated items, returned as
  // status `verified`, which is the one thing this layer exists to make
  // impossible. intent.js gates the live path and no caller does this today;
  // a safety layer with a "match everything" branch in it is one edit away
  // from being no safety layer, and CLAUDE.md already records this exact
  // failure once (significantWords stripping a district's only real word and
  // "silently matching everything").
  if (!queryWords.length) return false;
  const haystack = new Set(significantWords(`${item.title} ${item.description}`));
  return queryWords.some((word) => haystack.has(word));
}

/**
 * Fetch every feed in scope and keep only items that share a real word with
 * the query. A feed is not a search engine - there is no query parameter to
 * send it - so the filtering happens here, after the fetch.
 *
 * `feeds`, when given, is the explicit list to ask (routing decided it) and
 * overrides the flat configured list entirely - the caller already resolved
 * which feeds are worth asking; this function does not second-guess it.
 *
 * Never throws: one feed failing to fetch or parse is dropped and reported in
 * `errors`, not allowed to fail the whole search.
 */
async function search(query, { timeoutMs = DEFAULT_TIMEOUT_MS, feeds: explicitFeeds, matchAll = false } = {}) {
  const feeds = explicitFeeds || configuredFeeds();
  if (!feeds.length) return { items: [], errors: [] };

  // `matchAll` is for a feed that has ALREADY matched the query - a search
  // endpoint rather than a publisher's front page (providers/websearch.js).
  // Filtering those a second time on the seed's own words throws away good
  // hits whose headline happens to word it differently, which is most of them.
  const queryWords = queryWordsFor(query);
  const results = await Promise.all(feeds.map((url) => fetchFeed(url, timeoutMs)));

  const items = [];
  const errors = [];
  results.forEach((result, index) => {
    if (result.error) {
      errors.push({ feed: feeds[index], error: result.error, condition: result.condition });
      return;
    }
    for (const item of result.items) {
      // `matchAll`: the endpoint has already matched the query, so every item
      // it returned is a hit. See the note where the option is read.
      if (matchAll || matchesQuery(item, queryWords)) items.push(item);
    }
  });

  return { items, errors };
}

/**
 * Several queries against ONE fetch of each feed.
 *
 * `search()` is right for a single seed and wrong for a whole edition: a
 * thirteen-tag brief calling it thirteen times fetches the same eight feeds
 * thirteen times - around two hundred requests to a handful of publishers for
 * one press run, which is both slow and rude. A feed is not a search engine,
 * so the query never reaches it anyway: the fetch and the matching are already
 * separate acts, and only the matching is per-query.
 *
 * So the union of every query's feeds is fetched once and each query is
 * matched against the same parsed items. The matching itself is the SAME
 * `matchesQuery` - there is deliberately no second implementation here, which
 * is the whole reason this lives in the reader rather than in the caller.
 *
 * @param {Array<{key: string, query: string, feeds: string[]}>} queries
 * @returns {{byKey: Map<string, object[]>, errors: object[], feedsFetched: number}}
 */
async function searchMany(queries = [], { timeoutMs = DEFAULT_TIMEOUT_MS, matchAll = false } = {}) {
  const wanted = [...new Set(queries.flatMap((q) => q.feeds || []))];
  if (!wanted.length) return { byKey: new Map(), errors: [], feedsFetched: 0 };

  const results = await Promise.all(wanted.map((url) => fetchFeed(url, timeoutMs)));
  const byFeed = new Map();
  const errors = [];
  results.forEach((result, index) => {
    if (result.error) {
      errors.push({ feed: wanted[index], error: result.error, condition: result.condition });
      return;
    }
    byFeed.set(wanted[index], result.items);
  });

  const byKey = new Map();
  for (const q of queries) {
    const queryWords = queryWordsFor(q.query);
    const hits = [];
    for (const feed of q.feeds || []) {
      for (const item of byFeed.get(feed) || []) {
        if (matchAll || matchesQuery(item, queryWords)) hits.push(item);
      }
    }
    byKey.set(q.key, hits);
  }

  return { byKey, errors, feedsFetched: byFeed.size };
}

module.exports = {
  search, searchMany, isConfigured, configuredFeeds, nationalFeeds, maharashtraFeeds, feedsForScopes,
  // exported for tests, which parse fixture strings directly
  parseFeed,
};
