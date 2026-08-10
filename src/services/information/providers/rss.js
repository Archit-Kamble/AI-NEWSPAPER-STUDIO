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

function parseDate(raw) {
  if (!raw) return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    return { title, link, description, publishedAt, publisher };
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
function significantWords(text) {
  return String(text || '').split(/[^\p{L}\p{M}\p{N}]+/u).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);
}

// Measured live against real feeds: "सातारा ताज्या बातम्या" (Satara latest
// news) matched on "ताज्या"/"बातम्या" alone - words that mean "this is news"
// and appear in nearly every headline about anything - and returned 91
// items with nothing to do with Satara. The words that actually say WHAT the
// query is about (the place, the topic) are what should decide a match; the
// words that only say "this is current news" should not. Reusing
// intent.js's own NEWS_WORDS/TEMPORAL_WORDS as the exclusion list rather
// than a second one - the same words that make a seed "about something
// current" are exactly the ones that carry no content of their own.
const { NEWS_WORDS, TEMPORAL_WORDS } = require('../intent');
const NOISE_WORDS = new Set([...NEWS_WORDS, ...TEMPORAL_WORDS].map((w) => w.toLowerCase()));

// If every word in the query happened to be a noise word (rare - the intent
// classifier already required a content signal to reach retrieval at all),
// filtering to nothing would match everything indiscriminately, which is
// worse than matching on the noise words. Fall back to the unfiltered words.
function queryWordsFor(query) {
  const words = significantWords(query);
  const withoutNoise = words.filter((w) => !NOISE_WORDS.has(w));
  return withoutNoise.length ? withoutNoise : words;
}

function matchesQuery(item, queryWords) {
  if (!queryWords.length) return true;
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
async function search(query, { timeoutMs = DEFAULT_TIMEOUT_MS, feeds: explicitFeeds } = {}) {
  const feeds = explicitFeeds || configuredFeeds();
  if (!feeds.length) return { items: [], errors: [] };

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
      if (matchesQuery(item, queryWords)) items.push(item);
    }
  });

  return { items, errors };
}

module.exports = {
  search, isConfigured, configuredFeeds, nationalFeeds, maharashtraFeeds, feedsForScopes,
  // exported for tests, which parse fixture strings directly
  parseFeed,
};
