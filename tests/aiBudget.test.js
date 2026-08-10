// The output budget, and the one failure a retry can fix.
//
// On Sarvam, reasoning tokens are billed and counted as OUTPUT. A call with a
// small ceiling can spend the whole of it thinking and come back with
// `finish_reason: "length"` and no content - and you are billed for the
// thinking either way. The old default was 4096, the Starter plan's ceiling,
// which made that the normal outcome at Plus and Ultra effort; and the error
// the desk was shown told it to raise an environment variable.
//
// These tests drive the provider chain with a stub provider, so they run
// without a key and without spending anything.

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../src/services/ai');
const tiers = require('../src/services/ai/tiers');
const sarvam = require('../src/services/ai/providers/sarvam');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: { body: { type: 'string' } },
};

/** Swaps a stub in as the primary provider for the length of one test. */
function withProvider(t, stub) {
  const real = ai.PROVIDERS.sarvam;
  const env = { ...process.env };
  ai.PROVIDERS.sarvam = { key: 'sarvam', name: 'Stub', supportsTiers: true, isConfigured: () => true, configHint: '', ...stub };
  process.env.AI_PROVIDER = 'sarvam';
  process.env.AI_FALLBACK_PROVIDER = '';
  t.after(() => {
    ai.PROVIDERS.sarvam = real;
    process.env.AI_PROVIDER = env.AI_PROVIDER;
    process.env.AI_FALLBACK_PROVIDER = env.AI_FALLBACK_PROVIDER;
  });
}

// ----------------------------------------------------------- I. the budget ---

test('the output budget is configurable, defaulted safely and clamped to the documented range', (t) => {
  const env = process.env.SARVAM_MAX_OUTPUT_TOKENS;
  t.after(() => { process.env.SARVAM_MAX_OUTPUT_TOKENS = env; });

  delete process.env.SARVAM_MAX_OUTPUT_TOKENS;
  assert.equal(sarvam.maxOutputTokens(), 16384, 'the default is the Pro ceiling, not the Starter one');

  // A Starter account says so, and is believed.
  process.env.SARVAM_MAX_OUTPUT_TOKENS = '4096';
  assert.equal(sarvam.maxOutputTokens(), 4096);

  // A Business account can ask for the whole range.
  process.env.SARVAM_MAX_OUTPUT_TOKENS = '128000';
  assert.equal(sarvam.maxOutputTokens(), 128000);

  // Values the API would reject are clamped rather than sent - a 400 on every
  // request looks like an outage, not like a typo in .env.
  process.env.SARVAM_MAX_OUTPUT_TOKENS = '999999';
  assert.equal(sarvam.maxOutputTokens(), 128000);
  process.env.SARVAM_MAX_OUTPUT_TOKENS = '1';
  assert.equal(sarvam.maxOutputTokens(), 256);
  process.env.SARVAM_MAX_OUTPUT_TOKENS = 'nonsense';
  assert.equal(sarvam.maxOutputTokens(), 16384, 'an unreadable value falls back to the default');

  // A caller asking for more room on a retry gets it, still clamped.
  assert.equal(sarvam.maxOutputTokens(32768), 32768);
  assert.equal(sarvam.maxOutputTokens(500000), 128000);
});

// ------------------------------------------------- J. finish_reason = length ---

test('a budget exhausted by reasoning is retried once, with less thinking and more room', async (t) => {
  const calls = [];
  withProvider(t, {
    maxOutputTokens: (n) => n || 16384,
    async askForJson(prompt, schema, tier, { maxOutputTokens }) {
      calls.push({ tier: tier.key, effort: tier.effort, maxOutputTokens });
      if (calls.length === 1) {
        return { error: 'spent it all reasoning', outputExhausted: true, budget: 16384 };
      }
      return { data: { body: 'मजकूर' } };
    },
  });

  const result = await ai.askForJson('write something', SCHEMA, { tier: 'ultra' });

  assert.equal(calls.length, 2, 'exactly one retry');
  assert.equal(calls[0].tier, 'ultra');
  assert.equal(calls[1].tier, 'plus', 'one step down the ladder, not straight to the bottom');
  assert.equal(calls[1].effort, 'medium');
  assert.equal(calls[1].maxOutputTokens, 32768, 'and twice the room');

  assert.equal(result.data.body, 'मजकूर', 'the desk gets its copy');
  assert.equal(result.tier, 'plus');
  assert.equal(result.retriedAt, 'plus', 'and is told it was written with less thinking than asked for');
});

test('the retry happens at most once, and the desk is told what to do next', async (t) => {
  const calls = [];
  withProvider(t, {
    maxOutputTokens: (n) => n || 16384,
    async askForJson(prompt, schema, tier) {
      calls.push(tier.key);
      return { error: 'spent it all reasoning', outputExhausted: true, budget: 8192 };
    },
  });

  const result = await ai.askForJson('write something', SCHEMA, { tier: 'plus' });

  assert.equal(calls.length, 2, 'never a third attempt - each one is billed');
  assert.deepEqual(calls, ['plus', 'basic']);

  assert.ok(!result.data);
  assert.equal(result.outputExhausted, true);
  assert.match(result.error, /could not complete this request within the current output limit/i);
  assert.match(result.error, /Basic or Plus|one section at a time/i,
    'it says what a sub-editor can do, not which environment variable to edit');
  assert.ok(!/SARVAM_MAX_OUTPUT_TOKENS/.test(result.error),
    'the desk is never shown an environment variable');
  assert.ok(Array.isArray(result.attempts) && result.attempts.length,
    "the provider's own words are kept for whoever runs the newsroom");
});

test('at the bottom of the ladder the retry buys room rather than thinking', async (t) => {
  const calls = [];
  withProvider(t, {
    maxOutputTokens: (n) => n || 16384,
    async askForJson(prompt, schema, tier, { maxOutputTokens }) {
      calls.push({ tier: tier.key, maxOutputTokens });
      if (calls.length === 1) return { error: 'no room', outputExhausted: true, budget: 4096 };
      return { data: { body: 'ठीक' } };
    },
  });

  const result = await ai.askForJson('write', SCHEMA, { tier: 'basic' });

  assert.equal(calls[1].tier, 'basic', 'there is nothing below Basic');
  assert.equal(calls[1].maxOutputTokens, 8192, 'so it gets twice the room instead');
  assert.equal(result.data.body, 'ठीक');
  assert.equal(result.retriedAt, null, 'and the tier it was asked for is the tier it got');
});

test('an ordinary failure is not retried - only an exhausted budget is', async (t) => {
  let calls = 0;
  withProvider(t, {
    async askForJson() {
      calls += 1;
      return { error: 'Sarvam returned 500.' };
    },
  });

  const result = await ai.askForJson('write', SCHEMA, { tier: 'plus' });
  assert.equal(calls, 1, 'a 500 is not fixed by asking again in the same second');
  assert.ok(!result.outputExhausted);
  assert.match(result.error, /500/);
});

test("the account's own ceiling is learned from the API, not configured by hand", async (t) => {
  // Sarvam rejects a max_tokens above the plan's ceiling with a 400 that names
  // the number. A Starter account is capped at 4096; the default asks for
  // 16384. Making the desk read that error and edit .env is passing the problem
  // on, not handling it.
  const realFetch = global.fetch;
  const asked = [];
  let first = true;

  global.fetch = async (url, options) => {
    asked.push(JSON.parse(options.body).max_tokens);
    if (first) {
      first = false;
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message:
          'max_tokens (16384) exceeds the maximum allowed for sarvam-105b for your subscription tier (starter): 4096. Please reduce max_tokens or upgrade your plan.' } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"body":"मजकूर"}' }, finish_reason: 'stop' }] }),
    };
  };

  const env = process.env.SARVAM_API_KEY;
  process.env.SARVAM_API_KEY = 'test-key';
  t.after(() => { global.fetch = realFetch; process.env.SARVAM_API_KEY = env; });

  const tier = tiers.tierFor('basic');
  const result = await sarvam.askForJson('write', SCHEMA, tier, {});

  assert.deepEqual(asked, [16384, 4096], 'it asks, is told the ceiling, and re-sends at it');
  assert.equal(result.data.body, 'मजकूर', 'and the desk gets its copy on the first try it ever sees');
  assert.equal(sarvam.knownCeiling(), 4096, 'the ceiling is remembered');
  assert.equal(sarvam.maxOutputTokens(16384), 4096, 'so every later call is right the first time');
});

test('the tier ladder only ever steps down', () => {
  assert.equal(tiers.lowerThan('ultra').key, 'plus');
  assert.equal(tiers.lowerThan('plus').key, 'basic');
  assert.equal(tiers.lowerThan('basic'), null);
  assert.equal(tiers.lowerThan('nonsense'), null, 'an unknown tier is Basic, and Basic is the bottom');
});
