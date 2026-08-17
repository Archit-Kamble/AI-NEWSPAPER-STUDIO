// DeepSeek — OpenAI-compatible chat completions, at DeepSeek's own endpoint.
//
// A dedicated file rather than pointing the generic openai-compatible
// provider at DeepSeek's base URL: `AI_PROVIDER=deepseek` needs a real
// `PROVIDERS.deepseek` entry to select, and a desk-facing status line should
// say "DeepSeek", not "OpenAI-compatible".
//
// Two things confirmed against the real API before this was written (no
// guessing at a dialect the account was actually billed for):
//
//   * A real call with a real key came back HTTP 402 "Insufficient Balance" -
//     a real, billing-specific failure DeepSeek returns distinctly from 401/
//     429, and conditions.js's fromHttpStatus() had no case for it (fell
//     through to the generic `unavailable`, which reads as "the provider is
//     having a bad night" - wrong; nothing about a 402 clears on its own).
//     Added as `quotaExhausted` there - the account needs topping up, exactly
//     the same "nothing retries this" shape as a used-up daily quota.
//   * DeepSeek's JSON mode is `response_format: {type: 'json_object'}`, not
//     OpenAI's newer `json_schema` (strict) mode the generic provider sends -
//     unverified whether DeepSeek's API accepts that stricter dialect, so
//     this file does not assume it does. The one hard requirement of
//     `json_object` mode is that the word "json" appear somewhere in the
//     messages sent, or the call is rejected outright; none of this
//     application's Marathi prompts say so, so a system message adds it
//     rather than every caller having to remember to.
//
// No thinking-effort dial: deepseek-chat takes no `reasoning_effort`
// parameter DeepSeek's API documents, so - like openai-compatible.js -
// `supportsTiers` is honestly false rather than pretending three tiers do
// different amounts of work here.

const conditions = require('../conditions');

const key = () => process.env.DEEPSEEK_API_KEY || '';
const model = () => process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const baseUrl = () => (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');

const DEFAULT_ANSWER_TOKENS = 8192;
const MIN_OUTPUT_TOKENS = 256;
// deepseek-chat's own documented ceiling.
const MODEL_OUTPUT_CEILING = 8192;

function answerTokens(requested) {
  const configured = Number(process.env.DEEPSEEK_MAX_OUTPUT_TOKENS) || DEFAULT_ANSWER_TOKENS;
  const wanted = Number(requested) || configured;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(MODEL_OUTPUT_CEILING, Math.round(wanted)));
}

const provider = {
  key: 'deepseek',
  name: 'DeepSeek',
  supportsTiers: false,

  isConfigured: () => Boolean(key()),

  configHint: 'Set DEEPSEEK_API_KEY in .env, and top up the account balance at platform.deepseek.com.',

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
          // The word 'json' has to appear in the messages or DeepSeek's
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
      return {
        error: `DeepSeek returned ${response.status}.`,
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
          error: 'DeepSeek reached its output limit before it finished the answer.',
          condition: 'outputExhausted',
          outputExhausted: true,
          budget: allowance,
        };
      }
      return { error: 'DeepSeek returned nothing usable.', condition: 'empty' };
    }

    try {
      return { data: JSON.parse(text), usage: body.usage || null };
    } catch {
      if (choice?.finish_reason === 'length') {
        return {
          error: 'DeepSeek reached its output limit part-way through the answer.',
          condition: 'outputExhausted',
          outputExhausted: true,
          budget: allowance,
        };
      }
      return { error: 'DeepSeek did not answer in the shape that was asked for.', condition: 'badShape' };
    }
  },
};

provider.answerTokens = answerTokens;

module.exports = provider;
