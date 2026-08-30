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
const conditions = require('./conditions');

const PROVIDERS = {
  sarvam: require('./providers/sarvam'),
  gemini: require('./providers/gemini'),
  anthropic: require('./providers/anthropic'),
  openai: require('./providers/openai-compatible'),
  deepseek: require('./providers/deepseek'),
  groq: require('./providers/groq'),
};

// Who writes when `.env` does not say. Gemini: it has the room for a full-page
// lead and a real thinking dial, and the failure that kept reaching the desk
// was a call coming back empty rather than a sentence being a shade off.
// Sarvam is the understudy and its Marathi is still why it is there.
//
// This is the ONLY hard-coded provider name in the application. Everything else
// reads AI_PROVIDER / AI_FALLBACK_PROVIDER through chain() below.
const DEFAULT_PROVIDER = 'gemini';
// 120s, not 60. These are reasoning models and the work is not small: twelve
// horoscope signs at Basic effort measured 40 seconds against a real account,
// and a lead story at Ultra is slower again. At 60s the call was being aborted
// at this end while the model was still writing - which reads to the desk as
// "the AI is broken" and bills for the thinking anyway.
const timeoutMs = (override) => Number(override) > 0 ? Number(override) : (Number(process.env.AI_TIMEOUT_MS) || 120000);

function providerNamed(name) {
  return PROVIDERS[String(name || '').toLowerCase().trim()] || null;
}

/**
 * The provider that writes, and the ones that cover for it in order.
 *
 * `AI_FALLBACK_PROVIDER` takes a comma-separated list, so a newsroom running
 * three providers can say "Gemini, then Sarvam, then Claude" rather than being
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

  // A headline that comes back as the number 12345 is not a shape a schema
  // rejects on its own - `additionalProperties`/`required` say nothing about
  // it - and `String(12345)` turns it into printable text without a complaint
  // anywhere. Every field this application asks for is prose, so this is the
  // one primitive type worth checking explicitly.
  if (schema.type === 'string' && typeof data !== 'string') {
    return `${path.replace(/\.$/, '') || 'the answer'} is not text`;
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
  // A five-deep chain is right for one block a sub-editor is waiting on and
  // wrong for a batch. This newsroom's live chain is deepseek -> gemini ->
  // sarvam -> anthropic -> groq at 120s each, so a single block whose
  // providers all time out takes TEN MINUTES, and a twenty-block run could sit
  // there for over an hour with nothing on screen. `maxProviders` lets an
  // interactive, many-call path cap its own worst case without changing what
  // the desk's own single-block button does.
  //
  // The timeout deliberately stays where it is. These are reasoning models
  // writing Marathi and cutting them short reads to a desk as a failure that
  // never happened - it is the CHAIN that is too long here, not the clock.
  const providers = chain();
  // The cap counts WAITING, not attempts.
  //
  // Slicing the chain by count was the first version and it is wrong in the
  // one case that matters: a provider out of quota answers in milliseconds
  // (402, or a 429 naming a daily limit), so skipping past it costs nothing
  // and stopping there throws away every working understudy. Measured on this
  // newsroom - DeepSeek 402, Gemini out of daily quota - a cap of two meant
  // the run failed outright while Sarvam and Anthropic sat unused.
  //
  // What the cap is actually for is the FIVE-DEEP TIMEOUT: five providers at
  // 120 seconds is ten minutes for one block. So a failure that cost real time
  // counts against the cap and an instant refusal does not.
  const INSTANT = new Set(['auth', 'quotaExhausted', 'rateLimit', 'unconfigured']);
  const cap = Number(options.maxProviders) > 0 ? Number(options.maxProviders) : Infinity;
  let slowFailures = 0;
  if (!providers.length) {
    const primary = providerNamed(process.env.AI_PROVIDER) || PROVIDERS[DEFAULT_PROVIDER];
    return {
      error: `No AI provider is configured. ${primary.configHint}`,
      unconfigured: true,
    };
  }

  const tier = tiers.tierFor(options.tier);
  const attempts = [];
  // Why the first choice did not write, kept so a desk that gets the
  // understudy's copy is told which of the several possible reasons it was.
  const failures = [];
  const noteFailure = (provider, result) => {
    failures.push({
      provider: provider.key,
      condition: result.condition || null,
      // A classified failure becomes a sentence about the newspaper. An
      // unclassified one keeps the provider's own words - losing detail nobody
      // has taught this module to read yet would be worse than a clumsy line,
      // and a desk debugging at 11pm needs whatever there is.
      // `deskText` wins where the failure already has a sentence worth reading:
      // "the horoscope is missing सुविचार" tells a sub-editor what to do, and a
      // generic "answered in the wrong shape" would throw that away.
      desk: result.deskText
        || (result.condition ? conditions.deskSentence(result.condition, provider.name) : result.error),
    });
  };
  /** What the desk is told about a handover, in one sentence. */
  const handover = (writer) => (failures.length
    ? { from: failures[0].provider, condition: failures[0].condition, note: `${failures[0].desk} ${writer.name} wrote this instead.` }
    : null);

  for (const provider of providers) {
    if (slowFailures >= cap) break;
    let result = await callOnce(provider, prompt, schema, tier, undefined, options.callBudget, 'initial', options.timeoutMs);
    if (result.condition === 'budget') return { error: 'SERVICE_CALL_BUDGET_EXHAUSTED', callBudgetExhausted: true, attempts };

    // One retry, and only for the one failure that a retry can actually fix:
    // the model spent its whole output budget reasoning and returned nothing.
    // Less reasoning and more room is the answer, so the retry steps one tier
    // down and doubles the ceiling. Never more than once - a model that cannot
    // answer at Basic with twice the room is not going to on the third try, and
    // a loop here bills the newspaper for every attempt.
    //
    // Everything else goes straight to the understudy. A used-up daily quota, a
    // rejected key and a busy minute are all things the SAME provider will fail
    // at again in the next half second, and asking twice is latency the desk
    // waits through and, on a metered account, a second charge.
    if (result.outputExhausted || conditions.isRetryable(result.condition)) {
      attempts.push(`${provider.name}: ${result.error}`);
      const wasRetryable = result.outputExhausted || conditions.isRetryable(result.condition);
      if (!wasRetryable) noteFailure(provider, result);
      const gentler = tiers.lowerThan(tier.key) || tier;
      const roomier = provider.maxOutputTokens
        ? provider.maxOutputTokens(result.budget ? result.budget * 2 : undefined)
        : undefined;
      result = await callOnce(provider, prompt, schema, gentler, roomier, options.callBudget, 'retry', options.timeoutMs);
      if (result.condition === 'budget') return { error: 'SERVICE_CALL_BUDGET_EXHAUSTED', callBudgetExhausted: true, attempts };
      if (result.data) {
        const problem = validate(result.data, schema);
        if (!problem) {
          return {
            data: result.data,
            provider: provider.key,
            tier: gentler.key,
            usage: result.usage || null,
            attempts,
            fellBackTo: provider === providers[0] ? null : provider.key,
            handover: provider === providers[0] ? null : handover(provider),
            // The desk is told its copy was written with less thinking than it
            // asked for, rather than quietly getting a cheaper answer.
            retriedAt: gentler.key !== tier.key ? gentler.key : null,
          };
        }
        result = {
          error: `${provider.name} answered in the wrong shape: ${problem}`,
          condition: 'badShape',
          deskText: `${provider.name} answered in the wrong shape: ${problem}`,
        };
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
          // Kept on success too: a run that took three minutes because the
          // first provider timed out looks identical to one that was simply
          // slow, and only the attempt log tells them apart.
          attempts,
          // Named only when it is not the one that was meant to answer, so the
          // desk knows tonight's copy came from the understudy - and, since the
          // conditions are classified, WHY.
          fellBackTo: provider === providers[0] ? null : provider.key,
          handover: provider === providers[0] ? null : handover(provider),
        };
      }
      result = {
        error: `${provider.name} answered in the wrong shape: ${problem}`,
        condition: 'badShape',
        deskText: `${provider.name} answered in the wrong shape: ${problem}`,
      };
    }

    if (result.outputExhausted && !result.condition) result.condition = 'outputExhausted';
    if (!INSTANT.has(result.condition)) slowFailures += 1;
    noteFailure(provider, result);
    attempts.push(result.error);
  }

  // What the desk reads when nothing worked. When the cause was the output
  // budget, it says what to DO - the two things a sub-editor can actually do -
  // rather than naming an environment variable. The provider's own words are
  // kept in `attempts` for whoever is looking after the newsroom.
  const finalConditions = failures.map((failure) => failure.condition);
  const allFinalFailuresOutputExhausted = finalConditions.length > 0 && finalConditions.every((condition) => condition === 'outputExhausted');
  if (allFinalFailuresOutputExhausted) {
    return {
      error: 'AI could not complete this request within the current output limit. '
        + 'Try Basic or Plus, or generate the story one section at a time.',
      outputExhausted: true, condition: 'outputExhausted', conditions: finalConditions,
      attempts,
    };
  }

  // Everything is down. The desk gets sentences about the newspaper - "Google
  // Gemini's quota is used up for now. Sarvam AI is busy." - rather than two
  // status codes and a page of somebody's JSON. The providers' own words stay
  // in `attempts` for whoever looks after the newsroom.
  return {
    error: failures.length
      ? `${failures.map((f) => f.desk).join(' ')} Nothing could be written just now.`
      : attempts.join(' | '),
    conditions: finalConditions,
    attempts,
  };
}

/** One call to one provider, with the timeout every provider is held to. */
function consumeProviderCall(budget, metadata) {
  if (!budget) return;
  if (budget.used >= budget.max) {
    const error = new Error('SERVICE_CALL_BUDGET_EXHAUSTED'); error.code = 'SERVICE_CALL_BUDGET_EXHAUSTED'; throw error;
  }
  budget.used += 1;
  const event = { provider: metadata.provider, reason: metadata.reason, callNumber: budget.used, at: new Date().toISOString() };
  if (Array.isArray(budget.events)) budget.events.push(event);
  budget.onConsume?.(event);
}
async function callOnce(provider, prompt, schema, tier, maxOutputTokens, callBudget, reason = 'initial', overrideTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(overrideTimeoutMs));
  try {
    consumeProviderCall(callBudget, { provider: provider.key, reason });
    return await provider.askForJson(prompt, schema, tier, { signal: controller.signal, maxOutputTokens });
  } catch (error) {
    if (error.code === 'SERVICE_CALL_BUDGET_EXHAUSTED') return { error: error.code, condition: 'budget' };
    // A dead socket and a stopwatch are different situations, and only one of
    // them says anything about the provider being reachable.
    return error.name === 'AbortError'
      ? { error: `${provider.name} timed out after ${Math.round(timeoutMs(overrideTimeoutMs) / 1000)}s.`, condition: 'timeout' }
      : { error: `${provider.name}: ${error.message}`, condition: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { askForJson, isConfigured, status, tiers, PROVIDERS, consumeProviderCall };
