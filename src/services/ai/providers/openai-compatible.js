// Any provider that speaks the OpenAI chat-completions shape.
//
// One file, many providers. OpenAI, DeepSeek, Krutrim, Together, Groq, most
// self-hosted servers and very likely whatever Indic provider launches next all
// expose the same endpoint shape, so they need one client rather than one each.
// Point `OPENAI_BASE_URL` at whichever you want:
//
//   OpenAI     https://api.openai.com/v1
//   DeepSeek   https://api.deepseek.com/v1
//   Krutrim    https://cloud.olakrutrim.com/v1
//
// This exists so the choice of provider stays a line in `.env` rather than a
// change to the application. The paper should never be difficult to move.
//
// Effort: the OpenAI shape has no single agreed dial. Newer OpenAI models take
// `reasoning_effort` and most others ignore unknown fields, so it is sent and
// `supportsTiers` is left false - the honest position is that the tiers may or
// may not differ here, depending on what you pointed it at.

const key = () => process.env.OPENAI_API_KEY || '';
const model = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const baseUrl = () => (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const maxOutputTokens = () => Number(process.env.OPENAI_MAX_OUTPUT_TOKENS) || 4096;

const provider = {
  key: 'openai',
  name: 'OpenAI-compatible',
  supportsTiers: false,

  isConfigured: () => Boolean(key()),

  configHint:
    'Set OPENAI_API_KEY in .env, and OPENAI_BASE_URL if you are pointing it at ' +
    'DeepSeek, Krutrim or another OpenAI-compatible provider.',

  async askForJson(prompt, schema, tier, { signal }) {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
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
        reasoning_effort: tier.effort,
        max_tokens: maxOutputTokens(),
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'sahas_response', schema, strict: true },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { error: `${model()} returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const body = await response.json();
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return { error: 'The model returned nothing usable.' };

    try {
      return { data: JSON.parse(text), usage: body.usage || null };
    } catch {
      return { error: 'The model did not answer in the shape that was asked for.' };
    }
  },
};

module.exports = provider;
