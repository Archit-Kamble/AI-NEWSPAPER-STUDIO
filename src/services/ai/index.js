// The one place SAHAS talks to a language model — and it does not know which.
//
// The application asks for a JSON answer at a tier of effort. Which company
// serves that, at what price, in what dialect of the API, is a line in `.env`.
// Nothing above this file names a provider, so changing provider is
// configuration rather than a change to the newspaper.
//
// That matters more here than in most software. This is a Marathi paper: the
// thing being bought from a provider is its Marathi, and that is exactly the
// thing most likely to be beaten by somebody else within a year. A newsroom
// should be able to move for the price of an API key.
//
// Three rules this module enforces, and none is negotiable:
//
//   1. If nothing is configured it SAYS SO. It never returns invented content
//      dressed up as a successful result. A paper that silently prints
//      placeholder text is worse than one that prints nothing.
//
//   2. It returns validated JSON or an error. Free prose a caller has to guess
//      at is how wrong things get onto a page. Providers that enforce a schema
//      server-side are asked to; every answer is checked here as well, because
//      "the API promised" is not a thing to stake a print run on.
//
//   3. If the first provider fails, the second is tried. A newspaper goes to
//      press whether or not an API is having a bad night. Which one answered is
//      reported, never hidden - the desk should know if tonight's copy came
//      from the fallback.

const tiers = require('./tiers');

const PROVIDERS = {
  sarvam: require('./providers/sarvam'),
  gemini: require('./providers/gemini'),
  anthropic: require('./providers/anthropic'),
  openai: require('./providers/openai-compatible'),
};

const DEFAULT_PROVIDER = 'sarvam';
const timeoutMs = () => Number(process.env.AI_TIMEOUT_MS) || 60000;

function providerNamed(name) {
  return PROVIDERS[String(name || '').toLowerCase().trim()] || null;
}

/**
 * The provider that writes, and the ones that cover for it in order.
 *
 * `AI_FALLBACK_PROVIDER` takes a comma-separated list, so a newsroom running
 * three providers can say "Sarvam, then Gemini, then Claude" rather than being
 * limited to a single understudy. The order is the order they are tried.
 */
function chain() {
  const primary = providerNamed(process.env.AI_PROVIDER) || PROVIDERS[DEFAULT_PROVIDER];
  const fallbacks = String(process.env.AI_FALLBACK_PROVIDER || '')
    .split(',')
    .map(providerNamed)
    .filter(Boolean);

  const ordered = [primary, ...fallbacks].filter(Boolean);
  // Only providers that actually have a key, and each only once. An
  // unconfigured fallback is not a fallback, and finding that out at 2 a.m. is
  // not the moment.
  return ordered.filter((p, index) => p.isConfigured() && ordered.indexOf(p) === index);
}

function isConfigured() {
  return chain().length > 0;
}

/**
 * What the desk can see about how this newsroom is set up: who writes, who
 * covers, and whether the tiers mean anything on the provider in use.
 */
function status() {
  const primary = providerNamed(process.env.AI_PROVIDER) || PROVIDERS[DEFAULT_PROVIDER];
  const fallbacks = String(process.env.AI_FALLBACK_PROVIDER || '')
    .split(',')
    .map(providerNamed)
    .filter(Boolean)
    .filter((p) => p !== primary);

  return {
    configured: isConfigured(),
    provider: primary
      ? { key: primary.key, name: primary.name, ready: primary.isConfigured(), supportsTiers: primary.supportsTiers }
      : null,
    // Every understudy, in the order they would be tried - so a desk can see at
    // a glance which of the three are actually reachable tonight.
    fallbacks: fallbacks.map((p) => ({ key: p.key, name: p.name, ready: p.isConfigured() })),
    // Kept for the editor's status line, which names the first one that could
    // actually answer rather than the first one listed.
    fallback: fallbacks.find((p) => p.isConfigured())
      ? (() => { const p = fallbacks.find((f) => f.isConfigured()); return { key: p.key, name: p.name, ready: true }; })()
      : (fallbacks[0] ? { key: fallbacks[0].key, name: fallbacks[0].name, ready: false } : null),
    tiers: tiers.list(),
    // If the provider in use has no effort dial, the dropdown should say so
    // rather than offer three choices that do the same thing.
    tiersMeaningful: Boolean(primary?.supportsTiers),
    hint: primary && !primary.isConfigured() ? primary.configHint : null,
  };
}

// A last check on the shape, at this end.
//
// Sarvam and the OpenAI-compatible providers enforce the schema server-side and
// Gemini enforces its own dialect of it, but they are three different
// implementations of one promise, and a printed page is the wrong place to
// discover that one of them is loose. This checks the few things the callers
// actually depend on: required keys present, arrays that must have a fixed
// length having it.
function validate(data, schema, path = '') {
  if (!schema || typeof schema !== 'object') return null;

  if (schema.type === 'object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return `${path || 'the answer'} is not an object`;
    }
    for (const name of schema.required || []) {
      if (data[name] === undefined) return `${path}${name} is missing`;
    }
    for (const [name, child] of Object.entries(schema.properties || {})) {
      if (data[name] === undefined) continue;
      const problem = validate(data[name], child, `${path}${name}.`);
      if (problem) return problem;
    }
    return null;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(data)) return `${path.replace(/\.$/, '')} is not a list`;
    if (schema.minItems && data.length < schema.minItems) {
      return `${path.replace(/\.$/, '')} has ${data.length} entries, needs ${schema.minItems}`;
    }
    for (let index = 0; index < data.length; index += 1) {
      const problem = validate(data[index], schema.items, `${path}${index}.`);
      if (problem) return problem;
    }
    return null;
  }

  return null;
}

/**
 * Ask whichever model is configured for one JSON object.
 *
 * @param {string} prompt   the brief
 * @param {object} schema   JSON Schema the answer must match
 * @param {object} options  { tier: 'basic'|'plus'|'ultra' }
 * @returns {{data, provider, tier, usage}} or {{error, unconfigured?}}
 */
async function askForJson(prompt, schema, options = {}) {
  const providers = chain();
  if (!providers.length) {
    const primary = providerNamed(process.env.AI_PROVIDER) || PROVIDERS[DEFAULT_PROVIDER];
    return {
      error: `No AI provider is configured. ${primary.configHint}`,
      unconfigured: true,
    };
  }

  const tier = tiers.tierFor(options.tier);
  const attempts = [];
  let exhausted = false;

  for (const provider of providers) {
    let result = await callOnce(provider, prompt, schema, tier);

    // One retry, and only for the one failure that a retry can actually fix:
    // the model spent its whole output budget reasoning and returned nothing.
    // Less reasoning and more room is the answer, so the retry steps one tier
    // down and doubles the ceiling. Never more than once - a model that cannot
    // answer at Basic with twice the room is not going to on the third try, and
    // a loop here bills the newspaper for every attempt.
    if (result.outputExhausted) {
      exhausted = true;
      attempts.push(`${provider.name}: ${result.error}`);
      const gentler = tiers.lowerThan(tier.key) || tier;
      const roomier = provider.maxOutputTokens
        ? provider.maxOutputTokens(result.budget ? result.budget * 2 : undefined)
        : undefined;
      result = await callOnce(provider, prompt, schema, gentler, roomier);
      if (result.data) {
        const problem = validate(result.data, schema);
        if (!problem) {
          return {
            data: result.data,
            provider: provider.key,
            tier: gentler.key,
            usage: result.usage || null,
            fellBackTo: provider === providers[0] ? null : provider.key,
            // The desk is told its copy was written with less thinking than it
            // asked for, rather than quietly getting a cheaper answer.
            retriedAt: gentler.key !== tier.key ? gentler.key : null,
          };
        }
        result = { error: `${provider.name} answered in the wrong shape: ${problem}` };
      }
    }

    if (result.data) {
      const problem = validate(result.data, schema);
      if (!problem) {
        return {
          data: result.data,
          provider: provider.key,
          tier: tier.key,
          usage: result.usage || null,
          // Named only when it is not the one that was meant to answer, so the
          // desk knows tonight's copy came from the understudy.
          fellBackTo: provider === providers[0] ? null : provider.key,
        };
      }
      result = { error: `${provider.name} answered in the wrong shape: ${problem}` };
    }

    attempts.push(result.error);
  }

  // What the desk reads when nothing worked. When the cause was the output
  // budget, it says what to DO - the two things a sub-editor can actually do -
  // rather than naming an environment variable. The provider's own words are
  // kept in `attempts` for whoever is looking after the newsroom.
  if (exhausted) {
    return {
      error: 'AI could not complete this request within the current output limit. '
        + 'Try Basic or Plus, or generate the story one section at a time.',
      outputExhausted: true,
      attempts,
    };
  }

  return { error: attempts.join(' | '), attempts };
}

/** One call to one provider, with the timeout every provider is held to. */
async function callOnce(provider, prompt, schema, tier, maxOutputTokens) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await provider.askForJson(prompt, schema, tier, { signal: controller.signal, maxOutputTokens });
  } catch (error) {
    return {
      error: error.name === 'AbortError'
        ? `${provider.name} timed out after ${Math.round(timeoutMs() / 1000)}s.`
        : `${provider.name}: ${error.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askForJson, isConfigured, status, tiers, PROVIDERS };
