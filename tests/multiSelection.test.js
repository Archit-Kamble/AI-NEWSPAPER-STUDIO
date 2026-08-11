// Stage 7: multi-selecting several pictures in one block (Shift+click), and
// aligning them. Pure logic covered here without a browser - the drag/click
// interaction itself is covered by tests/browser/workspace.browser.js.

const test = require('node:test');
const assert = require('node:assert/strict');

test('computeAlignment: left/right/center line up to the selection bounding box', async () => {
  const { computeAlignment } = await import('../public/editor/external-editor/align.js');
  const rows = [
    { id: 1, x_px: 10, y_px: 0, width_px: 20, height_px: 10 },
    { id: 2, x_px: 50, y_px: 0, width_px: 40, height_px: 10 },
  ];
  // Bounding box: left 10, right 90 (50+40).
  assert.deepEqual(computeAlignment(rows, 'left'), { 1: { x: 10 }, 2: { x: 10 } });
  assert.deepEqual(computeAlignment(rows, 'right'), { 1: { x: 70 }, 2: { x: 50 } }); // 90-20, 90-40
  assert.deepEqual(computeAlignment(rows, 'center'), { 1: { x: 40 }, 2: { x: 30 } }); // centerX=50, 50-10, 50-20
});

test('computeAlignment: top/middle/bottom line up on the Y axis independently of X', async () => {
  const { computeAlignment } = await import('../public/editor/external-editor/align.js');
  const rows = [
    { id: 1, x_px: 0, y_px: 5, width_px: 10, height_px: 10 },
    { id: 2, x_px: 0, y_px: 40, width_px: 10, height_px: 30 },
  ];
  // Bounding box: top 5, bottom 70 (40+30), centreY 37.5.
  assert.deepEqual(computeAlignment(rows, 'top'), { 1: { y: 5 }, 2: { y: 5 } });
  assert.deepEqual(computeAlignment(rows, 'bottom'), { 1: { y: 60 }, 2: { y: 40 } }); // 70-10, 70-30
  assert.deepEqual(computeAlignment(rows, 'middle'), { 1: { y: 33 }, 2: { y: 23 } }); // round(37.5-5), round(37.5-15)
});

test('computeAlignment: fewer than two rows aligns nothing - there is no "other" to line up with', async () => {
  const { computeAlignment } = await import('../public/editor/external-editor/align.js');
  assert.deepEqual(computeAlignment([{ id: 1, x_px: 0, y_px: 0, width_px: 10, height_px: 10 }], 'left'), {});
  assert.deepEqual(computeAlignment([], 'left'), {});
});

test('store: Shift+click builds a multi-selection, plain setSelectedPart narrows to one', async () => {
  const store = await import('../public/editor/store.js');
  const page = { id: 900, page_number: 1, sections: [{ section_key: 'lead', width_px: 300, height_px: 200 }] };
  store.setEdition({ newspaper: { id: 900 }, pages: [page], reporterNews: [] });
  store.setSelectedSection('lead', { headline: '', body: '' });

  store.setSelectedPart('image', 1);
  assert.deepEqual(store.getSelectedImageIds(), [1], 'an ordinary click selects just the one picture');

  store.toggleSelectedImage(2);
  assert.deepEqual(store.getSelectedImageIds(), [1, 2], 'Shift+click adds a second picture to the selection');
  assert.equal(store.getState().selectedImageId, 2, 'the just-added picture becomes the primary');

  store.toggleSelectedImage(2);
  assert.deepEqual(store.getSelectedImageIds(), [1], 'Shift+click on an already-selected picture removes it');
  assert.equal(store.getState().selectedImageId, 1, 'the primary falls back to what is left');

  store.toggleSelectedImage(1);
  assert.deepEqual(store.getSelectedImageIds(), [], 'removing the last one empties the selection');
  assert.equal(store.getState().selectedPart, 'block', 'and the part falls back to the block itself');

  store.setSelectedPart('image', 5);
  assert.deepEqual(store.getSelectedImageIds(), [5], 'a plain click after a multi-selection narrows back to one');
});

test('store: Escape\'s own step - collapseMultiSelection reduces before "block" does', async () => {
  const store = await import('../public/editor/store.js');
  const page = { id: 901, page_number: 1, sections: [{ section_key: 'lead', width_px: 300, height_px: 200 }] };
  store.setEdition({ newspaper: { id: 901 }, pages: [page], reporterNews: [] });
  store.setSelectedSection('lead', { headline: '', body: '' });

  assert.equal(store.collapseMultiSelection(), false, 'nothing to collapse when zero or one picture is selected');

  store.setSelectedPart('image', 1);
  store.toggleSelectedImage(2);
  store.toggleSelectedImage(3);
  assert.deepEqual(store.getSelectedImageIds(), [1, 2, 3]);

  assert.equal(store.collapseMultiSelection(), true, 'three selected - there is something to collapse');
  assert.deepEqual(store.getSelectedImageIds(), [3], 'collapses to the single primary, not an arbitrary member');
  assert.equal(store.collapseMultiSelection(), false, 'one left - nothing more to collapse, Escape moves on to "block" instead');
});
