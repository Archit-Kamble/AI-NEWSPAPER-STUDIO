// Pure resize arithmetic (Phase E): eight independent handles instead of
// four corners that always preserved aspect ratio. An edge handle changes
// ONE axis; a corner changes both, independently by default; Shift
// preserves the aspect ratio on either kind.

const test = require('node:test');
const assert = require('node:assert/strict');

let resize;

test.before(async () => {
  resize = await import('../public/editor/layout/image-resize.js');
});

const RECT = { x: 100, y: 100, width: 200, height: 100 };

test('east handle changes only width', () => {
  const result = resize.resizeRect(RECT, 'e', 20, 0);
  assert.deepEqual(result, { x: 100, y: 100, width: 220, height: 100 });
});

test('west handle changes x and width, never y/height', () => {
  const result = resize.resizeRect(RECT, 'w', -20, 0);
  assert.deepEqual(result, { x: 80, y: 100, width: 220, height: 100 });
});

test('north handle changes y and height, never x/width', () => {
  const result = resize.resizeRect(RECT, 'n', 0, -20);
  assert.deepEqual(result, { x: 100, y: 80, width: 200, height: 120 });
});

test('south handle changes only height', () => {
  const result = resize.resizeRect(RECT, 's', 0, 20);
  assert.deepEqual(result, { x: 100, y: 100, width: 200, height: 120 });
});

test('a corner changes both axes independently by default - no aspect lock', () => {
  const result = resize.resizeRect(RECT, 'se', 20, 5);
  assert.deepEqual(result, { x: 100, y: 100, width: 220, height: 105 });
});

test('the four corners each anchor the OPPOSITE corner', () => {
  const se = resize.resizeRect(RECT, 'se', 20, 20);
  assert.equal(se.x, 100, 'se anchors its own top-left, which does not move');
  assert.equal(se.y, 100);

  const nw = resize.resizeRect(RECT, 'nw', -20, -20);
  assert.equal(nw.x, 80, 'nw anchors the bottom-right: right edge (300) stays put -> x = 300 - 240');
  assert.equal(nw.y, 80);
  assert.equal(nw.x + nw.width, RECT.x + RECT.width, 'the right edge must not have moved');
  assert.equal(nw.y + nw.height, RECT.y + RECT.height, 'the bottom edge must not have moved');

  const ne = resize.resizeRect(RECT, 'ne', 20, -10);
  assert.equal(ne.x, 100, 'ne anchors the bottom-left x');
  assert.equal(ne.y + ne.height, RECT.y + RECT.height, 'and the bottom edge does not move');

  const sw = resize.resizeRect(RECT, 'sw', -20, 10);
  assert.equal(sw.x + sw.width, RECT.x + RECT.width, 'sw anchors the top-right: right edge does not move');
  assert.equal(sw.y, 100);
});

test('minimum size clamps, anchored on the edge that actually moved', () => {
  const shrunk = resize.resizeRect(RECT, 'e', -190, 0, { minWidth: 24 });
  assert.equal(shrunk.width, 24);
  assert.equal(shrunk.x, 100, 'east handle never moves x, floor or not');

  const shrunkFromWest = resize.resizeRect(RECT, 'w', 190, 0, { minWidth: 24 });
  assert.equal(shrunkFromWest.width, 24);
  assert.equal(shrunkFromWest.x, 276, 'west handle hitting the floor keeps the RIGHT edge (300) fixed: 300 - 24');
});

test('bounds clamp - a resize cannot push the rectangle past the given box', () => {
  const bounds = { x: 0, y: 0, width: 250, height: 250 };
  const result = resize.resizeRect(RECT, 'e', 200, 0, { bounds });
  assert.equal(result.x + result.width, 250, 'east growth is clamped to the bounds right edge');

  const result2 = resize.resizeRect(RECT, 'w', -500, 0, { bounds });
  assert.equal(result2.x, 0, 'west growth is clamped to the bounds left edge');
});

// ------------------------------------------------------- Shift (preserveAspect) ---

test('Shift on a corner preserves the aspect ratio, anchored on the opposite corner', () => {
  const result = resize.resizeRect(RECT, 'se', 20, 999, { preserveAspect: true });
  // startRatio = 100/200 = 0.5; width becomes 220 -> height = 110, not 999.
  assert.equal(result.width, 220);
  assert.equal(result.height, 110);
  assert.equal(result.x, 100, 'se still anchors its own top-left');
  assert.equal(result.y, 100);
});

test('Shift on nw preserves aspect ratio and keeps the bottom-right corner fixed', () => {
  const result = resize.resizeRect(RECT, 'nw', -40, -999, { preserveAspect: true });
  // width becomes 240 -> height = 120 (ratio 0.5).
  assert.equal(result.width, 240);
  assert.equal(result.height, 120);
  assert.equal(result.x + result.width, RECT.x + RECT.width, 'the anchored corner must not move');
  assert.equal(result.y + result.height, RECT.y + RECT.height);
});

test('Shift on an edge handle derives the other axis too, centred on the rectangle\'s own centre', () => {
  const result = resize.resizeRect(RECT, 'e', 20, 0, { preserveAspect: true });
  assert.equal(result.width, 220);
  assert.equal(result.height, 110, 'height follows the new width via the starting 0.5 ratio');
  const oldCenterY = RECT.y + RECT.height / 2;
  const newCenterY = result.y + result.height / 2;
  assert.equal(newCenterY, oldCenterY, 'height must grow symmetrically around the rectangle\'s own vertical centre');
});

test('without Shift, dragging one edge never touches the other axis, whatever the ratio would imply', () => {
  const withAspect = resize.resizeRect(RECT, 'e', 20, 0, { preserveAspect: true });
  const withoutAspect = resize.resizeRect(RECT, 'e', 20, 0, { preserveAspect: false });
  assert.notEqual(withAspect.height, withoutAspect.height);
  assert.equal(withoutAspect.height, RECT.height);
});

test('deterministic: the same input always produces the same rectangle', () => {
  const a = resize.resizeRect(RECT, 'se', 15, -7, { preserveAspect: true, bounds: { x: 0, y: 0, width: 500, height: 500 } });
  const b = resize.resizeRect({ ...RECT }, 'se', 15, -7, { preserveAspect: true, bounds: { x: 0, y: 0, width: 500, height: 500 } });
  assert.deepEqual(a, b);
});
