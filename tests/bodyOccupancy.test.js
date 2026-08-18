// How full is the body? In WEIGHTED USABLE GEOMETRY, never in fragments.
//
// `bodyLines.length` is a count of placed text runs, and around a cut-out
// standing clear of both edges one physical row of type is two of them:
// pourBody()'s fillRow() sets every legal gap on a row, and each becomes its
// own entry. Nine entries for six physical rows was measured on a real
// centre-standing silhouette - and each of those nine was a half-measure
// fragment being counted as a whole line.
//
// That number was divided into the character count to calibrate what the AI
// was asked to write next, so the error did not stay in the read-out: it
// propagated into the copy. It also read 44% full where the geometry says
// 29%, on exactly the transparent-cut-out case this product is built around.
//
// The existing tapered-cut-out fixture in copyFit.test.js does NOT prove this
// bug: it sits flush against the block's left edge, so it narrows one
// corridor rather than splitting a row in two. This file exists to hold the
// split.

const test = require('node:test');
const assert = require('node:assert/strict');

let adapter;
let composeBlock;

test.before(async () => {
  adapter = await import('../public/editor/compose/section-adapter.js');
  ({ composeBlock } = await import('../public/editor/compose/compose.js'));
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
});

const SENTENCE = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे. ';

/** A mask whose opaque subject stands in the middle, clear of both edges. */
function centreSplitMask(halfCells = 3) {
  const cols = 20;
  const rows = 20;
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    const row = [];
    for (let x = 0; x < cols; x += 1) row.push(Math.abs(x - (cols - 1) / 2) <= halfCells ? 1 : 0);
    cells.push(row);
  }
  return { cols, rows, cells };
}

/** A mask whose subject leans to one side but still leaves both corridors. */
function asymmetricMask() {
  const cols = 20;
  const rows = 20;
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    const lean = Math.round(3 * (y / rows));
    const row = [];
    for (let x = 0; x < cols; x += 1) row.push(x >= 5 + lean && x <= 12 + lean ? 1 : 0);
    cells.push(row);
  }
  return { cols, rows, cells };
}

function cutout(mask, over = {}) {
  return {
    x_px: 40, y_px: 60, width_px: 200, height_px: 160,
    shape: 'cutout', rotation: 0, stand_off_px: 4, fit_mode: 'contain',
    source_width_px: 200, source_height_px: 160, mask, ...over,
  };
}

const SECTION = {
  width_px: 280, height_px: 320, margin_px: 10, column_count: 1,
  line_height: 1.3, headline_font_px: 20, subheading_font_px: 12, body_font_px: 10,
};

const CASES = [
  { name: 'no image', section: SECTION, images: [] },
  {
    name: 'rectangular image',
    section: SECTION,
    images: [{ x_px: 40, y_px: 60, width_px: 200, height_px: 120, shape: 'rect', rotation: 0, stand_off_px: 4 }],
  },
  { name: 'centre-split cut-out', section: SECTION, images: [cutout(centreSplitMask())] },
  { name: 'asymmetric cut-out', section: SECTION, images: [cutout(asymmetricMask())] },
  { name: 'cut-out rotated 90 degrees', section: SECTION, images: [cutout(centreSplitMask(), { rotation: 90 })] },
  {
    name: 'two-column section',
    section: { ...SECTION, width_px: 480, column_count: 2 },
    images: [cutout(centreSplitMask(), { x_px: 120, width_px: 240 })],
  },
];

function compose(block, body) {
  return adapter.composeSection({ ...block.section, images: block.images }, { headline: '', subheading: '', body });
}

/**
 * Occupied equivalents recomputed from the placed lines themselves - an
 * independent second opinion on the accumulator, derived from a different
 * part of the result. A gap that received type counts its whole MEASURE, not
 * the width its glyphs reached: a ragged right end is how type is set.
 */
function occupiedFromLines(result) {
  const columnWidths = (result.columns || []).map((c) => c.end - c.start);
  return (result.bodyLines || []).reduce((sum, line) => {
    const owning = columnWidths.find((w, i) => {
      const col = result.columns[i];
      return line.x >= col.start - 0.5 && line.x <= col.end + 0.5;
    }) || columnWidths[0] || 1;
    return sum + line.measure / owning;
  }, 0);
}

test('a centre-standing cut-out splits ONE physical row into several fragments - the case the old count could not see', () => {
  const block = CASES.find((c) => c.name === 'centre-split cut-out');
  const result = compose(block, SENTENCE.repeat(4));

  const rows = new Set(result.bodyLines.map((line) => line.y.toFixed(1)));
  assert.ok(result.bodyLines.length > rows.size,
    `the fixture must actually split rows: ${result.bodyLines.length} fragments over ${rows.size} rows`);

  const fill = adapter.bodyFill(result);
  // The whole point: fragments over-count, so the honest occupancy is lower.
  assert.equal(fill.renderedFragments, result.bodyLines.length);
  assert.ok(fill.occupiedEquivalentLines < fill.renderedFragments,
    `occupancy ${fill.occupiedEquivalentLines} must be below the fragment count ${fill.renderedFragments}`);
  // And it is not a token difference - a halved row is half a line.
  assert.ok(fill.occupiedEquivalentLines < rows.size + 0.5,
    `occupancy ${fill.occupiedEquivalentLines} may not exceed the ${rows.size} physical rows it was set on`);
});

test('fill follows weighted usable geometry, on every block shape', () => {
  for (const block of CASES) {
    const result = compose(block, SENTENCE.repeat(4));
    const fill = adapter.bodyFill(result);

    assert.equal(fill.occupiedEquivalentLines, Number(occupiedFromLines(result).toFixed(2)),
      `${block.name}: the accumulator and the placed lines must agree`);
    assert.ok(fill.availableEquivalentLines >= fill.occupiedEquivalentLines - 0.01, `${block.name}: available >= occupied`);
    assert.ok(fill.ratio >= 0 && fill.ratio <= 1, `${block.name}: ratio in range`);
    assert.equal(fill.linesUsed, fill.occupiedEquivalentLines, `${block.name}: the alias carries the occupancy`);
    assert.equal(fill.holeLines, fill.emptyEquivalentLines, `${block.name}: the hole alias carries the occupancy`);
  }
});

test('an unobstructed row counts exactly one line, so a plain block is unchanged by any of this', () => {
  const block = CASES.find((c) => c.name === 'no image');
  const result = compose(block, SENTENCE.repeat(4));
  const fill = adapter.bodyFill(result);
  // Nothing splits a row here, so fragments and lines are the same thing and
  // every one of them is a whole measure.
  assert.equal(fill.renderedFragments, result.bodyLines.length);
  assert.ok(Math.abs(fill.occupiedEquivalentLines - fill.renderedFragments) < 0.01,
    `${fill.occupiedEquivalentLines} should equal ${fill.renderedFragments} with nothing in the way`);
});

test('a block filled to its foot reads as full, and an empty one as empty', () => {
  for (const block of CASES) {
    const empty = adapter.bodyFill(compose(block, ''));
    assert.equal(empty.occupiedEquivalentLines, 0, `${block.name}: nothing set`);
    assert.equal(empty.ratio, 0, `${block.name}: an empty block is 0% full`);
    assert.ok(empty.emptyEquivalentLines > 0, `${block.name}: and all of its room is free`);

    const full = adapter.bodyFill(compose(block, SENTENCE.repeat(60)));
    assert.ok(full.emptyEquivalentLines < 1,
      `${block.name}: a block poured past its own foot has under a line free, got ${full.emptyEquivalentLines}`);
    assert.ok(full.ratio > 0.9, `${block.name}: and reads as full, got ${full.ratio}`);
  }
});

test('paragraph air is intentional space, never a hole somebody is asked to fill', () => {
  const section = { ...SECTION, paragraph_spacing_px: 24 };
  const spaced = adapter.composeSection({ ...section, images: [] },
    { headline: '', subheading: '', body: `${SENTENCE}\n\n${SENTENCE}\n\n${SENTENCE}` });
  const tight = adapter.composeSection({ ...section, paragraph_spacing_px: 0, images: [] },
    { headline: '', subheading: '', body: `${SENTENCE}\n\n${SENTENCE}\n\n${SENTENCE}` });

  assert.ok(spaced.whitespace.occupancy.intentionalEquivalentLines > 0,
    'the air a paragraph break asks for must be recorded as intentional');
  assert.equal(tight.whitespace.occupancy.intentionalEquivalentLines, 0,
    'with no paragraph spacing there is no intentional air');
  // The desk must not be offered "fill this" for room the stylesheet took.
  assert.ok(spaced.whitespace.occupancy.emptyEquivalentLines <= tight.whitespace.occupancy.emptyEquivalentLines + 0.01,
    'paragraph air may not inflate the fillable hole');
});
