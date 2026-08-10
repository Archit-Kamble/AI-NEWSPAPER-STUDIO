// Google Gemini — the writer.
//
// It was the understudy, on the grounds that its Marathi read a shade more like
// a translation than like a Maharashtra desk wrote it. It is primary now
// (AI_PROVIDER in .env), for one reason above the rest: room. A newspaper lead
// is a long piece of copy, and the thing that kept breaking was not the quality
// of a sentence but a call coming back empty because the model had spent its
// whole output allowance thinking. Sarvam stays, one step behind, and its
// Marathi is still the reason it is there.
//
// Gemini DOES have an effort dial now - `thinkingConfig.thinkingBudget` - so
// the three tiers mean three real amounts of thinking here, and
// `supportsTiers` says so. It did not when this file was written.
//
// THE TRAP, measured against this account rather than assumed:
//
//   maxOutputTokens 200, thinkingBudget 4096
//     -> finishReason MAX_TOKENS, 190 thought tokens, SIX tokens of answer.
//
// Thinking is counted inside `maxOutputTokens`, exactly as it is on Sarvam. So
// the two are budgeted separately here and added: the article gets its own
// room, and no amount of reasoning can eat it. Getting this wrong is not a
// slower answer, it is a blank one.
//
// `thinkingBudget: 0` is rejected outright by gemini-3.6-flash (400), so the
// cheap tier asks for a little thinking rather than none.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const key = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const model = () => process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.5-flash';

// Room for the ARTICLE, before any thinking is added on top.
//
// 8192 tokens is far more than a full-page lead needs (a 4000-character Marathi
// story is well under 3000 tokens), and the model's own ceiling is 65536, which
// is what `maxOutputTokens` is clamped to. Set GEMINI_MAX_OUTPUT_TOKENS to
// change the room the copy gets; the thinking budget is added to it, not taken
// out of it.
const DEFAULT_ANSWER_TOKENS = 8192;
const MIN_OUTPUT_TOKENS = 256;
const MODEL_OUTPUT_CEILING = 65536;

// How much thinking each tier buys. These are the numbers the desk's Basic /
// Plus / Ultra actually turn into.
//
//   basic  a caption, a headline, a filler - almost no reasoning needed, and
//          the desk wants it back quickly. Not zero: the model rejects zero.
//   plus   an ordinary news item reworked to its measure. This is the normal
//          case and it is deliberately NOT the maximum - every token of
//          thinking is paid for and waited for.
//   ultra  the lead, and anything that has to be worked out rather than
//          written: structured features, puzzles, a story that must be fitted
//          to an exact hole.
const THINKING_BY_TIER = { basic: 1024, plus: 4096, ultra: 12288 };

function thinkingBudget(tier) {
  return THINKING_BY_TIER[tier?.key] || THINKING_BY_TIER.plus;
}

function answerTokens(requested) {
  const configured = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || DEFAULT_ANSWER_TOKENS;
  const wanted = Number(requested) || configured;
  return Math.max(MIN_OUTPUT_TOKENS, Math.min(MODEL_OUTPUT_CEILING, Math.round(wanted)));
}

/**
 * The whole output allowance: the article's room PLUS the thinking's.
 *
 * This is the number that goes on the wire, and the reason it is a sum is the
 * measurement at the top of this file.
 */
function maxOutputTokens(requested, tier) {
  return Math.min(MODEL_OUTPUT_CEILING, answerTokens(requested) + thinkingBudget(tier));
}

// Gemini's schema dialect does not accept a couple of the JSON Schema keywords
// the other providers take, and rejects the whole request when it sees them.
// The application writes one schema; this makes it acceptable here.
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;

  const out = {};
  for (const [name, value] of Object.entries(node)) {
    if (name === 'additionalProperties' || name === '$schema' || name === 'strict') continue;
    out[name] = toGeminiSchema(value);
  }
  return out;
}

const provider = {
  key: 'gemini',
  name: 'Google Gemini',
  // True now: thinkingBudget is a real dial, so the three tiers buy three
  // different amounts of thinking rather than charging differently for
  // identical work.
  supportsTiers: true,

  isConfigured: () => Boolean(key()),

  configHint: 'Set GEMINI_API_KEY in .env. A key is issued free at aistudio.google.com/apikey.',

  // What this provider will give an answer, so the retry in ai/index.js can ask
  // for more room after a budget was exhausted.
  maxOutputTokens: (requested) => answerTokens(requested),
  modelName: model,

  async askForJson(prompt, schema, tier, { signal, maxOutputTokens: budget } = {}) {
    const thinking = thinkingBudget(tier);
    const allowance = maxOutputTokens(budget, tier);

    const response = await fetch(`${BASE}/${model()}:generateContent?key=${key()}`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: tier.temperature,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          // The article's room plus the thinking's, never one at the expense of
          // the other. See the measurement at the top of this file.
          maxOutputTokens: allowance,
          thinkingConfig: { thinkingBudget: thinking },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { error: `Gemini returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const body = await response.json();
    const candidate = body?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      // The same condition Sarvam reports, in Gemini's words: the allowance ran
      // out before the answer was finished. Reported as a CONDITION so the one
      // retry policy in ai/index.js applies here too - a provider does not get
      // to decide what to do about it.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        return {
          error: 'Gemini reached its output limit before it finished the answer.',
          outputExhausted: true,
          spentTokens: body?.usageMetadata?.thoughtsTokenCount || null,
          budget: answerTokens(budget),
        };
      }
      return { error: `Gemini returned nothing usable.${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}` };
    }

    try {
      return { data: JSON.parse(text), usage: body.usageMetadata || null };
    } catch {
      // Truncated JSON reads as malformed JSON. If the answer was cut off, say
      // what actually happened rather than blaming the model's shape.
      if (candidate?.finishReason === 'MAX_TOKENS') {
        return {
          error: 'Gemini reached its output limit part-way through the answer.',
          outputExhausted: true,
          budget: answerTokens(budget),
        };
      }
      return { error: 'Gemini did not answer in the shape that was asked for.' };
    }
  },
};

// Exported so they can be tested directly. A schema Gemini silently rejects,
// or a budget that lets reasoning eat the article, means the paper's writer
// fails on the night it is needed.
provider.toGeminiSchema = toGeminiSchema;
provider.thinkingBudget = thinkingBudget;
provider.answerTokens = answerTokens;
provider.totalOutputAllowance = maxOutputTokens;

module.exports = provider;
