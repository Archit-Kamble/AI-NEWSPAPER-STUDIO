// THE WHOLE INTERNET, AND THE DESK VERIFIES IT.
//
// The RSS provider beside this one asks a hand-picked list of feeds, and its
// answers can be `verified` because every publisher on that list was checked
// once by a person (trust.js). That is right for national and state news and
// useless for the story a district daily actually runs: a taluka water scheme,
// a local body decision, a name only the Satara papers carry. Those exist on
// the internet and not in six national feeds.
//
// So this is the other kind of search - the whole web, by query - and it
// carries the opposite guarantee. NOTHING IT RETURNS IS VERIFIED. It is
// offered only when a desk explicitly asks for it, every fact it supplies is
// labelled as unverified in the brief and in the panel, and the copy it
// produces reaches the block as `needs_review` with a note saying so. The desk
// verifies it. That is not a weakness in this provider; it is the entire
// contract, and it is why the strict path above it is left exactly as strict
// as it was.
//
// Google News's search endpoint is used because it IS an RSS feed - the reader
// next door already parses it, no key, no new dependency, no vendor client -
// and because it indexes the district press this paper competes with rather
// than a handful of national wires. Verified live: 100 items for a Marathi
// district query, 54 for the English one, each item carrying its publisher in
// a `<source url>` tag.

const rss = require('./rss');

const ENDPOINT = 'https://news.google.com/rss/search';
const DEFAULT_TIMEOUT_MS = 8000;
// Two passes, because a district story is written in Marathi by the local
// press and in English by the nationals, and a desk asking about it wants
// whichever exists.
const EDITIONS = Object.freeze([
  { hl: 'mr', gl: 'IN', ceid: 'IN:mr' },
  { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
]);

/** Always available: it needs no key and no configuration. */
function isConfigured() {
  return true;
}

function urlFor(query, edition) {
  const params = new URLSearchParams({
    q: query, hl: edition.hl, gl: edition.gl, ceid: edition.ceid,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * Search the open web for this query.
 *
 * Returns the same item shape the RSS provider returns, so everything above -
 * dedupe, freshness, trust, the digest - works on it unchanged. What differs
 * is what the caller is allowed to conclude, and that is decided in index.js.
 */
async function search(query, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const clean = String(query || '').trim();
  if (!clean) return { items: [], errors: [] };
  const feeds = EDITIONS.map((edition) => urlFor(clean, edition));
  // Google has already matched the query, so the reader's own keyword filter
  // is not applied a second time - it would throw away good hits whose title
  // words differ from the seed's. `search()` takes the feeds explicitly.
  return rss.search(clean, { timeoutMs, feeds, matchAll: true });
}

module.exports = { isConfigured, search, urlFor, EDITIONS };
