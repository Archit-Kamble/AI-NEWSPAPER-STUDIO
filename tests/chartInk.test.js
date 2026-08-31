// A CHART'S READINGS EACH CHOOSE THEIR OWN INK, AND A CHART TAKES ONLY THE
// ROOM ITS READINGS NEED.
//
// Both were reported off one screen recording of a real 307x296 anchor: three
// bars measuring three different quantities, all three the same black, sitting
// in the top third of a quarter-block panel with the rest of it dead white.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/editor/smart-cards/layout.js');
const ready = async () => {
  const [{ ensureFontsLoaded }, { ensureShaperReady }] = await Promise.all([
    import('../public/editor/compose/font-metrics.js'),
    import('../public/editor/compose/shaper.js'),
  ]);
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
};

const RED = '#c8102e';
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  label: ['सातारा', 'वडूज', 'पुसेगाव', 'कराड', 'फलटण', 'कोरेगाव'][i],
  value: (6 - i) * 1700,
}));
const card = (n, extra = {}) => ({ chartType: 'bar', unit: 'टक्के', items: rows(n), ...extra });

test('a reading may name its own ink, and an unrecognised one can never reach a plate', async () => {
  const { rowInk } = await load();

  // ABSENT MEANS THE CHART'S OWN, and that is what every stored chart means
  // today - so this is additive and no existing card changes.
  assert.equal(rowInk({}, 0, RED, 'bar'), RED);
  assert.equal(rowInk({ ink: '' }, 0, RED, 'bar'), RED);
  // A pie still tints its slices apart, which is what a printed pie does.
  assert.notEqual(rowInk({}, 1, RED, 'pie'), RED);

  assert.equal(rowInk({ ink: '#17458f' }, 0, RED, 'bar'), '#17458f');
  assert.equal(rowInk({ ink: '#0a7a3f' }, 0, RED, 'bar'), '#0a7a3f');
  // Black is the absence of a plate and carries no hex in the catalogue, so it
  // is asked for by name - the same way chartInk() already asks.
  assert.equal(rowInk({ ink: 'black' }, 0, RED, 'bar'), '#111111');

  // A PRESS HAS FOUR PLATES. A colour mixed in a browser is one no press can
  // lay down, so it is refused here and falls back rather than being drawn.
  assert.equal(rowInk({ ink: '#ff00ff' }, 0, RED, 'bar'), RED);
  assert.equal(rowInk({ ink: 'rgb(255,0,255)' }, 0, RED, 'bar'), RED);
  assert.equal(rowInk({ ink: 'javascript:x' }, 0, RED, 'bar'), RED);
});

test('every chart kind carries a resolved ink on every item, so no renderer decides one', async () => {
  await ready();
  const { layoutSmartCard } = await load();
  for (const chartType of ['bar', 'pie', 'line', 'dots', 'stat']) {
    const solved = layoutSmartCard('chart', card(4, { chartType }), { width: 220, height: 200 });
    assert.equal(solved.items.length, 4, chartType);
    for (const item of solved.items) {
      assert.match(String(item.ink), /^#[0-9a-f]{6}$/i, `${chartType} item has no resolved ink`);
    }
  }
});

test('the readings that name a colour get it; the ones that do not keep the chart\'s', async () => {
  await ready();
  const { layoutSmartCard } = await load();
  const solved = layoutSmartCard('chart', {
    chartType: 'bar',
    items: [
      { label: 'सातारा', value: 10000, ink: '#17458f' },
      { label: 'वडूज', value: 5000, ink: '#0a7a3f' },
      { label: 'पुसेगाव', value: 2000 },
    ],
  }, { width: 220, height: 200 });
  assert.deepEqual(solved.items.map((i) => i.ink), ['#17458f', '#0a7a3f', RED]);
});

test('a chart states the height its readings actually need', async () => {
  await ready();
  const { layoutSmartCard } = await load();
  const frame = { width: 154, height: 148 };
  const heights = [2, 3, 4, 6].map((n) =>
    layoutSmartCard('chart', card(n), frame).geometry.contentHeight);

  for (const h of heights) assert.ok(h > 0, 'a chart with readings has a content height');
  // FEWER READINGS NEED LESS ROOM. This is the whole point: the panel used to
  // reserve its share whether it held three readings or twelve, so a quarter
  // of a 307x296 block was 148px deep for three bars that need 94.
  assert.ok(heights[0] < heights[1], `2 readings (${heights[0]}) should need less than 3 (${heights[1]})`);
  assert.ok(heights[1] < heights[2], `3 readings (${heights[1]}) should need less than 4 (${heights[2]})`);
  // And it is a real saving on the block the desk reported.
  assert.ok(heights[1] < frame.height * 0.8,
    `3 readings need ${heights[1].toFixed(1)}px of a ${frame.height}px panel - the rest was standing empty`);
});

test('an empty chart states no height, so a panel keeps the share it asked for', async () => {
  await ready();
  const { layoutSmartCard } = await load();
  const solved = layoutSmartCard('chart', { chartType: 'bar', items: [] }, { width: 154, height: 148 });
  assert.equal(solved.fitState, 'EMPTY');
});
