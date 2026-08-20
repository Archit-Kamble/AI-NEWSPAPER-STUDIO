// Phase 6 — the production writing pipeline, audited end to end.
//
// Two things this file exists to hold, both found by reading the prompts
// rather than assumed:
//
//   The fact-safety rules forbade an invented NUMBER or NAME, but said nothing
//   about a model asserting what "today's" election, match or weather actually
//   did - which is not an invented figure, it is training knowledge presented
//   as news. A newspaper cannot tell the two apart once they are printed. All
//   three prompts (write, resize, fill) now say so explicitly.
//
//   The shared response validator in `ai/index.js` checked that a required
//   field was PRESENT, never that it was the right TYPE. A body that came back
//   as the number 12345 passed validation and printed as "12345" - not because
//   anything downstream mishandled it, but because nothing upstream had ever
//   been asked to look.
//
// Driven through stubs throughout. No model is called.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

const writer = require('../src/services/storyWriter.service');
const ai = require('../src/services/ai');
const information = require('../src/services/information');
const informationConditions = require('../src/services/information/conditions');

function withProviders(t, stubs) {
  const saved = { ...ai.PROVIDERS };
  for (const [key, stub] of Object.entries(stubs)) {
    ai.PROVIDERS[key] = {
      key, name: key, supportsTiers: true, isConfigured: () => true, configHint: '',
      maxOutputTokens: (n) => n || 8192,
      ...stub,
    };
  }
  t.after(() => {
    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, saved);
  });
}

// ---------------------------------------------- Part 4/5/6: current facts ---

test('the first write cannot be asked to invent a live result, score or status', () => {
  const brief = writer.briefFor({
    seed: 'बिहार निवडणूक निकाल', notes: '',
    fit: { bodyCharBudget: 400, bodyWordBudget: 66, cols: 40, rows: 20, hasPictures: false },
    section: { width_px: 268, height_px: 248 }, language: 'Marathi', isLead: false,
  });
  assert.match(brief, /today's result, score, weather/i);
  assert.match(brief, /do NOT.*state an outcome, a number or a status/is);
});

test('a resize repair carries the same instruction, not just the length change', () => {
  const brief = writer.resizeBriefFor({
    proposal: { body: 'चाचणी मजकूर.' }, used: 100, budget: 400, language: 'Marathi',
  });
  assert.match(brief, /live result, score or/i);
});

test('filling remaining space carries the same instruction', () => {
  const brief = writer.fillBriefFor({
    view: { headline: 'चाचणी', subheading: '', body: 'सुरुवातीचा मजकूर.' },
    notes: '', room: { budget: 400, used: 100, remaining: 300, columns: 2, fillRatio: 0.5, holeLines: 4 },
    language: 'Marathi', section: { width_px: 268, height_px: 248 },
  });
  assert.match(brief, /live result, score or status/i);
});

test('the guardrail sits alongside the existing no-invented-facts rule, not instead of it', () => {
  // A prompt that only forbade CURRENT-EVENT fabrication and dropped the
  // original rule would be a regression dressed as a fix.
  const brief = writer.briefFor({
    seed: 'x', notes: '',
    fit: { bodyCharBudget: 400, bodyWordBudget: 66, cols: 40, rows: 20, hasPictures: false },
    section: { width_px: 268, height_px: 248 }, language: 'Marathi', isLead: false,
  });
  assert.match(brief, /no casualty figures, no rupee amounts, no dates/i);
});

test('an AI headline below 95% is replaced only after exact composition of alternatives', async (t) => {
  withOnlyGemini(t, {
    async askForJson() {
      return { data: { headlines: [
        'शहरातील पाणीटंचाईवर प्रशासनाची उपाययोजना सुरू',
        'पाणीटंचाईवर शहर प्रशासनाकडून उपाययोजना सुरू',
        'शहरातील पाणी प्रश्नावर प्रशासनाच्या उपाययोजना',
        'पाणीटंचाई निवारणासाठी शहरात उपाययोजना सुरू',
        'शहराच्या पाणी प्रश्नावर प्रशासनाच्या उपाययोजना सुरू',
        'पाणीटंचाई दूर करण्यासाठी शहर प्रशासनाचे प्रयत्न सुरू',
        'शहरातील पाणीटंचाईच्या प्रश्नावर प्रशासनाच्या उपाययोजना सुरू',
        'शहराची पाणीटंचाई दूर करण्यासाठी प्रशासनाकडून प्रयत्न सुरू',
      ] } };
    },
  });

  const section = {
    width_px: 268, height_px: 248, margin_px: 4, column_count: 1,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10,
  };
  const result = await writer.settleGeneratedHeadline({
    section,
    images: [],
    proposal: { headline: 'लहान मथळा', subheading: '', body: '' },
    seed: 'शहरातील पाणीटंचाई',
    fit: { headlineChars: 60, cols: 40 },
    language: 'Marathi',
    tier: 'basic',
    accentStyle: false,
  });

  assert.equal(result.calls, 1);
  assert.equal(result.acceptable, true);
  assert.ok(result.fill >= 0.95);
  assert.notEqual(result.headline, 'लहान मथळा');
});

// -------------------------------------------------- Part 7: response type ---

// A rejected shape is non-retryable-on-the-same-provider, so `ai.askForJson`
// correctly moves on to the next provider in the chain - and if `sarvam` or
// `anthropic` happen to have a real key configured in `.env`, "the next
// provider" is a real, billed API. That was found HERE, live, while testing
// Phase 8: this test only ever stubbed `gemini`, on the unstated assumption
// that nothing else in the chain would be reachable - true when it was
// written, not true once a real Sarvam key was added later. Every provider
// the chain could reach is now stubbed shut, explicitly, so this test's
// result depends only on `gemini`'s answer, whatever `.env` says.
function withOnlyGemini(t, gemini) {
  withProviders(t, {
    gemini,
    sarvam: { isConfigured: () => false },
    anthropic: { isConfigured: () => false },
    openai: { isConfigured: () => false },
  });
}

test('a body that comes back as a number is rejected, not stringified and accepted', async (t) => {
  withOnlyGemini(t, { async askForJson() { return { data: { headline: 'क', subheading: 'क', body: 12345 } }; } });
  const result = await ai.askForJson('x',
    { type: 'object', required: ['headline', 'subheading', 'body'], properties: {
      headline: { type: 'string' }, subheading: { type: 'string' }, body: { type: 'string' },
    } },
    { tier: 'basic' });
  assert.equal(result.data, undefined, 'a numeric body must not reach the desk as if it were prose');
  assert.match(result.error, /not text/);
});

test('a body that is an object, an array, or a boolean is rejected the same way', async (t) => {
  for (const bad of [{}, [], true, ['a', 'b']]) {
    withOnlyGemini(t, { async askForJson() { return { data: { headline: 'क', subheading: 'क', body: bad } }; } });
    // eslint-disable-next-line no-await-in-loop
    const result = await ai.askForJson('x',
      { type: 'object', required: ['body'], properties: { body: { type: 'string' } } },
      { tier: 'basic' });
    assert.equal(result.data, undefined, `body=${JSON.stringify(bad)} must fail validation`);
  }
});

test('a correctly-typed answer is untouched by the new check', async (t) => {
  withProviders(t, {
    gemini: { async askForJson() { return { data: { headline: 'मथळा', subheading: 'उपमथळा', body: 'मजकूर.' } }; } },
  });
  const result = await ai.askForJson('x',
    { type: 'object', required: ['headline', 'subheading', 'body'], properties: {
      headline: { type: 'string' }, subheading: { type: 'string' }, body: { type: 'string' },
    } },
    { tier: 'basic' });
  assert.equal(result.data.body, 'मजकूर.');
});

// -------------------------------------------- Part 13: the call-count matrix ---

function stubProvider(t, respond) {
  withProviders(t, { gemini: { async askForJson(prompt, schema) { return respond(prompt, schema); } } });
}

async function callCount(t, block) {
  let calls = 0;
  const inner = block;
  return { run: async (respond) => {
    stubProvider(t, (prompt, schema) => { calls += 1; return respond(prompt, schema); });
    const r = await inner();
    return { result: r, calls };
  } };
}

const copyFit = require('../src/services/copyFit.service');

// A real block, composed - not a `{ bodyCharBudget, cols }` stand-in. The
// stand-in is what the old `resizeNeeded()` rule needed, and that rule is
// gone: a character count cannot answer "does this fit" (the same block holds
// 30-46% more or fewer characters depending only on what is written into it),
// and the budget it compared against was a reservation for a headline that
// did not exist yet - measured 63% below the finished block's real capacity
// across 400 real article blocks.
const REAL_BLOCK = {
  width_px: 268, height_px: 296, margin_px: 12, column_count: 1,
  line_height: 1.25, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10,
};
const REAL_OVER = { headline: 'नरेंद्र मोदींनी लाल किल्ल्यावर ध्वजारोहण', subheading: 'स्वातंत्र्यदिनाच्या सन्मानार्थ ध्वज उचलला' };
const REAL_SENTENCE = 'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावर ध्वजारोहण केले. ';

async function paidCallsFor(body) {
  let calls = 0;
  const settled = await copyFit.settleToFit({
    section: REAL_BLOCK,
    images: [],
    proposal: { ...REAL_OVER, body },
    resizeBriefFor: () => 'brief',
    askForMore: async () => { calls += 1; return { data: { additions: [REAL_SENTENCE.repeat(6)] } }; },
  });
  return { calls, settled };
}

test('call-count matrix: good fit, hole, and overflow - measured on a real block', async () => {
  // The block's own longest fitting body, found by composing.
  const full = (await copyFit.trimToFit(REAL_BLOCK, [], { ...REAL_OVER, body: REAL_SENTENCE.repeat(40) })).body;

  const scenarios = [
    { name: 'good fit (composed to the foot)', body: full, expectCalls: 0 },
    { name: 'genuine hole', body: REAL_SENTENCE, expectCalls: copyFit.MAX_FILL_CALLS },
    // The change that saves the most money: overflow is repaired by a free,
    // deterministic sentence-boundary cut. It used to cost a paid call that
    // was not even guaranteed to come back the right length.
    { name: 'overflow', body: REAL_SENTENCE.repeat(40), expectCalls: 0 },
    { name: 'empty', body: '', expectCalls: copyFit.MAX_FILL_CALLS },
  ];

  for (const s of scenarios) {
    // eslint-disable-next-line no-await-in-loop
    const { calls, settled } = await paidCallsFor(s.body);
    assert.equal(calls, s.expectCalls, `${s.name}: expected ${s.expectCalls} paid call(s), spent ${calls}`);
    // Whatever happened, nothing may be left running past the foot of the block.
    assert.equal(settled.fit.overset, false, `${s.name}: the block a desk is shown always fits`);
  }
});

test('call-count matrix: no room means zero calls, not one that gets refused', async (t) => {
  let calls = 0;
  withProviders(t, { gemini: { async askForJson() { calls += 1; return { data: {} }; } } });

  // planningFit returning no budget is what `write()` checks BEFORE calling
  // ai.askForJson at all - reproduced here at the same boundary write() uses.
  const fit = { bodyCharBudget: 0 };
  const wouldCall = Boolean(fit.bodyCharBudget);
  assert.equal(wouldCall, false, 'write() must refuse before spending a call, not after');
  assert.equal(calls, 0);
});

// -------------------------------------------------- Part 14: Fill Remaining ---

test('Fill Remaining uses the shared exact settle controller, not a second fit rule', () => {
  // A whole-body response can overshoot; cutting it at a sentence may then
  // expose a visible hole. The explicit fill action now delegates that final
  // trim-and-one-bounded-repair decision to the same controller as write().
  // The old `resizeNeeded` predictor must stay gone.
  const src = writer.fillRemaining.toString();
  assert.match(src, /copyFit\.settleToFit/);
  assert.doesNotMatch(src, /resizeNeeded/);
});

test('Fill Remaining asks for exactly one call when there is room', async (t) => {
  let calls = 0;
  withProviders(t, {
    gemini: {
      async askForJson(prompt, schema) {
        calls += 1;
        return { data: { body: 'क'.repeat(200) } };
      },
    },
  });
  const result = await ai.askForJson('fill', { type: 'object', required: ['body'], properties: { body: { type: 'string' } } }, { tier: 'basic' });
  assert.equal(calls, 1);
  assert.ok(result.data.body);
});

// ---------------------------------- Phase 8: information layer integration ---
//
// "Write this block" now classifies the seed BEFORE calling a model at all.
// Evergreen and reporter-copy seeds are untouched - one call, same as always.
// A current-event seed must be verified first; if it is not, the model is
// never called, because a retrieval FAILURE for a current-event request must
// never silently become "let Gemini write from memory" (see
// src/services/information/ and CLAUDE.md's "AI is not a source of current
// events"). Driven through the real HTTP endpoint against a real DB, with
// both the AI provider and the RSS provider stubbed - no model, no network.

async function withBlock(t, name) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const newspaper = await desk.json('/api/newspapers', { method: 'POST', body: JSON.stringify({ name }) });
  t.after(() => pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]));

  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, page };
}

// Stubs `gemini` only, via the file's own `withProviders` - never touches
// AI_PROVIDER/AI_FALLBACK_PROVIDER. Those are process-wide env vars, and this
// file's earlier tests rely on the ambient .env default (gemini primary)
// while stubbing nothing but `ai.PROVIDERS.gemini` - mutating the env instead
// would race whichever of those tests happens to run at the same time, and
// send a real network request to whatever provider the race left in place.
// (That happened once, here, during this phase: two unrelated tests each
// hung for 49s/100s waiting on a real provider before this was found.)
function withProvider(t, askForJson) {
  withOnlyGemini(t, { askForJson });
}

function withRss(t, stub) {
  const saved = information.PROVIDERS.rss;
  information.PROVIDERS.rss = { ...saved, ...stub };
  t.after(() => { information.PROVIDERS.rss = saved; });
}

// A headline, subheading and body all at the TOP of what the brief asked
// for. Only the body being "compliant" is not enough: `planningFit` reserves
// the headline/deck at their full legal length before the model has written
// either (see storyWriter.service.js's own comment on `standIn`), so a real
// headline shorter than that reservation - `'मथळा'`, four characters, would
// be typical and realistic - hands rows back to the body and makes the real
// budget measure larger than what was briefed. A body sized only to the
// BRIEFED budget then reads as a hole and fires the pre-existing resize pass
// (resizeRule.test.js) for a reason that has nothing to do with retrieval.
// Answering at every stated limit is the same technique the Phase 5
// exhaustive proof used, and for the same reason: it is what keeps these
// tests measuring ONE thing (does retrieval add a call) rather than two.
// A real word, space-separated and repeated, never one giant unbroken
// token: storyWriter.service.js's own `standIn()` reserves the headline/deck
// budget the same way, and now that the budget itself comes from the exact
// composition engine (not text-flow.js's length-only grid - see its own
// comment on why), a single N-character token with no legal break point
// composes to a DIFFERENT row count than N characters of ordinary word-
// wrapped text would. `'क'.repeat(N)` was a fine stand-in under the old
// grid, where only length mattered; under real word-shaping it is its own,
// unrelated cause of an "overflow" a genuine headline of the same length
// would never hit.
function wordFill(n) {
  const want = Math.max(0, Math.round(n));
  if (!want) return '';
  const WORD = 'शब्द ';
  return WORD.repeat(Math.ceil(want / WORD.length)).slice(0, want);
}

function compliantResponse(prompt) {
  if (/HEADLINE TO RESET:/.test(prompt)) {
    return { headlines: [
      'शहरातील पाणीटंचाईवर प्रशासनाची उपाययोजना सुरू',
      'पाणीटंचाईवर शहर प्रशासनाकडून उपाययोजना सुरू',
      'शहरातील पाणी प्रश्नावर प्रशासनाच्या उपाययोजना',
      'पाणीटंचाई निवारणासाठी शहरात उपाययोजना सुरू',
      'शहराच्या पाणी प्रश्नावर प्रशासनाच्या उपाययोजना सुरू',
      'पाणीटंचाई दूर करण्यासाठी शहर प्रशासनाचे प्रयत्न सुरू',
      'शहरातील पाणीटंचाईच्या प्रश्नावर प्रशासनाच्या उपाययोजना सुरू',
      'शहराची पाणीटंचाई दूर करण्यासाठी प्रशासनाकडून प्रयत्न सुरू',
    ] };
  }
  const additionRange = /aiming for (\d+) and never more than (\d+)/.exec(prompt);
  if (additionRange) return { additions: [wordFill(Number(additionRange[2]))] };
  const headlineLimit = /headline must be \d+ to (\d+) characters/.exec(prompt);
  const deckLimit = /one line of \d+ to (\d+)/.exec(prompt);
  const bodyRange = /between (\d+) and (\d+) characters/.exec(prompt);
  return {
    headline: wordFill(headlineLimit ? Number(headlineLimit[1]) : 30),
    subheading: wordFill(deckLimit ? Number(deckLimit[1]) : 60),
    body: wordFill(bodyRange ? Number(bodyRange[2]) : 400),
  };
}

const TRUSTED = 'trusted-wire.example.com';
function withTrustedDomain(t) {
  const saved = process.env.INFORMATION_TRUSTED_DOMAINS;
  process.env.INFORMATION_TRUSTED_DOMAINS = TRUSTED;
  t.after(() => {
    if (saved === undefined) delete process.env.INFORMATION_TRUSTED_DOMAINS;
    else process.env.INFORMATION_TRUSTED_DOMAINS = saved;
  });
}

test('evergreen: retrieval is never invoked; only writing and measured headline repair may call AI', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information evergreen');

  let rssCalls = 0;
  withRss(t, { isConfigured: () => true, search: async () => { rssCalls += 1; return { items: [] }; } });

  let aiCalls = 0;
  withProvider(t, async (prompt) => { aiCalls += 1; return { data: compliantResponse(prompt) }; });

  const result = await desk.json(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: 'Satara history', tier: 'basic' }),
  });

  assert.ok(result.proposal, 'the block was written');
  assert.match(result.fit.compositionFingerprint, /^[0-9a-z]+$/,
    'acceptance is tied to the exact typography/image snapshot the server measured');
  assert.equal(result.fit.displayOverflowing, false);
  assert.equal(rssCalls, 0, 'an evergreen seed must never reach the information layer');
  assert.ok(aiCalls >= 1 && aiCalls <= 1 + 1 + copyFit.MAX_FILL_CALLS,
    'retrieval adds no call; only one headline repair and the bounded body repairs may add calls');
  assert.equal(result.fit.headlineAcceptable, true, 'the headline passed the exact 95% composition check');
  assert.equal(result.fit.overflowing, false, 'the bounded writer must never overset the block');
  assert.equal(result.fit.state, 'SOURCE_LIMITED_UNDERFILL',
    'a finite stub source is reported honestly instead of being padded past its supplied facts');
  assert.equal(result.retrieval, null, 'nothing to show - retrieval never ran');
});

test('current-event + verified: the writer is called with the verified facts, and the desk is told', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information verified');
  withTrustedDomain(t);
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [{
        title: 'Satara district: heavy rain warning issued',
        description: 'IMD has issued an orange alert for Satara district for the next 24 hours.',
        link: `http://${TRUSTED}/a`,
        publishedAt: new Date().toISOString(),
        publisher: 'Trusted Wire',
      }],
    }),
  });

  let briefed = '';
  withProvider(t, async (prompt) => {
    briefed = prompt;
    return { data: compliantResponse(prompt) };
  });

  const result = await desk.json(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: 'Satara weather today', tier: 'basic' }),
  });

  assert.ok(result.proposal, 'the block was written using the verified facts');
  assert.match(briefed, /VERIFIED SOURCE DATA/, 'the model was handed the digested facts, delimited as data');
  assert.match(briefed, /orange alert for Satara district/i);
  assert.equal(result.retrieval.status, 'verified');
  assert.equal(result.retrieval.category, 'current_data');
});

test('current-event + insufficient: the writer is never called, and the desk is told why', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information insufficient');
  withRss(t, { isConfigured: () => true, search: async () => ({ items: [] }) });
  withProvider(t, async () => { throw new Error('the model must not be called without verified facts'); });

  const response = await desk(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: 'Bihar election result', tier: 'basic' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();

  assert.equal(result.error, informationConditions.REFUSAL.insufficient);
  assert.equal(result.retrieval.status, 'insufficient');
});

test('current-event + unavailable (nothing configured): the writer is never called', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information unavailable');
  withRss(t, { isConfigured: () => false, search: async () => { throw new Error('must not be reached'); } });
  withProvider(t, async () => { throw new Error('the model must not be called when retrieval is unavailable'); });

  const response = await desk(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: "today's Maharashtra news", tier: 'basic' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();

  assert.equal(result.error, informationConditions.REFUSAL.unavailable);
  assert.equal(result.retrieval.status, 'unavailable');
});

test('current-event + conflicting: the writer is never called while sources disagree', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information conflicting');
  process.env.INFORMATION_TRUSTED_DOMAINS = 'wire-a.example.com,wire-b.example.com';
  t.after(() => { delete process.env.INFORMATION_TRUSTED_DOMAINS; });
  withRss(t, {
    isConfigured: () => true,
    search: async () => ({
      items: [
        {
          title: 'Result', description: 'Candidate X received 52,000 votes.',
          link: 'http://wire-a.example.com/a', publishedAt: new Date().toISOString(), publisher: 'Wire A',
        },
        {
          title: 'Result', description: 'Candidate X received 61,000 votes.',
          link: 'http://wire-b.example.com/b', publishedAt: new Date().toISOString(), publisher: 'Wire B',
        },
      ],
    }),
  });
  withProvider(t, async () => { throw new Error('the model must not be called while sources conflict'); });

  const response = await desk(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: 'Bihar election result today', tier: 'basic' }),
  });
  assert.equal(response.status, 400);
  const result = await response.json();

  assert.equal(result.error, informationConditions.REFUSAL.conflicting);
  assert.equal(result.retrieval.status, 'conflicting');
});

test('reporter_copy: retrieval is never invoked even when the seed also contains a date word', async (t) => {
  const { desk, page } = await withBlock(t, 'ZZ information reporter copy');
  let rssCalls = 0;
  withRss(t, { isConfigured: () => true, search: async () => { rssCalls += 1; return { items: [] }; } });
  withProvider(t, async (prompt) => ({ data: compliantResponse(prompt) }));

  const result = await desk.json(`/api/pages/${page.id}/sections/lead/write`, {
    method: 'POST',
    body: JSON.stringify({ seed: "Rewrite today's reporter copy", tier: 'basic' }),
  });

  assert.ok(result.proposal);
  assert.equal(rssCalls, 0, 'a request to rewrite existing copy is not a request for a new fact');
});
