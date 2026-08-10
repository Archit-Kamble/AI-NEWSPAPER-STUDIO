// What goes wrong, and what the newsroom does about it.
//
// A provider failing is not one situation. A used-up daily quota, a busy
// minute, a rejected key and an answer cut off mid-sentence look similar in a
// log and could not be more different in a newsroom: one of them is worth
// trying again, one of them is over until tomorrow, and only one of them is
// the desk's problem rather than the newsroom's.
//
// These hold the classification, and - more important - hold that the SAME
// provider is never asked twice for a thing asking twice cannot fix. Every
// attempt is billed.

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../src/services/ai');
const conditions = require('../src/services/ai/conditions');
const gemini = require('../src/services/ai/providers/gemini');
const sarvam = require('../src/services/ai/providers/sarvam');
const anthropic = require('../src/services/ai/providers/anthropic');
const tiers = require('../src/services/ai/tiers');

const SCHEMA = { type: 'object', required: ['body'], properties: { body: { type: 'string' } } };

function withEnv(vars, run) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  const out = run();
  return out instanceof Promise ? out.finally(restore) : (restore(), out);
}

function withProviders(t, stubs) {
  const saved = { ...ai.PROVIDERS };
  for (const [key, stub] of Object.entries(stubs)) {
    ai.PROVIDERS[key] = {
      key, name: key, supportsTiers: true, isConfigured: () => true, configHint: '',
      maxOutputTokens: (n) => n || 8192,
      ...stub,
    };
  }
  t.after(() => {
    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, saved);
  });
}

// --------------------------------------------------------- classification ---

test('a daily quota and a busy minute are both 429 and are not the same thing', () => {
  // Google's own words, from the real 429 this project hit.
  const quota = conditions.fromHttpStatus(429, 'Quota exceeded for metric: '
    + 'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20');
  assert.equal(quota, 'quotaExhausted', 'this one is over until the clock rolls over');

  assert.equal(conditions.fromHttpStatus(429, 'Too many requests, slow down'), 'rateLimit',
    'and this one clears by itself');
});

test('a rejected key is never a reason to try the same key again', () => {
  assert.equal(conditions.fromHttpStatus(401, ''), 'auth');
  assert.equal(conditions.fromHttpStatus(403, ''), 'auth');
  assert.equal(conditions.fromHttpStatus(400, '{"error":{"message":"API key not valid."}}'), 'auth',
    'Google says this with a 400, not a 401');
  for (const condition of ['auth', 'quotaExhausted', 'rateLimit', 'unavailable', 'timeout', 'badShape', 'empty']) {
    assert.equal(conditions.isRetryable(condition), false, `${condition} must not be retried on the same provider`);
  }
  assert.equal(conditions.isRetryable('outputExhausted'), true,
    'the one failure a different request can actually fix');
});

test('every condition says something about the newspaper, not about HTTP', () => {
  for (const key of Object.keys(conditions.CONDITIONS)) {
    const sentence = conditions.deskSentence(key, 'Google Gemini');
    assert.ok(sentence.length > 0);
    assert.ok(!/\b(4\d\d|5\d\d)\b/.test(sentence), `${key} leaks a status code: ${sentence}`);
    assert.ok(!/JSON|token|API/i.test(sentence) || key === 'unconfigured', `${key} is jargon: ${sentence}`);
  }
});

// ------------------------------------------------------------ the routing ---

test('a used-up quota goes straight to the understudy — Gemini is not asked twice', async (t) => {
  let geminiCalls = 0;
  let sarvamCalls = 0;
  withProviders(t, {
    gemini: {
      async askForJson() {
        geminiCalls += 1;
        return { error: 'Gemini returned 429.', condition: 'quotaExhausted' };
      },
    },
    sarvam: { async askForJson() { sarvamCalls += 1; return { data: { body: 'सारवम' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, { tier: 'ultra' }));

  assert.equal(geminiCalls, 1, 'asking a used-up quota again is latency and, on a metered account, a charge');
  assert.equal(sarvamCalls, 1);
  assert.equal(result.provider, 'sarvam');
  assert.equal(result.handover.condition, 'quotaExhausted');
  assert.match(result.handover.note, /quota is used up/, 'and the desk is told which kind of failure it was');
  assert.match(result.handover.note, /wrote this instead/);
});

test('a rejected key is not retried either', async (t) => {
  let calls = 0;
  withProviders(t, {
    gemini: { async askForJson() { calls += 1; return { error: 'Gemini returned 401.', condition: 'auth' }; } },
    sarvam: { async askForJson() { return { data: { body: 'ok' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, {}));

  assert.equal(calls, 1);
  assert.match(result.handover.note, /would not accept/);
});

test('three providers are tried in the order .env names, once each', async (t) => {
  const order = [];
  withProviders(t, {
    gemini: { async askForJson() { order.push('gemini'); return { error: 'down', condition: 'unavailable' }; } },
    sarvam: { async askForJson() { order.push('sarvam'); return { error: 'down', condition: 'unavailable' }; } },
    anthropic: { async askForJson() { order.push('anthropic'); return { data: { body: 'क्लॉड' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam,anthropic' },
    () => ai.askForJson('write', SCHEMA, {}));

  assert.deepEqual(order, ['gemini', 'sarvam', 'anthropic'], 'no ping-pong, no provider asked twice');
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.fellBackTo, 'anthropic');
  assert.match(result.handover.note, /Gemini|gemini/, 'the note names the one that was meant to write');
});

test('when everything is down the desk gets sentences, not two status codes', async (t) => {
  withProviders(t, {
    gemini: { async askForJson() { return { error: 'Gemini returned 429.', condition: 'quotaExhausted' }; } },
    sarvam: { async askForJson() { return { error: 'Sarvam returned 503.', condition: 'unavailable' }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, {}));

  assert.equal(result.data, undefined);
  assert.match(result.error, /quota is used up/);
  assert.match(result.error, /could not be reached/);
  assert.ok(!/\b429\b|\b503\b/.test(result.error), 'no status codes in what a sub-editor reads');
  assert.deepEqual(result.conditions, ['quotaExhausted', 'unavailable']);
  assert.equal(result.attempts.length, 2, 'the providers own words are still kept for whoever debugs it');
});

test('an exhausted output budget is still retried once, one tier down', async (t) => {
  const calls = [];
  withProviders(t, {
    gemini: {
      async askForJson(prompt, schema, tier) {
        calls.push(tier.key);
        if (calls.length === 1) return { error: 'no room', condition: 'outputExhausted', outputExhausted: true, budget: 8192 };
        return { data: { body: 'लांब बातमी' } };
      },
    },
    sarvam: { async askForJson() { return { data: { body: 'not needed' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, { tier: 'ultra' }));

  assert.deepEqual(calls, ['ultra', 'plus'], 'exactly one retry, with less thinking');
  assert.equal(result.provider, 'gemini');
});

// ------------------------------------------- what each real adapter reports ---

test('every provider classifies its own API into the one vocabulary', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  const cases = [
    { name: 'gemini', provider: gemini, env: { GEMINI_API_KEY: 'k' },
      status: 429, body: '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20"}}',
      expect: 'quotaExhausted' },
    { name: 'gemini', provider: gemini, env: { GEMINI_API_KEY: 'k' },
      status: 400, body: '{"error":{"message":"API key not valid. Please pass a valid API key."}}',
      expect: 'auth' },
    { name: 'gemini', provider: gemini, env: { GEMINI_API_KEY: 'k' },
      status: 503, body: 'high demand', expect: 'unavailable' },
    { name: 'sarvam', provider: sarvam, env: { SARVAM_API_KEY: 'k' },
      status: 503, body: 'upstream', expect: 'unavailable' },
    { name: 'anthropic', provider: anthropic, env: { ANTHROPIC_API_KEY: 'k' },
      status: 401, body: 'bad key', expect: 'auth' },
  ];

  for (const c of cases) {
    globalThis.fetch = async () => new Response(c.body, { status: c.status });
    // eslint-disable-next-line no-await-in-loop
    const result = await withEnv(c.env, () => c.provider.askForJson('x', SCHEMA, tiers.tierFor('basic'), {}));
    assert.equal(result.condition, c.expect, `${c.name} ${c.status} -> ${c.expect}`);
    assert.ok(!/\{/.test(result.error), `${c.name}: the desk is not shown a JSON body`);
  }
});

test('Claude running out of room is the same condition as the other two', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  globalThis.fetch = async () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'half an ans' }],
    stop_reason: 'max_tokens',
  }), { status: 200 });

  const result = await withEnv({ ANTHROPIC_API_KEY: 'k' },
    () => anthropic.askForJson('write', SCHEMA, tiers.tierFor('ultra'), {}));

  assert.equal(result.condition, 'outputExhausted');
  assert.equal(result.outputExhausted, true, 'so the one retry applies here too');
  assert.ok(!/ANTHROPIC_MAX_OUTPUT_TOKENS/.test(result.error),
    'and nobody is told to edit an environment variable mid-edition');
});
