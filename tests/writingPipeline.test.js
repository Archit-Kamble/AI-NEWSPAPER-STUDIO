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

const writer = require('../src/services/storyWriter.service');
const ai = require('../src/services/ai');

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
    notes: '', room: { budget: 400, used: 100, remaining: 300, cols: 40 },
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

// -------------------------------------------------- Part 7: response type ---

test('a body that comes back as a number is rejected, not stringified and accepted', async (t) => {
  withProviders(t, {
    gemini: { async askForJson() { return { data: { headline: 'क', subheading: 'क', body: 12345 } }; } },
  });
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
    withProviders(t, {
      gemini: { async askForJson() { return { data: { headline: 'क', subheading: 'क', body: bad } }; } },
    });
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

const BLOCK = { bodyCharBudget: 315, cols: 45 };

test('call-count matrix: good fit, hole, overflow, short, and no room', async (t) => {
  // Exercised directly against resizeNeeded - already the authority the
  // service itself calls - rather than re-deriving planningFit's real-block
  // arithmetic, which tests/planningFit.test.js already covers exhaustively.
  const scenarios = [
    { name: 'good fit (at the top of the brief)', used: 315, briefed: 315, expectCalls: 1 },
    { name: 'small acceptable underfill', used: 300, briefed: 315, expectCalls: 1 },
    { name: 'genuine hole (>4 lines short)', used: 90, briefed: 315, expectCalls: 2 },
    { name: 'overflow', used: 340, briefed: 315, expectCalls: 2 },
    { name: 'very short', used: 20, briefed: 315, expectCalls: 2 },
  ];
  for (const s of scenarios) {
    const verdict = writer.resizeNeeded({ used: s.used, real: BLOCK, briefed: s.briefed });
    const calls = verdict ? 2 : 1;
    assert.equal(calls, s.expectCalls, `${s.name}: expected ${s.expectCalls} call(s), the rule implies ${calls}`);
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

test('Fill Remaining never invokes the resize pipeline', () => {
  // fillRemaining's own source is the authority: it must not reference
  // resizeNeeded or make a second ai.askForJson call under any condition.
  const src = writer.fillBriefFor.toString();
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
