// A SMART CARD BRINGS ITS OWN BLOCK.
//
// The desk's report: "rather than fixing smart blocks at layout, after
// generating a smart block it will generate a new block with all data already
// filled in." A card's own shape is knowable before any layout work - a sudoku
// is square, a statutory notice is a whole leg, a quote is a shallow strip -
// so the block it wants is a catalogue, read by the panel's preview and by the
// placement, which is what keeps a desk from reviewing a card at one size and
// getting it at another.

const test = require('node:test');
const assert = require('node:assert/strict');

let layout;
test.before(async () => {
  layout = await import('../public/editor/smart-cards/layout.js');
  const fonts = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([fonts.ensureFontsLoaded(), shaper.ensureShaperReady()]);
});

test('every card that can be drawn declares the block it wants', () => {
  for (const key of layout.SMART_CARD_LAYOUT_KEYS) {
    if (key === 'sudoku-solution') continue; // shares the sudoku's own frame
    const size = layout.SMART_CARD_BLOCK_SIZE[key];
    assert.ok(size, `${key} has no declared block size`);
    assert.ok(size.width > 0 && size.height > 0, `${key}'s block size is not a rectangle`);
  }
});

test('the shapes are the printed ones, not arbitrary numbers', () => {
  const sudoku = layout.smartCardBlockSize('sudoku');
  // A puzzle is square-ish: the grid is, so the block it lives in has to be.
  const ratio = sudoku.width / sudoku.height;
  assert.ok(ratio > 0.75 && ratio < 1.15, `a sudoku block should be about square, got ${ratio.toFixed(2)}`);

  // A quote is a shallow strip across a measure; a statutory notice is a leg.
  assert.ok(layout.smartCardBlockSize('suvichar').height < layout.smartCardBlockSize('suvichar').width);
  assert.ok(layout.smartCardBlockSize('tender').height > 400);
});

test('an unknown key still gets a usable block rather than nothing', () => {
  const fallback = layout.smartCardBlockSize('no-such-card');
  assert.ok(fallback.width > 0 && fallback.height > 0);
});

test('the block a card asks for is one the card actually fits in', () => {
  // The point of the catalogue: a desk who takes the default gets a card that
  // sets, not one that arrives OVERSET and has to be resized by hand - which
  // is the work this whole change exists to remove.
  const payloads = {
    panchang: { items: [
      { label: 'सूर्योदय', text: '०६:२०' }, { label: 'सूर्यास्त', text: '१९:०७' },
      { label: 'दिनमान', text: '१२ तास ४७ मिनिटे' }, { label: 'राहुकाळ', text: '०९:३१ ते ११:०७' },
      { label: 'शके', text: '१९४८' },
    ] },
    suvichar: { text: 'प्रयत्न आणि सातत्य हीच यशाची खरी किल्ली आहे.', attribution: 'स्वामी विवेकानंद' },
    dinvishesh: { entries: [{ label: 'स्वातंत्र्य दिन', symbol: 'flag' }] },
    havaman: { cities: [{ key: 'satara', name: 'सातारा', condition: 'ढगाळ', maxC: 27.4, minC: 22.6, rainMm: 2.2, rainChance: 92 }], source: 'स्रोत : Open-Meteo' },
    market: {
      title: 'शेअर / सोने बाजार', asOf: '२६ ऑग, २०२६',
      items: [
        { key: 'sensex', label: 'सेन्सेक्स', group: 'index', value: '७७,४७२.९४', delta: '−१८३.१६', change: '−०.२४%', direction: 'down' },
        { key: 'gold', label: 'सोने', unit: '१० ग्रॅम', group: 'bullion', value: '₹१,३८,२९४', delta: '−४,४४६', change: '−३.११%', direction: 'down' },
      ],
      yesterdayBrief: 'निर्देशांक घसरले.', source: 'स्रोत : Yahoo Finance',
    },
    advert: {
      advertiser: 'श्री गणेश ट्रेडर्स', headline: 'शेती अवजारे',
      lines: ['पंप विक्री', 'सेवा केंद्र'], offer: '१०% सवलत', contact: '९८२२० १२३४५',
    },
  };

  for (const [key, data] of Object.entries(payloads)) {
    const size = layout.smartCardBlockSize(key);
    const solved = layout.layoutSmartCard(key, data, {
      width: size.width, height: size.height, padding: 1,
    });
    assert.equal(solved.fitState, 'FITS', `${key} does not fit the block it asks for`);
    assert.ok(solved.fontPx >= 6, `${key} solves below a legible size in its own block: ${solved.fontPx}`);
  }
});
