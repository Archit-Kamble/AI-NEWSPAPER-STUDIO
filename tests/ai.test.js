// The AI layer, and the promises it makes regardless of who is behind it.
//
// SAHAS does not choose a model, it chooses a tier of effort - and whichever
// provider is configured serves it. These tests hold the guarantees that must
// survive a change of provider, because the whole point of the layer is that
// changing provider is a line in .env rather than a change to the newspaper.

const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../src/services/ai');
const tiers = require('../src/services/ai/tiers');
const sarvam = require('../src/services/ai/providers/sarvam');
const gemini = require('../src/services/ai/providers/gemini');

// Each test sets the environment it needs and puts it back afterwards, so the
// suite never depends on what happens to be in the developer's .env.
function withEnv(vars, run) {
  const saved = {};
  for (const [name, value] of Object.entries(vars)) {
    saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const NO_KEYS = {
  SARVAM_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  GOOGLE_API_KEY: undefined,
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
};

// --- the tiers ---------------------------------------------------------------

test('the three tiers are three amounts of effort, not three models', () => {
  assert.deepEqual(tiers.list().map((t) => t.key), ['basic', 'plus', 'ultra']);
  assert.deepEqual(
    ['basic', 'plus', 'ultra'].map((key) => tiers.tierFor(key).effort),
    ['low', 'medium', 'high'],
  );
});

test('every tier carries a hint, because "Basic" alone tells a sub-editor nothing', () => {
  for (const tier of tiers.list()) {
    assert.ok(tier.hint && tier.hint.length > 10, `${tier.key} needs a hint`);
  }
});

test('every tier gets the whole output ceiling, and the dial is effort alone', () => {
  // This test used to assert the opposite - that cheap tiers get a smaller
  // share of max_tokens - and the first real call disproved it: Basic asked
  // for a block of Marathi copy, was given max_tokens 2048, spent all of it
  // reasoning and returned nothing.
  //
  // max_tokens is a CEILING, not a spend. Providers bill the tokens actually
  // produced, so a lower ceiling saves nothing and only makes it likelier that
  // a call you have already paid the reasoning for comes back empty.
  // list() is the menu the desk sees; tierFor() is the full tier.
  for (const key of ['basic', 'plus', 'ultra']) {
    assert.equal(tiers.tierFor(key).outputBudgetShare, undefined,
      `${key} must not carry an output share - the ceiling is not the dial`);
  }
  assert.deepEqual(
    ['basic', 'plus', 'ultra'].map((key) => tiers.tierFor(key).effort),
    ['low', 'medium', 'high'],
    'the tiers differ by how hard the model thinks, which is what actually costs money',
  );
});

test('an unknown or missing tier falls back to basic rather than throwing', () => {
  assert.equal(tiers.tierFor(undefined).key, 'basic');
  assert.equal(tiers.tierFor('premium-gold').key, 'basic');
  assert.equal(tiers.tierFor('ULTRA').key, 'ultra', 'and the name is not case-sensitive');
});

// A provider that answers with whatever the test hands it, so the layer's own
// promises can be checked without a network or a key.
function fakeProvider(key, reply) {
  return {
    key,
    name: key,
    supportsTiers: true,
    isConfigured: () => true,
    configHint: '',
    calls: [],
    async askForJson(prompt, schema, tier) {
      this.calls.push({ tier: tier.key, effort: tier.effort });
      return typeof reply === 'function' ? reply() : reply;
    },
  };
}

function withProviders(map, run) {
  const saved = { ...ai.PROVIDERS };
  Object.assign(ai.PROVIDERS, map);
  try {
    return run();
  } finally {
    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, saved);
  }
}

// --- being provider-agnostic -------------------------------------------------

test('with no key at all it says so, and never invents content', async () => {
  await withEnv(NO_KEYS, async () => {
    const result = await ai.askForJson('anything', { type: 'object' }, {});
    assert.equal(result.unconfigured, true);
    assert.equal(result.data, undefined, 'a paper that prints placeholder text is worse than one that prints nothing');
    assert.match(result.error, /SARVAM_API_KEY/);
  });
});

test('the provider is chosen by .env, not by the code', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' }, () => {
    assert.equal(ai.status().provider.key, 'gemini');
    assert.equal(ai.status().configured, true);
  });
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'test-key' }, () => {
    assert.equal(ai.status().provider.key, 'sarvam');
  });
});

test('Sarvam is the default provider when nothing is named', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: undefined, SARVAM_API_KEY: 'test-key' }, () => {
    assert.equal(ai.status().provider.key, 'sarvam');
  });
});

test('three providers can be chained, and are tried in the order given', async () => {
  const first = fakeProvider('first', { error: 'down' });
  const second = fakeProvider('second', { error: 'also down' });
  const third = fakeProvider('third', {
    data: { rashi: Array.from({ length: 12 }, () => ({ key: 'mesh' })), suvichar: { text: 'x' } },
  });

  await withProviders({ first, second, third }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'first', AI_FALLBACK_PROVIDER: 'second,third' }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.equal(result.provider, 'third', 'it worked down the whole chain');
      assert.equal(first.calls.length, 1);
      assert.equal(second.calls.length, 1);
      assert.equal(third.calls.length, 1);
    }));
});

test('a provider named twice in the chain is only tried once', async () => {
  const only = fakeProvider('only', { error: 'down' });
  await withProviders({ only }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'only', AI_FALLBACK_PROVIDER: 'only,only' }, async () => {
      await ai.askForJson('p', SCHEMA, {});
      assert.equal(only.calls.length, 1, 'no point asking the same dead API three times');
    }));
});

test('the status lists every understudy in the order they would be tried', () => {
  withEnv(
    { ...NO_KEYS, AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'k', AI_FALLBACK_PROVIDER: 'gemini,anthropic' },
    () => {
      const status = ai.status();
      assert.deepEqual(status.fallbacks.map((f) => f.key), ['gemini', 'anthropic']);
      assert.equal(status.fallbacks.every((f) => f.ready === false), true, 'neither has a key here');
    },
  );
});

test('the status line names the first understudy that could actually answer', () => {
  withEnv(
    {
      ...NO_KEYS,
      AI_PROVIDER: 'sarvam',
      SARVAM_API_KEY: 'k',
      AI_FALLBACK_PROVIDER: 'gemini,anthropic',
      ANTHROPIC_API_KEY: 'k',
    },
    () => {
      // Gemini is listed first but has no key, so it is not the one that would
      // answer - saying "falling back to Gemini" would be a lie.
      assert.equal(ai.status().fallback.key, 'anthropic');
      assert.equal(ai.status().fallback.ready, true);
    },
  );
});

test('a fallback with no key is not reported as ready', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'k', AI_FALLBACK_PROVIDER: 'gemini' }, () => {
    const status = ai.status();
    assert.equal(status.fallback.key, 'gemini');
    assert.equal(status.fallback.ready, false, 'an unconfigured fallback is not a fallback');
  });
});

test('the status says whether the tiers actually mean anything on this provider', () => {
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'sarvam', SARVAM_API_KEY: 'k' }, () => {
    assert.equal(ai.status().tiersMeaningful, true, 'Sarvam has a real effort dial');
  });
  withEnv({ ...NO_KEYS, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, () => {
    assert.equal(ai.status().tiersMeaningful, false, 'Gemini has none, and the menu should not pretend');
  });
});

// --- the guarantee that survives a change of provider ------------------------

const SCHEMA = {
  type: 'object',
  properties: {
    rashi: { type: 'array', minItems: 12, items: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
    suvichar: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  required: ['rashi', 'suvichar'],
};

test('an answer in the wrong shape is rejected, even if the provider claimed success', async () => {
  const liar = fakeProvider('liar', { data: { rashi: [{ key: 'mesh' }], suvichar: { text: 'x' } } });
  await withProviders({ liar }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'liar', AI_FALLBACK_PROVIDER: undefined }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.equal(result.data, undefined);
      assert.match(result.error, /wrong shape/, 'eleven signs is not twelve, and a page would print short');
    }));
});

test('a missing required field is caught here, not on the page', async () => {
  const partial = fakeProvider('partial', {
    data: { rashi: Array.from({ length: 12 }, () => ({ key: 'mesh' })) },
  });
  await withProviders({ partial }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'partial', AI_FALLBACK_PROVIDER: undefined }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.match(result.error, /suvichar is missing/);
    }));
});

test('a good answer comes back with who wrote it and at what effort', async () => {
  const good = fakeProvider('good', {
    data: { rashi: Array.from({ length: 12 }, () => ({ key: 'mesh' })), suvichar: { text: 'x' } },
  });
  await withProviders({ good }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'good', AI_FALLBACK_PROVIDER: undefined }, async () => {
      const result = await ai.askForJson('p', SCHEMA, { tier: 'ultra' });
      assert.equal(result.provider, 'good');
      assert.equal(result.tier, 'ultra');
      assert.equal(result.fellBackTo, null);
      assert.deepEqual(good.calls, [{ tier: 'ultra', effort: 'high' }]);
    }));
});

// --- the paper goes to press anyway ------------------------------------------

test('when the first provider fails the second answers, and says that it did', async () => {
  const broken = fakeProvider('broken', { error: 'Sarvam returned 503.' });
  const standby = fakeProvider('standby', {
    data: { rashi: Array.from({ length: 12 }, () => ({ key: 'mesh' })), suvichar: { text: 'x' } },
  });

  await withProviders({ broken, standby }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'broken', AI_FALLBACK_PROVIDER: 'standby' }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.equal(result.provider, 'standby');
      assert.equal(result.fellBackTo, 'standby', 'the desk must be able to see the understudy wrote tonight');
    }));
});

test('a provider that throws does not take the paper down with it', async () => {
  const explodes = fakeProvider('explodes', () => { throw new Error('socket hang up'); });
  const standby = fakeProvider('standby', {
    data: { rashi: Array.from({ length: 12 }, () => ({ key: 'mesh' })), suvichar: { text: 'x' } },
  });

  await withProviders({ explodes, standby }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'explodes', AI_FALLBACK_PROVIDER: 'standby' }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.equal(result.provider, 'standby');
    }));
});

test('when everything fails it reports every reason rather than one', async () => {
  const a = fakeProvider('a', { error: 'first reason' });
  const b = fakeProvider('b', { error: 'second reason' });
  await withProviders({ a, b }, () =>
    withEnv({ ...NO_KEYS, AI_PROVIDER: 'a', AI_FALLBACK_PROVIDER: 'b' }, async () => {
      const result = await ai.askForJson('p', SCHEMA, {});
      assert.match(result.error, /first reason/);
      assert.match(result.error, /second reason/);
    }));
});

// --- provider specifics ------------------------------------------------------

test('Gemini schema conversion strips the keywords Gemini rejects, at every depth', () => {
  // The application writes ONE schema and every provider must take it as given.
  // Gemini refuses the whole request if it sees `additionalProperties` - so a
  // schema that works on Sarvam would make the fallback fail on the one night
  // it is needed.
  const source = {
    type: 'object',
    $schema: 'http://json-schema.org/draft-07/schema#',
    additionalProperties: false,
    required: ['rashi'],
    properties: {
      rashi: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          strict: true,
          properties: { key: { type: 'string' }, lucky_number: { type: 'integer' } },
          required: ['key'],
        },
      },
    },
  };

  const converted = gemini.toGeminiSchema(source);
  const asText = JSON.stringify(converted);

  assert.equal(asText.includes('additionalProperties'), false, 'nested ones too');
  assert.equal(asText.includes('$schema'), false);
  assert.equal(asText.includes('"strict"'), false);

  // And everything Gemini does need survives.
  assert.equal(converted.type, 'object');
  assert.deepEqual(converted.required, ['rashi']);
  assert.equal(converted.properties.rashi.items.properties.lucky_number.type, 'integer');
  assert.deepEqual(converted.properties.rashi.items.required, ['key']);

  // The source is not mutated - it is the same object the other providers get.
  assert.equal(source.additionalProperties, false);
});

test('the providers all declare the same interface', () => {
  for (const provider of Object.values(ai.PROVIDERS)) {
    assert.equal(typeof provider.key, 'string', 'every provider is named');
    assert.equal(typeof provider.isConfigured, 'function');
    assert.equal(typeof provider.askForJson, 'function');
    assert.equal(typeof provider.configHint, 'string', 'and says how to configure it');
    assert.equal(typeof provider.supportsTiers, 'boolean', 'and is honest about the effort dial');
  }
});

test('Sarvam is pointed at the only chat model it actually has', () => {
  withEnv({ SARVAM_MODEL: undefined }, () => {
    // sarvam-30b and sarvam-m are deprecated and no longer served.
    assert.equal(sarvam.key, 'sarvam');
    assert.equal(sarvam.supportsTiers, true);
  });
});
