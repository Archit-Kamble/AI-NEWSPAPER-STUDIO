// Groq — OpenAI-compatible chat completions, at Groq's own endpoint.
//
// Added for testing at the newsroom's request, alongside DeepSeek/Gemini/
// Sarvam/Anthropic. Two things confirmed against the real API before this
// was written:
//
//   * The hosted model (`openai/gpt-oss-120b` by default) reasons the same
//     way Gemini's tiers do (see the AI section of CLAUDE.md): thinking is
//     spent out of the SAME `max_tokens` budget as the answer, but unlike
//     DeepSeek it comes back as a separate `message.reasoning` field, not
//     mixed into `content`. A `max_tokens: 50` call spent its entire budget
//     on `reasoning` and returned an EMPTY `content` - `choice.message.content`
//     is still the right field to read, never `.reasoning`.
//   * When the budget runs out before the JSON closes, Groq does not behave
//     like DeepSeek (a 200 with `finish_reason: 'length'`) - it answers HTTP
//     400 with `error.code: 'json_validate_failed'`. Confirmed live: the same
//     request that succeeds at `max_tokens: 500` fails this way at 60. That
//     is an output-exhaustion condition wearing a 400's clothes, not a bad
//     request, so it is classified before falling through to the generic
//     `fromHttpStatus()` (which would otherwise call any bare 400
//     `unavailable` and send the desk to the fallback for something a retry
//     with more room can actually fix).
//   * The free ("on_demand") tier caps at 8000 TOKENS PER MINUTE for these
//     models, and `max_tokens` counts against that ceiling up front, before
//     a single token is generated - confirmed live: `max_tokens: 8192` (this
//     project's usual default, sized for Gemini/DeepSeek) failed HTTP 413 on
//     BOTH `openai/gpt-oss-120b` and `openai/gpt-oss-20b` even for a two-line
//     prompt, because 8192 alone is already over 8000. That is why
//     GROQ_MAX_OUTPUT_TOKENS defaults lower than every other provider here
//     (see .env.example) - raising it on a paid Dev Tier plan is fine, but
//     the default has to work on the free tier this was wired up against.
//     Classified as `rateLimit`, not `outputExhausted`: the fix is a SMALLER
//     request next minute, the opposite of what outputExhausted asks for.
//   * `response_format: {type: 'json_object'}` has the same requirement as
//     DeepSeek's dialect: the word "json" has to appear in the messages sent,
//     or the call is rejected outright - a system message adds it.
//
// No thinking-effort dial: unlike Gemini's tiers, nothing here asks Groq for
// a specific amount of reasoning - `supportsTiers` stays honestly false.

const conditions = require('../conditions');

const key = () => process.env.GROQ_API_KEY || '';
const model = () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const baseUrl = () => (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

// Lower than DeepSeek/Gemini's 8192 default on purpose - see the file header.
const DEFAULT_ANSWER_TOKENS = 4096;
const MIN_OUTPUT_TOKENS = 256;

function answerTokens(requested) {
  const configured = Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || DEFAULT_ANSWER_TOKENS;
  const wanted = Number(requested) || configured;
  return Math.max(MIN_OUTPUT_TOKENS, Math.round(wanted));
}

const provider = {
  key: 'groq',
  name: 'Groq',
  supportsTiers: false,

  isConfigured: () => Boolean(key()),

  configHint: 'Set GROQ_API_KEY in .env (console.groq.com).',

  maxOutputTokens: (requested) => answerTokens(requested),
  modelName: model,

  async askForJson(prompt, schema, tier, { signal, maxOutputTokens: budget } = {}) {
    const allowance = answerTokens(budget);

    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key()}`,
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          // The word 'json' has to appear in the messages or Groq's
          // json_object mode rejects the call outright - this application's
          // Marathi briefs never say so themselves.
          { role: 'system', content: 'Respond with a single valid JSON object only, matching the fields the brief asks for. No prose outside the JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: tier?.temperature,
        max_tokens: allowance,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 400 && /json_validate_failed/.test(detail)) {
        return {
          error: 'Groq reached its output limit before the JSON closed.',
          condition: 'outputExhausted',
          outputExhausted: true,
          budget: allowance,
        };
      }
      if (response.status === 413) {
        return {
          error: 'Groq is busy.',
          condition: 'rateLimit',
          detail: detail.slice(0, 300),
        };
      }
      return {
        error: `Groq returned ${response.status}.`,
        condition: conditions.fromHttpStatus(response.status, detail),
        detail: detail.slice(0, 300),
      };
    }

    const body = await response.json();
    const choice = body?.choices?.[0];
    const text = choice?.message?.content;

    if (!text) {
      if (choice?.finish_reason === 'length') {
        return {
          error: 'Groq reached its output limit before it finished the answer.',
          condition: 'outputExhausted',
          outputExhausted: true,
          budget: allowance,
        };
      }
      return { error: 'Groq returned nothing usable.', condition: 'empty' };
    }

    try {
      return { data: JSON.parse(text), usage: body.usage || null };
    } catch {
      if (choice?.finish_reason === 'length') {
        return {
          error: 'Groq reached its output limit part-way through the answer.',
          condition: 'outputExhausted',
          outputExhausted: true,
          budget: allowance,
        };
      }
      return { error: 'Groq did not answer in the shape that was asked for.', condition: 'badShape' };
    }
  },
};

provider.answerTokens = answerTokens;

module.exports = provider;
