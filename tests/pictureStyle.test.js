// D3: placedPictureStyle() now reads image-geometry.js's resolver instead
// of hardcoding `object-fit:contain` regardless of the desk's actual
// Contain/Cover/Stretch choice - the one function the page canvas AND the
// Block Editor both call (see the module's own header), so fixing it once
// fixes both surfaces.

const test = require('node:test');
const assert = require('node:assert/strict');

let pictureStyle;

test.before(async () => {
  pictureStyle = await import('../public/editor/layout/picture-style.js');
});

const ROW = { x_px: 10, y_px: 20, width_px: 200, height_px: 100, z_index: 2, rotation: 0, shape: 'rect' };

test('fit_mode drives the real object-fit value - contain, cover and stretch all differ', () => {
  const contain = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'contain' });
  const cover = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'cover' });
  const stretch = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'stretch' });
  assert.match(contain.image, /object-fit:contain/);
  assert.match(cover.image, /object-fit:cover/);
  // Stretch maps to CSS `fill`, the object-fit value that stretches
  // independently on both axes - "cover" and "contain" both preserve
  // aspect ratio, which stretch must not.
  assert.match(stretch.image, /object-fit:fill/);
});

test('an unrecognised fit_mode paints as contain, matching image-geometry.js\'s own fallback', () => {
  const result = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'nonsense' });
  assert.match(result.image, /object-fit:contain/);
});

test('a quarter turn still swaps the image box axes, exactly as before this change', () => {
  const straight = pictureStyle.placedPictureStyle({ ...ROW, rotation: 0 });
  const turned = pictureStyle.placedPictureStyle({ ...ROW, rotation: 90 });
  assert.match(straight.image, /width:200px/);
  assert.match(straight.image, /height:100px/);
  assert.match(turned.image, /width:100px/, 'a 90deg turn must size the pre-rotation box to the frame turned on its side');
  assert.match(turned.image, /height:200px/);
  assert.match(turned.image, /rotate\(90deg\)/);
});

test('flip flags still apply as scaleX/scaleY on the transform', () => {
  const flipped = pictureStyle.placedPictureStyle({ ...ROW, flip_h: true, flip_v: true });
  assert.match(flipped.image, /scaleX\(-1\)/);
  assert.match(flipped.image, /scaleY\(-1\)/);
});

test('the frame box is unaffected by fit mode - only what happens INSIDE it changes', () => {
  const contain = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'contain' });
  const cover = pictureStyle.placedPictureStyle({ ...ROW, fit_mode: 'cover' });
  assert.equal(contain.frame, cover.frame);
});

test('scale divides both the frame and the image box, for the editor\'s own zoom', () => {
  const atOne = pictureStyle.placedPictureStyle(ROW, 1);
  const atHalf = pictureStyle.placedPictureStyle(ROW, 0.5);
  assert.match(atOne.frame, /width:200px/);
  assert.match(atHalf.frame, /width:400px/, 'a scale of 0.5 (block px per screen px) must draw twice as large on screen');
});

test('ellipse shape still clips the image element itself, unchanged', () => {
  const result = pictureStyle.placedPictureStyle({ ...ROW, shape: 'ellipse' });
  assert.match(result.image, /border-radius:50%/);
  assert.equal(result.shape, 'ellipse');
});
