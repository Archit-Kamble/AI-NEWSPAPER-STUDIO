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

test.after(() => pool.end());

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

test('filling an edition writes the panchang block\'s structured card, not just flattened copy', async () => {
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

test('fillEdition always returns structured filled[] and skipped[] arrays', async () => {
  await withFeaturesPage(async ({ newspaper }) => {
    const result = await fillEdition(newspaper.id, {});
    assert.ok(Array.isArray(result.skipped));
    assert.ok(Array.isArray(result.filled));
  });
});

test('filling twice re-fills the card (a deliberate refill), not left stale from the first pass', async () => {
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

test('filling an edition never persists a body longer than the block\'s own real budget', async () => {
  // The trim's own unit tests above are deterministic; this closes the loop
  // against the real AI-written path (rashi) that motivated it - the 1-in-5
  // overset was found by re-running the real fill, not by reasoning about it.
  // One real draw, not the 5 that first surfaced it: each is a real, paid AI
  // call (written.js's whole point is ONE call for the day - CLAUDE.md notes
  // the free tier is 20/day), and the deterministic tests above already prove
  // the trim mechanism itself, every run, without spending any.
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
