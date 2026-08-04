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
  openai: require('./providers/openai-compatible'),
};

const DEFAULT_PROVIDER = 'sarvam';
const timeoutMs = () => Number(process.env.AI_TIMEOUT_MS) || 60000;

function providerNamed(name) {
  return PROVIDERS[String(name || '').toLowerCase()] || null;
}

/** The provider that writes, and the one that covers for it. */
function chain() {
  const primary = providerNamed(process.env.AI_PROVIDER) || PROVIDERS[DEFAULT_PROVIDER];
  const fallback = providerNamed(process.env.AI_FALLBACK_PROVIDER);
  const ordered = [primary, fallback].filter(Boolean);
  // Only providers that actually have a key. An unconfigured fallback is not a
  // fallback, and finding that out at 2 a.m. is not the moment.
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
  const fallback = providerNamed(process.env.AI_FALLBACK_PROVIDER);
  return {
    configured: isConfigured(),
    provider: primary
      ? { key: primary.key, name: primary.name, ready: primary.isConfigured(), supportsTiers: primary.supportsTiers }
      : null,
    fallback: fallback
      ? { key: fallback.key, name: fallback.name, ready: fallback.isConfigured() }
      : null,
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

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    let result;
    try {
      result = await provider.askForJson(prompt, schema, tier, { signal: controller.signal });
    } catch (error) {
      result = {
        error: error.name === 'AbortError'
          ? `${provider.name} timed out after ${Math.round(timeoutMs() / 1000)}s.`
          : `${provider.name}: ${error.message}`,
      };
    } finally {
      clearTimeout(timer);
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

  return { error: attempts.join(' | '), attempts };
}

module.exports = { askForJson, isConfigured, status, tiers, PROVIDERS };
