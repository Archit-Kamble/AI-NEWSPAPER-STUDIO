// Google Gemini — kept as the fallback rather than the writer.
//
// Gemini handles Devanagari well and is fast and cheap, but its tokenizer is
// not built for Marathi and its Marathi reads a shade more like a translation
// than like a Maharashtra desk wrote it. For a paper printed in Marathi that is
// the wrong trade to make on the copy a reader sees.
//
// It earns its place somewhere more valuable: as the provider that answers when
// the first one does not. A newspaper goes to press whether or not an API is
// having a bad night, and a second provider on a different network, a different
// company and a different continent is worth far more than a marginally better
// sentence.
//
// Gemini has no effort dial, so the three tiers cannot mean three different
// amounts of thinking here. It says so honestly (`supportsTiers: false`) rather
// than charging differently for identical work; only the temperature moves.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const key = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const model = () => process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.5-flash';

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
  supportsTiers: false,

  isConfigured: () => Boolean(key()),

  configHint: 'Set GEMINI_API_KEY in .env. A key is issued free at aistudio.google.com/apikey.',

  async askForJson(prompt, schema, tier, { signal }) {
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
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { error: `Gemini returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return { error: 'Gemini returned nothing usable.' };

    try {
      return { data: JSON.parse(text), usage: body.usageMetadata || null };
    } catch {
      return { error: 'Gemini did not answer in the shape that was asked for.' };
    }
  },
};

// Exported so the conversion can be tested directly. A schema that Gemini
// silently rejects means the fallback fails on the night it is needed.
provider.toGeminiSchema = toGeminiSchema;

module.exports = provider;
