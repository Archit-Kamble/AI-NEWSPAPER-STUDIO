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

// -------------------------------------------- the separator that was silent ---

test('a PLAIN separator is a panel, not an empty one', () => {
  // The Separator vocabulary's first and commonest entry is `plain` - two
  // rules and nothing between them, which is what a printed paper sets most
  // often. It carries no mark, and panelOf() judged a panel with neither a
  // title nor a line empty and threw it away. So the draft stored it, the
  // menu lit its "Remove the separator" item, and the page, the Block Editor,
  // the compositor's obstacle set and all four exports drew NOTHING. An
  // ornament is its own rules; the kind decides, exactly as it already did
  // for a chart.
  require('../public/editor/layout/inset-panels.js');
  const { panelOf, panelsOf, panelLayout } = globalThis.SahasInsetPanels;
  const frame = { width: 190, height: 264 };
  const plain = { id: 'p1', kind: 'ornament', x: 2, y: 120, width: 186, height: 12, title: '', lines: [] };

  const kept = panelOf(plain, frame);
  assert.ok(kept, 'a plain separator survives');
  assert.equal(kept.kind, 'ornament');
  assert.deepEqual(kept.lines, [], 'and it carries no line, because it has no mark');
  assert.equal(panelLayout(kept, 6.4).lines.length, 0, 'so it sets no type - its rules are its ink');

  // A marked one is unchanged, and so is the emptiness rule everywhere else.
  const diamond = panelOf({ ...plain, id: 'p2', lines: ['◆'] }, frame);
  assert.equal(diamond.lines.length, 1);
  assert.equal(panelOf({ id: 'p3', kind: 'note', x: 2, y: 10, width: 100, height: 40, title: '', lines: [] }, frame), null,
    'a fact box with nothing in it is still refused - that is what the test is FOR');

  // And it reaches a real section's panel list.
  assert.equal(panelsOf({ width_px: 190, height_px: 264, inset_panels: [plain] }).length, 1);
});

test('a block reports the status every other surface reports', async () => {
  // properties-panel.js read `view.status` raw. That column is NULL until a
  // desk explicitly sets one, so a block with a headline, a story and a
  // photograph in it read "empty" in the Properties panel while the canvas
  // badge beside it said "editing" - one derived answer, one second copy, and
  // the second copy was the one under the desk's eye.
  const { statusOf } = await import('../public/editor/status/section-status.js');
  assert.equal(statusOf({ headline: '', body: '' }, false), 'empty');
  assert.equal(statusOf({ headline: 'पाणीपुरवठा', body: 'copy' }, false), 'editing',
    'a written block is never empty');
  assert.equal(statusOf({ headline: '', body: '' }, true), 'editing',
    'nor is one carrying only a photograph');
  assert.equal(statusOf({ headline: 'x', body: 'y', status: 'ready' }, false), 'ready',
    'and an explicit decision still wins');
});

test('the block is not offered a tracking control the page will not set', async () => {
  // letter_spacing_px was measured by compose.js and drawn by NOBODY - not
  // render.js, not the PDF, the IDML, the .docx or the .sla. The only thing
  // that ever showed it was the Typography panel's own preview paragraph,
  // which is exactly how drop_cap BOOLEAN and list_style presented. A block
  // measured tracked and set untracked falls short of its own measure on
  // every line.
  const fs = require('node:fs');
  const panel = fs.readFileSync('public/editor/external-editor/typography-panel.js', 'utf8');
  const code = panel.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/letterSpacingPx/.test(code),
    'the panel neither offers tracking nor previews it');

  // The column, the model and the compositor keep their support, so nothing
  // stored changes and this is one line to put back.
  const model = fs.readFileSync('public/editor/section-model.js', 'utf8');
  assert.ok(/letterSpacingPx/.test(model), 'the stored field is untouched');
});

test('an empty story is empty, not the story that was there before', async () => {
  // pick() treats '' as "the desk has not said" - right for a font family,
  // wrong for the words. Measured in the running app: a sub-editor puts the
  // caret in the body, presses Ctrl+A and Delete, the draft goes 490
  // characters to 0 and SAVES, the canvas sets the dateline alone - and the
  // Block Editor's own page went on setting all thirteen lines of the copy
  // that had just been deleted, because '' fell through to the row it still
  // held. Taking a reporter's story that carries no body does the same.
  const adapter = await import('../public/editor/compose/section-adapter.js');
  const row = {
    ...BLOCK, headline: 'पाणीपुरवठा योजनेला गती', subheading: '', kicker: '',
    body: 'सातारा जिल्ह्यातील ग्रामीण भागात पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात आले आहे. '
      + 'महापालिकेने शहरातील रस्त्यांच्या दुरुस्तीसाठी स्वतंत्र निधी मंजूर केला आहे.',
  };
  const asStored = adapter.composeSection(row, {});
  assert.ok(asStored.bodyLines.length > 1, 'the fixture must actually set several lines');

  // A DRAFT THAT SAYS EMPTY IS OBEYED.
  const cleared = adapter.composeSection(row, { ...row, body: '' });
  const datelineOnly = cleared.bodyLines.filter((line) => !line.dateline).length;
  assert.equal(datelineOnly, 0, 'a cleared story sets no copy');

  // AND AN ABSENT KEY STILL READS THE ROW - every server-side caller composes
  // a stored row with an empty view (preflight, worklist, copyFit).
  assert.equal(adapter.composeSection(row, {}).bodyLines.length, asStored.bodyLines.length);
  assert.equal(adapter.composeSection(row, { headline: '' }).bands.headline?.lines.length ?? 0, 0,
    'a headline cleared to empty sets no headline');
  assert.ok(adapter.composeSection(row, {}).bands.headline.lines.length > 0,
    'while a view that never mentions the headline still reads the row');

  // THE DATELINE'S FIELDS ARE COPY TOO, and this is one field further on:
  // after the body was fixed, taking a story with no location left the canvas
  // setting "■ reporter" and the Block Editor "■ पाटण, reporter" - a different
  // dateline, a different measure and a different number of lines.
  const dated = { ...row, body: '', location: 'पाटण', reporter_name: 'सुजॉय' };
  const line = (c) => c.bodyLines.map((l) => l.text).join(' | ');
  assert.match(line(adapter.composeSection(dated, {})), /पाटण/,
    'an empty view still reads the row - preflight, worklist and copyFit rely on it');
  assert.doesNotMatch(line(adapter.composeSection(dated, { location: '', author: 'सुजॉय', body: '' })), /पाटण/,
    'a cleared location is obeyed');
  assert.match(line(adapter.composeSection(dated, { author: 'सुजॉय', body: '' })), /पाटण/,
    'and a view that never mentions the location still reads the row');
});
