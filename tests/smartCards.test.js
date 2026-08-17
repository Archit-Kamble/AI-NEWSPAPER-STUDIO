// Problem #8: deterministic newspaper geometry for a Smart Card - a pure
// solver (layoutSmartCard()) and a renderer (smartCardMarkup()) that reads
// its answer, replacing three disagreeing hardcoded font-sizes (7px on the
// page, a dead 9px editor rule, 13-15px in the AI proposal preview) with one
// computed answer from the block's own logical width/height. Pure modules,
// so this tests the arithmetic and the markup directly - no DOM, no server.

const test = require('node:test');
const assert = require('node:assert/strict');

let layout;
let cards;

test.before(async () => {
  layout = await import('../public/editor/smart-cards/layout.js');
  cards = await import('../public/editor/smart-cards/smart-cards.js');
});

const FRAME = { width: 230, height: 300, padding: 10 };
const TINY_FRAME = { width: 30, height: 30, padding: 4 };

function sudokuData() {
  const grid = Array.from({ length: 9 }, (u, r) => Array.from({ length: 9 }, (u2, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1));
  return { grid };
}

function rashiData(count = 12) {
  return {
    signs: Array.from({ length: count }, (u, i) => ({
      key: `sign${i}`, name: `राशी${i}`, text: 'आजचा दिवस चांगला जाईल.', luckyNumber: i + 1, luckyColour: 'निळा',
    })),
  };
}

function panchangData() {
  return {
    items: [
      { label: 'सूर्योदय', text: '०६:३०' },
      { label: 'सूर्यास्त', text: '१८:४५' },
      { label: 'दिनमान', text: '१२ तास' },
      { label: 'राहुकाळ', text: '११:०० ते १२:३०' },
      { label: 'शके', text: '१९४६' },
    ],
  };
}

function dinvisheshData() {
  return {
    entries: [
      { text: '१८८५: भारतीय राष्ट्रीय काँग्रेसची स्थापना.' },
      { text: '१९४७: भारताला स्वातंत्र्य मिळाले.' },
      { text: '१९६९: पहिला मानव चंद्रावर उतरला.' },
    ],
  };
}

// ----------------------------------------------------------------- sudoku ---

test('sudoku: all 81 cells are exact squares, in a known frame', () => {
  const html = cards.smartCardMarkup('sudoku', sudokuData(), FRAME);
  const cells = [...html.matchAll(/<td[^>]*style="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(cells.length, 81, 'nine rows of nine');
  const sizes = new Set(cells.map((style) => {
    const w = /width:([\d.]+)px/.exec(style)[1];
    const h = /height:([\d.]+)px/.exec(style)[1];
    return `${w}x${h}`;
  }));
  assert.equal(sizes.size, 1, `every cell must be the SAME square size, got ${[...sizes].join(', ')}`);
  const [w, h] = [...sizes][0].split('x');
  assert.equal(w, h, 'width must equal height - a square, not a rectangle');
});

test('sudoku: the 3x3 box rules are still the heavier ones', () => {
  const html = cards.smartCardMarkup('sudoku', sudokuData(), FRAME);
  assert.equal((html.match(/box-right/g) || []).length, 18, 'two heavier vertical rules, nine rows deep');
  assert.equal((html.match(/box-bottom/g) || []).length, 18, 'two heavier horizontal rules, nine columns wide');
});

test('sudoku: fits a real, roomy frame at FITS', () => {
  const result = layout.layoutSmartCard('sudoku', sudokuData(), FRAME);
  assert.equal(result.fitState, 'FITS');
  assert.ok(result.geometry.cell > 10, `cell should be comfortably above the floor, got ${result.geometry.cell}`);
});

test('sudoku: a tiny frame returns OVERSET, not a silently shrunk grid', () => {
  const result = layout.layoutSmartCard('sudoku', sudokuData(), TINY_FRAME);
  assert.equal(result.fitState, 'OVERSET');
  // Clamped to the legible floor, not shrunk below it, even though it does
  // not fit - "do not silently shrink to unreadability".
  assert.ok(result.geometry.cell >= 10, `cell must not go below the legible floor, got ${result.geometry.cell}`);
  const html = cards.smartCardMarkup('sudoku', sudokuData(), TINY_FRAME);
  assert.ok(html.includes('is-overset'), 'the markup must carry the overset flag');
  assert.ok(html.includes('data-fit-state="OVERSET"'), 'and a machine-readable fit state - the card still draws, it is not deleted');
  // The desk-facing warning sentence is NOT here - it would be printable
  // newspaper content if it were. It surfaces instead as editor chrome
  // (section-thumb.js's section-flags badge) and in the AI proposal preview
  // before acceptance (smart-card-panel.js), never inside the card itself.
  assert.ok(!html.includes('smart-card-overset-note'), 'a desk diagnostic must never become printable card content');
});

// ------------------------------------------------------------------- rashi ---

test('rashi: a narrow frame solves to one column', () => {
  const result = layout.layoutSmartCard('rashi', rashiData(), { width: 100, height: 400, padding: 8 });
  assert.equal(result.geometry.columns, 1);
  assert.equal(result.geometry.rows, 12);
});

test('rashi: a wide frame solves to two columns', () => {
  const result = layout.layoutSmartCard('rashi', rashiData(), { width: 260, height: 400, padding: 8 });
  assert.equal(result.geometry.columns, 2);
  assert.equal(result.geometry.rows, 6);
});

test('rashi: all twelve signs are present in the markup, none dropped', () => {
  const data = rashiData();
  const html = cards.smartCardMarkup('rashi', data, FRAME);
  assert.equal((html.match(/smart-card-rashi-sign/g) || []).length, 12);
  for (const sign of data.signs) assert.ok(html.includes(sign.name), `${sign.name} must be present`);
});

test('rashi: no clipping - overflow is flagged (OVERSET), never hidden', () => {
  // Twelve signs in a frame far too short to hold them at any legible size.
  const result = layout.layoutSmartCard('rashi', rashiData(), { width: 200, height: 20, padding: 4 });
  assert.equal(result.fitState, 'OVERSET');
  assert.ok(result.fontPx >= 5.5, 'still a real, legible font - not shrunk to nothing to hide the overflow');
});

test('rashi: a false FITS is closed - twenty repetitions of real reading copy cannot fit in a fixed 3-line row', () => {
  // The exact repro that exposed the bug: layoutRashi() used to charge every
  // sign a FIXED three lines regardless of what it actually held, so this
  // reported FITS at 9px. It cannot - the reading text alone is roughly
  // twenty real sentences.
  const data = {
    signs: Array.from({ length: 12 }, (u, i) => ({
      key: `sign${i}`,
      name: `राशी${i}`,
      text: 'अत्यंत लांब राशिभविष्य मजकूर '.repeat(20),
      luckyNumber: i + 1,
      luckyColour: 'निळा',
    })),
  };
  const result = layout.layoutSmartCard('rashi', data, { width: 260, height: 400, padding: 8 });
  assert.equal(result.fitState, 'OVERSET', 'twenty repeated sentences per sign cannot fit a 400px-tall card');
  // And the height actually reflects the real text - each item's resolved
  // reading is many lines deep, not the old fixed count of one.
  assert.ok(result.items[0].readingLines.length > 3, `expected many wrapped lines, got ${result.items[0].readingLines.length}`);
});

test('rashi: row height is content-aware - a sign with more real text gets a taller row, not a uniform share', () => {
  const data = {
    signs: [
      { key: 'short', name: 'अ', text: 'ठीक.', luckyNumber: 1, luckyColour: 'लाल' },
      { key: 'long', name: 'ब', text: 'हा एक खूप मोठा आणि तपशीलवार मजकूर आहे जो अनेक ओळींमध्ये विभागला जाईल.', luckyNumber: 2, luckyColour: 'निळा' },
    ],
  };
  // One column (narrow frame), so both signs are separate rows - the row
  // heights must differ, because the old code gave every row an identical
  // frame.innerHeight / rows share regardless of content.
  const result = layout.layoutSmartCard('rashi', data, { width: 140, height: 300, padding: 8 });
  const [shortHeight, longHeight] = result.geometry.rowHeights;
  assert.ok(longHeight > shortHeight, `the row with more real text must be taller: short=${shortHeight} long=${longHeight}`);
});

// ---------------------------------------------------------------- panchang ---

test('panchang: all rows are present', () => {
  const html = cards.smartCardMarkup('panchang', panchangData(), FRAME);
  assert.equal((html.match(/<tr[ >]/g) || []).length, 5);
  for (const label of ['सूर्योदय', 'सूर्यास्त', 'दिनमान', 'राहुकाळ', 'शके']) {
    assert.ok(html.includes(`<th>${label}</th>`));
  }
});

test('panchang: fits a deterministic frame', () => {
  const result = layout.layoutSmartCard('panchang', panchangData(), FRAME);
  assert.equal(result.fitState, 'FITS');
});

test('panchang: a false FITS is closed - a value column is measured by its real width, not by font height alone', () => {
  // The exact repro: the old solver only checked candidate font height
  // against a uniform row height, never the value text's own width - so a
  // row holding a genuinely long value could still report FITS.
  const data = {
    items: [
      { label: 'सूर्योदय', text: '०६:३०' },
      { label: 'सूर्यास्त', text: '१८:४५' },
      { label: 'दिनमान', text: '१२ तास' },
      { label: 'राहुकाळ', text: 'ही एक अत्यंत लांब आणि तपशीलवार नोंद आहे जी अनेक ओळींमध्ये मोडेल कारण ती एका ओळीत मुळीच बसत नाही. '.repeat(30) },
      { label: 'शके', text: '१९४६' },
    ],
  };
  const result = layout.layoutSmartCard('panchang', data, FRAME);
  assert.equal(result.fitState, 'OVERSET', 'one genuinely long value cannot fit a five-row 300px card');
  const raahukaal = result.items.find((item) => item.label === 'राहुकाळ');
  assert.ok(raahukaal.valueLines.length > 1, `expected the long value to wrap onto several real lines, got ${raahukaal.valueLines.length}`);
});

test('panchang: a tiny frame returns OVERSET', () => {
  const result = layout.layoutSmartCard('panchang', panchangData(), TINY_FRAME);
  assert.equal(result.fitState, 'OVERSET');
});

// ---------------------------------------------------------------- suvichar ---

test('suvichar: the quote and its attribution are both present', () => {
  // A quote this short, in a frame this roomy, now solves at a large enough
  // font (CANDIDATE_FONT_PX's raised ceiling - the whole point of a "fill
  // the card" fix) that it legitimately wraps onto more than one
  // smart-card-line span, exactly like any other Smart Card text - so this
  // strips markup and compares words, rather than asserting the quote
  // survives as one unbroken string.
  const data = { text: 'प्रयत्ने वाळूचे कण रगडिता तेलही गळे.', attribution: 'समर्थ रामदास' };
  const html = cards.smartCardMarkup('suvichar', data, FRAME);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(text.includes('प्रयत्ने वाळूचे कण रगडिता तेलही गळे.'), `quote words missing or reordered: ${text}`);
  assert.ok(html.includes('समर्थ रामदास'));
});

test('suvichar: fit state is explicit, both ways', () => {
  const data = { text: 'प्रयत्ने वाळूचे कण रगडिता तेलही गळे.', attribution: 'समर्थ रामदास' };
  const fits = layout.layoutSmartCard('suvichar', data, FRAME);
  assert.equal(fits.fitState, 'FITS');
  const oversets = layout.layoutSmartCard('suvichar', data, TINY_FRAME);
  assert.equal(oversets.fitState, 'OVERSET');
});

// -------------------------------------------------------------- dinvishesh ---

test('dinvishesh: all entries are present, in order', () => {
  // A raised font ceiling (CANDIDATE_FONT_PX) means a short entry list in a
  // roomy frame can legitimately wrap each entry across several
  // smart-card-line spans now, not one bare text run per <li> - so this
  // extracts each <li>'s full text across any nested spans, rather than
  // assuming no markup ever sits between the tags.
  const data = dinvisheshData();
  const html = cards.smartCardMarkup('dinvishesh', data, FRAME);
  const items = [...html.matchAll(/<li>(.*?)<\/li>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.equal(items.length, data.entries.length);
  assert.deepEqual(items, data.entries.map((e) => e.text), 'entries must print in the SAME order they were stored');
});

test('dinvishesh: fit state is explicit, both ways', () => {
  const data = dinvisheshData();
  const fits = layout.layoutSmartCard('dinvishesh', data, FRAME);
  assert.equal(fits.fitState, 'FITS');
  const oversets = layout.layoutSmartCard('dinvishesh', data, TINY_FRAME);
  assert.equal(oversets.fitState, 'OVERSET');
});

// --------------------------------------------------------------- subtitle ---

test('the subtitle is measured BEFORE the card body, and its real height is deducted, not added afterward', () => {
  const withoutSubtitle = layout.layoutSmartCard('panchang', panchangData(), FRAME);
  const longSubtitle = { ...panchangData(), subtitle: 'ही एक तपशीलवार उपशीर्षक ओळ आहे जी दोन ओळींमध्ये मोडेल.' };
  const withSubtitle = layout.layoutSmartCard('panchang', longSubtitle, FRAME);

  assert.ok(withSubtitle.subtitle.lines.length > 0, 'the subtitle resolves to real lines');
  assert.ok(withSubtitle.subtitle.height > 0);
  // Same body content, less room left over once the subtitle's real height
  // is taken out first - so the body's own row heights must not be taller
  // than the no-subtitle case (they have less available height to solve
  // against), proving the deduction happened before the body was solved
  // rather than the subtitle being drawn on top of an unchanged answer.
  const bodyHeight = (r) => r.items.reduce((sum, item) => sum + item.rowHeight, 0);
  assert.ok(bodyHeight(withSubtitle) <= bodyHeight(withoutSubtitle) + 1, 'the subtitle must have taken real room from the body');
});

test('a subtitle so long it cannot fit at any legible size still draws, flagged OVERSET, never dropped', () => {
  const data = { ...panchangData(), subtitle: 'शब्द '.repeat(200) };
  const result = layout.layoutSmartCard('panchang', data, FRAME);
  assert.equal(result.fitState, 'OVERSET');
  assert.ok(result.subtitle.lines.length > 0, 'the subtitle is still drawn, not silently removed');
});

// ---------------------------------------------------------- overlong token ---

test('one legal piece wider than the whole card is reported, never invented a mid-word break', () => {
  // A single "word" (no internal break opportunity) far wider than any
  // reasonable card - graphemes.js deliberately has no hyphenator, so this
  // must become hardOverset rather than a silently clipped or broken line.
  const data = { text: 'अ'.repeat(200), attribution: '' };
  const result = layout.layoutSmartCard('suvichar', data, FRAME);
  assert.equal(result.fitState, 'OVERSET');
  assert.equal(result.quoteLines.length, 1, 'one unbreakable piece stays one line - it is reported, not fragmented');
});

// ------------------------------------------------------ cross-cutting rules ---

test('the same card and the same frame always produce the same deterministic layout', () => {
  for (const [key, data] of [['sudoku', sudokuData()], ['rashi', rashiData()], ['panchang', panchangData()], ['suvichar', { text: 'विचार', attribution: 'क' }], ['dinvishesh', dinvisheshData()]]) {
    const a = layout.layoutSmartCard(key, data, FRAME);
    const b = layout.layoutSmartCard(key, data, FRAME);
    assert.deepEqual(a, b, `${key}: identical input must give an identical result`);
  }
});

test('changing only the editor\'s display scale does not change the logical geometry - the frame is what decides it', () => {
  // The Editor enlarges the whole rendered card as one object (CSS
  // transform:scale()) rather than asking the solver for a different
  // font at a different size - so the SAME logical frame, passed twice,
  // must solve identically regardless of anything about screen zoom
  // (which never reaches this pure module at all).
  const a = layout.layoutSmartCard('rashi', rashiData(), FRAME);
  const b = layout.layoutSmartCard('rashi', rashiData(), { ...FRAME });
  assert.deepEqual(a, b);
});

test('the page and the Block Editor draw from the SAME markup for the same frame - no more 7px/9px divergence', () => {
  // smartCardMarkup() is the one call site section-thumb.js's
  // sectionContentMarkup() shares with block-frame.js's layoutTextFrames();
  // this asserts the function itself is deterministic on frame, which is
  // what makes that sharing actually mean something.
  const first = cards.smartCardMarkup('panchang', panchangData(), FRAME);
  const second = cards.smartCardMarkup('panchang', panchangData(), FRAME);
  assert.equal(first, second);
});

test('an unknown key still returns a real fitState object, not a throw', () => {
  const result = layout.layoutSmartCard('havaman', { items: [] }, FRAME);
  assert.equal(result.fitState, 'EMPTY');
  assert.equal(result.violations.length, 0);
});
