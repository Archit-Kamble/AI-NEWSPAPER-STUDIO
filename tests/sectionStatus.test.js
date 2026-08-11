// section-status.js's statusOf(), and section-thumb.js's sectionClassName():
// a block holding only a placed picture (section_images) used to read as
// "Empty" for ever, in every panel that shows the status badge, and drew with
// the empty-block treatment on the canvas itself. Both functions only ever
// checked view.headline/body/imageUrl - the legacy single hero-image field -
// never the placed-pictures table, because `view` (the desk's editable draft,
// section-model.js) deliberately does not carry `images` (that lives
// alongside it, e.g. block-frame.js's own state). Found live on Project A's
// realistic test edition: a pure photo block, correctly showing its picture
// on the canvas, badged EMPTY throughout the Block Editor.

const test = require('node:test');
const assert = require('node:assert/strict');

test('statusOf: a block with only a placed picture is not "empty"', async () => {
  const { statusOf } = await import('../public/editor/status/section-status.js');
  const view = { headline: '', body: '', imageUrl: '', newsItemId: null, status: 'empty' };

  assert.equal(statusOf(view, false), 'empty', 'no picture at all is genuinely empty');
  assert.notEqual(statusOf(view, true), 'empty', 'a placed picture means there is something here');
});

test('statusOf: an explicit status (e.g. "ready") is never overridden by hasImages either way', async () => {
  const { statusOf } = await import('../public/editor/status/section-status.js');
  const view = { headline: '', body: '', imageUrl: '', newsItemId: null, status: 'ready' };
  assert.equal(statusOf(view, false), 'ready');
  assert.equal(statusOf(view, true), 'ready');
});

test('sectionClassName: a block with only a placed picture is drawn "filled", not empty-styled', async () => {
  const { sectionClassName } = await import('../public/editor/canvas/section-thumb.js');
  const view = { headline: '', body: '', imageUrl: '', blockType: 'photo', borderStyle: 'none' };

  assert.ok(!sectionClassName(view, {}).includes('filled'), 'no picture, no text - genuinely unfilled');
  assert.ok(sectionClassName(view, { hasImages: true }).includes('filled'), 'a placed picture makes the block filled');
});
