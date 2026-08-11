// validatePageLayout(): the general collision layer, Project A Phase 2.
//
// This is not a second layout engine - it is preflight.service.js's own
// checkPage(), which has caught overset copy and overlapping blocks since
// preflight existed, reshaped into the named error-type vocabulary a
// composition engine (or a future AI composer's own repair loop) wants to
// branch on rather than parse out of an English sentence. These tests hold
// the checks that Project A's Phase 2 added on top of what already existed:
// a block can no longer overlap the header/footer furniture, and two
// pictures on one block are now caught the same way two blocks are.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePageLayout } = require('../src/services/preflight.service');
const { geometryOf } = require('../src/layout/geometry');

const G = geometryOf({});

function page(pageNumber, sections) {
  return { page_number: pageNumber, prints_colour: true, sections };
}

function section(overrides = {}) {
  return {
    id: 1,
    section_key: 'test-block',
    block_type: 'article',
    x_px: G.marginXPx,
    y_px: G.regions.inside.content.top,
    width_px: 200,
    height_px: 100,
    headline: 'चाचणी मथळा',
    body: '',
    body_font_px: 10,
    images: [],
    ...overrides,
  };
}

test('a normally-placed block on an inside page validates clean of collisions', async () => {
  const result = await validatePageLayout(page(2, [section()]), {});
  assert.deepEqual(result.collisions, []);
  assert.equal(result.valid, true);
});

test('a block overlapping the folio band is OVERLAPPING_HEADER', async () => {
  const result = await validatePageLayout(page(2, [section({ y_px: G.marginYPx })]), {});
  assert.ok(result.collisions.some((c) => c.type === 'OVERLAPPING_HEADER'));
  assert.equal(result.valid, false);
});

test('a block overlapping the footer band is OVERLAPPING_FOOTER', async () => {
  const bottom = G.regions.inside.footer.bottom;
  const result = await validatePageLayout(
    page(2, [section({ y_px: bottom - 20, height_px: 20 })]), {},
  );
  assert.ok(result.collisions.some((c) => c.type === 'OVERLAPPING_FOOTER'));
  assert.equal(result.valid, false);
});

test('the masthead-advert block is exempt from the header check - it belongs in the header band', async () => {
  const result = await validatePageLayout(
    page(1, [section({ section_key: 'masthead-advert', block_type: 'advert', y_px: G.marginYPx })]), {},
  );
  assert.ok(!result.collisions.some((c) => c.type === 'OVERLAPPING_HEADER'));
});

test('two blocks occupying the same pixels is STORY_COLLISION', async () => {
  const a = section({ section_key: 'a' });
  const b = section({ section_key: 'b' });
  const result = await validatePageLayout(page(2, [a, b]), {});
  assert.ok(result.collisions.some((c) => c.type === 'STORY_COLLISION'));
});

test('a zero-width block is NEGATIVE_SPACE', async () => {
  const result = await validatePageLayout(page(2, [section({ width_px: 0 })]), {});
  assert.ok(result.collisions.some((c) => c.type === 'NEGATIVE_SPACE'));
});

test('text longer than the block can hold is TEXT_OVERFLOW, not a collision', async () => {
  const result = await validatePageLayout(
    page(2, [section({ body: 'फार मोठा मजकूर. '.repeat(200) })]), {},
  );
  assert.ok(result.overflow.some((c) => c.type === 'TEXT_OVERFLOW'));
  assert.equal(result.valid, false);
});

test('two rectangular pictures on one block overlapping each other is IMAGE_COLLISION, graded as an error', async () => {
  const images = [
    { id: 1, shape: 'rect', x_px: 0, y_px: 0, width_px: 100, height_px: 100 },
    { id: 2, shape: 'rect', x_px: 50, y_px: 50, width_px: 100, height_px: 100 },
  ];
  const result = await validatePageLayout(page(2, [section({ images })]), {});
  const found = result.collisions.find((c) => c.type === 'IMAGE_COLLISION');
  assert.ok(found);
  assert.equal(found.level, 'error');
});

test('a cutout overlapping another picture\'s frame is IMAGE_COLLISION but only a warning - the real occupancy is the mask, not the box', async () => {
  const images = [
    { id: 1, shape: 'cutout', x_px: 0, y_px: 0, width_px: 100, height_px: 100 },
    { id: 2, shape: 'rect', x_px: 50, y_px: 50, width_px: 100, height_px: 100 },
  ];
  const result = await validatePageLayout(page(2, [section({ images })]), {});
  const found = result.collisions.find((c) => c.type === 'IMAGE_COLLISION');
  assert.ok(found);
  assert.equal(found.level, 'warning');
});

test('two pictures on one block that do not touch are not flagged', async () => {
  const images = [
    { id: 1, shape: 'rect', x_px: 0, y_px: 0, width_px: 50, height_px: 50 },
    { id: 2, shape: 'rect', x_px: 100, y_px: 100, width_px: 50, height_px: 50 },
  ];
  const result = await validatePageLayout(page(2, [section({ images })]), {});
  assert.ok(!result.collisions.some((c) => c.type === 'IMAGE_COLLISION'));
});
