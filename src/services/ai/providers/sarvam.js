// Sarvam AI — the default provider, and the one whose Marathi goes on the page.
//
// Sarvam is built for Indian languages, and the difference is structural rather
// than a matter of taste. A global model's tokenizer splits a Devanagari word
// into four or five fragments; Sarvam's treats it as a word. That shows up
// twice: in the bill, and in the writing - text that was tokenised as language
// rather than as debris reads like a person wrote it.
//
// The API is OpenAI-compatible, which matters more than it sounds. It means
// `response_format: { type: 'json_schema', strict: true }` is available, so the
// shape of the answer is enforced at the API rather than hoped for at this end.
// That guarantee is the reason a generated horoscope cannot arrive as free
// prose and land, malformed, in a printed box.
//
// Facts, as of August 2026, read off Sarvam's own documentation:
//
//   endpoint   POST https://api.sarvam.ai/v1/chat/completions
//   model      sarvam-105b - the ONLY chat model. sarvam-30b and sarvam-m are
//              deprecated and no longer served.
//   context    128K
//   price      ₹4 / 1M input, ₹2.5 / 1M cached input, ₹16 / 1M output
//   limits     Starter 60 req/min, Pro 200, Business 1000
//   max output Starter 4096, Pro 16384, Business 128000 - and reasoning tokens
//              are counted inside it. See tiers.js.

const ENDPOINT = 'https://api.sarvam.ai/v1/chat/completions';

const key = () => process.env.SARVAM_API_KEY || '';
const model = () => process.env.SARVAM_MODEL || 'sarvam-105b';
const maxOutputTokens = () => Number(process.env.SARVAM_MAX_OUTPUT_TOKENS) || 4096;

const provider = {
  key: 'sarvam',
  name: 'Sarvam AI',
  // Sarvam has a real effort dial, so the three tiers genuinely differ.
  supportsTiers: true,

  isConfigured: () => Boolean(key()),

  configHint:
    'Set SARVAM_API_KEY in .env. A key is issued at dashboard.sarvam.ai; new ' +
    'accounts get ₹100 of free credit, which is well over a year of this paper.',

  async askForJson(prompt, schema, tier, { signal }) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key()}`,
      },
      body: JSON.stringify({
        model: model(),
        messages: [{ role: 'user', content: prompt }],
        temperature: tier.temperature,
        // Sarvam's own parameter, and the whole basis of the tiers.
        reasoning_effort: tier.effort,
        // Reasoning is billed and counted as output, so the higher tiers are
        // given room to think AND to answer. Without this the Ultra tier can
        // spend its whole budget reasoning and return nothing.
        max_tokens: maxOutputTokens(),
        // Enforced at the API, not parsed hopefully at this end.
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'sahas_response', schema, strict: true },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { error: `Sarvam returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    const finish = body?.choices?.[0]?.finish_reason;

    if (!text) {
      // The specific failure this provider has, named so nobody has to guess.
      if (finish === 'length') {
        return {
          error:
            'Sarvam spent its whole output budget reasoning and returned nothing. ' +
            'Raise SARVAM_MAX_OUTPUT_TOKENS, or use a lower tier.',
        };
      }
      return { error: 'Sarvam returned nothing usable.' };
    }

    try {
      return { data: JSON.parse(text), usage: body.usage || null };
    } catch {
      return { error: 'Sarvam did not answer in the shape that was asked for.' };
    }
  },
};

module.exports = provider;
