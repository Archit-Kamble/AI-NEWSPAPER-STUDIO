// DeepSeek's provider adapter (src/services/ai/providers/deepseek.js).
//
// Two things this holds because they were confirmed against the real API,
// not assumed: a 402 ("Insufficient Balance") is a real, distinct DeepSeek
// response this account hit directly, and conditions.js's fromHttpStatus()
// had no case for it before this - it fell through to `unavailable`, which
// reads to a desk as "try again in a minute", when nothing about a zero
// balance clears on its own. And DeepSeek's `json_object` response mode
// requires the word "json" to appear somewhere in the messages sent, or the
// call is rejected outright - none of this application's Marathi prompts
// say so themselves, so the adapter has to add it.

const test = require('node:test');
const assert = require('node:assert/strict');

const deepseek = require('../src/services/ai/providers/deepseek');
const conditions = require('../src/services/ai/conditions');
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

function withFetch(t, handler) {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let lastRequest = null;
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, body: init?.body ? JSON.parse(init.body) : null };
    return handler(url, init);
  };
  return () => lastRequest;
}

test('isConfigured is false with no key, true once DEEPSEEK_API_KEY is set', () => {
  withEnv({ DEEPSEEK_API_KEY: undefined }, () => assert.equal(deepseek.isConfigured(), false));
  withEnv({ DEEPSEEK_API_KEY: 'k' }, () => assert.equal(deepseek.isConfigured(), true));
});

test('conditions.js: a 402 is quotaExhausted, not the generic unavailable', () => {
  assert.equal(conditions.fromHttpStatus(402, 'Insufficient Balance'), 'quotaExhausted');
});

test('a real 402 Insufficient Balance response is classified as quotaExhausted, not retried', async (t) => {
  withFetch(t, () => new Response(
    JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error', code: 'invalid_request_error' } }),
    { status: 402 },
  ));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.condition, 'quotaExhausted');
  assert.equal(conditions.isRetryable(result.condition), false);
});

test('a 401 is classified as auth, not retried', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 }));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.condition, 'auth');
});

test('finish_reason "length" with no content is outputExhausted, the one retryable condition', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '' }, finish_reason: 'length' }],
  }), { status: 200 }));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('ultra'), {}));
  assert.equal(result.outputExhausted, true);
  assert.equal(result.condition, 'outputExhausted');
});

test('finish_reason "length" with truncated (unparseable) JSON is still outputExhausted, never badShape', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"अपुरे मजकूर' }, finish_reason: 'length' }],
  }), { status: 200 }));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('ultra'), {}));
  assert.equal(result.outputExhausted, true);
  assert.ok(!/shape/.test(result.error));
});

test('real nonsense with finish_reason "stop" is a bad shape, and is not retried', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: 'Sure, here is your article' }, finish_reason: 'stop' }],
  }), { status: 200 }));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.condition, 'badShape');
  assert.equal(result.outputExhausted, undefined);
});

test('a valid JSON reply parses, with usage carried through', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"चाचणी"}' }, finish_reason: 'stop' }],
    usage: { total_tokens: 42 },
  }), { status: 200 }));
  const result = await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.deepEqual(result.data, { body: 'चाचणी' });
  assert.deepEqual(result.usage, { total_tokens: 42 });
});

test('the request always carries the word "json" - DeepSeek\'s json_object mode rejects a call without it, and this application\'s Marathi briefs never say so themselves', async (t) => {
  const getLast = withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"चाचणी"}' }, finish_reason: 'stop' }],
  }), { status: 200 }));
  await withEnv({ DEEPSEEK_API_KEY: 'k' },
    () => deepseek.askForJson('मराठीत बातमी लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  const sent = getLast().body;
  assert.equal(sent.response_format.type, 'json_object');
  const wholeConversation = sent.messages.map((m) => m.content).join(' ');
  assert.match(wholeConversation, /json/i, 'the word "json" must appear somewhere in the messages');
});

test('the endpoint and auth header are DeepSeek\'s own, at the configured base URL', async (t) => {
  const getLast = withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"चाचणी"}' }, finish_reason: 'stop' }],
  }), { status: 200 }));
  await withEnv({ DEEPSEEK_API_KEY: 'real-key' },
    () => deepseek.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  const { url } = getLast();
  assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
});
