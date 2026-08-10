// Gemini writes; Sarvam covers.
//
// The migration is configuration, not code: AI_PROVIDER and
// AI_FALLBACK_PROVIDER decide the chain, and DEFAULT_PROVIDER decides only what
// happens when .env says nothing. These tests hold the order, the handover, and
// the two numbers that made the change worth making - the article's room and
// the thinking's, budgeted separately so reasoning cannot eat the copy.
//
// Driven through stubs, so they run without a key and spend nothing. The real
// API calls were made by hand against the real account; see PROJECT_STATUS.md.

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../src/services/ai');
const gemini = require('../src/services/ai/providers/gemini');
const tiers = require('../src/services/ai/tiers');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['body'],
  properties: { body: { type: 'string' } },
};

const NO_KEYS = {
  SARVAM_API_KEY: undefined, GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined,
  OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
};

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

/** Swaps stub providers in for the length of one test. */
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

// -------------------------------------------------------- 1, 2, 6. the order ---

test('Gemini is the primary provider and Sarvam is the understudy', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam,anthropic',
            GEMINI_API_KEY: 'k', SARVAM_API_KEY: 'k' }, () => {
    const status = ai.status();
    assert.equal(status.provider.key, 'gemini', 'the desk is told Gemini writes this paper');
    assert.equal(status.provider.ready, true);
    assert.deepEqual(status.fallbacks.map((f) => f.key), ['sarvam', 'anthropic'],
      'and Sarvam is first in the queue behind it');
    assert.equal(status.fallbacks[0].ready, true, 'and is actually reachable');
    assert.equal(status.tiersMeaningful, true, 'the effort dial means something on Gemini');
  });
});

test('the status endpoint never carries a key', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'super-secret-value' }, () => {
    const serialised = JSON.stringify(ai.status());
    assert.ok(!serialised.includes('super-secret-value'), 'no secret reaches the browser');
    assert.match(serialised, /gemini/);
  });
});

// --------------------------------------------------- 3, 4, 5. the handover ---

test('when Gemini answers, Sarvam is never called', async (t) => {
  let geminiCalls = 0;
  let sarvamCalls = 0;
  withProviders(t, {
    gemini: { async askForJson() { geminiCalls += 1; return { data: { body: 'मजकूर' } }; } },
    sarvam: { async askForJson() { sarvamCalls += 1; return { data: { body: 'fallback' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, { tier: 'plus' }));

  assert.equal(geminiCalls, 1);
  assert.equal(sarvamCalls, 0, 'the understudy is not paid to watch');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.fellBackTo, null);
  assert.equal(result.data.body, 'मजकूर');
});

test('when Gemini fails, Sarvam is asked, and says who answered', async (t) => {
  withProviders(t, {
    gemini: { async askForJson() { return { error: 'Gemini returned 503.' }; } },
    sarvam: { async askForJson() { return { data: { body: 'सारवमने लिहिले' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, { tier: 'plus' }));

  assert.equal(result.data.body, 'सारवमने लिहिले', 'the paper goes to press');
  assert.equal(result.provider, 'sarvam');
  assert.equal(result.fellBackTo, 'sarvam', 'and the desk is told the understudy wrote it');
});

test('both providers come back in the same shape', async (t) => {
  const shapes = [];
  for (const who of ['gemini', 'sarvam']) {
    const saved = { ...ai.PROVIDERS };
    ai.PROVIDERS.gemini = { key: 'gemini', name: 'g', supportsTiers: true, isConfigured: () => true, configHint: '',
      async askForJson() { return who === 'gemini' ? { data: { body: 'x' } } : { error: 'down' }; } };
    ai.PROVIDERS.sarvam = { key: 'sarvam', name: 's', supportsTiers: true, isConfigured: () => true, configHint: '',
      async askForJson() { return { data: { body: 'x' } }; } };

    // eslint-disable-next-line no-await-in-loop
    const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
      () => ai.askForJson('write', SCHEMA, { tier: 'basic' }));
    shapes.push(Object.keys(result).sort().join(','));

    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, saved);
  }
  assert.equal(shapes[0], shapes[1],
    'the caller cannot tell which company wrote the copy from the shape of the answer');
});

test('both failing gives the desk one error, not a silence', async (t) => {
  withProviders(t, {
    gemini: { async askForJson() { return { error: 'Gemini returned 503.' }; } },
    sarvam: { async askForJson() { return { error: 'Sarvam returned 500.' }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, {}));

  assert.equal(result.data, undefined);
  assert.match(result.error, /503/);
  assert.match(result.error, /500/, 'both are named - a desk debugging at 11pm needs both');
});

test('a fallback is for a provider that is down, not for copy somebody dislikes', async (t) => {
  let sarvamCalls = 0;
  withProviders(t, {
    // Three words is short. It is still an answer, and the schema is satisfied.
    gemini: { async askForJson() { return { data: { body: 'फार छोटी बातमी' } }; } },
    sarvam: { async askForJson() { sarvamCalls += 1; return { data: { body: 'longer' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write', SCHEMA, {}));

  assert.equal(sarvamCalls, 0, 'quality is the desk\'s judgement, not the router\'s');
  assert.equal(result.provider, 'gemini');
});

// ------------------------------------------- 7, 8. reasoning against output ---

test('the three tiers buy three different amounts of thinking on Gemini', () => {
  const basic = gemini.thinkingBudget(tiers.tierFor('basic'));
  const plus = gemini.thinkingBudget(tiers.tierFor('plus'));
  const ultra = gemini.thinkingBudget(tiers.tierFor('ultra'));

  assert.ok(basic < plus && plus < ultra, 'more effort means more thinking');
  assert.ok(basic > 0, 'gemini-3.6-flash rejects a thinking budget of zero outright');
  assert.ok(plus < ultra, 'the everyday tier is deliberately not the maximum - thinking is paid for and waited for');
  assert.equal(gemini.thinkingBudget(undefined), plus, 'an unnamed tier gets the everyday one, not the dearest');
});

test('reasoning is added to the article\'s room, never taken out of it', () => {
  const env = process.env.GEMINI_MAX_OUTPUT_TOKENS;
  process.env.GEMINI_MAX_OUTPUT_TOKENS = '8192';
  try {
    const answer = gemini.answerTokens();
    assert.equal(answer, 8192, 'the copy gets what it was given');

    for (const key of ['basic', 'plus', 'ultra']) {
      const tier = tiers.tierFor(key);
      const total = gemini.totalOutputAllowance(undefined, tier);
      assert.equal(total, answer + gemini.thinkingBudget(tier),
        `${key}: the allowance on the wire is the article's room PLUS the thinking's`);
      assert.ok(total > answer, `${key}: thinking never eats the article`);
    }

    // This is the measurement the change was made on: maxOutputTokens 200 with a
    // 4096 thinking budget came back MAX_TOKENS with six tokens of answer. The
    // sum is what stops that happening.
    const ultra = gemini.totalOutputAllowance(undefined, tiers.tierFor('ultra'));
    assert.ok(ultra >= 8192 + 12288);
  } finally {
    if (env === undefined) delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
    else process.env.GEMINI_MAX_OUTPUT_TOKENS = env;
  }
});

test('the output allowance is configurable and clamped to what the model allows', () => {
  const env = process.env.GEMINI_MAX_OUTPUT_TOKENS;
  try {
    delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
    assert.equal(gemini.answerTokens(), 8192, 'a full-page lead has room by default');

    process.env.GEMINI_MAX_OUTPUT_TOKENS = '32768';
    assert.equal(gemini.answerTokens(), 32768);

    // gemini-3.6-flash tops out at 65536; a value above it would be rejected.
    process.env.GEMINI_MAX_OUTPUT_TOKENS = '999999';
    assert.equal(gemini.answerTokens(), 65536);
    process.env.GEMINI_MAX_OUTPUT_TOKENS = '1';
    assert.equal(gemini.answerTokens(), 256);
    process.env.GEMINI_MAX_OUTPUT_TOKENS = 'nonsense';
    assert.equal(gemini.answerTokens(), 8192);
    assert.ok(gemini.totalOutputAllowance(60000, tiers.tierFor('ultra')) <= 65536,
      'and the sum is capped at the model ceiling too');
  } finally {
    if (env === undefined) delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
    else process.env.GEMINI_MAX_OUTPUT_TOKENS = env;
  }
});

test('an allowance exhausted by thinking is reported as a condition, and retried once', async (t) => {
  const calls = [];
  withProviders(t, {
    gemini: {
      maxOutputTokens: (n) => n || 8192,
      async askForJson(prompt, schema, tier, { maxOutputTokens }) {
        calls.push({ tier: tier.key, maxOutputTokens });
        if (calls.length === 1) {
          return { error: 'Gemini reached its output limit before it finished the answer.', outputExhausted: true, budget: 8192 };
        }
        return { data: { body: 'लांब बातमी' } };
      },
    },
    sarvam: { async askForJson() { return { data: { body: 'not needed' } }; } },
  });

  const result = await withEnv({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'sarvam' },
    () => ai.askForJson('write a long one', SCHEMA, { tier: 'ultra' }));

  assert.equal(calls.length, 2, 'one retry, never a loop - each attempt is billed');
  assert.equal(calls[1].tier, 'plus', 'a step down the ladder leaves more of the allowance for the copy');
  assert.equal(calls[1].maxOutputTokens, 16384, 'and twice the room');
  assert.equal(result.data.body, 'लांब बातमी');
  assert.equal(result.provider, 'gemini', 'fixed without troubling the understudy');
});

// ------------------------------------------------- the schema Gemini accepts ---

test('the one schema the application writes is made acceptable to Gemini', () => {
  const converted = gemini.toGeminiSchema({
    type: 'object',
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
    required: ['headline', 'body'],
    properties: {
      headline: { type: 'string' },
      body: { type: 'string' },
      signs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } },
    },
  });

  const flat = JSON.stringify(converted);
  assert.ok(!flat.includes('additionalProperties'), 'Gemini rejects the whole request when it sees these');
  assert.ok(!flat.includes('$schema'));
  assert.ok(!flat.includes('strict'));
  assert.deepEqual(converted.required, ['headline', 'body'], 'and everything that matters survives');
  assert.equal(converted.properties.signs.items.properties.name.type, 'string', 'to any depth');
});
