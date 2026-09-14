// A cut made for a tight pitch sets at the leading it was measured at.
//
// The reference rails were measured at 1.19-1.28 em in mukta-text, and the
// compositor floored them at the unmeasured-face 1.45, so every rail set a
// fifth looser than the printed page. typefaces.js's pitchFloorEm is that
// cut's own floor; no other face carries one, so nothing else may move.

const test = require('node:test');
const assert = require('node:assert/strict');

test('mukta-text keeps a measured tight pitch, in the draft and in the compositor', async () => {
  require('../public/editor/layout/typefaces.js');
  const { draftFromSection } = await import('../public/editor/section-model.js');
  const { minLineHeightFor, ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  await ensureFontsLoaded();

  assert.equal(minLineHeightFor('mukta-text', 400), 1.11);
  assert.equal(minLineHeightFor('mukta-text', 700), 1.11);
  assert.equal(draftFromSection({ font_family: 'mukta-text', line_height: 1.19 }).lineHeight, 1.19);
  // Still a floor: nothing is set tighter than the cut's own line box.
  assert.equal(draftFromSection({ font_family: 'mukta-text', line_height: 1.0 }).lineHeight, 1.11);
});

test('every other face floors exactly as before', async () => {
  require('../public/editor/layout/typefaces.js');
  const { draftFromSection } = await import('../public/editor/section-model.js');
  const { minLineHeightFor, ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { MIN_MEASURED_LINE_HEIGHT } = await import('../public/editor/layout/text-flow.js');
  await ensureFontsLoaded();

  assert.equal(minLineHeightFor('sans', 400), 1.305);
  assert.ok(minLineHeightFor('serif', 400) >= 1.45);
  assert.ok(minLineHeightFor('mukta', 400) >= 1.45);
  for (const family of ['serif', 'sans', 'mukta', 'khand', 'mukta-heavy', undefined]) {
    assert.equal(draftFromSection({ font_family: family, line_height: 1.0 }).lineHeight, MIN_MEASURED_LINE_HEIGHT, String(family));
  }
});

// A block that states its leading keeps it; every other block still bottoms
// its column out by opening the leading a little (vertical justification).
test("leading_policy 'fixed' keeps the stated pitch, and NULL still fills the column", async () => {
  require('../public/editor/layout/typefaces.js');
  const fm = await import('../public/editor/compose/font-metrics.js');
  const sh = await import('../public/editor/compose/shaper.js');
  await Promise.all([fm.ensureFontsLoaded(), sh.ensureShaperReady()]);
  const { composeSection } = await import('../public/editor/compose/section-adapter.js');
  const body = 'सातारा शहरातील नागरिकांनी आज सकाळी स्वच्छता मोहीम राबवली. नगरपालिकेच्या कर्मचाऱ्यांनीही यात भाग घेतला. मोहिमेत शाळकरी मुलेही सहभागी झाली.';
  const row = { section_key: 'probe', block_type: 'article', width_px: 70, height_px: 118, body,
    font_family: 'sans', body_font_px: 6, line_height: 1.4, column_count: 1, margin_px: 1, text_align: 'left', show_dateline: false };
  const pitches = (section) => {
    const ys = [...new Set(composeSection(section, {}).bodyLines.map((l) => Number(l.y.toFixed(3))))].sort((a, b) => a - b);
    return ys.slice(1).map((y, i) => y - ys[i]);
  };
  const fixed = pitches({ ...row, leading_policy: 'fixed' });
  assert.ok(fixed.length >= 3);
  for (const gap of fixed) assert.ok(Math.abs(gap - 8.4) < 0.01, `fixed gap ${gap}`);
  const filled = pitches(row);
  assert.ok(filled.some((gap) => gap > 8.41), 'the unset policy still opens the leading');
});
