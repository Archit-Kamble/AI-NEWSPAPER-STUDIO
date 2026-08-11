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
const { fillEdition } = require('../src/services/editionFeatures.service');
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
