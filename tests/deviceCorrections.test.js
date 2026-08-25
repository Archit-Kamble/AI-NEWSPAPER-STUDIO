// The eleven corrections the desk reported after using the device bar.
//
// Every one of these is a behaviour a desk pressed a button for and did not
// get. They are held here rather than in the browser net where the assertion
// is about arithmetic rather than about what moved on the screen - the net
// still drives all eleven, because half of these faults were only ever
// visible by looking at a page.
const test = require('node:test');
const assert = require('node:assert/strict');

let adapter; let compose; let cards; let panels; let model;

test.before(async () => {
  model = require('../src/services/export/print-model.js');
  const ready = await model.ensureComposeReady();
  adapter = ready.adapter;
  compose = ready.compose;
  cards = ready.smartCardLayout;
  panels = require('../public/editor/layout/inset-panels.js');
});

const BLOCK = Object.freeze({
  width_px: 200, height_px: 240, margin_px: 12, body_font_px: 6.4,
  headline_font_px: 20, subheading_font_px: 12, line_height: 1.45,
  block_type: 'article',
  // Long enough to actually reach down the block. A two-line fixture sits
  // entirely above anything set into the middle of the story, so a panel that
  // works perfectly would still narrow nothing and the test would read as a
  // failure of the feature rather than of its own copy.
  body: 'शहरातील रस्त्यांची कामे वेगाने सुरू असून नागरिकांनी समाधान व्यक्त केले आहे. '
    + 'पालिकेने उर्वरित कामे महिनाअखेरीस पूर्ण होतील असे सांगितले. ठेकेदाराने मुदतीत '
    + 'काम पूर्ण न केल्यास दंड आकारला जाईल असा इशारा प्रशासनाने दिला आहे. या भागातील '
    + 'नागरिकांनी गेली दोन वर्षे पाठपुरावा केला होता. रस्त्याच्या दुतर्फा पथदिवे आणि '
    + 'पदपथाचे कामही याच निधीतून केले जाणार असल्याचे सांगण्यात आले. उर्वरित रकमेचा '
    + 'हिशेब सर्वसाधारण सभेपुढे ठेवला जाईल.',
});

// ---------------------------------------------------------------- item 2 ---

test('ruling a block does not re-set its copy', () => {
  const plain = adapter.composeSection({ ...BLOCK }, {});
  const boxed = adapter.composeSection({ ...BLOCK, border_style: 'box' }, {});

  // The measure is what decides every line break, so this is the whole claim.
  assert.equal(boxed.content.left, plain.content.left,
    'a box must not move the copy in - the 12 px margin already clears it twice over');
  assert.deepEqual(
    boxed.bodyLines.map((line) => line.text),
    plain.bodyLines.map((line) => line.text),
    'and therefore not one line may break differently',
  );
});

test('but a block set tight is still pushed clear of its own rule', () => {
  const tight = adapter.composeSection({ ...BLOCK, margin_px: 1 }, {});
  const boxed = adapter.composeSection({ ...BLOCK, margin_px: 1, border_style: 'box' }, {});
  assert.ok(boxed.content.left > tight.content.left,
    'at margin 1 the box really is the larger number, and the type has to come in');
});

// ---------------------------------------------------------------- item 9 ---

test('a drop cap sets on a block that opens with a dateline', () => {
  const dated = adapter.composeSection(
    { ...BLOCK, drop_cap_lines: 3, location: 'सातारा', reporter_name: 'प्रतिनिधी' }, {},
  );
  assert.ok(dated.dropCap, 'this refused outright before, on most of the blocks in a paper');
  assert.ok(!dated.dropCap.text.includes('■'),
    'and it is a letter, not the dateline\'s own square drawn three lines deep');
  // The dateline takes the first line to itself; the cap opens the story under it.
  assert.ok(dated.bodyLines[0].text.includes('सातारा'));
  assert.ok(dated.dropCap.y > dated.bodyLines[0].y,
    'the cap starts below the dateline, not beside it');
});

test('a vowel sign above the head stroke makes the cap smaller, not taller', () => {
  const plain = adapter.composeSection({ ...BLOCK, drop_cap_lines: 3, body: 'शहरातील रस्ते' }, {});
  const above = adapter.composeSection({ ...BLOCK, drop_cap_lines: 3, body: 'शीतगृहातील माल' }, {});
  assert.ok(above.dropCap.fontPx < plain.dropCap.fontPx,
    'ी rises over the head stroke, so the cap comes down to keep its ink inside the block');
  assert.ok(Math.abs(above.dropCap.baseline - plain.dropCap.baseline) < 0.01,
    'and its baseline may not move - it is the baseline of the last line it spans');
});

test('a vowel sign below the baseline keeps the copy off it', () => {
  const plain = adapter.composeSection({ ...BLOCK, drop_cap_lines: 3 }, {});
  const below = adapter.composeSection(
    { ...BLOCK, drop_cap_lines: 3, body: `सुरक्षा ${BLOCK.body}` }, {},
  );
  // The first line that starts at the block's own left edge again - i.e. the
  // first line no longer standing beside the cap.
  // The first line that has the whole measure back - i.e. the first one no
  // longer standing beside the cap.
  const clears = (composition) => {
    const full = composition.content.right - composition.content.left;
    return composition.bodyLines.find((line) => line.measure > full - 0.5);
  };
  assert.ok(clears(plain) && clears(below), 'both blocks must set past their cap at all');
  assert.ok(clears(below).y > clears(plain).y,
    'ु hangs past the cap\'s reserved lines, so the copy has to start a band lower');
});

// --------------------------------------------------------------- item 10 ---

test('a block may decline its dateline, and every reader agrees', () => {
  const on = adapter.composeSection({ ...BLOCK, location: 'सातारा', reporter_name: 'प्रतिनिधी' }, {});
  const off = adapter.composeSection(
    { ...BLOCK, location: 'सातारा', reporter_name: 'प्रतिनिधी', show_dateline: false }, {},
  );
  assert.ok(on.bodyLines[0].text.includes('■'));
  assert.ok(!off.bodyLines[0].text.includes('■'));
  // The capacity count has to agree, or a block is reported full while it
  // shows short - the fault the dateline itself once had in the other
  // direction.
  const textFlow = require('../public/editor/layout/text-flow.js');
  assert.equal(textFlow.datelineText({ location: 'सातारा', showDateline: false }), '');
  assert.ok(textFlow.datelineText({ location: 'सातारा' }).length > 0);
});

// ---------------------------------------------------------------- item 4 ---

test('a chart is printed in the ink it was given, in tints of that one ink', () => {
  const frame = { width: 160, height: 120, padding: 0 };
  const data = { chartType: 'pie', items: [{ label: 'अ', value: 3 }, { label: 'ब', value: 1 }] };

  const red = cards.layoutSmartCard('chart', data, frame);
  const blue = cards.layoutSmartCard('chart', { ...data, ink: '#17458f' }, frame);
  assert.equal(red.geometry.ink, '#c8102e', 'the paper\'s red is the default and stays it');
  assert.equal(blue.geometry.ink, '#17458f');

  const inks = blue.items.map((item) => item.ink);
  assert.equal(new Set(inks).size, inks.length, 'each slice is a different tint');
  for (const ink of inks) assert.match(ink, /^#[0-9a-f]{6}$/, 'a real hex every writer can draw');

  // Not a colour a desk mixed in a browser: a press has four plates.
  assert.equal(cards.layoutSmartCard('chart', { ...data, ink: '#123456' }, frame).geometry.ink,
    '#c8102e', 'a colour that is not one of the paper\'s inks falls back rather than printing');
});

test('a chart can be a panel inside a story, and it survives being read back', () => {
  const raw = {
    kind: 'chart', width: 90, height: 70, x: 10, y: 20,
    card: { chartType: 'pie', ink: '#0a7a3f', items: [{ label: 'अ', value: 2 }] },
  };
  const panel = panels.panelOf(raw, { width: 200, height: 240 });
  assert.ok(panel, 'a chart panel has no title and no lines and is still not empty');
  assert.equal(panel.card.items.length, 1);
  assert.equal(panels.panelOf({ ...raw, card: null }, { width: 200, height: 240 }), null,
    'one with no readings is empty, and an empty panel may not take layout space');
  // And the compositor sees it as what it is: a rectangle, like a photograph.
  assert.deepEqual(panels.obstacleFromPanel(panel).shape, 'rect');
});

test('a chart panel narrows the copy that runs past it', () => {
  const withoutPanel = adapter.composeSection({ ...BLOCK }, {});
  const withPanel = adapter.composeSection({
    ...BLOCK,
    inset_panels: [{
      kind: 'chart', x: 110, y: 40, width: 80, height: 70,
      card: { chartType: 'bar', items: [{ label: 'अ', value: 2 }] },
    }],
  }, {});
  const narrowest = (c) => Math.min(...c.bodyLines.map((line) => line.measure));
  assert.ok(narrowest(withPanel) < narrowest(withoutPanel),
    'the story runs round the chart, which is what "block inside block" means');
});

// ---------------------------------------------------------------- item 6 ---

test('the separator vocabulary is a catalogue, not one hard-coded mark', () => {
  assert.ok(panels.INSET_PANEL_ORNAMENTS.length > 1);
  const plain = panels.INSET_PANEL_ORNAMENTS.find((o) => o.key === 'plain');
  assert.equal(plain.mark, '', 'the commonest separator is two rules and nothing between them');
  // Only marks the publication faces carry - U+2022 is in neither (BULLET's
  // own comment), so a separator may not quietly reintroduce it.
  for (const ornament of panels.INSET_PANEL_ORNAMENTS) {
    assert.ok(!ornament.mark.includes('•'), `${ornament.key} may not use U+2022`);
  }
});

// ---------------------------------------------------------------- item 1 ---

test('a justified line reaches the plate justified, not just the screen', async () => {
  // compose.js justifies with two levers; `render.js` applied both and NOTHING
  // ELSE DID. Measured on one real block: the canvas set nine lines with 4 px
  // of variation in their right edge, the press PDF set the same nine with
  // 111 px. The levers have to travel with the line, or the two surfaces are
  // rendering different newspapers.
  const model = require('../src/services/export/print-model.js');
  const justified = {
    ...BLOCK, width_px: 300, text_align: 'justify', column_count: 1,
    headline: '', subheading: '',
  };
  const page = {
    id: 1, page_number: 1, sections: [{ ...justified, x_px: 0, y_px: 0, section_key: 'lead', images: [] }],
  };
  const built = await model.buildPrintModel(
    { page_width_px: 660, page_height_px: 1060, matter_width_px: 620, matter_height_px: 1020,
      publication_date: '2099-01-01', column_rules: false },
    [page],
  );
  const lines = built.pages[0].items.filter((item) => item.kind === 'text' && item.baseline);
  const carrying = lines.filter((item) => item.wordSpacingMm || item.glyphScaleX);
  assert.ok(carrying.length > 0,
    'a justified block must hand its writers the spacing it justified with');
  for (const item of carrying) {
    // NEGATIVE IS LEGAL, and it is the third lever: a line the breaker chose
    // to set TIGHT carries a negative word space and a scale below 1, because
    // the alternative was leaving the word that fills it stranded on the line
    // below. A writer that only handled the expanding case would draw those
    // lines overhanging their column.
    assert.ok(!item.wordSpacingMm || Number.isFinite(item.wordSpacingMm),
      'word space is a real measurement in mm, positive or negative');
    assert.ok(!item.glyphScaleX || (item.glyphScaleX >= 0.979 && item.glyphScaleX <= 1.031),
      'and the stretch stays inside the newspaper range');
  }
  assert.ok(carrying.some((item) => (item.wordSpacingMm || 0) > 0),
    'and at least one line was genuinely stretched to its measure');
});

test('a flush-left block hands its writers nothing, so nothing about it changes', async () => {
  const model = require('../src/services/export/print-model.js');
  const page = {
    id: 1, page_number: 1,
    sections: [{ ...BLOCK, x_px: 0, y_px: 0, section_key: 'lead', text_align: 'left', images: [] }],
  };
  const built = await model.buildPrintModel(
    { page_width_px: 660, page_height_px: 1060, matter_width_px: 620, matter_height_px: 1020,
      publication_date: '2099-01-01', column_rules: false },
    [page],
  );
  assert.equal(
    built.pages[0].items.filter((item) => item.wordSpacingMm || item.glyphScaleX).length, 0,
  );
});

// ---------------------------------------------------------------- item 2 ---

test('a locked display size is the size that is set', () => {
  const tall = { ...BLOCK, headline: 'पाणीपुरवठा योजनेला गती', headline_font_px: 40 };
  const fitted = adapter.composeSection(tall, {});
  const locked = adapter.composeSection({ ...tall, headline_locked: true }, {});
  assert.equal(locked.bands.headline.resolvedPx, 40,
    'the desk asked for 40 and locked it, so the page sets 40');
  // And the point of the control: unlocked, the compositor is free to fit -
  // which is right, and is also why a desk who typed a size could see nothing
  // happen. The lock is how they say which of the two they meant.
  assert.ok(fitted.bands.headline.resolvedPx !== 40
    || locked.bands.headline.resolvedPx === fitted.bands.headline.resolvedPx);
  assert.equal(fitted.bands.headline.requestedPx, 40, 'and the request is still reported either way');
});

// ---------------------------------------------------------------- item 4 ---

test('the breaker is charged for how hard a line has to be stretched', () => {
  // Not for its raw slack alone, which is what let one line take a 0.55 em
  // word space while the next needed none. Both are "closable", and
  // (slack/measure)^3 for a closable line is about 0.002 - no reason at all to
  // even them out.
  const wide = {
    ...BLOCK, width_px: 320, column_count: 1, text_align: 'justify',
    headline: '', subheading: '',
  };
  const composed = adapter.composeSection(wide, {});
  const inner = composed.bodyLines.filter((line, i) => i < composed.bodyLines.length - 1
    && !composed.bodyLines[i + 1].paragraphBreak);
  assert.ok(inner.length >= 3, 'the fixture must actually set several justified lines');
  const ems = inner.map((line) => (line.wordSpacingPx || 0) / line.fontPx);
  for (const em of ems) {
    assert.ok(em <= 0.56, `no line may exceed the word-space cap (saw ${em.toFixed(3)} em)`);
  }
});
