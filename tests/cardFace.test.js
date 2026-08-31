// A CARD IS SET IN THE FACE IT WAS MEASURED IN - and the desk may choose it.
//
// Two things, and the second could not honestly be offered without the first.
//
// print-model.js set EVERY smart-card line in 'serif' while layoutSmartCard()
// measures a chart, the weather panel and the market table in 'sans'. Those
// cards were therefore fitted in one face and printed in another: measured
// across a chart's own strings, the plate sets them 5-17% narrower than the
// box they were fitted to, worst on Devanagari digits (16.7%), which is
// exactly what a value column is made of.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { smartCardLines } = require('../src/services/export/smart-card-lines');

const ready = async () => {
  const [{ ensureFontsLoaded }, { ensureShaperReady }, layout] = await Promise.all([
    import('../public/editor/compose/font-metrics.js'),
    import('../public/editor/compose/shaper.js'),
    import('../public/editor/smart-cards/layout.js'),
  ]);
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  return layout;
};

const chart = (extra = {}) => ({
  chartType: 'bar', unit: '', source: 'स्रोत : साहस वार्ता',
  items: [{ label: 'सातारा', value: 10000 }, { label: 'वडूज', value: 5000 }],
  ...extra,
});

test('the plate sets a card line in the face the solver measured it in', async () => {
  const cardLayout = await ready();
  const frame = { width: 220, height: 200 };

  // A chart is measured in sans throughout. Every line it emits must say so,
  // or the walk's caller falls back to serif - which is what it used to do.
  const lines = smartCardLines('chart', chart(), frame, cardLayout).filter((l) => !l.kind && l.text);
  assert.ok(lines.length > 0, 'a chart emits lines of type');
  for (const line of lines) {
    assert.equal(line.family, 'sans', `"${line.text}" would print in ${line.family}`);
  }

  // And a card whose reading matter really is serif still says serif, so
  // nothing that was already right changes.
  const quote = smartCardLines('suvichar', { text: 'ज्ञान हेच खरे धन आहे.', credit: 'म्हण' }, frame, cardLayout)
    .filter((l) => !l.kind && l.text);
  assert.ok(quote.some((l) => l.family === 'serif'), 'the thought itself is set in the serif');
});

test('a card may be set in another of the paper\'s faces, and it is MEASURED in it', async () => {
  const { layoutSmartCard } = await ready();
  const frame = { width: 200, height: 160 };

  const paper = layoutSmartCard('chart', chart(), frame);
  const mukta = layoutSmartCard('chart', chart({ family: 'mukta' }), frame);

  assert.equal(paper.family, null, 'a card that chose nothing is in the paper\'s own faces');
  assert.equal(mukta.family, 'mukta');
  assert.ok(mukta.familyCss, 'and states the CSS the canvas draws it with');

  // THE POINT: the label column is measured in the chosen face, so the card is
  // fitted to what it will actually print as. Painting a different face over
  // the same numbers is the two-surface fault this whole module exists to
  // prevent.
  assert.notEqual(paper.geometry.labelWidth, mukta.geometry.labelWidth,
    'a different face must measure to a different width');
});

test('an unknown face resolves to the paper\'s own, and never reaches a renderer', async () => {
  const { layoutSmartCard } = await ready();
  const frame = { width: 200, height: 160 };
  for (const family of ['not-a-face', 'Comic Sans', '<script>', 1, {}]) {
    const solved = layoutSmartCard('chart', chart({ family }), frame);
    assert.equal(solved.family, null, `${JSON.stringify(family)} should not resolve to a face`);
    assert.equal(solved.familyCss, null);
  }
});

test('the substitution is scoped to one solve and cannot leak into the next', async () => {
  const { layoutSmartCard } = await ready();
  const frame = { width: 200, height: 160 };
  const before = layoutSmartCard('chart', chart(), frame).geometry.labelWidth;
  layoutSmartCard('chart', chart({ family: 'tiro' }), frame);
  const after = layoutSmartCard('chart', chart(), frame).geometry.labelWidth;
  assert.equal(after, before, 'the next card was measured in the face the previous one chose');

  // Including when the solve throws - the substitution is cleared in a finally.
  try { layoutSmartCard('chart', chart({ family: 'mukta', items: null }), frame); } catch (error) { /* fine */ }
  assert.equal(layoutSmartCard('chart', chart(), frame).geometry.labelWidth, before);
});

test('the export walk sets a chosen face too, so the plate follows the canvas', async () => {
  const cardLayout = await ready();
  const frame = { width: 220, height: 200 };
  const lines = smartCardLines('chart', chart({ family: 'mukta' }), frame, cardLayout)
    .filter((l) => !l.kind && l.text);
  assert.ok(lines.length > 0);
  for (const line of lines) assert.equal(line.family, 'mukta');
});
