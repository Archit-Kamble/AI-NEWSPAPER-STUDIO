// The one place SAHAS checks a fact before an AI writes about it — mirrors
// `src/services/ai/index.js`'s shape on purpose: one router, callers never
// name a provider, and the module says so plainly when nothing is configured
// rather than returning invented content dressed as a successful result.
//
// It answers exactly one question: for this seed, is there verified source
// material a writer may use? The answer is always one of four states -
// `verified`, `conflicting`, `insufficient`, `unavailable` - and `storyWriter`
// is the one place that turns a non-`verified` answer into a refusal. This
// module never writes a sentence of newspaper copy; it only decides what a
// writer is allowed to know.

const intent = require('./intent');
const trust = require('./trust');
const freshness = require('./freshness');
const conditions = require('./conditions');
const routing = require('./routing');
const rss = require('./providers/rss');
const websearch = require('./providers/websearch');

// The CHECKED sources - the ones whose answers can be `verified`. The open-web
// provider is deliberately NOT one of them: it needs no configuration, so
// counting it here would make `isConfigured()` permanently true and a newsroom
// with no feeds at all would stop being told so.
const PROVIDERS = { rss };
// Asked only when a desk explicitly ticks "search the whole internet", and its
// answers are never `verified`. See providers/websearch.js.
const OPEN_WEB = websearch;

const EXCERPT_MAX_CHARS = 240;
const MAX_FACTS = 5;

function timeoutMs() {
  return Number(process.env.INFORMATION_TIMEOUT_MS) || 8000;
}

function isConfigured() {
  return Object.values(PROVIDERS).some((provider) => provider.isConfigured());
}

function status() {
  return {
    configured: isConfigured(),
    providers: Object.entries(PROVIDERS).map(([key, provider]) => ({
      key,
      ready: provider.isConfigured(),
    })),
  };
}

// In-process only, on purpose - see VISION.md/CLAUDE.md's existing "no
// provider cooldown, no distributed cache" precedent. Cleared on restart,
// never shared across processes, never a second moving part to operate.
const cache = new Map();

function cacheKey(category, query) {
  return `${category}::${String(query || '').trim().toLowerCase()}`;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function truncate(text, max) {
  const clean = String(text || '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// The approved contract's `sources[]` shape: {publisher, trust, url,
// publishedAt, excerpt}. Nothing else rides along - a raw feed item has no
// business reaching a prompt or a desk screen unshaped.
function toSource(item) {
  const excerptSource = [item.title, item.description].filter(Boolean).join(' — ');
  return {
    publisher: item.publisher || (item.link ? safeHostname(item.link) : 'unknown'),
    trust: trust.trustForUrl(item.link),
    url: item.link || null,
    publishedAt: item.publishedAt,
    excerpt: truncate(excerptSource, EXCERPT_MAX_CHARS),
  };
}

function extractNumbers(text) {
  return (String(text).match(/\d[\d,]*/g) || []).map((n) => n.replace(/,/g, ''));
}

// Deliberately narrow. This is not fact-checking - it is one honest, testable
// signal: two trustworthy sources both stating a number about the same query,
// and the numbers disagree. Anything subtler than that (worded differently,
// no digits involved) is exactly what `insufficient`, not a false `verified`,
// is for - RSS alone was never going to prove a claim without a hard number to
// compare.
function conflicts(sources) {
  const withNumbers = sources.map((s) => new Set(extractNumbers(s.excerpt))).filter((set) => set.size > 0);
  if (withNumbers.length < 2) return false;
  for (let i = 0; i < withNumbers.length; i += 1) {
    for (let j = i + 1; j < withNumbers.length; j += 1) {
      const overlaps = [...withNumbers[i]].some((n) => withNumbers[j].has(n));
      if (!overlaps) return true;
    }
  }
  return false;
}

// Ten items from the same publisher's feed are one voice, not ten. Without
// this, a single outlet running several stories that happen to match the
// query could either manufacture a false `conflicting` (its own two articles
// mention different, unrelated numbers) or inflate confidence in a
// `verified` that is really one source repeated. Kept deliberately simple -
// a publisher-name lookup, not a similarity graph: at most one source per
// publisher survives into the facts/conflict decision. The FULL list is
// still returned in `sources` for the desk to read; only the verification
// decision is deduplicated.
function onePerPublisher(sources) {
  const seen = new Map();
  for (const source of sources) {
    const key = (source.publisher || source.url || '').toLowerCase();
    if (!seen.has(key)) seen.set(key, source);
  }
  return [...seen.values()];
}

// What the writer may state - short, pre-digested bullets, never the sources'
// raw text wholesale. Capped at MAX_FACTS so a busy news day cannot balloon a
// brief the way an uncapped source list would.
function digest(sources) {
  return sources.slice(0, MAX_FACTS).map((s) => truncate(s.excerpt, EXCERPT_MAX_CHARS));
}

/**
 * Ask whether there is verified source material for this query.
 *
 * @param {{query: string, category: string}} args  category is one of
 *   intent.classifyIntent()'s current_* / ambiguous values.
 * @returns {{query, category, retrievedAt, status, facts, sources}}
 */
async function fetchContext({ query, category, openWeb = false }) {
  const retrievedAt = () => new Date().toISOString();
  const empty = (resultStatus, sources = []) => ({
    query, category, retrievedAt: retrievedAt(), status: resultStatus, facts: [], sources,
  });

  // Not cached: caching "nothing is configured" would mean a newsroom that
  // adds a feed mid-day stays refused for up to the freshness window anyway.
  // An open-web search needs no feeds configured; the strict path does.
  if (!openWeb && !isConfigured()) return empty('unavailable');

  const key = `${openWeb ? 'web:' : ''}${cacheKey(category, query)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Which configured feeds are worth asking - a Maharashtra/district query
  // is not diluted by purely-national headlines and vice versa. Resolves to
  // the flat legacy list when no scoped feeds are configured at all.
  const scopes = routing.scopesFor(query);
  const feeds = PROVIDERS.rss.feedsForScopes(scopes);
  const { items } = openWeb
    ? await OPEN_WEB.search(query, { timeoutMs: timeoutMs() })
    : await PROVIDERS.rss.search(query, { timeoutMs: timeoutMs(), feeds });

  let value;
  if (!items.length) {
    value = empty('insufficient');
  } else if (openWeb) {
    // THE WHOLE INTERNET, AND NOTHING FROM IT IS VERIFIED.
    //
    // The strict path below requires an OFFICIAL or TRUSTED_NEWS publisher and
    // refuses without one, because a checked publisher is what makes a fact
    // safe to print unread. An open search cannot offer that and does not
    // pretend to: its status is `unverified`, every fact carries the
    // publisher it came from, and the desk is told - in the brief, in the
    // panel, and on the block - that they must check each one before it
    // prints. A district daily's own stories live here and nowhere else, so
    // the choice is this or nothing; what must never happen is this being
    // mistaken for the other.
    const sources = onePerPublisher(items.map(toSource));
    const fresh = sources.filter((s) => !freshness.isStale(s.publishedAt, category));
    const usable = fresh.length ? fresh : sources;
    value = {
      query, category, retrievedAt: retrievedAt(), status: 'unverified',
      facts: digest(usable), sources, mustVerify: true,
    };
  } else {
    const sources = items.map(toSource);
    const trustworthy = sources.filter((s) => trust.CAN_VERIFY_ALONE.has(s.trust));
    const fresh = onePerPublisher(trustworthy.filter((s) => !freshness.isStale(s.publishedAt, category)));

    if (!fresh.length) {
      // Sources exist and are kept for the desk to read - just none of them
      // both trustworthy AND current enough to write from.
      value = empty('insufficient', sources);
    } else if (conflicts(fresh)) {
      value = { query, category, retrievedAt: retrievedAt(), status: 'conflicting', facts: [], sources };
    } else {
      value = { query, category, retrievedAt: retrievedAt(), status: 'verified', facts: digest(fresh), sources };
    }
  }

  cache.set(key, { value, expiresAt: Date.now() + freshness.freshnessMsFor(category) });
  return value;
}

module.exports = {
  isConfigured,
  status,
  fetchContext,
  classifyIntent: intent.classifyIntent,
  needsRetrieval: intent.needsRetrieval,
  refusalMessage: conditions.refusalMessage,
  TRUST: trust.TRUST,
  PROVIDERS,
};
