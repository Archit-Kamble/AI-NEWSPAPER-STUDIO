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
// A masthead is short. ABP Majha's Maharashtra feed sets its channel <title>
// to its own top HEADLINE, which changes through the day - measured live:
// "Manoj Jarange Patil and Eknath Shinde: मनोज जरांगे एकनाथ शिंदेंवर संतापले…"
// arrived as the publisher of five separate stories. A feed's channel title is
// therefore not reliably a publication name, so a long one is treated as what
// it is (an article title that leaked into the wrong element) and the domain
// is shown instead.
const PUBLISHER_NAME_MAX = 40;

// Hosts that are never themselves the publisher. A Google News link is a
// redirect through the aggregator, so its host identifies Google and not the
// newsroom - keyed on it, twenty-five stories from a dozen papers collapse
// into one voice, which is the headline-as-publisher failure with the sign
// flipped. The reader extracts each item's real <source url="..."> and that
// wins; this is the fallback for an item that arrived without one, where the
// NAME is the only distinguishing signal there is.
const AGGREGATOR_HOSTS = new Set(['news.google.com']);

function displayPublisher(item, domain) {
  const named = String(item.publisher || '').trim();
  if (!named || named.length > PUBLISHER_NAME_MAX) return domain || 'unknown';
  return named;
}

function toSource(item) {
  const excerptSource = [item.title, item.description].filter(Boolean).join(' — ');
  // safeHostname() answers 'unknown' rather than '' for anything it cannot
  // parse, so it must never be handed an absent value: `safeHostname('')` is
  // TRUTHY, and every unattributed item would share the one identity
  // "unknown" - two different wires collapsing into one voice, which is the
  // exact guarantee this field exists to keep. Guard the call, and treat the
  // sentinel as no identity wherever it does arrive.
  const attributed = item.publisherUrl ? safeHostname(item.publisherUrl) : '';
  const linkHost = item.link ? safeHostname(item.link) : '';
  const domain = attributed || linkHost || '';
  // `trust` deliberately stays on the link we actually fetched. An open-web
  // item is `unverified` by design however respectable the domain it names,
  // and reading trust off an aggregator's attribution would quietly undo that.
  const identifies = domain && domain !== 'unknown' && !AGGREGATOR_HOSTS.has(domain);
  return {
    publisher: displayPublisher(item, domain),
    // The outlet's IDENTITY, and deliberately separate from its display name.
    // Two things go wrong when a name is used as an identity, and both were
    // measured on real feeds: one outlet whose channel title is its current
    // headline counts as a new voice every time its front page changes, and
    // TV9 arrives as both "TV9 Marathi" and "TV9 Marathi- Marathi News,
    // Marathi Samachar (समाचार), मराठी न्यूज़" - two names, two votes, one
    // newsroom. `onePerPublisher()` exists to make exactly that impossible,
    // so it has to key on something the publisher cannot vary at will.
    publisherDomain: identifies ? domain : null,
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
    const key = (source.publisherDomain || source.publisher || source.url || '').toLowerCase();
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


/**
 * Retrieved items, shaped and annotated, with no verdict attached.
 *
 * The one place a raw feed item becomes something the rest of SAHAS may look
 * at - shared by the strict single-story path and by the Newsdesk Run, which
 * is the point: a second copy of source shaping is the drift this project has
 * been bitten by twice.
 *
 * Staleness and trust are STATED here, never acted on. Whether an eight-hour
 * old story belongs in tomorrow's paper is an editorial decision, and this
 * module's whole discipline is to decline to make those early.
 */
function annotate(items, { category, openWeb = false } = {}) {
  return items.map((item) => {
    const source = toSource(item);
    return {
      ...source,
      title: truncate(item.title, EXCERPT_MAX_CHARS),
      stale: freshness.isStale(source.publishedAt, category),
      // An open-web item can never be `verified`, whatever its domain says.
      // Carrying that on the ITEM is what lets one pool hold both kinds and a
      // story be scored on the sources it actually has.
      openWeb,
    };
  });
}

/**
 * The candidate POOL for one query - every retrieved item, shaped and
 * annotated, with no verify-or-refuse verdict attached.
 *
 * `fetchContext()` above answers "may a writer use this?" and is deliberately
 * lossy on the way there: it keeps at most MAX_FACTS digests, collapses
 * publishers, and throws the rest away, because a single story needs a small
 * set of checked facts and nothing else.
 *
 * The Newsdesk Run needs the opposite. It clusters many articles into EVENTS,
 * and an event is precisely a group of articles from different publishers -
 * so the run needs the whole list, undeduplicated, with each item's own trust
 * tier and staleness stated rather than acted on. The judgement stays where it
 * always was; this only declines to make it early.
 *
 * Deliberately shares toSource/trust/freshness with the strict path. A second
 * copy of source shaping is the drift this project has been bitten by twice.
 */
async function fetchPool({ query, category, openWeb = false, limit = 40 }) {
  const retrievedAt = new Date().toISOString();
  const base = { query, category, retrievedAt, items: [] };
  if (!openWeb && !isConfigured()) return { ...base, status: 'unavailable' };

  const scopes = routing.scopesFor(query);
  const feeds = PROVIDERS.rss.feedsForScopes(scopes);
  const { items } = openWeb
    ? await OPEN_WEB.search(query, { timeoutMs: timeoutMs() })
    : await PROVIDERS.rss.search(query, { timeoutMs: timeoutMs(), feeds });

  if (!items.length) return { ...base, status: 'insufficient' };
  return {
    ...base,
    status: openWeb ? 'unverified' : 'retrieved',
    items: annotate(items.slice(0, limit), { category, openWeb }),
  };
}

module.exports = {
  isConfigured,
  fetchPool,
  annotate,
  status,
  fetchContext,
  classifyIntent: intent.classifyIntent,
  needsRetrieval: intent.needsRetrieval,
  refusalMessage: conditions.refusalMessage,
  TRUST: trust.TRUST,
  PROVIDERS,
};
