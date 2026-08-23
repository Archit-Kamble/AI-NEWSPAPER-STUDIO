// Groq's provider adapter (src/services/ai/providers/groq.js).
//
// Three things this holds because they were confirmed against the real API,
// not assumed:
//   - `openai/gpt-oss-120b` reasons out of the same max_tokens budget as the
//     answer, but returns it as a separate `message.reasoning` field, not
//     mixed into `content` (unlike DeepSeek) - `content` is what has to be
//     read.
//   - Running out of budget mid-JSON is HTTP 400 with
//     `error.code: 'json_validate_failed'`, not a 200 with
//     `finish_reason: 'length'` the way DeepSeek answers the same situation.
//   - The free tier caps at 8000 tokens per minute, and `max_tokens` counts
//     against that ceiling before generation starts - a real `max_tokens:
//     8192` call failed HTTP 413 on its own, for a two-line prompt.

const test = require('node:test');
const assert = require('node:assert/strict');

const groq = require('../src/services/ai/providers/groq');
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

test('isConfigured is false with no key, true once GROQ_API_KEY is set', () => {
  withEnv({ GROQ_API_KEY: undefined }, () => assert.equal(groq.isConfigured(), false));
  withEnv({ GROQ_API_KEY: 'k' }, () => assert.equal(groq.isConfigured(), true));
});

test('a 413 (per-minute token cap) is classified as rateLimit, not outputExhausted - a SMALLER request is the fix, not a bigger one', async (t) => {
  withFetch(t, () => new Response(
    JSON.stringify({ error: { message: 'Request too large for model on tokens per minute (TPM)', type: 'tokens', code: 'rate_limit_exceeded' } }),
    { status: 413 },
  ));
  const result = await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.condition, 'rateLimit');
  assert.equal(conditions.isRetryable(result.condition), false);
});

test('HTTP 400 with error.code json_validate_failed is outputExhausted, not badShape - the budget ran out before the JSON closed', async (t) => {
  withFetch(t, () => new Response(
    JSON.stringify({ error: { message: 'Failed to validate JSON.', type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: '' } }),
    { status: 400 },
  ));
  const result = await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('ultra'), {}));
  assert.equal(result.outputExhausted, true);
  assert.equal(result.condition, 'outputExhausted');
});

test('a 401 is classified as auth, not retried', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
  const result = await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.condition, 'auth');
});

test('reasoning lives in message.reasoning, never message.content - a reply that spent its whole budget thinking has empty content, and that is empty, not the reasoning text', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{
      message: { role: 'assistant', content: '', reasoning: 'We need to think about this for a while...' },
      finish_reason: 'length',
    }],
  }), { status: 200 }));
  const result = await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.equal(result.outputExhausted, true);
  assert.ok(!result.data);
});

test('a valid JSON reply parses from content, with usage carried through', async (t) => {
  withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: '{"body":"चाचणी"}', reasoning: 'thinking...' }, finish_reason: 'stop' }],
    usage: { total_tokens: 42, completion_tokens_details: { reasoning_tokens: 10 } },
  }), { status: 200 }));
  const result = await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  assert.deepEqual(result.data, { body: 'चाचणी' });
  assert.equal(result.usage.total_tokens, 42);
});

test('the request always carries the word "json" - Groq\'s json_object mode rejects a call without it, and this application\'s Marathi briefs never say so themselves', async (t) => {
  const getLast = withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"चाचणी"}' }, finish_reason: 'stop' }],
  }), { status: 200 }));
  await withEnv({ GROQ_API_KEY: 'k' },
    () => groq.askForJson('मराठीत बातमी लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  const sent = getLast().body;
  assert.equal(sent.response_format.type, 'json_object');
  const wholeConversation = sent.messages.map((m) => m.content).join(' ');
  assert.match(wholeConversation, /json/i, 'the word "json" must appear somewhere in the messages');
});

test('the endpoint and auth header are Groq\'s own, at the configured base URL', async (t) => {
  const getLast = withFetch(t, () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"body":"चाचणी"}' }, finish_reason: 'stop' }],
  }), { status: 200 }));
  await withEnv({ GROQ_API_KEY: 'real-key' },
    () => groq.askForJson('लिहा', SCHEMA, tiers.tierFor('basic'), {}));
  const { url } = getLast();
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('the default output budget stays under the free tier\'s 8000-tokens-per-minute cap, unlike the other providers\' 8192', () => {
  withEnv({ GROQ_MAX_OUTPUT_TOKENS: undefined }, () => {
    assert.ok(groq.answerTokens(undefined) < 8000);
  });
});
