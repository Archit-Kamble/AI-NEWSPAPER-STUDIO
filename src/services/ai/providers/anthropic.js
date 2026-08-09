// Anthropic Claude — the third provider.
//
// Its API is not the OpenAI shape, so it needs its own client rather than a
// base URL: a different header, a different envelope, and no `response_format`
// at all. Structured output is obtained the way Anthropic intends - declare a
// single tool whose input schema IS the shape wanted, and force it with
// `tool_choice`. The model then answers as tool arguments, which the API
// constrains to the schema. Same guarantee as Sarvam's `strict: true`, reached
// by a different road.
//
// On the tiers: Claude has extended thinking, which is the obvious equivalent
// of Sarvam's `reasoning_effort`, but it does not combine with a forced tool
// call - and the forced tool call is what makes the answer's shape safe. A
// malformed horoscope on a printed page is a worse outcome than a slightly less
// considered one, so the schema wins and `supportsTiers` is false. The tiers
// still change the temperature and the output budget here; they do not change
// how hard it thinks. The editor says so rather than pretending.
//
// Pricing, checked August 2026: $2 / 1M input and $10 / 1M output as an
// introductory rate through 31 August 2026, then $3 / $15 from 1 September.
// Budget for the second pair.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const key = () => process.env.ANTHROPIC_API_KEY || '';
const model = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const maxOutputTokens = () => Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS) || 4096;

const TOOL_NAME = 'sahas_response';

const provider = {
  key: 'anthropic',
  name: 'Anthropic Claude',
  supportsTiers: false,

  isConfigured: () => Boolean(key()),

  configHint: 'Set ANTHROPIC_API_KEY in .env. A key is issued at console.anthropic.com.',

  async askForJson(prompt, schema, tier, { signal }) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key(),
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: maxOutputTokens(),
        temperature: tier.temperature,
        messages: [{ role: 'user', content: prompt }],
        // One tool, whose input schema is the answer's shape. Forcing it is
        // what makes the reply structured rather than prose about the reply.
        tools: [{
          name: TOOL_NAME,
          description: 'Return the answer in exactly this shape.',
          input_schema: schema,
        }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { error: `Claude returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const body = await response.json();
    const call = (body.content || []).find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);

    if (!call) {
      if (body.stop_reason === 'max_tokens') {
        return {
          error:
            'Claude hit its output limit before finishing the answer. ' +
            'Raise ANTHROPIC_MAX_OUTPUT_TOKENS.',
        };
      }
      return { error: 'Claude returned nothing usable.' };
    }

    // Already an object - the arguments of the forced tool call, not a string
    // that has to be parsed and hoped over.
    return { data: call.input, usage: body.usage || null };
  },
};

module.exports = provider;
