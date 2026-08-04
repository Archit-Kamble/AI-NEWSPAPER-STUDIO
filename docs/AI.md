# AI in SAHAS

SAHAS does not depend on any one AI company. The application asks for **a JSON
answer at a tier of effort**; which provider serves that, at what price, in what
dialect of the API, is a line in `.env`.

That matters more here than in most software. This is a Marathi newspaper — the
thing being bought from a provider is *its Marathi*, and that is exactly the
thing most likely to be beaten by somebody else within a year. A newsroom should
be able to move for the price of an API key.

---

## The one rule

> **The model may write. It may never assert a fact.**

राशिभविष्य, सुविचार and puzzles may be written by a model, because everyone
understands them as entertainment. Gold rates, mandi prices, market closes,
weather numbers and "on this day in history" may **not** — those come from a
source or they do not run. A model asked for yesterday's gold rate will produce
a number, it will be wrong, and it will be printed under this paper's masthead.

`src/features/index.js` enforces this by classifying every standing feature by
where its content comes from: `computed`, `curated`, `written`, or `feed`. The
`feed` ones are declared and deliberately refuse to run until a real source is
connected.

---

## Setting it up

Copy `.env.example` to `.env` and fill in a key. **`.env` is gitignored and must
never be committed.**

```bash
AI_PROVIDER=sarvam                        # who writes the copy that gets printed
AI_FALLBACK_PROVIDER=gemini,anthropic     # who covers, in order
SARVAM_API_KEY=...
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
```

`AI_FALLBACK_PROVIDER` is a comma-separated chain, tried in order. A provider
with no key is skipped rather than counted — an unconfigured fallback is not a
fallback, and 2 a.m. is not the moment to find that out.

Nothing else needs changing. `GET /api/ai/status` reports what is configured,
and the editor's AI panel describes the real setup rather than a fixed list of
names.

---

## The providers

| | `sarvam` | `gemini` | `anthropic` | `openai` |
|---|---|---|---|---|
| Role | writes the Marathi | first understudy | second understudy | optional |
| Marathi | native | good, slightly translated | good, translated | varies |
| Structured output | `json_schema` `strict` | own schema dialect | forced tool call | `json_schema` `strict` |
| Effort dial | ✅ `reasoning_effort` | ✗ | ✗ (see below) | depends |
| Tokens per Marathi word | ~2 | ~8 | ~8 | ~8 |

**Claude has extended thinking**, which is the obvious equivalent of Sarvam's
effort dial — but it does not combine with a *forced* tool call, and the forced
tool call is what makes the answer's shape safe. A malformed horoscope on a
printed page is worse than a slightly less considered one, so the schema wins
and `supportsTiers` is `false` there.

**Sarvam is the default** because it is built for Indian languages, and the
difference is structural rather than a matter of taste: a global tokenizer
splits a Devanagari word into four or five fragments, Sarvam's treats it as a
word. That shows up twice — in the bill, and in writing that was tokenised as
language rather than as debris.

**Gemini is the fallback, not the writer.** A newspaper goes to press whether or
not an API is having a bad night, and a second provider on a different network
and a different continent is worth far more than a marginally better sentence.
It is *not* used for the Optimize button: anything a reader sees printed should
come from the provider chosen for its Marathi.

**`openai-compatible` is one file that speaks to many providers** — OpenAI,
DeepSeek, Krutrim, Together, Groq, most self-hosted servers. Point
`OPENAI_BASE_URL` at whichever you want.

### Sarvam facts, verified August 2026

```
endpoint    POST https://api.sarvam.ai/v1/chat/completions   (OpenAI-compatible)
model       sarvam-105b — the ONLY chat model.
            sarvam-30b and sarvam-m are deprecated and no longer served.
context     128K
price       ₹4 / 1M input · ₹2.5 / 1M cached input · ₹16 / 1M output
rate limit  Starter 60 req/min · Pro 200 · Business 1,000
max output  Starter 4096 · Pro 16384 · Business 128000
credits     ₹100 free on signup
languages   10 most-spoken Indian languages + English, Marathi included
```

---

## The tiers

The desk does not choose a model. It says "this is a filler, do it quickly" or
"this is tonight's lead, take your time".

| Tier | `reasoning_effort` | For |
|---|---|---|
| **Basic** | `low` | Fillers, captions, briefs, the standing features. The default. |
| **Plus** | `medium` | Reworking a story to its measure, a headline that has to land. |
| **Ultra** | `high` | The lead. Slower, and a few paise more. |

**They are not three models.** Sarvam ships exactly one chat model, so a menu of
three could not be built even if it were a good idea. What Sarvam *has* is a
real effort dial, and that is the thing worth exposing. A provider with no such
dial declares `supportsTiers: false`, and the editor says so rather than
offering three choices that quietly do identical work at identical cost.

### ⚠ The trap on Ultra

**Reasoning tokens are billed and counted as output.** A high-effort call with a
small `max_tokens` can spend its entire budget thinking and return **nothing** —
a failure that looks like an outage, on the tier you reach for when a story
matters most.

So each tier carries its own output budget (`outputBudgetShare` in
`src/services/ai/tiers.js`), and `SARVAM_MAX_OUTPUT_TOKENS` must match your
plan. **If you intend to use Ultra, budget for the Pro plan** (16,384) rather
than Starter (4,096). When it does happen the error says so by name rather than
leaving anyone guessing.

---

## What it costs

Measured against this paper's real workload: one features call a day, plus AI
help on 15 blocks a day — about **117,600 words in and 54,000 words out per
month**. Each row is that provider doing *all* of it.

| Provider | tokens/mo | per month | per year |
|---|---|---|---|
| **Sarvam 105B** | 0.34M | **₹3** | **₹32** |
| Gemini 3.6 Flash | 1.37M | ₹409 | ₹4,912 |
| Claude Sonnet 5 — intro, to 31 Aug 2026 | 1.37M | ₹546 | ₹6,549 |
| Claude Sonnet 5 — standard, from 1 Sep | 1.37M | ₹819 | ₹9,823 |

At ₹88/USD. The 4× gap is the tokenizer, not the price list: Sarvam bills 0.34M
tokens for work the others bill 1.37M for.

**In the configured setup Sarvam does nearly all of it and the other two only
cover outages, so the real blended bill is a few rupees a month.** Sarvam's ₹100
free credit covers years at that rate. Gemini's free tier likely covers its
share outright.

Ultra multiplies Sarvam's output tokens by roughly 3–5× (reasoning is billed as
output), which takes ₹3/month to ₹10–15. Still not a number worth optimising.

Be sceptical of published comparisons. Every third-party estimate this project
was shown assumed **10,000–100,000 articles** — between six years and six
decades of this newspaper — and two of them contradicted their own price tables
between one paragraph and the next. Check the provider's own pricing page.

---

## The guarantees

`src/services/ai/index.js` enforces three things, whoever is behind it:

1. **If nothing is configured it says so.** It never returns invented content
   dressed up as a successful result. A paper that silently prints placeholder
   text is worse than one that prints nothing.

2. **It returns validated JSON or an error.** Providers that enforce a schema
   server-side are asked to — and every answer is checked again here, because
   three providers are three implementations of one promise, and a printed page
   is the wrong place to discover one of them is loose.

3. **If the first provider fails, the second is tried** — and which one answered
   is reported, never hidden. If the fallback wrote tonight's horoscope, the
   desk can see that.

---

## Adding a provider

One file in `src/services/ai/providers/`, implementing:

```js
module.exports = {
  key: 'name',
  name: 'Display Name',
  supportsTiers: false,          // be honest — has it a real effort dial?
  isConfigured: () => Boolean(process.env.MY_API_KEY),
  configHint: 'Set MY_API_KEY in .env.',
  async askForJson(prompt, schema, tier, { signal }) {
    // → { data } | { error }
  },
};
```

Register it in the `PROVIDERS` map in `src/services/ai/index.js`. If it speaks
the OpenAI shape, set `OPENAI_BASE_URL` instead and write no code at all.

---

## Where the AI is actually used

- **`src/features/written.js`** — राशिभविष्य and सुविचार, in **one call a day**
  for all twelve signs together. Not twelve calls, not four.
- **The editor's AI panel** — per-block help. The model is handed the block as a
  **character grid** (`fitBrief` in `public/editor/external-editor/ai-panel.js`)
  with an exact character budget that already accounts for the picture's shape,
  rather than being asked for "about 400 words".

Everything a model writes lands in the ordinary fields, is measured by the same
character grid, saved by the same endpoint and printed by the same renderer as a
reporter's copy — and stays fully editable. **AI assists, never owns.**
