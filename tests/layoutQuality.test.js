const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeLayout } = require('../src/layout/layout-quality');
const { validatePageLayout } = require('../src/services/preflight.service');
const { geometryOf } = require('../src/layout/geometry');

const G = geometryOf({});
const CONTENT = G.regions.inside.content;
const LEFT = G.marginXPx;
const TOP = CONTENT.top;
const WIDTH = G.matterWidthPx;
const HEIGHT = CONTENT.bottom - CONTENT.top;

function page(sections, pageNumber = 2) {
  return { page_number: pageNumber, prints_colour: true, sections };
}

function section(overrides = {}) {
  return {
    section_key: 'section', block_type: 'article', x_px: LEFT, y_px: TOP,
    width_px: 100, height_px: 100, headline: 'भरलेला विभाग', body: '', images: [],
    ...overrides,
  };
}

test('a densely filled valid page has high occupancy and no empty-region finding', () => {
  const result = analyzeLayout(page([section({ width_px: WIDTH, height_px: HEIGHT })]));
  assert.equal(result.metrics.occupancyRatio, 1);
  assert.equal(result.metrics.largestEmptyRect, null);
  assert.equal(result.subscores.density, 100);
  assert.ok(!result.findings.some((item) => item.code === 'LARGE_EMPTY_REGION'));
});

test('a valid page with a large unused region produces a diagnostic despite clean preflight', async () => {
  const sparse = page([section({ width_px: Math.floor(WIDTH / 4), height_px: 120 })]);
  const legality = await validatePageLayout(sparse, {});
  const quality = analyzeLayout(sparse);

  assert.equal(legality.valid, true);
  assert.deepEqual(legality.collisions, []);
  assert.ok(quality.score < 60);
  assert.ok(quality.findings.some((item) => item.code === 'LARGE_EMPTY_REGION'));
  assert.ok(quality.findings.some((item) => item.code === 'LOW_PAGE_OCCUPANCY'));
});

test('content only on the left produces horizontal imbalance', () => {
  const result = analyzeLayout(page([section({ width_px: Math.floor(WIDTH / 2), height_px: HEIGHT })]));
  assert.equal(result.metrics.leftWeight > 0, true);
  assert.equal(result.metrics.rightWeight, 0);
  assert.equal(result.metrics.horizontalImbalance, 1);
  assert.ok(result.findings.some((item) => item.code === 'HORIZONTAL_IMBALANCE'));
});

test('matching left and right rectangles have low horizontal imbalance', () => {
  const half = WIDTH / 2;
  const result = analyzeLayout(page([
    section({ section_key: 'left', width_px: half, height_px: 160 }),
    section({ section_key: 'right', x_px: LEFT + half, width_px: half, height_px: 160 }),
  ]));
  assert.equal(result.metrics.leftWeight, result.metrics.rightWeight);
  assert.equal(result.metrics.horizontalImbalance, 0);
});

test('top-heavy content produces vertical imbalance', () => {
  const result = analyzeLayout(page([section({ width_px: WIDTH, height_px: Math.floor(HEIGHT / 3) })]));
  assert.equal(result.metrics.topWeight > 0, true);
  assert.equal(result.metrics.bottomWeight, 0);
  assert.equal(result.metrics.verticalImbalance, 1);
  assert.ok(result.findings.some((item) => item.code === 'VERTICAL_IMBALANCE'));
});

test('empty template frames are measured separately from occupied area', () => {
  const result = analyzeLayout(page([
    section({ section_key: 'filled', width_px: 100, height_px: 100 }),
    section({ section_key: 'empty', x_px: LEFT + 100, width_px: 250, height_px: 200, headline: '', body: '' }),
  ]));
  assert.equal(result.metrics.filledSectionCount, 1);
  assert.equal(result.metrics.emptySectionCount, 1);
  assert.equal(result.metrics.occupiedArea, 10000);
  assert.equal(result.metrics.emptyFrameArea, 50000);
  assert.ok(result.findings.some((item) => item.code === 'LARGE_EMPTY_FRAME'));
});

test('placed images and structured Smart Cards are printable occupied content', () => {
  const result = analyzeLayout(page([
    section({ section_key: 'picture', headline: '', width_px: 100, height_px: 100, images: [{ id: 1 }] }),
    section({ section_key: 'card', headline: '', x_px: LEFT + 100, width_px: 100, height_px: 100, smart_card_key: 'rashi' }),
    section({ section_key: 'empty', headline: '', x_px: LEFT + 200, width_px: 100, height_px: 100 }),
  ]));
  assert.equal(result.metrics.filledSectionCount, 2);
  assert.equal(result.metrics.emptySectionCount, 1);
  assert.equal(result.metrics.occupiedArea, 20000);
});

test('overlapping occupied rectangles are unioned rather than double-counted', () => {
  const result = analyzeLayout(page([
    section({ section_key: 'a', width_px: 200, height_px: 100 }),
    section({ section_key: 'b', x_px: LEFT + 100, width_px: 200, height_px: 100 }),
  ]));
  assert.equal(result.metrics.occupiedArea, 30000);
});

test('a rectangle crossing the page midpoint contributes equally to both halves', () => {
  const result = analyzeLayout(page([
    section({ x_px: LEFT + (WIDTH / 2) - 50, width_px: 100, height_px: 100 }),
  ]));
  assert.equal(result.metrics.leftWeight, 5000);
  assert.equal(result.metrics.rightWeight, 5000);
  assert.equal(result.metrics.horizontalImbalance, 0);
});

test('geometry outside the canonical content region is clipped and ignored', () => {
  const result = analyzeLayout(page([
    section({ x_px: LEFT - 50, width_px: 100, height_px: 100 }),
    section({ section_key: 'header-only', x_px: LEFT, y_px: TOP - 100, width_px: 100, height_px: 50 }),
  ]));
  assert.equal(result.metrics.occupiedArea, 5000);
  assert.equal(result.metrics.filledSectionCount, 1);
});

test('analysis is deterministic and does not mutate page input', () => {
  const input = page([section({ width_px: 120, height_px: 140 })]);
  const original = structuredClone(input);
  assert.deepEqual(analyzeLayout(input), analyzeLayout(input));
  assert.deepEqual(input, original);
});
