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
AI_PROVIDER=sarvam            # who writes the copy that gets printed
AI_FALLBACK_PROVIDER=gemini   # who covers when that one is down
SARVAM_API_KEY=...
GEMINI_API_KEY=...
```

Nothing else needs changing. `GET /api/ai/status` reports what is configured,
and the editor's AI panel describes the real setup rather than a fixed list of
names.

---

## The providers

| | `sarvam` | `gemini` | `openai` |
|---|---|---|---|
| Role | writes the Marathi | fallback | optional |
| Marathi | native | good, slightly translated | varies |
| Strict JSON schema | ✅ | ✅ (own dialect) | ✅ |
| Effort dial | ✅ `reasoning_effort` | ✗ | depends |

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

Measured against this paper's real workload — one call a day for the standing
features, plus per-block help on a 4-page paper of ~44 blocks:

| | per month | per year |
|---|---|---|
| Basic | ~₹4–5 | **~₹55** |
| Ultra | ~₹15–20 | ~₹220 |

**Sarvam's ₹100 free credit covers well over a year at Basic.** Cost is
formally a non-issue at this scale, which is the right outcome: it means tiers
and providers can be chosen on quality alone.

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
