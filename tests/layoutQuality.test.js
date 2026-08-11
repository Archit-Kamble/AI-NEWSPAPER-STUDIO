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

test('a priority-five lead in the dominant editorial frame has prominence metrics and no mismatch', async () => {
  const { STORY_TYPE } = await import('../public/editor/layout/story-types.js');
  const result = analyzeLayout(page([
    section({ section_key: 'lead', story_type: STORY_TYPE.LEAD, editorial_priority: 5, width_px: 360, height_px: 300 }),
    section({ section_key: 'secondary', story_type: STORY_TYPE.SECONDARY, editorial_priority: 3, x_px: LEFT + 370, width_px: 200, height_px: 220 }),
    section({ section_key: 'brief', story_type: STORY_TYPE.BRIEF, editorial_priority: 2, y_px: TOP + 310, width_px: 140, height_px: 100 }),
  ]));
  const lead = result.sections.find((item) => item.sectionKey === 'lead');
  assert.equal(lead.storyType, STORY_TYPE.LEAD, 'the analyzer reads the persisted canonical catalog value');
  assert.equal(lead.frameSizeRank, 1);
  assert.equal(lead.widthRatio, 0.5806);
  assert.ok(!lead.findings.some((item) => item.code === 'PRIORITY_FRAME_MISMATCH'));
  assert.ok(!result.findings.some((item) => item.code === 'LEAD_NOT_DOMINANT'));
});

test('a priority-five story in a tiny frame while lower priority dominates is a mismatch', () => {
  const result = analyzeLayout(page([
    section({ section_key: 'lead', story_type: 'LEAD', editorial_priority: 5, width_px: 80, height_px: 80 }),
    section({ section_key: 'low-large', story_type: 'STANDARD', editorial_priority: 1, x_px: LEFT + 100, width_px: 400, height_px: 320 }),
    section({ section_key: 'other', story_type: 'STANDARD', editorial_priority: 3, y_px: TOP + 340, width_px: 160, height_px: 120 }),
  ]));
  const lead = result.sections.find((item) => item.sectionKey === 'lead');
  assert.ok(lead.findings.some((item) => item.code === 'PRIORITY_FRAME_MISMATCH'));
  assert.ok(result.findings.some((item) => item.code === 'LEAD_NOT_DOMINANT'));
  assert.ok(result.subscores.hierarchy < 100);
});

test('a compact brief passes while a dominant brief is diagnosed', () => {
  const compact = analyzeLayout(page([
    section({ section_key: 'lead', story_type: 'LEAD', editorial_priority: 5, width_px: 300, height_px: 260 }),
    section({ section_key: 'standard', story_type: 'STANDARD', editorial_priority: 3, x_px: LEFT + 320, width_px: 200, height_px: 180 }),
    section({ section_key: 'brief', story_type: 'BRIEF', editorial_priority: 2, y_px: TOP + 280, width_px: 100, height_px: 80 }),
  ]));
  assert.ok(!compact.findings.some((item) => item.code === 'BRIEF_OVERSIZED_FRAME'));

  const oversized = analyzeLayout(page([
    section({ section_key: 'brief', story_type: 'BRIEF', editorial_priority: 2, width_px: 420, height_px: 300 }),
    section({ section_key: 'lead', story_type: 'LEAD', editorial_priority: 5, x_px: LEFT + 440, width_px: 160, height_px: 180 }),
    section({ section_key: 'standard', story_type: 'STANDARD', editorial_priority: 3, y_px: TOP + 320, width_px: 120, height_px: 100 }),
  ]));
  assert.ok(oversized.findings.some((item) => item.code === 'BRIEF_OVERSIZED_FRAME'));
});

test('photo features require a real image and report a clearly too-small placed image', () => {
  const good = analyzeLayout(page([
    section({ section_key: 'photo', story_type: 'PHOTO_FEATURE', width_px: 300, height_px: 300,
      images: [{ x_px: 0, y_px: 0, width_px: 240, height_px: 220 }] }),
  ]));
  assert.ok(!good.findings.some((item) => item.code === 'PHOTO_FEATURE_WITHOUT_IMAGE'));
  assert.ok(!good.findings.some((item) => item.code === 'PHOTO_FEATURE_IMAGE_TOO_SMALL'));

  const missing = analyzeLayout(page([section({ story_type: 'PHOTO_FEATURE', images: [] })]));
  assert.ok(missing.findings.some((item) => item.code === 'PHOTO_FEATURE_WITHOUT_IMAGE'));

  const tooSmall = analyzeLayout(page([
    section({ story_type: 'PHOTO_FEATURE', width_px: 300, height_px: 300,
      images: [{ x_px: 0, y_px: 0, width_px: 40, height_px: 40 }] }),
  ]));
  assert.ok(tooSmall.findings.some((item) => item.code === 'PHOTO_FEATURE_IMAGE_TOO_SMALL'));
});

test('Smart Cards require their structured key-and-data payload', () => {
  const valid = analyzeLayout(page([
    section({ story_type: 'SMART_CARD', headline: '', smart_card_key: 'rashi', smart_card_data: { items: [] } }),
  ]));
  assert.ok(!valid.findings.some((item) => item.code === 'SMART_CARD_MISSING_DATA'));

  const missing = analyzeLayout(page([section({ story_type: 'SMART_CARD', smart_card_key: 'rashi' })]));
  assert.ok(missing.findings.some((item) => item.code === 'SMART_CARD_MISSING_DATA'));
});

test('advertisements and Smart Cards do not distort editorial lead dominance', () => {
  const result = analyzeLayout(page([
    section({ section_key: 'lead', story_type: 'LEAD', editorial_priority: 5, width_px: 260, height_px: 220 }),
    section({ section_key: 'standard', story_type: 'STANDARD', editorial_priority: 3, x_px: LEFT + 280, width_px: 180, height_px: 180 }),
    section({ section_key: 'advert', story_type: 'ADVERTISEMENT', editorial_priority: 1, y_px: TOP + 240, width_px: WIDTH, height_px: 280 }),
    section({ section_key: 'card', story_type: 'SMART_CARD', headline: '', y_px: TOP + 540, width_px: WIDTH, height_px: 100,
      smart_card_key: 'sudoku', smart_card_data: { grid: [] } }),
  ]));
  assert.ok(!result.findings.some((item) => item.code === 'LEAD_NOT_DOMINANT'));
  assert.equal(result.sections.find((item) => item.sectionKey === 'advert').frameSizeRank, null);
  assert.equal(result.sections.find((item) => item.sectionKey === 'card').frameSizeRank, null);
});
