// The shared image transform (D2): one resolved geometry object, used by
// paint, resize preview and (eventually) alpha exclusion and print instead
// of each recomputing fit/rotation for themselves. Pure module, so this
// tests the arithmetic directly - no DOM, no server.

const test = require('node:test');
const assert = require('node:assert/strict');

let geometry;

test.before(async () => {
  geometry = await import('../public/editor/layout/image-geometry.js');
});

// ------------------------------------------------------------------ fit ---

test('contain: 400x200 source into a 200x200 frame is 200x100, centered vertically', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 200, height: 200, source_width_px: 400, source_height_px: 200, fit_mode: 'contain',
  });
  assert.equal(result.localContentRect.width, 200);
  assert.equal(result.localContentRect.height, 100);
  assert.equal(result.localContentRect.x, 0);
  assert.equal(result.localContentRect.y, 50, 'centered: (200 - 100) / 2 = 50px blank on top and bottom');
});

test('cover: 400x200 source into a 200x200 frame fills the square and overflows horizontally', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 200, height: 200, source_width_px: 400, source_height_px: 200, fit_mode: 'cover',
  });
  assert.equal(result.localContentRect.height, 200);
  assert.equal(result.localContentRect.width, 400, 'scale = max(200/400, 200/200) = 1, so the source paints at its own 400px width');
  assert.equal(result.localContentRect.x, -100, 'centered: (200 - 400) / 2 = -100, overflowing equally on both sides');
  assert.ok(result.localContentRect.width >= result.clipRect.width, 'cover must fill or exceed the frame - the clip is what cuts the excess');
});

test('stretch: 400x200 source into a 200x200 frame is exactly 200x200, independent axes', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 200, height: 200, source_width_px: 400, source_height_px: 200, fit_mode: 'stretch',
  });
  assert.equal(result.localContentRect.width, 200);
  assert.equal(result.localContentRect.height, 200);
  assert.notEqual(result.scaleX, result.scaleY, 'stretch must not preserve the source aspect ratio');
  assert.equal(result.scaleX, 0.5);
  assert.equal(result.scaleY, 1);
});

test('an unrecognised fit_mode falls back to contain, never crashes', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 100, height: 100, source_width_px: 100, source_height_px: 100, fit_mode: 'nonsense',
  });
  assert.equal(result.fitMode, 'contain');
});

// -------------------------------------------------------------- rotation ---

test('a 90 degree rotation swaps the local target axes', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 300, height: 100, source_width_px: 100, source_height_px: 100, rotation: 90, fit_mode: 'contain',
  });
  assert.equal(result.localTarget.width, 100, 'the box the content fits BEFORE rotation is the frame turned on its side');
  assert.equal(result.localTarget.height, 300);
});

test('a 180 degree rotation does not swap the local target axes', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 300, height: 100, source_width_px: 100, source_height_px: 100, rotation: 180, fit_mode: 'contain',
  });
  assert.equal(result.localTarget.width, 300);
  assert.equal(result.localTarget.height, 100);
});

test('a 270 degree rotation swaps the axes exactly like 90', () => {
  const at90 = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 300, height: 100, source_width_px: 100, source_height_px: 100, rotation: 90, fit_mode: 'contain',
  });
  const at270 = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 300, height: 100, source_width_px: 100, source_height_px: 100, rotation: 270, fit_mode: 'contain',
  });
  assert.deepEqual(at270.localTarget, at90.localTarget);
});

test('rotation is normalised into 0-359, negative and over-360 values included', () => {
  assert.equal(geometry.normaliseRotation(-90), 270);
  assert.equal(geometry.normaliseRotation(450), 90);
  assert.equal(geometry.normaliseRotation(0), 0);
});

// ------------------------------------------------------------------ flip ---

test('flip flags are preserved on the resolved result, untouched', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 100, height: 100, source_width_px: 100, source_height_px: 100, flip_h: true, flip_v: false,
  });
  assert.equal(result.flipH, true);
  assert.equal(result.flipV, false);
});

// ------------------------------------------------------------------ crop ---

test('a crop rectangle changes the effective source aspect ratio', () => {
  const uncropped = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 200, height: 200, source_width_px: 400, source_height_px: 200, fit_mode: 'contain',
  });
  const cropped = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 200, height: 200, source_width_px: 400, source_height_px: 200,
    crop_x_px: 100, crop_y_px: 0, crop_width_px: 200, crop_height_px: 200, fit_mode: 'contain',
  });
  assert.equal(uncropped.localContentRect.height, 100, 'uncropped 2:1 source contains at 200x100');
  assert.equal(cropped.localContentRect.height, 200, 'a cropped 1:1 square now fills the square frame exactly');
  assert.equal(cropped.crop.width, 200);
});

test('a crop that would run past the source edge is clamped to stay inside it', () => {
  const result = geometry.resolvePlacedImage({
    x: 0, y: 0, width: 100, height: 100, source_width_px: 100, source_height_px: 100,
    crop_x_px: 80, crop_y_px: 80, crop_width_px: 60, crop_height_px: 60,
  });
  assert.equal(result.crop.x, 80);
  assert.equal(result.crop.width, 20, 'clamped to the 20px actually remaining between x=80 and the 100px source edge');
});

test('no crop columns at all defaults to the whole source', () => {
  const result = geometry.resolvePlacedImage({ x: 0, y: 0, width: 50, height: 50, source_width_px: 120, source_height_px: 80 });
  assert.deepEqual(result.crop, { x: 0, y: 0, width: 120, height: 80 });
});

// --------------------------------------------------------- source fallback ---

test('an asset with no known natural size falls back to the placement\'s own shape', () => {
  const result = geometry.resolvePlacedImage({ x: 0, y: 0, width: 150, height: 90 });
  assert.equal(result.source.width, 150);
  assert.equal(result.source.height, 90);
  // Falling back to its own frame means it already fits it exactly - the
  // deterministic "preserve current appearance" behaviour for an old asset.
  assert.equal(result.localContentRect.width, 150);
  assert.equal(result.localContentRect.height, 90);
});

// -------------------------------------------------------------- determinism ---

test('the same input always resolves to the same geometry', () => {
  const row = {
    x: 12, y: 8, width: 220, height: 140, source_width_px: 800, source_height_px: 600,
    fit_mode: 'cover', rotation: 90, flip_h: true, crop_x_px: 10, crop_y_px: 5, crop_width_px: 700, crop_height_px: 500,
  };
  const a = geometry.resolvePlacedImage(row);
  const b = geometry.resolvePlacedImage({ ...row });
  assert.deepEqual(a, b);
});

test('camelCase draft field names resolve identically to their snake_case persisted equivalents', () => {
  const persisted = geometry.resolvePlacedImage({
    x_px: 5, y_px: 5, width_px: 100, height_px: 80, source_width_px: 300, source_height_px: 200, fit_mode: 'cover',
  });
  const draft = geometry.resolvePlacedImage({
    x: 5, y: 5, width: 100, height: 80, sourceWidth: 300, sourceHeight: 200, fitMode: 'cover',
  });
  assert.deepEqual(persisted, draft);
});
