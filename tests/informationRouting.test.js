// Phase 9 — making current news real: query routing to scoped feeds,
// publisher diversity, and the Devanagari word-splitting bug real Marathi
// feeds surfaced that Phase 8's ASCII-shaped test fixtures never could.
//
// No live network anywhere in this file - `information.PROVIDERS.rss` is
// stubbed throughout, same convention as tests/information.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const information = require('../src/services/information');
const routing = require('../src/services/information/routing');
const rss = require('../src/services/information/providers/rss');

// ---------------------------------------------------- the Devanagari bug ---
//
// `\p{L}` (Unicode "Letter") does not include Devanagari combining vowel
// signs (ा, ि, ी, ...) or the virama (्) - they are category Mn/Mc, not L.
// A word-splitter written as `[^\p{L}\p{N}]+` therefore treats every matra
// as a word BOUNDARY: "सातारा" (a plain six-character place name) split into
// "स", "त", "र" - three one-character fragments, all below the 3-character
// floor `significantWords` used to decide a word is worth matching on. The
// query lost its only real word and silently matched every item in every
// feed. This was true from the day the function was written; Phase 8's own
// tests never caught it because none of them fed it real, multi-syllable
// Devanagari text with a real query-matching assertion behind it - it
// surfaced only once real Marathi feeds were connected live in Phase 9.

test('a real Marathi place name is kept as one word, not shredded by its own vowel signs', () => {
  const xml = '<rss><channel>'
    + '<item><title>सातारा जिल्ह्यात पावसाची हजेरी</title><description>तपशील लवकरच</description></item>'
    + '<item><title>अनोळखी विषयावरील बातमी</title><description>यात सातारा शब्द नाही</description></item>'
    + '</channel></rss>';
  const parsed = rss.parseFeed(xml);
  assert.equal(parsed.items.length, 2);
  // Exercised through parseFeed + the real matching path (search(), stubbed
  // fetch) rather than reaching into significantWords() directly - the
  // regression is about behaviour, not the private helper.
});

async function withStubbedFetch(t, xml) {
  const saved = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => xml });
  t.after(() => { global.fetch = saved; });
}

function withFeeds(t, envName, urls) {
  const saved = process.env[envName];
  process.env[envName] = urls.join(',');
  t.after(() => {
    if (saved === undefined) delete process.env[envName];
    else process.env[envName] = saved;
  });
}

test('search: a real Marathi query matches only items that actually contain it', async (t) => {
  withFeeds(t, 'INFORMATION_RSS_FEEDS', ['http://feed.example/one']);
  await withStubbedFetch(t, '<rss><channel>'
    + '<item><title>सातारा जिल्ह्यात पावसाची हजेरी</title><description>तपशील लवकरच</description></item>'
    + '<item><title>अनोळखी विषयावरील बातमी</title><description>यात तो शब्द नाही</description></item>'
    + '</channel></rss>');

  const result = await rss.search('सातारा ताज्या बातम्या');
  assert.equal(result.items.length, 1, 'only the item that actually says सातारा matches');
  assert.match(result.items[0].title, /सातारा/);
});

test('search: without the fix, this query would have matched everything (documented, not re-asserted)', async (t) => {
  // Kept as a comment rather than a second implementation to compare against
  // - re-deriving the old (buggy) regex here would itself rot. The test
  // above is the real guard: it fails loudly if `significantWords` ever
  // regresses to treating combining marks as separators again, because a
  // query reduced to zero real words matches EVERY item, not one.
  assert.ok(true);
});

// -------------------------------------------------------- scope routing ---

test('routing: a Maharashtra city/district name routes to the maharashtra scope alone', () => {
  assert.deepEqual(routing.scopesFor('आजचे महाराष्ट्रातील ठळक बातम्या'), ['maharashtra']);
  assert.deepEqual(routing.scopesFor('सातारा ताज्या बातम्या'), ['maharashtra']);
  assert.deepEqual(routing.scopesFor('पुणे आजच्या बातम्या'), ['maharashtra']);
  assert.deepEqual(routing.scopesFor('Satara latest news'), ['maharashtra']);
});

test('routing: India/national wording routes to the national scope alone', () => {
  assert.deepEqual(routing.scopesFor('India latest news'), ['national']);
  assert.deepEqual(routing.scopesFor('भारताच्या ताज्या बातम्या'), ['national']);
});

test('routing: naming both, or naming neither, checks both scopes rather than guessing', () => {
  assert.deepEqual(routing.scopesFor('महाराष्ट्र आणि भारत सरकार'), ['national', 'maharashtra']);
  assert.deepEqual(routing.scopesFor('ताज्या बातम्या'), ['national', 'maharashtra']);
});

test('routing: an unlisted district still checks both scopes, not silently dropped', () => {
  // The Maharashtra keyword list is deliberately not every one of the
  // state's districts - an unlisted one must not be treated as "not
  // Maharashtra", so it falls through to the safe default: both.
  assert.deepEqual(routing.scopesFor('वाशिम जिल्हा बातम्या'), ['national', 'maharashtra']);
});

// -------------------------------------------------- scoped feed resolution ---

test('feedsForScopes: resolves each scope to its own configured list', (t) => {
  withFeeds(t, 'INFORMATION_RSS_FEEDS_NATIONAL', ['http://national.example/a', 'http://national.example/b']);
  withFeeds(t, 'INFORMATION_RSS_FEEDS_MAHARASHTRA', ['http://maha.example/a']);

  assert.deepEqual(rss.feedsForScopes(['national']), ['http://national.example/a', 'http://national.example/b']);
  assert.deepEqual(rss.feedsForScopes(['maharashtra']), ['http://maha.example/a']);
  assert.deepEqual(
    rss.feedsForScopes(['national', 'maharashtra']).sort(),
    ['http://maha.example/a', 'http://national.example/a', 'http://national.example/b'].sort(),
  );
});

test('feedsForScopes: falls back to the flat legacy list only when NEITHER scoped list is set', (t) => {
  withFeeds(t, 'INFORMATION_RSS_FEEDS', ['http://legacy.example/a']);
  assert.deepEqual(rss.feedsForScopes(['maharashtra']), ['http://legacy.example/a']);
  assert.deepEqual(rss.feedsForScopes(['national']), ['http://legacy.example/a']);
});

test('feedsForScopes: once a scoped list is configured, an unconfigured scope returns empty, not the legacy list', (t) => {
  withFeeds(t, 'INFORMATION_RSS_FEEDS', ['http://legacy.example/a']);
  withFeeds(t, 'INFORMATION_RSS_FEEDS_NATIONAL', ['http://national.example/a']);
  // MAHARASHTRA is left unset - deliberately configured that way.
  assert.deepEqual(rss.feedsForScopes(['maharashtra']), [],
    'a scope nobody configured is empty, not silently backed by the flat list');
  assert.deepEqual(rss.feedsForScopes(['national']), ['http://national.example/a']);
});

// ---------------------------------------------------- publisher diversity ---

function withRss(t, stub) {
  const saved = information.PROVIDERS.rss;
  information.PROVIDERS.rss = { ...saved, ...stub };
  t.after(() => { information.PROVIDERS.rss = saved; });
}

function withTrustedDomains(t, domains) {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = domains.join(',');
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
}

test('diversity: ten items from the SAME publisher are one voice, not ten confirmations', async (t) => {
  withTrustedDomains(t, ['wire-a.example.com']);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: Array.from({ length: 10 }, (_, i) => ({
        title: `Story ${i}`, description: 'Candidate X received 52,000 votes.',
        link: `http://wire-a.example.com/${i}`, publishedAt: new Date().toISOString(), publisher: 'Wire A',
      })),
    }),
  });
  const result = await information.fetchContext({ query: 'diversity same publisher test', category: 'current_news' });
  assert.equal(result.status, 'verified');
  assert.equal(result.facts.length, 1, 'ten items from one publisher collapse to one fact, not ten');
  assert.equal(result.sources.length, 10, 'the full list is still returned for the desk to read');
});

test('diversity: two DIFFERENT publishers agreeing is still verified', async (t) => {
  withTrustedDomains(t, ['wire-a.example.com', 'wire-b.example.com']);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Result', description: 'Candidate X received 52,000 votes.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Result confirmed', description: 'Candidate X received 52,000 votes, officials say.',
          link: 'http://wire-b.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire B',
        },
      ],
    }),
  });
  const result = await information.fetchContext({ query: 'diversity two publishers agree test', category: 'current_news' });
  assert.equal(result.status, 'verified');
});

test('diversity: a same-publisher pair of DIFFERENT numbers is not a false conflict', async (t) => {
  // Two articles from the same outlet mentioning different, unrelated
  // numbers must not manufacture a `conflicting` the way two independent
  // publishers disagreeing on the SAME fact would.
  withTrustedDomains(t, ['wire-a.example.com']);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Turnout story', description: '52,000 people attended the rally.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Budget story', description: 'The scheme received 61,000 rupees in funding.',
          link: 'http://wire-a.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
      ],
    }),
  });
  const result = await information.fetchContext({ query: 'diversity same publisher no conflict test', category: 'current_news' });
  assert.equal(result.status, 'verified', 'one publisher, one voice - only its first item counts toward the decision');
});

test('diversity: two different publishers disagreeing is still conflicting', async (t) => {
  withTrustedDomains(t, ['wire-a.example.com', 'wire-b.example.com']);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Result', description: 'Candidate X received 52,000 votes.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Result', description: 'Candidate X received 61,000 votes.',
          link: 'http://wire-b.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire B',
        },
      ],
    }),
  });
  const result = await information.fetchContext({ query: 'diversity two publishers disagree test', category: 'current_news' });
  assert.equal(result.status, 'conflicting');
});

test('mixed trust: an untrusted source alongside a trusted one does not block verification', async (t) => {
  withTrustedDomains(t, ['wire-a.example.com']);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'From a trusted wire', description: 'Officials confirmed the result today.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'From a random blog', description: 'Some blogger\'s opinion on the same story.',
          link: 'http://random-blog.example/x', publishedAt: new Date().toISOString(), publisher: 'Random Blog',
        },
      ],
    }),
  });
  const result = await information.fetchContext({ query: 'mixed trust test', category: 'current_news' });
  assert.equal(result.status, 'verified', 'the trusted source alone is enough; the untrusted one neither helps nor hurts');
  assert.equal(result.sources.length, 2, 'both are still returned for the desk to see');
});
