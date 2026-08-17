// What went wrong, in words the rest of the application can act on.
//
// A provider knows its own API: Google says 429 with a quotaId, Sarvam says 400
// with a ceiling in the prose, Anthropic says `stop_reason: max_tokens`. Three
// vocabularies for the same handful of situations. Left as raw text, every
// caller has to pattern-match somebody's error body - and the desk ends up
// reading a page of JSON at 11pm.
//
// So each adapter classifies its own failure into ONE of these, and everything
// above works from the condition rather than from the wording. The condition
// decides two things nothing else can decide safely:
//
//   * whether trying the same provider again could possibly help
//   * what a sub-editor is told, in a sentence about the newspaper
//
// Deliberately small. A condition earns its place by changing what happens
// next; anything that does not is just `unavailable`.

const CONDITIONS = {
  // Nothing is set up. Not a failure of the model - a failure of the .env.
  unconfigured: {
    retryable: false,
    // Named the provider it applies to when the message is built.
    desk: () => 'No AI provider is set up yet.',
  },

  // The key is wrong, revoked, or not permitted to use this model. Trying again
  // with the same key is guaranteed to fail the same way.
  auth: {
    retryable: false,
    desk: (name) => `${name} would not accept this newsroom's key.`,
  },

  // Too many requests just now. This one genuinely does clear on its own, but
  // not inside the few seconds a desk is willing to watch a spinner - so it is
  // the fallback's job, not a retry's.
  rateLimit: {
    retryable: false,
    desk: (name) => `${name} is busy.`,
  },

  // The allowance for the day (or the month) is gone. Nothing clears this until
  // the clock rolls over or somebody changes the plan. Retrying is pure waste,
  // and on a metered account it is waste that bills.
  quotaExhausted: {
    retryable: false,
    desk: (name) => `${name}'s quota is used up for now.`,
  },

  // The provider is having a bad night - 500, 503, a socket that died. The one
  // condition where trying again might genuinely work, but the fallback is
  // faster than a wait, so it is still the fallback that handles it.
  unavailable: {
    retryable: false,
    desk: (name) => `${name} could not be reached.`,
  },

  // We stopped waiting. Whether the model would have finished is unknowable.
  timeout: {
    retryable: false,
    desk: (name) => `${name} took too long to answer.`,
  },

  // The model spent its whole output allowance and the answer is missing or cut
  // off mid-sentence. THE ONE THING A RETRY CAN ACTUALLY FIX: less thinking and
  // more room is a different request, not the same one again.
  outputExhausted: {
    retryable: true,
    desk: (name) => `${name} ran out of room before it finished writing.`,
  },

  // It answered, but not in the shape that was asked for. More room would not
  // help; this is the model ignoring the schema, and the fallback is the answer.
  badShape: {
    retryable: false,
    desk: (name) => `${name} answered in the wrong shape.`,
  },

  // A well-formed nothing.
  empty: {
    retryable: false,
    desk: (name) => `${name} returned nothing.`,
  },
};

/** Whether trying the SAME provider again could plausibly help. */
function isRetryable(condition) {
  return Boolean(CONDITIONS[condition]?.retryable);
}

/** One sentence for the desk, naming the provider rather than a status code. */
function deskSentence(condition, providerName) {
  const entry = CONDITIONS[condition];
  return entry ? entry.desk(providerName) : `${providerName} could not answer.`;
}

/**
 * Google, Sarvam and Anthropic all speak HTTP, and the status codes mean the
 * same things. The parts that differ - which 429 is "slow down" and which is
 * "you have used your day" - stay in the adapters, which pass `body`.
 */
function fromHttpStatus(status, body = '') {
  const text = String(body);
  if (status === 401 || status === 403) return 'auth';
  // DeepSeek's real response to a zero-balance account - "Insufficient
  // Balance", confirmed against the live API. Nothing about it clears on its
  // own; the account needs topping up, the same non-retryable shape as a
  // quota that resets on a clock the desk cannot turn.
  if (status === 402) return 'quotaExhausted';
  if (status === 429) {
    // Google names the exhausted metric; a per-day quota is not a busy minute,
    // and calling it one would send the desk back to press the button again.
    return /per\s*day|PerDay|quota.*exceed|RESOURCE_EXHAUSTED|billing/i.test(text)
      ? 'quotaExhausted'
      : 'rateLimit';
  }
  if (status === 400 && /API key not valid|API_KEY_INVALID|invalid.*api key/i.test(text)) return 'auth';
  if (status >= 500) return 'unavailable';
  return 'unavailable';
}

module.exports = { CONDITIONS, isRetryable, deskSentence, fromHttpStatus };
