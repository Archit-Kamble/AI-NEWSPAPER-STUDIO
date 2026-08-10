// The one source this phase implements: RSS/Atom feeds, nothing else.
//
// Not arbitrary webpage scraping - deliberately. A feed is a bounded, known
// shape (a flat list of items, each with a title/link/description/date); a
// webpage is unbounded HTML that may be rendered by JavaScript this process
// never runs, may be enormous, and is exactly the surface a prompt-injection
// attempt would use. RSS/Atom is the smallest source type that is genuinely
// useful and genuinely safe to add first.

const DEFAULT_TIMEOUT_MS = 8000;

function configuredFeeds() {
  return String(process.env.INFORMATION_RSS_FEEDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isConfigured() {
  return configuredFeeds().length > 0;
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
// otherwise match nearly every item in every feed. Devanagari and Latin both
// split cleanly on non-letter/number boundaries.
function significantWords(text) {
  return String(text || '').split(/[^\p{L}\p{N}]+/u).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3);
}

function matchesQuery(item, queryWords) {
  if (!queryWords.length) return true;
  const haystack = new Set(significantWords(`${item.title} ${item.description}`));
  return queryWords.some((word) => haystack.has(word));
}

/**
 * Fetch every configured feed and keep only items that share a real word with
 * the query. A feed is not a search engine - there is no query parameter to
 * send it - so the filtering happens here, after the fetch.
 *
 * Never throws: one feed failing to fetch or parse is dropped and reported in
 * `errors`, not allowed to fail the whole search.
 */
async function search(query, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const feeds = configuredFeeds();
  if (!feeds.length) return { items: [], errors: [] };

  const queryWords = significantWords(query);
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
  search, isConfigured, configuredFeeds,
  // exported for tests, which parse fixture strings directly
  parseFeed,
};
