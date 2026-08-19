// A picture may not be LEFT where it leaves a column too narrow to set in.
//
// NO_LEGAL_MEASURE reports this accurately now (§31), but a report is not a
// prevention: a desk still has to notice the message and work out which of
// "make a picture narrower, move it, or set the body smaller" applies to the
// block in front of them. The two real blocks in this database that hit it
// both got there by an ordinary drag.
//
// The rule is the ordinary newspaper one - a picture is placed on the grid, so
// what is left beside it is a whole column or nothing at all. The legal
// placements are: flush to an edge, inset by at least MIN_CORRIDOR_EM, or
// spanning the measure. Everything between is a hole.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

let snap;
let MIN_CORRIDOR_EM;

test.before(async () => {
  ({ snapPictureToLegalCorridor: snap } = await import(
    path.join(__dirname, '..', 'public', 'editor', 'layout', 'corridor-snap.js')));
  ({ MIN_CORRIDOR_EM } = await import(
    path.join(__dirname, '..', 'public', 'editor', 'compose', 'intervals.js')));
});

// Block 300202, field for field: a 307x296 feature set in 12px type, with a
// 175x190 picture standing in the middle of it. 299px of measure; 12px type
// needs a 72px column; the picture leaves 62 on one side and 62 on the other,
// so neither can hold a word and the whole block sets nothing.
const WIDE = { contentLeft: 4, contentRight: 303, standOffPx: 6, minCorridorPx: 72, expectsCopy: true };

// Block 39131: a 190x264 second lead set in 16px type with a 95x88 picture.
// 182px of measure, 96px minimum column - there is no placement of a 95px
// picture that leaves one.
const NARROW = { contentLeft: 4, contentRight: 186, standOffPx: 6, minCorridorPx: 96, expectsCopy: true };

test('a picture standing in the middle is moved to an edge, so one whole column survives', () => {
  const out = snap({ x: 66, y: 71, width: 175, height: 190 }, WIDE);
  assert.equal(out.snapped, true);
  assert.equal(out.width, 175, 'the desk chose that size - moving is free, resizing is not');
  assert.equal(out.height, 190);
  const corridor = WIDE.contentRight - (out.x + out.width + WIDE.standOffPx);
  const other = (out.x - WIDE.standOffPx) - WIDE.contentLeft;
  assert.ok(corridor >= WIDE.minCorridorPx || corridor <= 0, `right corridor ${corridor} must be legal`);
  assert.ok(other >= WIDE.minCorridorPx || other <= 0, `left corridor ${other} must be legal`);
  assert.ok(corridor >= WIDE.minCorridorPx || other >= WIDE.minCorridorPx,
    'and one of them must actually be a column of type');
});

test('a picture no placement can save becomes a full-measure picture', () => {
  const out = snap({ x: 0, y: 151, width: 95, height: 88 }, NARROW);
  assert.equal(out.how, 'spanned');
  assert.equal(out.x, NARROW.contentLeft);
  assert.equal(out.width, NARROW.contentRight - NARROW.contentLeft);
  assert.equal(out.height, 88, 'the height is never touched');
});

test('a legal placement is left exactly alone - this never fights the pointer', () => {
  for (const rect of [
    { x: 4, y: 10, width: 76, height: 60 },      // flush left, 96px column beside it
    { x: 4, y: 10, width: 299, height: 60 },     // the full measure
    { x: 110, y: 10, width: 76, height: 60 },    // flush right
  ]) {
    const out = snap(rect, NARROW.minCorridorPx && rect.width > 100 ? WIDE : NARROW);
    assert.equal(out.snapped, false, `${JSON.stringify(rect)} is already legal`);
    assert.equal(out.x, rect.x);
    assert.equal(out.width, rect.width);
  }
});

test('the nearest legal placement wins, so the picture does not jump across the block', () => {
  // A hair inside the right edge: it must close to the right, not fly left.
  const out = snap({ x: 140, y: 10, width: 150, height: 100 }, WIDE);
  assert.equal(out.snapped, true);
  assert.ok(out.x > 100, `it must snap to the near edge, went to ${out.x}`);
});

test('a block that carries no copy is never snapped - a full-bleed advert is the finished advert', () => {
  const rect = { x: 30, y: 10, width: 150, height: 100 };
  const out = snap(rect, { ...WIDE, expectsCopy: false });
  assert.equal(out.snapped, false);
  assert.deepEqual({ x: out.x, width: out.width }, { x: rect.x, width: rect.width });
});

test('a multi-column block is left alone rather than snapped against the wrong measure', () => {
  const out = snap({ x: 66, y: 71, width: 175, height: 190 }, { ...WIDE, columnCount: 2 });
  assert.equal(out.snapped, false, 'a column-aware rule would be guessing - there is no such block to measure');
});

test('the rule is the engine\'s own minimum, not a second opinion about it', () => {
  assert.equal(MIN_CORRIDOR_EM, 6, 'if this moves, the snap and the pour must move together');
});

// ------------------------------------------------- and it actually composes ---

test('a snapped picture really does let the block set its copy', async () => {
  const adapter = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));
  const metrics = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'font-metrics.js'));
  const shaper = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'shaper.js'));
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);

  // Block 300202, field for field.
  const section = {
    block_type: 'article', width_px: 307, height_px: 296, margin_px: 4, column_count: 1,
    headline: 'सेंद्रिय शेती गटांसाठी', headline_font_px: '28.0',
    subheading: null, subheading_font_px: '15.0',
    body_font_px: '12.0', line_height: '1.25', text_align: 'justify',
    body: 'कृषी विभागाने सेंद्रिय शेती गटांसाठी तीन दिवसांचे प्रशिक्षण शिबिर आयोजित केले. माती परीक्षण, बियाणे निवड आणि खत व्यवस्थापन या विषयांवर मार्गदर्शन करण्यात आले.',
  };
  const picture = (rect) => [{ ...rect, shape: 'rect', rotation: 0, stand_off_px: 6 }];

  // The picture that reproduces the fault, DERIVED from this block rather than
  // remembered as two pixel numbers. The original fixture carried block
  // 300202's real placement (66, 71, 175x190), and it stopped reproducing the
  // fault the day the sink under the display type was corrected and the block
  // gained ten pixels of copy depth - one line then fitted above the picture
  // and the test was silently exercising nothing. Where the copy starts is not
  // a constant of a block; a fixture that assumes it is tests last week's
  // typography.
  //
  // Same fault, stated as what it IS: a picture with a dead corridor on both
  // sides, tall enough that neither the strip above it nor the strip below is
  // a whole line deep.
  const bare = adapter.composeSection({ ...section, images: [] }, {});
  const band = bare.typography.bodyPx * bare.typography.lineHeight;
  const standOff = 6;
  const rect = {
    x: 66,
    y: Math.round(bare.bodyTop + band * 0.6),
    width: 175,
    height: Math.round(bare.content.bottom - band - standOff - (bare.bodyTop + band * 0.6)) + 4,
  };

  const before = adapter.composeSection(
    { ...section, images: picture({ x_px: rect.x, y_px: rect.y, width_px: rect.width, height_px: rect.height }) }, {});
  assert.ok(before.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'),
    'the fixture must be the real fault: a picture leaving no legal column');
  assert.equal(before.bodyLines.length, 0, 'and it really sets nothing');

  const fixed = snap(rect,
    { contentLeft: before.content.left, contentRight: before.content.right,
      standOffPx: standOff, minCorridorPx: 6 * before.typography.bodyPx, expectsCopy: true });
  const after = adapter.composeSection(
    { ...section, images: picture({ x_px: fixed.x, y_px: fixed.y, width_px: fixed.width, height_px: fixed.height }) }, {});

  assert.ok(!after.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'),
    'the snapped placement must be legal by the engine\'s own reckoning');
  assert.ok(after.bodyLines.length > 0, 'and the block must now set its copy');
});

// ------------------------------------------------------ the vertical half ---
//
// A full-measure picture takes the whole measure, so copy cannot pass it -
// only sit above or below. Widening a picture to the measure while leaving it
// floating in the middle of the body can therefore make matters WORSE.
//
// Measured on block 39131: a 95px picture at y=151 in a 190x264 frame set in
// 16px type. Widened to the full 182px measure and left where it was, it
// leaves 15px of copy above it and 15px below - and one line of that type
// needs 25px, so the block still sets nothing at all.

const NARROW_V = {
  ...{ contentLeft: 4, contentRight: 186, standOffPx: 6, minCorridorPx: 96, expectsCopy: true },
  bodyTop: 130, bodyBottom: 260, bandHeightPx: 25,
};

test('a full-measure picture goes to the top of the copy or the foot, never mid-column', () => {
  const out = snap({ x: 0, y: 151, width: 95, height: 88 }, NARROW_V);
  assert.equal(out.width, 182, 'it spans the measure');
  assert.ok(out.how === 'spanned-at-top' || out.how === 'spanned-at-foot', `got ${out.how}`);
  const above = out.y - NARROW_V.bodyTop;
  const below = NARROW_V.bodyBottom - (out.y + out.height);
  assert.ok(Math.max(above, below) >= NARROW_V.bandHeightPx,
    `one side must hold a whole line: ${above} above, ${below} below`);
});

test('a picture too tall for the block is left alone rather than shuffled to no effect', () => {
  const out = snap({ x: 0, y: 140, width: 95, height: 125 }, NARROW_V);
  assert.equal(out.snapped, false, 'nowhere to put it helps - that is a picture this block cannot take');
  assert.equal(out.how, 'does-not-fit');
});

// ------------------------------------------------- the repair is an OFFER ---
//
// The warning names three things a desk could do about an unprintable block.
// SAHAS already knows which picture is in the way and exactly where it would
// have to go - corridor-snap computes that for every placement anyway - so
// printing the advice while holding the answer is the same failure as
// printing a number nobody can act on.
//
// It stays an offer: a button, pressed by a person, going through the same
// picture patch a drag makes. Nothing here moves a stored picture on its own.

test('a block that cannot be printed is offered the repair, with the exact rectangle', async () => {
  const panel = await import(path.join(__dirname, '..', 'public', 'editor', 'external-editor', 'layout-panel.js'));
  const adapter = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));
  const metrics = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'font-metrics.js'));
  const shaper = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'shaper.js'));
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);

  // Block 39131, the one block in the database still carrying this fault.
  const section = {
    block_type: 'article', width_px: 190, height_px: 264, margin_px: 4, column_count: 1,
    headline: 'सातारा: पाणीटंचाईची सावट', headline_font_px: '17.0',
    subheading: 'अनेक भागात पाणीपुरवठा कमी झाला असून नागरिक त्रस्त आहेत.', subheading_font_px: '16.0',
    body_font_px: '16.0', line_height: '1.25', text_align: 'justify',
    body: 'पाणीपुरवठा कमी झाल्याने दैनंदिन जीवन विस्कळीत होऊन नागरिक त्रस्त आहेत.',
  };
  const images = [{ id: 7, x_px: 0, y_px: 151, width_px: 95, height_px: 88, shape: 'rect', rotation: 0, stand_off_px: 6 }];

  const before = adapter.composeSection({ ...section, images }, {});
  assert.ok(before.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'), 'the fixture must be the real fault');

  const repair = panel.placementRepair(section, {}, images);
  assert.ok(repair, 'a repair must be offered, not just advice');
  assert.equal(repair.imageId, 7);

  // And it really works - the offer is checked against the engine before it is
  // ever shown, so a button that does not fix the block is never drawn.
  const moved = [{ ...images[0], x_px: repair.patch.x, y_px: repair.patch.y,
    width_px: repair.patch.width, height_px: repair.patch.height }];
  const after = adapter.composeSection({ ...section, images: moved }, {});
  assert.ok(!after.warnings.some((w) => w.code === 'NO_LEGAL_MEASURE'));
  assert.ok(after.bodyLines.length > 0, 'the block must set its copy after the repair');
});

test('a printable block is offered nothing - there is nothing to repair', async () => {
  const panel = await import(path.join(__dirname, '..', 'public', 'editor', 'external-editor', 'layout-panel.js'));
  const section = {
    block_type: 'article', width_px: 307, height_px: 296, margin_px: 4, column_count: 1,
    headline: 'सेंद्रिय शेती गटांसाठी', headline_font_px: '28.0',
    body_font_px: '12.0', line_height: '1.25', text_align: 'justify',
    body: 'कृषी विभागाने सेंद्रिय शेती गटांसाठी तीन दिवसांचे प्रशिक्षण शिबिर आयोजित केले.',
  };
  const images = [{ id: 9, x_px: 128, y_px: 71, width_px: 175, height_px: 190, shape: 'rect', rotation: 0, stand_off_px: 6 }];
  assert.equal(panel.placementRepair(section, {}, images), null);
});

test('a block with no picture at all is never offered a picture repair', async () => {
  const panel = await import(path.join(__dirname, '..', 'public', 'editor', 'external-editor', 'layout-panel.js'));
  assert.equal(panel.placementRepair({ block_type: 'article', width_px: 190, height_px: 264 }, {}, []), null);
});
