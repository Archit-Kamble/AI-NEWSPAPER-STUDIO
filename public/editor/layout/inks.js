// What colours this paper can print, and the whole of them.
//
// SAHAS VARTA is printed from four plates. Every colour that reaches a page
// therefore has to be a colour the press can separate, which is why nothing in
// this product offers a colour WHEEL: a value a desk mixes in a browser is an
// ink that does not exist, and it would arrive at the press as a rich-black
// mess or as nothing at all.
//
// Two palettes, one file, because they answer the same question and a second
// copy of either is the failure mode this codebase has already been bitten by
// (the drifted template keys, `object-fit: cover` against `contain`). The
// browser reads this to draw the controls and paint the page; the server reads
// it - through the same dynamic import() the character grid and the block
// kinds already use - to name the separation in a .sla.
//
//   INKS   a colour on selected WORDS (rich-text.js's `data-sahas-ink` mark)
//   TINTS  a light ground behind a whole BLOCK (page_sections.background_color)

/**
 * The paper's own inks: the red of its nameplate, and the two spot colours a
 * Marathi daily actually uses in a headline.
 *
 * Black carries no hex, deliberately - it is the ABSENCE of a mark, so
 * choosing it clears the ink rather than adding a fourth one.
 */
export const INKS = [
  { key: 'black', label: 'Black', hex: null, scribus: 'Black' },
  { key: 'red', label: 'Red', hex: '#c8102e', scribus: 'SahasRed' },
  { key: 'blue', label: 'Blue', hex: '#17458f', scribus: 'SahasBlue' },
  { key: 'green', label: 'Green', hex: '#0a7a3f', scribus: 'SahasGreen' },
];

/**
 * A light ground behind a block: a printed side-bar or box-out carries a few
 * per cent of one ink so it reads as separate furniture without a rule around
 * it. Heavier than this and the copy loses its contrast on newsprint.
 *
 * White carries no hex for the same reason Black does not: it is the paper,
 * and it is stored as NULL so a block nobody tinted can be told from one a
 * desk deliberately set to white.
 */
export const TINTS = [
  { key: 'white', label: 'White', hex: null, scribus: 'None' },
  { key: 'grey', label: 'Grey', hex: '#f2f2f4', scribus: 'SahasTintGrey' },
  { key: 'cream', label: 'Cream', hex: '#fbf3e9', scribus: 'SahasTintCream' },
  { key: 'pink', label: 'Pink', hex: '#fdf1f3', scribus: 'SahasTintPink' },
  { key: 'blue', label: 'Blue', hex: '#eef3fb', scribus: 'SahasTintBlue' },
];

// A colour that has been through the DOM comes back as `rgb(200, 16, 46)`,
// never as the hex it was set with - a browser normalises every inline colour.
// Both forms have to resolve to the same ink, or a mark applied in Quill
// (which reads its own attribute back off the element) would be dropped on the
// way to storage while the screen went on showing it. Measured exactly that
// way: Quill painted the words red in its own DOM and recorded nothing.
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;
const asHex = (value) => {
  const match = RGB.exec(value);
  if (!match) return value;
  return `#${[1, 2, 3].map((i) => Number(match[i]).toString(16).padStart(2, '0')).join('')}`;
};

const byHex = (palette) => new Map(palette.filter((entry) => entry.hex).map((entry) => [entry.hex.toLowerCase(), entry]));
const INK_BY_HEX = byHex(INKS);
const TINT_BY_HEX = byHex(TINTS);

const lookup = (table, value) => table.get(asHex(String(value ?? '').trim().toLowerCase())) || null;

/** One of the paper's inks, or null - never an arbitrary colour. */
export function sanitiseInk(value) {
  return lookup(INK_BY_HEX, value)?.hex ?? null;
}

/** One of the paper's tints, or null - null being the paper's own white. */
export function sanitiseTint(value) {
  return lookup(TINT_BY_HEX, value)?.hex ?? null;
}

/** The Scribus separation a colour prints from. */
export function inkSeparation(hex) {
  return lookup(INK_BY_HEX, hex)?.scribus || 'Black';
}

export function tintSeparation(hex) {
  return lookup(TINT_BY_HEX, hex)?.scribus || 'None';
}
