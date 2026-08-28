// EVERY SHAPE A DISPLAY ADVERTISEMENT COMES IN.
//
// A district daily prints several kinds of advert and this product could only
// set one. ADVERT_STYLES is the catalogue that fixed that, and the thing worth
// holding is not that five shapes exist - it is that they are five rows of
// parameters read by ONE solver, one renderer and one press walk. The failure
// this project has been bitten by twice is a second copy, and five advert
// layouts would be four of them.
const test = require('node:test');
const assert = require('node:assert/strict');

let layout;
let styles;
let smartCardLines;

test.before(async () => {
  layout = await import('../public/editor/smart-cards/layout.js');
  styles = await import('../public/editor/smart-cards/advert-styles.js');
  ({ smartCardLines } = require('../src/services/export/smart-card-lines.js'));
  const fonts = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([fonts.ensureFontsLoaded(), shaper.ensureShaperReady()]);
});

const sample = () => ({ ...styles.ADVERT_SAMPLE, lines: [...styles.ADVERT_SAMPLE.lines] });
const PICTURE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';

test('the current style survived, and it is the default', () => {
  assert.equal(styles.DEFAULT_ADVERT_STYLE, 'classic');
  const classic = styles.ADVERT_STYLES.classic;
  assert.equal(classic.art, 'band');
  assert.equal(classic.align, 'left');
  assert.equal(classic.offer, 'reverse');
  // The block it always asked for.
  assert.deepEqual({ ...classic.block }, { width: 268, height: 300 });
});

test('an unknown style is the paper default, never nothing', () => {
  assert.equal(styles.advertStyle('no-such-shape').key, 'classic');
  assert.equal(styles.advertStyle('').key, 'classic');
  assert.equal(styles.advertStyle(undefined).key, 'classic');
});

test('a card with no style at all still sets - every advert stored before this existed', () => {
  const solved = layout.layoutSmartCard('advert', sample(), { width: 268, height: 300, padding: 1 });
  assert.equal(solved.fitState, 'FITS');
  assert.equal(solved.geometry.style, 'classic');
});

test('every shape sets in the block it asks for', () => {
  for (const style of Object.values(styles.ADVERT_STYLES)) {
    const frame = { width: style.block.width, height: style.block.height, padding: 1 };
    const solved = layout.layoutSmartCard('advert', { ...sample(), style: style.key, imageUrl: PICTURE }, frame);
    assert.equal(solved.fitState, 'FITS', `${style.key} does not fit its own block`);
    assert.ok(solved.fontPx >= 6, `${style.key} solved below a legible size`);
  }
});

test('an advert brings the block ITS OWN shape wants', () => {
  const banner = layout.smartCardBlockSize('advert', { style: 'banner' });
  const classified = layout.smartCardBlockSize('advert', { style: 'classified' });
  assert.ok(banner.width > banner.height, 'a strip is wider than it is deep');
  assert.ok(classified.width < banner.width / 2, 'a classified is a small block');
  // No style named: the trader panel, which is what every stored advert has.
  assert.deepEqual(layout.smartCardBlockSize('advert'), { width: 268, height: 300 });
});

test('the type stands clear of whatever the shape puts on the panel', () => {
  for (const style of Object.values(styles.ADVERT_STYLES)) {
    const frame = { width: style.block.width, height: style.block.height, padding: 1 };
    const g = layout.layoutSmartCard('advert', { ...sample(), style: style.key, imageUrl: PICTURE }, frame).geometry;
    assert.ok(g.typeBox.width > 0 && g.typeBox.height > 0, `${style.key} left no room for type`);
    if (g.art && !g.art.bleed) {
      const artBottom = g.art.y + g.art.height;
      const artRight = g.art.x + g.art.width;
      const clearsBelow = g.typeBox.y >= artBottom - 0.01;
      const clearsBeside = g.typeBox.x >= artRight - 0.01;
      assert.ok(clearsBelow || clearsBeside, `${style.key} sets its type over its own artwork`);
    }
  }
});

test('a poster leaves its photograph most of the panel', () => {
  const style = styles.ADVERT_STYLES.poster;
  const frame = { width: style.block.width, height: style.block.height, padding: 1 };
  const g = layout.layoutSmartCard('advert', { ...sample(), style: 'poster', imageUrl: PICTURE }, frame).geometry;
  assert.ok(g.art?.bleed, 'the picture is the panel');
  assert.ok(g.panel, 'the type sits on a reversed block');
  // The reason a desk chooses this shape is the photograph; a panel that
  // covered it would be an ordinary advert with a picture wasted behind it.
  assert.ok(g.panel.height < frame.height * 0.7, `the panel covers ${g.panel.height} of ${frame.height}`);
  assert.equal(g.reversed, true);
});

test('a shape with no artwork ignores a supplied picture rather than squeezing it in', () => {
  const g = layout.layoutSmartCard('advert', { ...sample(), style: 'classified', imageUrl: PICTURE },
    { width: 148, height: 176, padding: 1 }).geometry;
  assert.equal(g.imageUrl, '');
  assert.equal(g.art, null);
});

test('the press walk draws every shape, and the same words the canvas does', () => {
  for (const style of Object.values(styles.ADVERT_STYLES)) {
    const frame = { width: style.block.width, height: style.block.height, padding: 1 };
    const data = { ...sample(), style: style.key, imageUrl: PICTURE };
    const items = smartCardLines('advert', data, frame, layout);
    const texts = items.filter((i) => !i.kind && i.text);
    const solved = layout.layoutSmartCard('advert', data, frame);
    const drawn = [
      ...solved.nameLines, ...solved.shoutLines, ...solved.standLines, ...solved.detailLines,
      ...solved.offerLines, ...solved.contactLines, ...solved.addressLines, ...solved.footerLines,
    ];
    assert.equal(texts.length, drawn.length, `${style.key}: the plate sets ${texts.length} lines, the page ${drawn.length}`);
    // The artwork reaches the plate, not only the screen.
    const images = items.filter((i) => i.kind === 'image');
    assert.equal(images.length, style.art === 'none' ? 0 : 1, `${style.key} artwork`);
  }
});

test('no card lays two rules where a printer draws one', () => {
  // The advert branch used to draw a 1.2px box of its own INSIDE the card's
  // ring, and the notice branch a 0.8px one - so both printed the double
  // border the canvas had already lost. Two near-parallel hairlines a few
  // pixels apart is exactly what that looks like in the item list, whatever
  // rectangle each was measured from.
  const cases = [
    ['advert', sample(), { width: 268, height: 300, padding: 1 }],
    ['advert', { ...sample(), style: 'framed' }, { width: 268, height: 300, padding: 1 }],
    ['tender', { title: 'प्रकटपत्र', issuer: 'महाराष्ट्र शासन', body: ['एक ओळ मजकूर.'] },
      { width: 300, height: 620, padding: 1 }],
  ];
  for (const [key, data, frame] of cases) {
    const items = smartCardLines(key, data, frame, layout);
    const wide = items.filter((i) => i.kind === 'bar' && i.height <= 2 && i.width >= frame.width * 0.9)
      .map((i) => i.y).sort((a, b) => a - b);
    for (let i = 1; i < wide.length; i += 1) {
      const gap = wide[i] - wide[i - 1];
      // The चौकट is a deliberate second rule and stands a clear band inside
      // the ring; anything within 2px of another rule is the fault.
      assert.ok(gap === 0 || gap > 2,
        `${key} (${data.style || 'default'}): two rules ${gap.toFixed(2)}px apart`);
    }
  }
});

test('a reversed poster sets its type in white, and the plate is told so', () => {
  const frame = { width: 307, height: 380, padding: 1 };
  const items = smartCardLines('advert', { ...sample(), style: 'poster', imageUrl: PICTURE }, frame, layout);
  const texts = items.filter((i) => !i.kind && i.text);
  assert.ok(texts.length > 0);
  // Every band but the accent-reversed offer prints white out of the panel.
  const dark = texts.filter((i) => i.ink && /^#(0|1|2|3)/.test(i.ink));
  assert.equal(dark.length, 0, `${dark.length} lines would print black on a black panel`);
});
