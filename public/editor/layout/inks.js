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
// SEVEN INKS, NOT FOUR. The desk asked for more colours for a character, a
// word or a line, and there is no press reason to refuse: every one of these
// is defined in the .sla as a PROCESS colour (Spot="0"), so it separates onto
// the four plates the paper already prints from - it is not a fifth plate and
// costs the press nothing. What the palette is for is stopping a colour mixed
// in a browser reaching a plate, and a longer list of named, separated inks
// does that exactly as well as a short one.
//
// Each is dark enough to hold small Devanagari on newsprint. A pale ink is not
// on this list on purpose: it is a TINT, it belongs behind type rather than in
// it, and it is in the table below.
export const INKS = [
  { key: 'black', label: 'Black', hex: null, scribus: 'Black' },
  { key: 'red', label: 'Red', hex: '#c8102e', scribus: 'SahasRed' },
  { key: 'blue', label: 'Blue', hex: '#17458f', scribus: 'SahasBlue' },
  { key: 'green', label: 'Green', hex: '#0a7a3f', scribus: 'SahasGreen' },
  { key: 'orange', label: 'Orange', hex: '#d2601a', scribus: 'SahasOrange' },
  { key: 'purple', label: 'Purple', hex: '#5b2a86', scribus: 'SahasPurple' },
  { key: 'teal', label: 'Teal', hex: '#0f6d78', scribus: 'SahasTeal' },
  // THIRTEEN MORE, so a paper of a dozen pages can give each one a look of
  // its own without two of them wearing the same colour. Every one is a
  // PROCESS colour in the .sla (Spot="0") exactly as the seven above are, so
  // a longer palette is not a longer press run - it separates onto the same
  // four plates. What the palette is for is stopping a colour mixed in a
  // browser reaching a plate, and a longer list of named, separated inks
  // does that exactly as well as a short one.
  //
  // Each is dark enough to hold small Devanagari on newsprint - checked, not
  // eyeballed: tests/blockSurface.test.js holds every ink under a Rec. 709
  // luma of 120 and every tint over 228, which is the rule the originals
  // were chosen against and is not relaxed because the list got longer.
  { key: 'maroon', label: 'Maroon', hex: '#8a1c30', scribus: 'SahasMaroon' },
  { key: 'rose', label: 'Rose', hex: '#b4315f', scribus: 'SahasRose' },
  { key: 'navy', label: 'Navy', hex: '#16305e', scribus: 'SahasNavy' },
  { key: 'sky', label: 'Sky', hex: '#1b6fb0', scribus: 'SahasSky' },
  { key: 'forest', label: 'Forest', hex: '#14562b', scribus: 'SahasForest' },
  { key: 'olive', label: 'Olive', hex: '#5f6b1e', scribus: 'SahasOlive' },
  { key: 'amber', label: 'Amber', hex: '#b06a08', scribus: 'SahasAmber' },
  { key: 'rust', label: 'Rust', hex: '#a3441a', scribus: 'SahasRust' },
  { key: 'brown', label: 'Brown', hex: '#6b4423', scribus: 'SahasBrown' },
  { key: 'plum', label: 'Plum', hex: '#7a2455', scribus: 'SahasPlum' },
  { key: 'violet', label: 'Violet', hex: '#43308f', scribus: 'SahasViolet' },
  { key: 'slate', label: 'Slate', hex: '#3f4a56', scribus: 'SahasSlate' },
  { key: 'pine', label: 'Pine', hex: '#0f5c4f', scribus: 'SahasPine' },
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
  // Three more grounds, asked for by the desk. Every one is a few per cent of
  // one ink - heavier than this and the copy loses its contrast on newsprint,
  // which is the rule the five above were chosen against and is not relaxed
  // because the list got longer.
  { key: 'mint', label: 'Mint', hex: '#eef7f0', scribus: 'SahasTintMint' },
  { key: 'lilac', label: 'Lilac', hex: '#f3eefa', scribus: 'SahasTintLilac' },
  { key: 'sand', label: 'Sand', hex: '#f8f2e7', scribus: 'SahasTintSand' },
  // The eighth ground, added so every ink in the table above has a tint of its
  // own hue to sit on. `page-styles.js` pairs the two into the light-ground /
  // darker-rule / darker-heading triple a printed feature page is set in, and
  // teal was the one ink with no ground to pair with.
  { key: 'teal', label: 'Teal', hex: '#eef6f7', scribus: 'SahasTintTeal' },
  // A GROUND FOR EVERY INK. `page-styles.js` pairs the two into the light-
  // ground / darker-rule / darker-heading triple a printed feature page is
  // set in, so an ink with no ground of its own hue cannot be a hue family.
  { key: 'maroon', label: 'Maroon', hex: '#f9f0f2', scribus: 'SahasTintMaroon' },
  { key: 'rose', label: 'Rose', hex: '#fcf0f4', scribus: 'SahasTintRose' },
  { key: 'navy', label: 'Navy', hex: '#eef1f7', scribus: 'SahasTintNavy' },
  { key: 'sky', label: 'Sky', hex: '#eef5fb', scribus: 'SahasTintSky' },
  { key: 'forest', label: 'Forest', hex: '#eef5f0', scribus: 'SahasTintForest' },
  { key: 'olive', label: 'Olive', hex: '#f5f6ec', scribus: 'SahasTintOlive' },
  { key: 'amber', label: 'Amber', hex: '#fbf4e8', scribus: 'SahasTintAmber' },
  { key: 'rust', label: 'Rust', hex: '#fbf1eb', scribus: 'SahasTintRust' },
  { key: 'brown', label: 'Brown', hex: '#f7f3ee', scribus: 'SahasTintBrown' },
  { key: 'plum', label: 'Plum', hex: '#f8eff4', scribus: 'SahasTintPlum' },
  { key: 'violet', label: 'Violet', hex: '#f0eefa', scribus: 'SahasTintViolet' },
  { key: 'pine', label: 'Pine', hex: '#eef5f3', scribus: 'SahasTintPine' },
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

// HOW THE HEADLINE BAND IS TREATED - one catalogue, read by the Properties
// control, by the canvas renderer and by the press model, so no surface can
// invent a treatment or draw one differently.
//
// `reverse` was the only ground a display band could have: white type out of a
// solid ink. The desk asked for background colours behind the headline and the
// subheading, and a printed paper's answer to that is not a solid panel - it is
// a SCREEN, a few per cent of an ink, with the type left in its own colour.
// That is what `band` is, and it is why the type is untouched: a screen light
// enough to read black Devanagari through is not light enough to read white
// through, so a treatment that did both would be two treatments.
export const HEADLINE_STYLES = [
  { key: 'plain', label: 'Plain', grounds: [] },
  { key: 'accent', label: 'Accent word', grounds: [] },
  { key: 'reverse', label: 'Reversed', grounds: [], reverse: true },
  // `deck`, not `subheading`: that is the compositor's own key for the band
  // (BAND_CLASS in compose/render.js). Naming the COLUMN here drew the screen
  // behind the headline and silently nothing behind the deck - measured, one
  // screen where two were asked for.
  { key: 'band', label: 'Screen behind the headline', grounds: ['headline'] },
  { key: 'band-deck', label: 'Screen behind the deck', grounds: ['deck'] },
  { key: 'band-both', label: 'Screen behind both', grounds: ['headline', 'deck'] },
];

export const HEADLINE_STYLE_KEYS = HEADLINE_STYLES.map((entry) => entry.key);

/** Which display bands this treatment lays a ground behind. */
export function groundedBands(style) {
  return HEADLINE_STYLES.find((entry) => entry.key === style)?.grounds || [];
}

/**
 * An ink at a few per cent - what a printer calls a screen.
 *
 * Mixed toward white rather than given its own catalogue entry, because a
 * screen is a percentage OF an ink and not a colour in its own right: the desk
 * chooses the accent, and this is that accent laid down lightly. 0.12 is the
 * same order as the TINTS above, which were chosen against the rule that
 * anything heavier costs the copy its contrast on newsprint.
 */
export function screenOf(hex, share = 0.12) {
  const value = parseInt(String(hex || '#111111').replace('#', ''), 16);
  if (!Number.isFinite(value)) return '#f2f2f4';
  const mix = (channel) => Math.round(255 - (255 - channel) * share);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
