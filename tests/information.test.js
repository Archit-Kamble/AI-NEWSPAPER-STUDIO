// Phase 8 — the verified information layer's own decisions: intent, trust,
// freshness, and the cache that sits in front of a source fetch.
//
// No network anywhere in this file. `fetchContext()` is exercised by
// stubbing `information.PROVIDERS.rss.search` directly - the same style
// `writingPipeline.test.js` already uses for `ai.PROVIDERS`.

const test = require('node:test');
const assert = require('node:assert/strict');

const information = require('../src/services/information');
const { classifyIntent, needsRetrieval } = require('../src/services/information/intent');
const { TRUST, trustForDomain, trustForUrl, CAN_VERIFY_ALONE } = require('../src/services/information/trust');
const { freshnessMsFor, isStale } = require('../src/services/information/freshness');

// -------------------------------------------------------------- intent ---

test('intent: evergreen - no temporal, data or topic word at all', () => {
  assert.equal(classifyIntent('Satara history'), 'evergreen');
  assert.equal(classifyIntent('साताऱ्याचा इतिहास'), 'evergreen');
  assert.equal(needsRetrieval('evergreen'), false);
});

test('intent: reporter_copy - asking to rewrite copy that already exists', () => {
  assert.equal(classifyIntent('Rewrite this reporter copy'), 'reporter_copy');
  assert.equal(classifyIntent('edit the reporter story'), 'reporter_copy');
  assert.equal(needsRetrieval('reporter_copy'), false);
});

test('intent: current_news - a news word alongside a temporal word', () => {
  assert.equal(classifyIntent("today's Maharashtra news"), 'current_news');
  assert.equal(needsRetrieval('current_news'), true);
});

test('intent: current_data - a result/score/weather word needs no temporal word beside it', () => {
  assert.equal(classifyIntent('Satara weather today'), 'current_data');
  assert.equal(classifyIntent('Bihar election result'), 'current_data');
  assert.equal(classifyIntent('कालच्या सामन्याचा स्कोअर'), 'current_data');
  assert.equal(needsRetrieval('current_data'), true);
});

test('intent: ambiguous - a current-events-shaped topic with no outcome or temporal word', () => {
  assert.equal(classifyIntent('Bihar election'), 'ambiguous');
  assert.equal(needsRetrieval('ambiguous'), true);
});

test('intent: reporter_copy is checked before any temporal/data word, even if both are present', () => {
  // "today's reporter copy" mentions a temporal word too - the request is
  // still about existing copy, not about fetching a new fact.
  assert.equal(classifyIntent("Rewrite today's reporter copy"), 'reporter_copy');
});

test('intent: empty or whitespace-only text is evergreen, not a crash', () => {
  assert.equal(classifyIntent(''), 'evergreen');
  assert.equal(classifyIntent('   '), 'evergreen');
  assert.equal(classifyIntent(undefined), 'evergreen');
});

// --------------------------------------------------------------- trust ---

test('trust: a government domain is OFFICIAL', () => {
  assert.equal(trustForDomain('eci.gov.in'), TRUST.OFFICIAL);
  assert.equal(trustForDomain('imd.gov.in'), TRUST.OFFICIAL);
});

test('trust: an explicitly configured domain is TRUSTED_NEWS', () => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'trusted-wire.example.com';
  try {
    assert.equal(trustForDomain('trusted-wire.example.com'), TRUST.TRUSTED_NEWS);
    assert.equal(trustForDomain('www.trusted-wire.example.com'), TRUST.TRUSTED_NEWS, 'www. is stripped before the lookup');
  } finally {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  }
});

test('trust: an unrecognised domain is UNKNOWN, never trusted merely for responding', () => {
  assert.equal(trustForDomain('some-random-blog.example'), TRUST.UNKNOWN);
  assert.equal(trustForDomain(''), TRUST.UNKNOWN);
  assert.equal(trustForUrl('not a url'), TRUST.UNKNOWN);
});

test('trust: only PRIMARY/OFFICIAL/TRUSTED_NEWS may verify a claim alone', () => {
  assert.ok(CAN_VERIFY_ALONE.has(TRUST.OFFICIAL));
  assert.ok(CAN_VERIFY_ALONE.has(TRUST.TRUSTED_NEWS));
  assert.ok(!CAN_VERIFY_ALONE.has(TRUST.SECONDARY));
  assert.ok(!CAN_VERIFY_ALONE.has(TRUST.UNKNOWN));
});

// ----------------------------------------------------------- freshness ---

test('freshness: a fresh source is not stale', () => {
  assert.equal(isStale(new Date().toISOString(), 'current_news'), false);
  assert.equal(isStale(new Date().toISOString(), 'current_data'), false);
});

test('freshness: current_data goes stale much sooner than current_news', () => {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  assert.equal(isStale(thirtyMinAgo, 'current_data'), true, 'a weather/score fact is too old after 30 minutes');
  assert.equal(isStale(thirtyMinAgo, 'current_news'), false, 'general news is still current after 30 minutes');
  assert.ok(freshnessMsFor('current_data') < freshnessMsFor('current_news'));
});

test('freshness: no publish date at all is treated as stale, not as fresh', () => {
  assert.equal(isStale(null, 'current_news'), true);
  assert.equal(isStale('not a date', 'current_news'), true);
});

// -------------------------------------------------------- fetchContext ---

function withRss(t, stub) {
  const saved = information.PROVIDERS.rss;
  information.PROVIDERS.rss = { ...saved, ...stub };
  t.after(() => { information.PROVIDERS.rss = saved; });
}

// Each test below uses its own query text, even where two tests would
// otherwise ask the same thing - `fetchContext` caches by (category, query),
// and the cache is a module-level Map shared across this whole file. Reusing
// a literal query between tests would make the second one read the first
// one's cached answer instead of exercising its own stub.

test('fetchContext: not configured at all - unavailable, and the source is never called', async (t) => {
  let called = false;
  withRss(t, { isConfigured: () => false, search: async () => { called = true; return { items: [] }; } });
  const result = await information.fetchContext({ query: 'not configured test', category: 'current_news' });
  assert.equal(result.status, 'unavailable');
  assert.equal(called, false, 'an unconfigured source must not be reached');
});

test('fetchContext: configured but nothing found - insufficient', async (t) => {
  withRss(t, { isConfigured: () => true, search: async () => ({ items: [] }) });
  const result = await information.fetchContext({ query: 'nothing found test', category: 'current_news' });
  assert.equal(result.status, 'insufficient');
  assert.deepEqual(result.facts, []);
});

test('fetchContext: items found but from an untrusted domain - insufficient, sources kept for audit', async (t) => {
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [{
        title: 'Some update', description: 'details', link: 'http://random-blog.example/a',
        publishedAt: new Date().toISOString(), publisher: 'Random Blog',
      }],
    }),
  });
  const result = await information.fetchContext({ query: 'untrusted domain test', category: 'current_news' });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.sources.length, 1, 'the source is still returned for the desk to see, even though it cannot verify alone');
  assert.equal(result.facts.length, 0, 'nothing unverified reaches `facts`, which is what the writer may state');
});

test('fetchContext: a trusted, fresh source - verified, with digested facts', async (t) => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'trusted-wire.example.com';
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [{
        title: 'Rain expected in Satara', description: 'IMD forecasts heavy rain today.',
        link: 'http://trusted-wire.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Trusted Wire',
      }],
    }),
  });
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
  const result = await information.fetchContext({ query: 'Satara weather', category: 'current_data' });
  assert.equal(result.status, 'verified');
  assert.equal(result.facts.length, 1);
  assert.match(result.facts[0], /Rain expected in Satara/);
  assert.equal(result.sources[0].trust, TRUST.TRUSTED_NEWS);
});

test('fetchContext: a trusted but stale source cannot verify - insufficient', async (t) => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'trusted-wire.example.com';
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [{
        title: 'Old score', description: 'Team A won 3-1.', link: 'http://trusted-wire.example.com/b',
        publishedAt: twoHoursAgo, publisher: 'Trusted Wire',
      }],
    }),
  });
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
  // current_data's window is short (15 min) - two hours old is stale for a score.
  const result = await information.fetchContext({ query: 'match score', category: 'current_data' });
  assert.equal(result.status, 'insufficient');
});

test('fetchContext: two trusted sources with disagreeing numbers - conflicting', async (t) => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'wire-a.example.com,wire-b.example.com';
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Result declared', description: 'Candidate X received 52,000 votes.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Result declared', description: 'Candidate X received 61,000 votes.',
          link: 'http://wire-b.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire B',
        },
      ],
    }),
  });
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
  const result = await information.fetchContext({ query: 'election result', category: 'current_data' });
  assert.equal(result.status, 'conflicting');
  assert.deepEqual(result.facts, [], 'nothing is stateable while the sources disagree');
  assert.equal(result.sources.length, 2, 'both sources are kept so the desk can read the disagreement');
});

test('fetchContext: two trusted sources that agree on the number are not a conflict', async (t) => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'wire-a.example.com,wire-b.example.com';
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Result declared', description: 'Candidate X received 52,000 votes.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Result confirmed', description: 'Candidate X received 52,000 votes, officials say.',
          link: 'http://wire-b.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire B',
        },
      ],
    }),
  });
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
  const result = await information.fetchContext({ query: 'election result agreement test', category: 'current_data' });
  assert.equal(result.status, 'verified');
});

test('cache: a second identical request within the freshness window does not call the source again', async (t) => {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = 'trusted-wire.example.com';
  let calls = 0;
  withRss(t, {
    isConfigured: () => true,
    search: async () => {
      calls += 1;
      return {
        items: [{
          title: 'Cached item', description: 'stays the same', link: 'http://trusted-wire.example.com/c',
          publishedAt: new Date().toISOString(), publisher: 'Trusted Wire',
        }],
      };
    },
  });
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
  const query = `cache test ${Date.now()}`; // unique key so other tests' cache entries cannot collide
  const first = await information.fetchContext({ query, category: 'current_news' });
  const second = await information.fetchContext({ query, category: 'current_news' });
  assert.equal(calls, 1, 'the second call must be served from the cache');
  assert.deepEqual(first, second);
});

test('cache: not caching an unconfigured source, so configuring one mid-day takes effect immediately', async (t) => {
  withRss(t, { isConfigured: () => false, search: async () => ({ items: [] }) });
  const query = `unconfigured test ${Date.now()}`;
  const first = await information.fetchContext({ query, category: 'current_news' });
  assert.equal(first.status, 'unavailable');

  let called = false;
  withRss(t, { isConfigured: () => true, search: async () => { called = true; return { items: [] }; } });
  const second = await information.fetchContext({ query, category: 'current_news' });
  assert.equal(called, true, 'a source that just became configured must be tried, not served a cached refusal');
  assert.equal(second.status, 'insufficient');
});

// ---------------------------------------------------------- refusal ---

test('refusalMessage: each status gets a desk sentence, never a status code', () => {
  // Marathi, deliberately (Phase 10) - this is what a sub-editor at SAHAS
  // VARTA reads, not a form-field error. Checked by non-emptiness and the
  // absence of a status code, not by matching English wording.
  for (const status of ['insufficient', 'unavailable', 'conflicting']) {
    const message = information.refusalMessage(status);
    assert.ok(message.length > 10, `${status} must have a real sentence, not a stub`);
    assert.doesNotMatch(message, /\b[45]\d\d\b/, 'never a raw HTTP status code');
  }
});
