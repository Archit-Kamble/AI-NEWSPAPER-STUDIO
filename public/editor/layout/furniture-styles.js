// FIVE FOLIO STYLES AND FIVE FOOTER STYLES - how the running head and the
// page foot are set, on top of the identical facts they have always carried.
//
// The desk's report: "add new header for each page ... then 5 footers and 5
// headers." Two things have to be said before any of that, because both are
// load-bearing in ways a style is not.
//
// PAGE ONE'S NAMEPLATE IS NOT ONE OF THESE FIVE, AND CANNOT BE.
// `src/layout/identity.js`'s own header states it: the nameplate is
// REGISTERED ARTWORK tied to the paper's RNI number, read off the printed
// masthead, never redrawn. Offering "5 headers" that gave page one five
// different logo arrangements would mean five different claims about what
// the paper's registered identity is. What this file styles instead is the
// FOLIO - the running head every INSIDE page carries (paper, date, page
// number) - which is exactly what varies, page to page, in a printed daily.
//
// THE BAND NEVER MOVES. `geometry.js`'s HEADER.folioHeightPx and
// FOOTER.footHeightPx are what `templates.js` reads to know where a block may
// start, and this file is not touched by any of it. Every style here draws
// inside the SAME reserved band; only the rule, the tint and the type
// treatment change. That is what makes this safe to add without going near
// the one piece of geometry every editorial block's position depends on.
//
// NO NEW SCHEMA. A folio and a footer style are DERIVED from the page's own
// `style_theme` - the same column `page-styles.js` already writes, through
// the same "Dress the paper" button. A page dressed as the sport theme gets a
// folio ruled in the sport theme's own hue; nothing new is stored, and a
// paper with no theme chosen draws the plain style it always has.

import { themeOf, hueOf } from './page-styles.js';

/**
 * Five folio treatments, in increasing weight. Each names:
 *   rule     - the hairline under the strip: edge, weight in px, and whether
 *              it is doubled (the same vocabulary borders.js already uses).
 *   band     - a tint behind the whole strip, or null for the paper's white.
 *   title    - how the paper's own name is set: 'plain' (black), 'accent'
 *              (the page's hue ink) or 'reverse' (white out of a solid panel
 *              in the hue ink - the strongest device, used sparingly).
 */
export const FOLIO_STYLES = [
  { key: 'classic', label: 'Classic — hairline, plain title', rule: { weight: 1, double: false }, band: false, title: 'plain' },
  { key: 'accent-rule', label: 'Accent rule, coloured title', rule: { weight: 1, double: false }, band: false, title: 'accent' },
  { key: 'double-rule', label: 'Double rule, understated', rule: { weight: 0.75, double: true }, band: false, title: 'plain' },
  { key: 'tinted-band', label: 'Tinted strip', rule: { weight: 0.5, double: false }, band: true, title: 'accent' },
  { key: 'banner', label: 'Reversed banner', rule: { weight: 0, double: false }, band: 'reverse', title: 'reverse' },
];

/**
 * Five foot treatments. The page foot has never carried a rule at all
 * (styles.css's own comment: "a folio line is set type, not a drawn box") -
 * these are the first devices offered for it, and none of them may cost the
 * band a pixel of height, because `footHeightPx` is fixed the same way
 * `folioHeightPx` is.
 */
export const FOOTER_STYLES = [
  { key: 'classic', label: 'Classic — no rule', rule: null, band: false, title: 'plain' },
  { key: 'rule-above', label: 'Hairline above', rule: { edge: 'top', weight: 1, double: false }, band: false, title: 'plain' },
  { key: 'accent-rule', label: 'Accent rule above', rule: { edge: 'top', weight: 1, double: false }, band: false, title: 'accent' },
  { key: 'double-rule', label: 'Double rule above', rule: { edge: 'top', weight: 0.75, double: true }, band: false, title: 'plain' },
  { key: 'tinted', label: 'Tinted strip', rule: null, band: true, title: 'accent' },
];

export const FOLIO_STYLE_KEYS = FOLIO_STYLES.map((s) => s.key);
export const FOOTER_STYLE_KEYS = FOOTER_STYLES.map((s) => s.key);

export function folioStyleOf(key) {
  return FOLIO_STYLES.find((s) => s.key === key) || FOLIO_STYLES[0];
}
export function footerStyleOf(key) {
  return FOOTER_STYLES.find((s) => s.key === key) || FOOTER_STYLES[0];
}

// WHICH OF THE FIVE A THEME WEARS. A deterministic table, not a hash or a
// round-robin - a desk who dresses the same page as "sport" twice must see
// the same folio both times, and a table is the one form of "deterministic"
// that is also readable.
//
// The mapping is deliberately NOT one style per theme in strict order: the
// front page (sober) gets the classic folio's foot styling (it has no folio
// of its own - page one carries the nameplate instead - but its FOOTER still
// reads this table), and the fullest-colour themes get the strongest devices,
// mirroring the same "how much a page wears" ladder `DECORATION` already
// states for the blocks themselves.
const THEME_FOLIO = {
  plain: 'classic', front: 'classic', city: 'accent-rule', state: 'accent-rule',
  business: 'double-rule', sport: 'tinted-band', entertainment: 'banner',
  world: 'tinted-band', feature: 'accent-rule', sunday: 'banner',
};
const THEME_FOOTER = {
  plain: 'classic', front: 'classic', city: 'rule-above', state: 'rule-above',
  business: 'accent-rule', sport: 'accent-rule', entertainment: 'tinted',
  world: 'double-rule', feature: 'accent-rule', sunday: 'tinted',
};

/** The folio style a page's own theme resolves to. */
export function folioStyleForTheme(themeKey) {
  const key = THEME_FOLIO[themeKey] || THEME_FOLIO.plain;
  return folioStyleOf(key);
}
export function footerStyleForTheme(themeKey) {
  const key = THEME_FOOTER[themeKey] || THEME_FOOTER.plain;
  return footerStyleOf(key);
}

/**
 * The one ink a themed folio or footer draws with: the page's own hue, taken
 * from its FIRST listed hue - a page's theme is a set the block styler picks
 * from per block, but the furniture is one strip and needs one colour, so it
 * takes the theme's own leading hue, which is also the one its lead story is
 * most likely to wear.
 */
export function furnitureInkForTheme(themeKey) {
  const theme = themeOf(themeKey);
  const hue = theme?.hues?.[0] && hueOf(theme.hues[0]);
  return hue?.ink || null;
}
export function furnitureTintForTheme(themeKey) {
  const theme = themeOf(themeKey);
  const hue = theme?.hues?.[0] && hueOf(theme.hues[0]);
  return hue?.tint || null;
}

/**
 * THE SECTION NAMEPLATE - the box a feature page carries its own name in.
 *
 * The desk asked for it by name: "look pudhari header it like monday fun or
 * Sunday dhamaal on some pages with Aesthetic look". Measured off the
 * reference's own folio row, it sets THREE boxes - a brand box, a page-number
 * box, and a dark SECTION box carrying the page's own name - and this product
 * drew the first two and had no third.
 *
 * IT INVENTS NO TEXT. Every theme in `PAGE_THEMES` has carried a `marathi`
 * name since it was written - रविवार धमाल, क्रीडा, विश्वसंचार, मनोरंजन - and
 * nothing had ever drawn one. This is the same shape as `list_style` and
 * `drop_cap`: a value stored, a name chosen, and no surface reading it.
 *
 * TWO THEMES CARRY NO NAMEPLATE, and neither is an omission:
 *
 *   `plain` is the absence of a look, and साधे is not the name of a section.
 *   `front` never reaches this at all - page one has the nameplate itself,
 *   and `folioMarkup` returns early on it.
 *
 * A theme whose name would be its own paper's name is refused for the same
 * reason: a section box repeating the brand box two columns away is not a
 * second mark, it is a mistake - the RNI lesson, and the lion's.
 */
export function sectionNameFor(themeKey) {
  const theme = themeOf(themeKey);
  if (!theme || theme.key === 'plain' || theme.key === 'front') return null;
  const name = String(theme.marathi || '').trim();
  return name || null;
}
