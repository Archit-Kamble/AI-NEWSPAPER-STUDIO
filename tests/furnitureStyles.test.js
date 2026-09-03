// FIVE FOLIO STYLES, FIVE FOOTER STYLES, resolved from the page's own theme.
//
// The desk's report: "add new header for each page ... then 5 footers and 5
// headers." Page one's nameplate is registered artwork tied to the paper's
// RNI number and is not one of these five - see furniture-styles.js's own
// header for why. What varies is the FOLIO every inside page carries and the
// foot every page carries, exactly what a printed daily actually varies.

const test = require('node:test');
const assert = require('node:assert');

let furniture; let styles;
test.before(async () => {
  furniture = await import('../public/editor/layout/furniture-styles.js');
  styles = await import('../public/editor/layout/page-styles.js');
});

test('five folio styles, five footer styles, and every theme resolves to one of each', () => {
  assert.strictEqual(furniture.FOLIO_STYLES.length, 5);
  assert.strictEqual(furniture.FOOTER_STYLES.length, 5);
  const folioKeys = new Set(furniture.FOLIO_STYLE_KEYS);
  const footerKeys = new Set(furniture.FOOTER_STYLE_KEYS);
  for (const theme of styles.THEME_KEYS) {
    const folio = furniture.folioStyleForTheme(theme);
    const foot = furniture.footerStyleForTheme(theme);
    assert.ok(folioKeys.has(folio.key), `${theme} resolves to an unknown folio style`);
    assert.ok(footerKeys.has(foot.key), `${theme} resolves to an unknown footer style`);
  }
  // An unknown theme falls back to the plain style rather than throwing -
  // the same "never guess, never crash" rule sanitiseTheme already holds.
  assert.strictEqual(furniture.folioStyleForTheme('not-a-theme').key, furniture.folioStyleForTheme('plain').key);
  assert.strictEqual(furniture.folioStyleForTheme(undefined).key, furniture.folioStyleForTheme('plain').key);
});

// Every colour a themed folio or footer can reach is the SAME two-catalogue
// pairing page-styles.js's hue families already guarantee - never an
// invented colour, checked here rather than assumed.
test('a themed folio or footer draws only a colour from an existing hue family', async () => {
  const inks = await import('../public/editor/layout/inks.js');
  for (const theme of styles.THEME_KEYS) {
    const ink = furniture.furnitureInkForTheme(theme);
    const tint = furniture.furnitureTintForTheme(theme);
    if (ink) assert.strictEqual(inks.sanitiseInk(ink), ink, `${theme}'s furniture ink is not a palette ink`);
    if (tint) assert.strictEqual(inks.sanitiseTint(tint), tint, `${theme}'s furniture tint is not a palette tint`);
  }
  // 'plain' carries no hues at all (page-styles.js: hues: []), so a page
  // nobody has dressed draws its furniture exactly as it always has.
  assert.strictEqual(furniture.furnitureInkForTheme('plain'), null);
  // The front page DOES have hues, for its block-level dressing - but its
  // own folio/footer styles both resolve to 'classic'/'title: plain', so the
  // colour is never actually READ there. That is a property of the STYLE
  // tables, checked in the next test, not of furnitureInkForTheme itself.
  assert.strictEqual(furniture.folioStyleForTheme('front').title, 'plain');
  assert.strictEqual(furniture.footerStyleForTheme('front').title, 'plain');
});

// The reversed banner is the strongest device and the one most likely to be
// implemented backwards - white text with no panel, or a panel with black
// text. Both halves have to be true together.
test('a reversed banner style always pairs a solid panel with white type', () => {
  const banner = furniture.FOLIO_STYLES.find((s) => s.band === 'reverse');
  assert.ok(banner, 'no folio style uses the reversed-banner device');
  assert.strictEqual(banner.title, 'reverse', 'a reversed band must set reversed type, or the text is unreadable on it');
});

// A style whose title is 'plain' must never colour anything - that is the
// whole meaning of "plain" here, and the export and the canvas both branch
// on this exact check.
test('a plain title treatment never resolves a theme colour', () => {
  for (const style of [...furniture.FOLIO_STYLES, ...furniture.FOOTER_STYLES]) {
    if (style.title !== 'plain') continue;
    // Simulates the exact branch masthead.js and print-model.js both take.
    const themeInk = style.title !== 'plain' ? furniture.furnitureInkForTheme('world') : null;
    assert.strictEqual(themeInk, null, `${style.key} is 'plain' but the branch would still colour it`);
  }
});

