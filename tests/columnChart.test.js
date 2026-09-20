// A COLUMN CHART WITH CALLOUTS - the shape a printed feature panel uses when
// each reading needs a sentence beside it.
//
// The front page's own feature was set as bare percentages, and a bar chart
// was the near miss: it carries the columns and cannot carry the sentence,
// while a stat panel carries the sentence and not the columns. This kind
// carries both, and everything below is the property that matters for a
// newspaper - the canvas and the plate draw the SAME chart, and a panel of
// readings is not allowed to inflate into a poster.

const test = require('node:test');
const assert = require('node:assert/strict');

const CARD = {
  chartType: 'column',
  unit: '%',
  source: 'स्रोत : चाचणी',
  items: [
    { label: 'एक', value: 74 },
    { label: 'दोन', value: 65 },
    { label: 'तीन', value: 48 },
  ],
};

let layout;
let smartCards;
let lines;

test.before(async () => {
  require('../public/editor/layout/typefaces.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  await metrics.ensureFontsLoaded();
  layout = await import('../public/editor/smart-cards/layout.js');
  smartCards = await import('../public/editor/smart-cards/smart-cards.js');
  ({ smartCardLines: lines } = require('../src/services/export/smart-card-lines.js'));
});

const solve = (card = CARD, frame = { width: 82, height: 121 }) => layout.layoutSmartCard('chart', card, frame);

test('every reading gets a column, a leader and a callout, and they are in order', () => {
  const solved = solve();
  assert.equal(solved.fitState, 'FITS');
  assert.equal(solved.items.length, 3);
  const g = solved.geometry;
  assert.equal(g.chartType, 'column');
  // A column's height is its share of the largest reading.
  const [first, second, third] = solved.items;
  assert.ok(first.barHeight > second.barHeight && second.barHeight > third.barHeight);
  assert.ok(Math.abs(first.barHeight - g.plotHeight) < 0.01, 'the largest reading fills the plot');
  // Every column stands on the plot's foot.
  for (const item of solved.items) {
    assert.ok(Math.abs((item.barTop + item.barHeight) - g.plotHeight) < 0.01, 'a column stands on the foot');
  }
  // The callouts run down the page in the readings' own order and never overlap.
  for (let i = 1; i < solved.items.length; i += 1) {
    assert.ok(solved.items[i].top >= solved.items[i - 1].top + solved.items[i - 1].height - 0.01,
      'callouts may not overlap');
  }
  // Each leader runs from its own column's top to its own callout.
  solved.items.forEach((item) => {
    const [[x1, y1], [x2]] = item.leader;
    assert.ok(Math.abs(y1 - item.barTop) < 0.01);
    assert.ok(x1 > 0 && x2 > x1, 'the leader runs outward to the callout');
  });
});

// The fault this cost an hour to find: the solver capped the type and the
// renderers drew at the size it would have used without the cap, so the
// captions were set larger than the box they were wrapped for.
test('the captions are drawn at the size they were MEASURED at', () => {
  const solved = solve();
  const g = solved.geometry;
  assert.ok(g.columnPx > 0, 'the measured size is stated');
  assert.ok(g.columnPx <= solved.fontPx + 0.01, 'and it is a cap, never a growth');
  const markup = smartCards.smartCardMarkup('chart', CARD, { width: 82, height: 121, padding: 0 });
  assert.ok(markup.includes('smart-chart-columns'));
  assert.ok(markup.includes(`font-size:${g.columnPx}px`), 'the canvas sets the caption at the measured size');
  assert.ok(markup.includes(`font-size:${g.figurePx}px`), 'and the figure at the solved figure size');
});

test('a panel of readings is not a poster', () => {
  // Three short captions leave room for type far larger than a newspaper sets
  // a caption in. Given a much taller box the chart must NOT inflate.
  const roomy = solve(CARD, { width: 200, height: 600 });
  const tight = solve(CARD, { width: 82, height: 121 });
  assert.ok(roomy.geometry.columnPx <= tight.geometry.columnPx + 0.6,
    `a bigger box must not inflate the caption (${tight.geometry.columnPx} -> ${roomy.geometry.columnPx})`);
});

test('the plate draws the same chart as the canvas', () => {
  const solved = solve();
  const g = solved.geometry;
  const items = lines('chart', CARD, { width: 82, height: 121 }, layout);
  const bars = items.filter((item) => item.kind === 'bar');
  const polys = items.filter((item) => item.kind === 'poly');
  const texts = items.filter((item) => !item.kind && item.text);
  assert.equal(bars.length, 3, 'one column per reading');
  // A leader and a dot for each reading.
  assert.ok(polys.length >= 6, `expected a leader and a dot per reading, got ${polys.length}`);
  // Every figure, every caption and the source.
  for (const item of solved.items) {
    assert.ok(texts.some((t) => t.text === item.valueText), `the plate prints ${item.valueText}`);
    assert.ok(texts.some((t) => t.text === item.label), `the plate prints ${item.label}`);
  }
  assert.ok(texts.some((t) => t.text === CARD.source), 'and the source');
  // The source is set at the measured size too - at the uncapped size it
  // printed straight across the columns.
  const source = texts.find((t) => t.text === CARD.source);
  assert.ok(source.fontPx <= g.columnPx + 0.01);
});

test('an unknown chart type still falls back to bars, and a bar chart is unchanged', () => {
  const bar = layout.layoutSmartCard('chart', { ...CARD, chartType: 'bar' }, { width: 82, height: 121 });
  assert.equal(bar.geometry.chartType, 'bar');
  const unknown = layout.layoutSmartCard('chart', { ...CARD, chartType: 'sideways' }, { width: 82, height: 121 });
  assert.equal(unknown.geometry.chartType, 'bar');
});
