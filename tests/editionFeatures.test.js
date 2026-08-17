// editionFeatures.service.js's fillEdition(): "Fill features" is the one bulk
// action a desk presses every morning to seed राशिभविष्य, पंचांग, दिनविशेष and
// सुविचार for the day - and it had no functional test at all (press.test.js
// only checks the route is behind sign-in).
//
// Project A found a real gap while building the realistic test edition: every
// feature builder (src/features/{sudoku,written,panchang,dinvishesh}.js)
// produces a structured `card` payload beside its flattened `items`, and this
// service discarded it - writing only flattened copy, so a block "Fill
// features" filled NEVER carried a real Smart Card, silently, in every
// edition. These tests hold the fix, using पंचांग (`panchang`) - the one
// template-wired feature that is both `source: 'computed'` (no AI call,
// deterministic for a given date and place) and actually placed on the
// 'features' template (templates.js), unlike sudoku, which is built and
// tested (tests/production.test.js) but not wired into any layout block.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');
const { fillEdition, toCopy } = require('../src/services/editionFeatures.service');
const panchang = require('../src/features/panchang');
const ai = require('../src/services/ai');

test.after(() => pool.end());

// `fillEdition()` calls features.buildAll(), which calls written.js's ONE
// model call for the day's राशिभविष्य/सुविचार bundle (src/features/written.js).
// Every test in this file that calls fillEdition() therefore used to make a
// real, paid AI call whenever a real key happened to be configured in
// `.env` - and silently fell back to "the box was skipped" whenever it was
// not, which is exactly how the one assertion below went from a passing
// review-status check to `actual: undefined`: rashi/suvichar were never in
// `result.filled` at all, because written.buildAll() had errored and
// features.buildAll() only ever assembles it, never fakes it (src/features/
// index.js: `if (composed.error) notes.push(...)` - no feature is added).
//
// installAiStub() replaces the provider chain with a deterministic stub, so
// this file never depends on a real key, real network, provider
// availability or today's `.env`. Applied to every fillEdition() test below,
// not only the one that was failing - a suite whose tests are silently
// re-billed (or silently degrade to "skipped") on every run depending on
// whoever's `.env` happens to be sitting in the checkout is not a
// deterministic suite, whether or not any one assertion happens to notice.
const RASHI_KEYS = [
  'mesh', 'vrishabh', 'mithun', 'kark', 'sinh', 'kanya',
  'tula', 'vrischik', 'dhanu', 'makar', 'kumbh', 'meen',
];

function writtenFeatureReply() {
  return {
    data: {
      rashi: RASHI_KEYS.map((key, index) => ({
        key,
        text: `आजचा चाचणी मजकूर ${index + 1}.`,
        lucky_number: (index % 9) + 1,
        lucky_colour: 'निळा',
      })),
      suvichar: {
        text: 'परिश्रम आणि संयम यांना पर्याय नाही.',
        attribution: 'अज्ञात',
      },
    },
  };
}

/**
 * Stubs the AI provider chain with a deterministic, schema-valid written
 * reply, exactly like tests/aiConditions.test.js's withProviders() and
 * tests/geminiPrimary.test.js's own PROVIDERS stub - the same pattern this
 * codebase already uses to keep AI-touching tests off the network. Returns a
 * call counter so a caller can assert the ONE-call-per-day promise
 * (src/features/written.js's whole reason to exist) rather than just trust
 * it.
 */
function installAiStub(t) {
  const savedProviders = { ...ai.PROVIDERS };
  const savedProvider = process.env.AI_PROVIDER;
  const savedFallback = process.env.AI_FALLBACK_PROVIDER;
  const calls = { count: 0 };

  ai.PROVIDERS.gemini = {
    key: 'gemini',
    name: 'Gemini test stub',
    supportsTiers: true,
    isConfigured: () => true,
    configHint: '',
    maxOutputTokens: (value) => value || 8192,
    async askForJson() {
      calls.count += 1;
      return writtenFeatureReply();
    },
  };

  process.env.AI_PROVIDER = 'gemini';
  process.env.AI_FALLBACK_PROVIDER = '';

  t.after(() => {
    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, savedProviders);
    if (savedProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = savedProvider;
    if (savedFallback === undefined) delete process.env.AI_FALLBACK_PROVIDER;
    else process.env.AI_FALLBACK_PROVIDER = savedFallback;
  });

  return calls;
}

/**
 * The opposite stub: no provider answers `isConfigured()` truthfully, no
 * matter what is actually sitting in `.env` on the machine running this
 * suite. Used by the no-AI failure-mode test below - real isolation, not
 * "hope nobody has a key configured".
 */
function installNoProviderStub(t) {
  const saved = { ...ai.PROVIDERS };
  for (const key of Object.keys(ai.PROVIDERS)) {
    ai.PROVIDERS[key] = { ...ai.PROVIDERS[key], isConfigured: () => false };
  }
  t.after(() => {
    for (const key of Object.keys(ai.PROVIDERS)) delete ai.PROVIDERS[key];
    Object.assign(ai.PROVIDERS, saved);
  });
}

async function withFeaturesPage(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk.json('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'editionFeatures test', publicationDate: '2026-01-15' }),
    });
    const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
      body: JSON.stringify({ pageNumber: 1, templateKey: 'features' }),
    });
    await run({ desk, newspaper, page });
  } finally {
    await removeEdition(newspaper?.id);
    server.close();
  }
}

test('filling an edition writes the panchang block\'s structured card, not just flattened copy', async (t) => {
  installAiStub(t);
  await withFeaturesPage(async ({ newspaper, page }) => {
    const result = await fillEdition(newspaper.id, {});
    assert.ok(result.filled.some((f) => f.feature === 'panchang'), JSON.stringify(result));

    const { rows } = await pool.query(
      `SELECT * FROM page_sections WHERE page_id = $1 AND section_key = 'panchang'`,
      [page.id],
    );
    const block = rows[0];
    assert.ok(block, 'no panchang block found on the features page');
    assert.equal(block.smart_card_key, 'panchang');
    assert.ok(block.smart_card_data, 'smart_card_data must be set');
    assert.ok(Array.isArray(block.smart_card_data.items) && block.smart_card_data.items.length > 0,
      'the real structured items, not a flattened string');

    const expected = await panchang.build(String(newspaper.publication_date).slice(0, 10));
    assert.deepEqual(block.smart_card_data, expected.card, 'the same card panchang.build() produces for this date');

    // The flattened body still exists too - everything that measures a block
    // (character grid, worklist, preflight, fit) reads body text.
    assert.ok(block.body && block.body.length > 0, 'flattened copy must still be written');
    assert.equal(block.headline, 'सूर्योदय - सूर्यास्त');
  });
});

test('fillEdition always returns structured filled[] and skipped[] arrays', async (t) => {
  installAiStub(t);
  await withFeaturesPage(async ({ newspaper }) => {
    const result = await fillEdition(newspaper.id, {});
    assert.ok(Array.isArray(result.skipped));
    assert.ok(Array.isArray(result.filled));
  });
});

test('filling twice re-fills the card (a deliberate refill), not left stale from the first pass', async (t) => {
  installAiStub(t);
  await withFeaturesPage(async ({ newspaper, page }) => {
    await fillEdition(newspaper.id, {});
    // Hand-corrupt the card, as if a desk had cleared it.
    await pool.query(
      `UPDATE page_sections SET smart_card_key = NULL, smart_card_data = NULL WHERE page_id = $1 AND section_key = 'panchang'`,
      [page.id],
    );
    await fillEdition(newspaper.id, {});
    const { rows } = await pool.query(
      `SELECT smart_card_key FROM page_sections WHERE page_id = $1 AND section_key = 'panchang'`,
      [page.id],
    );
    assert.equal(rows[0].smart_card_key, 'panchang');
  });
});

test('model-written standing features need review while computed and curated features are ready', async (t) => {
  const calls = installAiStub(t);
  await withFeaturesPage(async ({ newspaper, page }) => {
    const result = await fillEdition(newspaper.id, {});
    const statuses = new Map(result.filled.map((item) => [item.feature, item.status]));
    assert.equal(statuses.get('rashi'), 'needs_review');
    assert.equal(statuses.get('suvichar'), 'needs_review');
    assert.equal(statuses.get('panchang'), 'ready');

    // written.js's whole reason to exist: the day's राशिभविष्य AND सुविचार
    // come back from ONE model call, not one call per box (and certainly
    // not one per zodiac sign) - src/features/index.js's buildAll() calls
    // written.buildAll() exactly once per fillEdition(), and this is what
    // would catch a regression back to a call-per-feature.
    assert.equal(calls.count, 1, 'exactly one model-written bundle call for the whole edition, not one per feature');

    const { rows } = await pool.query(`SELECT feature_key,status FROM page_sections WHERE page_id=$1 AND feature_key IS NOT NULL`, [page.id]);
    assert.equal(rows.find((item) => item.feature_key === 'rashi').status, 'needs_review');
    assert.equal(rows.find((item) => item.feature_key === 'suvichar').status, 'needs_review');
    assert.equal(rows.find((item) => item.feature_key === 'panchang').status, 'ready');
  });
});

// The other half of the contract: with no AI provider answering at all
// (installNoProviderStub() - real isolation from whatever `.env` on this
// machine actually holds, not merely "no key configured today"), the
// computed/curated features must still fill, the written ones must be
// reported as skipped with a reason a desk can act on, and - the one thing
// that must never happen - no fake horoscope may be written under a paper's
// masthead. No network call is made: the stub never reaches past
// `isConfigured()`.
test('with no AI provider configured, computed/curated features still fill and no fake horoscope is produced', async (t) => {
  installNoProviderStub(t);
  await withFeaturesPage(async ({ newspaper, page }) => {
    const result = await fillEdition(newspaper.id, {});

    const filledKeys = result.filled.map((item) => item.feature);
    assert.ok(filledKeys.includes('panchang'), 'a computed feature must still fill with no AI provider');
    assert.ok(!filledKeys.includes('rashi'), 'no fake horoscope may be produced without a real model call');
    assert.ok(!filledKeys.includes('suvichar'), 'no fake thought-for-the-day may be produced without a real model call');

    const skippedKeys = result.skipped.map((item) => item.feature);
    assert.ok(skippedKeys.includes('rashi'), 'rashi must be reported as skipped, not silently absent');
    assert.ok(skippedKeys.includes('suvichar'), 'suvichar must be reported as skipped, not silently absent');
    const rashiSkip = result.skipped.find((item) => item.feature === 'rashi');
    assert.match(rashiSkip.reason, /AI/i, 'the skip reason must tell a desk why, not just that it happened');

    const { rows } = await pool.query(
      `SELECT feature_key, body, smart_card_data FROM page_sections WHERE page_id = $1 AND feature_key IS NOT NULL`,
      [page.id],
    );
    const rashiRow = rows.find((item) => item.feature_key === 'rashi');
    assert.ok(!rashiRow.body, 'the rashi block must not be written to with invented copy');
    assert.equal(rashiRow.smart_card_data, null, 'no invented Smart Card either');
    const panchangRow = rows.find((item) => item.feature_key === 'panchang');
    assert.ok(panchangRow.body, 'panchang - computed, no AI needed - must still be filled');
  });
});

// toCopy()'s trim-to-fit: राशिभविष्य/सुविचार are AI-written (written.js), and
// the brief already asks the model for a per-sign character ceiling - but a
// brief is a request, not a guarantee. Re-running "Fill features" against the
// same real block during this pass's re-verification landed the rashi card
// over its own budget on one run in five, live, unprompted. This is the
// safety net: whole entries are dropped from the tail (never a mid-sentence
// cut) until the flattened body actually fits the real measured budget,
// exactly as CLAUDE.md documents for storyWriter.service.js's own resize
// guarantee on ordinary story blocks - the same invariant, extended to cover
// the one AI-written path that had no such protection at all.

test('toCopy: a body within budget is returned whole, nothing dropped', () => {
  const result = { title: 'शीर्षक', items: [{ text: 'छोटी नोंद.' }, { text: 'आणखी एक छोटी नोंद.' }] };
  const copy = toCopy(result, 200);
  assert.equal(copy.entriesDropped, 0);
  assert.ok(copy.body.length <= 200);
});

test('toCopy: a body over budget drops whole trailing entries, never mid-sentence, until it fits', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    label: `चिन्ह${i}`,
    text: 'ही एक लांब वाक्य आहे जी अक्षरे मोजण्यासाठी वापरली जाते.',
    note: 'शुभ अंक ७, शुभ रंग निळा',
  }));
  const result = { title: 'आजचे राशिभविष्य', items };
  const full = toCopy(result);
  assert.equal(full.entriesDropped, 0, 'no budget given - nothing is dropped');

  const capped = toCopy(result, 200);
  assert.ok(capped.body.length <= 200, `still over budget: ${capped.body.length}`);
  assert.ok(capped.entriesDropped > 0);
  // Every remaining line is one of the ORIGINAL, untouched entries - no line
  // was cut mid-word to make it fit.
  const keptLines = capped.body.split('\n').filter(Boolean);
  const originalLines = full.body.split('\n');
  for (const line of keptLines) assert.ok(originalLines.includes(line), `not a whole original entry: ${line}`);
});

test('toCopy: a budget too small for even one entry drops everything rather than write a partial line', () => {
  const result = { title: 'शीर्षक', items: [{ text: 'ही एक बऱ्यापैकी लांब ओळ आहे जी बसणार नाही.' }] };
  const copy = toCopy(result, 5);
  assert.equal(copy.body, '');
  assert.equal(copy.entriesDropped, 1);
});

test('filling an edition never persists a body longer than the block\'s own real budget', async (t) => {
  // The trim's own unit tests above are deterministic and prove the trim
  // mechanism itself, every run, without spending an AI call. This test
  // closes the loop against the real fillEdition() path with the
  // deterministic stub (installAiStub()) rather than a real call - the 1-in-5
  // overset that originally motivated the trim was found once, live, against
  // a real account; it does not need to be re-drawn from a paid API on every
  // suite run to stay covered.
  installAiStub(t);
  await withFeaturesPage(async ({ newspaper, page }) => {
    const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
    await fillEdition(newspaper.id, {});
    const { rows } = await pool.query(
      `SELECT * FROM page_sections WHERE page_id = $1 AND feature_key IS NOT NULL`,
      [page.id],
    );
    for (const block of rows) {
      if (!block.body) continue;
      const map = buildFlowMap(block, {
        marginPx: Number(block.margin_px) || 12,
        lineHeight: Number(block.line_height) || 1.25,
        headline: block.headline || '',
        headlineFontPx: Number(block.headline_font_px),
        subheading: block.subheading || '',
        subheadingFontPx: Number(block.subheading_font_px),
        body: '',
        bodyFontPx: Number(block.body_font_px),
      });
      assert.ok(
        block.body.length <= map.bodyCharBudget,
        `${block.section_key}: ${block.body.length} chars, budget ${map.bodyCharBudget}`,
      );
    }
  });
});
