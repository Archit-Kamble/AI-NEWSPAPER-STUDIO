const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const borders = require('../public/editor/layout/borders');
const printModel = require('../src/services/export/print-model');

test('open frames and corner rules become the exact requested press edges', () => {
  const base = {
    x_px: 20, y_px: 30, width_px: 200, height_px: 120,
    border_width_px: borders.BORDER_WIDTHS[1].px,
  };
  const expectations = {
    'frame-open-bottom': 3,
    'frame-open-top': 3,
    'frame-open-right': 3,
    'frame-open-left': 3,
    'corner-top-left': 2,
    'corner-bottom-right': 2,
  };
  for (const [border_style, count] of Object.entries(expectations)) {
    const items = printModel.blockRules({ ...base, border_style });
    assert.equal(items.length, count, border_style);
    assert.ok(items.every((item) => item.kind === 'rule'), border_style);
  }
});

test('triple rules are three separate strokes in the shared press model', async () => {
  const base = {
    x_px: 20, y_px: 30, width_px: 200, height_px: 120,
    border_width_px: borders.BORDER_WIDTHS[0].px,
  };
  const below = printModel.blockRules({ ...base, border_style: 'rule-triple' });
  assert.equal(below.length, 3);
  assert.ok(below.every((item) => item.kind === 'rule'));
  assert.equal(new Set(below.map((item) => item.y)).size, 3, 'each physical rule needs its own baseline');

  const box = printModel.blockRules({ ...base, border_style: 'box-triple' });
  assert.equal(box.length, 12, 'four edges times three physical rules');

  await printModel.ensureComposeReady();
  const shaped = printModel.blockRules({ ...base, border_style: 'box-triple', frame_shape: 'bevel-top' });
  assert.equal(shaped.length, 3);
  assert.ok(shaped.every((item) => item.kind === 'poly' && item.points.length === 6));
});

test('the canvas emits the same three physical strokes for a triple rule', async () => {
  const { sectionInnerHtml } = await import('../public/editor/canvas/section-thumb.js');
  const section = { section_key: 'brief', width_px: 200, height_px: 120, block_type: 'briefs', images: [] };
  const view = {
    blockType: 'briefs', borderStyle: 'rule-triple', borderWidthPx: 1, borderInk: '#111111',
    headline: '', subheading: '', body: '', smartCardKey: null,
  };
  const html = sectionInnerHtml(section, view);
  assert.match(html, /section-shape-border/);
  assert.equal((html.match(/<line /g) || []).length, 3);
});

test('every new rectangular edge style has editing and print-view CSS', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  for (const key of [
    'frame-open-bottom', 'frame-open-top', 'frame-open-right', 'frame-open-left',
    'corner-top-left', 'corner-top-right', 'corner-bottom-left', 'corner-bottom-right',
  ]) {
    assert.match(css, new RegExp(`\\.newspaper-section\\.ruled-${key}\\s*\\{`), `${key} editing CSS`);
    assert.match(css, new RegExp(`body\\.print-view \\.newspaper-section\\.ruled-${key}\\s*\\{`), `${key} print-view CSS`);
  }
});

test('all persisted design tokens fit their database varchar columns', async () => {
  const [{ HEADLINE_STYLE_KEYS }, shapes] = await Promise.all([
    import('../public/editor/layout/inks.js'),
    import('../public/editor/layout/block-shapes.js'),
  ]);
  assert.ok(borders.BORDER_KEYS.every((key) => key.length <= 20), 'border_style is VARCHAR(20)');
  assert.ok(HEADLINE_STYLE_KEYS.every((key) => key.length <= 20), 'headline_style is VARCHAR(20)');
  assert.ok(shapes.BLOCK_SHAPE_KEYS.every((key) => key.length <= 20), 'frame_shape is VARCHAR(20)');
});
