// HOW A PAGE IS DRESSED - the paper's own look, stated once.
//
// The desk's report was that this software fills a page but does not STYLE
// one: "every block is having different style ... a light colour background
// then same colour but medium dark shade border then dark colour heading,
// some headlines only having background colors ... and for each page like
// Sunday Dhamaal, Sport, Entertainment, Vishwasanchar."
//
// Every device that needs was already in this product. What was missing is
// that NOTHING CHOSE THEM: `background_color`, `border_style`, `accent_color`
// and `headline_style` are all columns a person had to set by hand, one block
// at a time, on thirty-odd blocks a day.
//
// This is the fifth catalogue shared by the browser and the server, beside the
// character grid, the block kinds, the picture style, the inks and the
// borders - and it is a catalogue rather than a stylesheet for the same reason
// they are: the canvas, the Block Editor, the PDF, the IDML and the .sla all
// have to dress a block identically or the page the desk approved is not the
// page that prints.
//
// TWO THINGS ONLY, and the split is the whole design:
//
//   A HUE FAMILY is the triple the desk described - a light ground, a rule in
//   the same hue but full strength, and a heading in that same ink. It is not
//   three new colours: the ground is one of `TINTS` and the rule and the
//   heading are ONE entry of `INKS`, so every colour here already separates
//   onto the four plates this paper prints from and `inkSeparation()` names it
//   without knowing this file exists.
//
//   A PAGE THEME says how much of that a page may wear. This is the part a
//   flat "style every block" would get wrong, and it is what the reference
//   paper actually does - measured across three of its own pages on one day:
//   the front page is white with two tinted blocks, a city news page carries a
//   few, and the feature page has a ground behind every story. A front page
//   dressed like a feature page does not read as a front page.

import { TINTS, INKS } from './inks.js';

const hexOf = (table, key) => table.find((entry) => entry.key === key)?.hex ?? null;

/**
 * THE TRIPLE: a light ground, and one ink for the rule around it and the
 * heading on it.
 *
 * The heading is deliberately the SAME ink as the rule rather than a darker
 * shade of it. A darker shade would be a colour no press knows: `INKS` is what
 * `inkSeparation()` can name in a .sla, and a hex mixed here would fall
 * through to Black - so the screen would show a dark green heading and the
 * plate would print a black one, which is the two-surface disagreement this
 * codebase guards hardest against.
 */
export const HUES = [
  { key: 'red', label: 'Red', tint: hexOf(TINTS, 'pink'), ink: hexOf(INKS, 'red') },
  { key: 'blue', label: 'Blue', tint: hexOf(TINTS, 'blue'), ink: hexOf(INKS, 'blue') },
  { key: 'green', label: 'Green', tint: hexOf(TINTS, 'mint'), ink: hexOf(INKS, 'green') },
  { key: 'purple', label: 'Purple', tint: hexOf(TINTS, 'lilac'), ink: hexOf(INKS, 'purple') },
  { key: 'orange', label: 'Orange', tint: hexOf(TINTS, 'sand'), ink: hexOf(INKS, 'orange') },
  { key: 'teal', label: 'Teal', tint: hexOf(TINTS, 'teal'), ink: hexOf(INKS, 'teal') },
  // THIRTEEN MORE, paired the same way as the six above - one TINT, one INK,
  // never a mixed shade. `slate` pairs with the existing grey ground rather
  // than a new tint of its own: it is a dark blue-grey distinct from black,
  // and grey is already the neutral ground this palette has.
  { key: 'maroon', label: 'Maroon', tint: hexOf(TINTS, 'maroon'), ink: hexOf(INKS, 'maroon') },
  { key: 'rose', label: 'Rose', tint: hexOf(TINTS, 'rose'), ink: hexOf(INKS, 'rose') },
  { key: 'navy', label: 'Navy', tint: hexOf(TINTS, 'navy'), ink: hexOf(INKS, 'navy') },
  { key: 'sky', label: 'Sky', tint: hexOf(TINTS, 'sky'), ink: hexOf(INKS, 'sky') },
  { key: 'forest', label: 'Forest', tint: hexOf(TINTS, 'forest'), ink: hexOf(INKS, 'forest') },
  { key: 'olive', label: 'Olive', tint: hexOf(TINTS, 'olive'), ink: hexOf(INKS, 'olive') },
  { key: 'amber', label: 'Amber', tint: hexOf(TINTS, 'amber'), ink: hexOf(INKS, 'amber') },
  { key: 'rust', label: 'Rust', tint: hexOf(TINTS, 'rust'), ink: hexOf(INKS, 'rust') },
  { key: 'brown', label: 'Brown', tint: hexOf(TINTS, 'brown'), ink: hexOf(INKS, 'brown') },
  { key: 'plum', label: 'Plum', tint: hexOf(TINTS, 'plum'), ink: hexOf(INKS, 'plum') },
  { key: 'violet', label: 'Violet', tint: hexOf(TINTS, 'violet'), ink: hexOf(INKS, 'violet') },
  { key: 'slate', label: 'Slate', tint: hexOf(TINTS, 'grey'), ink: hexOf(INKS, 'slate') },
  { key: 'pine', label: 'Pine', tint: hexOf(TINTS, 'pine'), ink: hexOf(INKS, 'pine') },
];

export const HUE_KEYS = HUES.map((hue) => hue.key);

export function hueOf(key) {
  return HUES.find((hue) => hue.key === key) || null;
}

/**
 * HOW MUCH DRESS A PAGE WEARS.
 *
 * `share` is the fraction of a page's editorial blocks that take a ground. It
 * is a share and not a count because pages are not all the same size: a third
 * of a four-block page and a third of a twenty-block page are both a third.
 *
 * `radius` is stated per level rather than per hue because a rounded corner is
 * a statement about the KIND of page - a feature page rounds its boxes, a
 * front page does not - and never about which colour the box is.
 */
export const DECORATION = {
  none: { share: 0, headlineInk: false, band: 0, radiusPt: 0, rule: 'none' },
  // A front page. Two blocks in ten carry a ground, nothing else is touched,
  // and the corners are square: this is the level that has to still read as a
  // newspaper rather than as a magazine.
  sober: { share: 0.2, headlineInk: true, band: 0, radiusPt: 0, rule: 'box' },
  light: { share: 0.45, headlineInk: true, band: 1, radiusPt: 0, rule: 'box' },
  // Every story on its own ground, which is what a feature page is.
  full: { share: 1, headlineInk: true, band: 1, radiusPt: 3, rule: 'box' },
};

export const DECORATION_KEYS = Object.keys(DECORATION);

/**
 * THE PAGE THEMES.
 *
 * `hues` is the set a page draws from, in preference order, and the styler
 * walks it so that no two blocks that touch wear the same one. A theme with
 * one hue is a page that uses it for emphasis and nothing else.
 *
 * The Marathi is the name a desk reads and, where the page carries a nameplate
 * of its own, the words on it.
 */
export const PAGE_THEMES = [
  { key: 'plain', label: 'Plain', marathi: 'साधे', decoration: 'none', hues: [] },
  { key: 'front', label: 'Front page', marathi: 'मुखपृष्ठ', decoration: 'sober', hues: ['red', 'navy'] },
  { key: 'city', label: 'City news', marathi: 'शहर वृत्त', decoration: 'light', hues: ['red', 'blue', 'slate', 'maroon'] },
  { key: 'state', label: 'State news', marathi: 'राज्य', decoration: 'light', hues: ['blue', 'green', 'orange', 'navy'] },
  { key: 'business', label: 'Business', marathi: 'अर्थकारण', decoration: 'light', hues: ['teal', 'olive', 'brown', 'slate'] },
  // EACH THEME DRAWS ON ITS OWN CORNER OF THE PALETTE, so two full-colour
  // pages read as two different sections of the paper rather than the same
  // seven hues shuffled. Sport takes the cool/green half, Entertainment and
  // Sunday take the warm half, World spans both because it is the widest
  // subject on the paper, Feature sits between.
  { key: 'sport', label: 'Sport', marathi: 'क्रीडा', decoration: 'full', hues: ['forest', 'sky', 'green', 'navy', 'teal'] },
  { key: 'entertainment', label: 'Entertainment', marathi: 'मनोरंजन', decoration: 'full', hues: ['violet', 'rose', 'plum', 'amber', 'purple'] },
  { key: 'world', label: 'World', marathi: 'विश्वसंचार', decoration: 'full', hues: ['navy', 'teal', 'forest', 'plum', 'rust', 'slate', 'blue'] },
  { key: 'feature', label: 'Feature', marathi: 'विशेष', decoration: 'full', hues: ['forest', 'amber', 'violet', 'sky', 'olive', 'teal'] },
  { key: 'sunday', label: 'Sunday', marathi: 'रविवार धमाल', decoration: 'full', hues: ['orange', 'rose', 'plum', 'rust', 'amber', 'maroon'] },
];

export const THEME_KEYS = PAGE_THEMES.map((theme) => theme.key);

export function themeOf(key) {
  return PAGE_THEMES.find((theme) => theme.key === key) || null;
}

/**
 * A theme key, or null - never an arbitrary string.
 *
 * A server boundary, exactly as `sanitiseTint` is: a theme decides a block's
 * ground and its rule ink, both of which are interpolated into the canvas's
 * style attribute, so a value that has not been through this function may not
 * reach a renderer.
 */
export function sanitiseTheme(value) {
  const key = String(value ?? '').trim();
  return THEME_KEYS.includes(key) ? key : null;
}

export function decorationOf(themeKey) {
  const theme = themeOf(themeKey);
  return DECORATION[theme?.decoration] || DECORATION.none;
}

/**
 * WHAT A PAGE IS ABOUT, GUESSED FROM WHAT IS ON IT.
 *
 * The theme is a semantic decision - "page twelve is the world page" - and the
 * page already carries the evidence: the ladder gives page one and the back
 * page their names, and the categories the newsdesk brief asked that page for
 * say what the rest of it is. So the ordinary case needs no model at all, and
 * an AI theme choice is an improvement on this rather than a substitute for
 * it: a paper that has never run the Newsdesk Run still gets dressed.
 *
 * Deliberately conservative. Anything it cannot place is `city`, the light
 * level - a page over-dressed by a guess is worse than one under-dressed,
 * because the desk can see too little colour and ask for more, while too much
 * has already been printed.
 */
const TAG_THEME = {
  local: 'city', crime: 'city', 'state-politics': 'state', 'national-politics': 'state',
  economy: 'business', agriculture: 'business', sports: 'sport',
  entertainment: 'entertainment', world: 'world', environment: 'world',
  health: 'feature', education: 'feature',
};

export function guessTheme({ pageNumber, pageCount, tags = [] } = {}) {
  if (Number(pageNumber) === 1) return 'front';
  const counted = new Map();
  for (const tag of tags) {
    const theme = TAG_THEME[tag];
    if (theme) counted.set(theme, (counted.get(theme) || 0) + 1);
  }
  if (counted.size) {
    return [...counted.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  // The back page of a district daily is its feature page.
  if (pageCount && Number(pageNumber) === Number(pageCount)) return 'feature';
  return 'city';
}

// ---------------------------------------------------------- the styler ---

import { blockExpectsCopy } from './block-kinds.js';

/**
 * Two blocks TOUCH if a reader's eye crosses from one to the other without
 * passing another story - which is the same question `column-rules.js` asks to
 * decide where to draw a hairline, and it is asked here for the opposite
 * reason: two touching blocks must not wear the same colour, or the pair reads
 * as one story on one ground.
 *
 * The gutters come from the page geometry rather than being restated, so this
 * cannot drift from the rules drawn between the very same blocks.
 */
function touching(a, b, geometry) {
  const gx = (geometry?.gutterPx ?? 6) + 2;
  const gy = (geometry?.baselinePx ?? 8) + 2;
  const box = (s) => ({
    left: Number(s.x_px), top: Number(s.y_px),
    right: Number(s.x_px) + Number(s.width_px),
    bottom: Number(s.y_px) + Number(s.height_px),
  });
  const A = box(a);
  const B = box(b);
  const overlapsY = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 0;
  const overlapsX = Math.min(A.right, B.right) - Math.max(A.left, B.left) > 0;
  const across = Math.max(B.left - A.right, A.left - B.right);
  const down = Math.max(B.top - A.bottom, A.top - B.bottom);
  return (overlapsY && across <= gx) || (overlapsX && down <= gy);
}

/** Editor pixels from points, at this page's 2 px/mm. */
const ptToPx = (pt) => Number((pt / (72 / 25.4 / 2)).toFixed(2));

/**
 * A BLOCK THIS STYLER MAY DRESS.
 *
 * An advert is the advertiser's own design and a Smart Card draws its own
 * nameplate and rule - dressing either would be this software painting over
 * work that is already finished. A photo block carries no copy and so has no
 * heading to ink. What is left is the stories, which is what a page's look is
 * made of.
 */
function dressable(section) {
  if (!blockExpectsCopy(section.block_type)) return false;
  if (section.smart_card_key && section.smart_card_data) return false;
  if (section.feature_key) return false;
  return true;
}

/** The plain state: what a block looks like when nobody has dressed it. */
const BARE = Object.freeze({
  backgroundColor: null, borderInk: null, headlineInk: null,
  borderStyle: 'none', borderRadiusPx: 0, headlineStyle: 'plain',
});

/**
 * WHAT EVERY BLOCK ON ONE PAGE SHOULD WEAR.
 *
 * Pure: it reads sections and geometry and returns patches, touching no
 * database and no DOM, so the browser can show the desk exactly what the
 * server is about to write - the same promise `composeBlock()` makes about a
 * block's lines.
 *
 * IT COVERS EVERY DRESSABLE BLOCK, including the ones it leaves plain, and
 * that is deliberate: restyling a feature page as a front page has to TAKE
 * grounds off as well as put them on, or the page keeps yesterday's colours
 * under today's theme. It is therefore idempotent - running it twice on the
 * same page gives the same answer - which is what makes it safe to offer as a
 * button rather than a one-way door.
 */
export function styleForPage({ sections = [], theme, geometry, pageNumber, pageCount, tags } = {}) {
  const key = sanitiseTheme(theme) || guessTheme({ pageNumber, pageCount, tags });
  const look = themeOf(key);
  const decoration = DECORATION[look.decoration];
  const hues = look.hues.map(hueOf).filter(Boolean);

  const candidates = sections.filter(dressable);
  // Biggest first: a page's own hierarchy, and the order the eye reads it in.
  const byWeight = [...candidates].sort((a, b) =>
    (Number(b.width_px) * Number(b.height_px)) - (Number(a.width_px) * Number(a.height_px)));

  let chosen = [];
  if (hues.length && decoration.share > 0) {
    const want = Math.max(1, Math.round(byWeight.length * decoration.share));
    // ON A SOBER PAGE THE LEAD IS NEVER TINTED. It is already the biggest
    // thing on the sheet and shouts by SIZE; a ground under it as well makes a
    // front page read as a poster. Measured on the reference paper's own front
    // page: the lead is black on white and the tinted blocks are the secondary
    // stories beside it. On a feature page every story is dressed, lead
    // included, so there is nothing to skip.
    const pool = decoration.share >= 1 ? byWeight : byWeight.slice(1);
    chosen = pool.slice(0, want);
  }

  const assigned = new Map();
  for (const section of chosen) {
    const taken = new Set();
    for (const [otherKey, hue] of assigned) {
      const other = candidates.find((s) => s.section_key === otherKey);
      if (other && touching(section, other, geometry)) taken.add(hue.key);
    }
    // The first hue in the theme's own order that no neighbour is wearing.
    // Falling back to the first when every hue is taken is right rather than
    // leaving the block bare: a page with more neighbours than colours has to
    // repeat one somewhere, and a missing ground is more visible than a
    // repeated one.
    const hue = hues.find((one) => !taken.has(one.key)) || hues[0];
    assigned.set(section.section_key, hue);
  }

  // The strongest device goes on the biggest dressed story: white type out of
  // a solid panel is what a page leads with, and more than one of them on a
  // page is two leads.
  const banded = new Set(decoration.band ? chosen.slice(0, decoration.band).map((s) => s.section_key) : []);

  return candidates.map((section) => {
    const hue = assigned.get(section.section_key);
    if (!hue) return { sectionKey: section.section_key, patch: { ...BARE } };
    return {
      sectionKey: section.section_key,
      patch: {
        backgroundColor: hue.tint,
        accentColor: hue.ink,
        borderInk: hue.ink,
        headlineInk: decoration.headlineInk ? hue.ink : null,
        borderStyle: decoration.rule,
        borderWidthPx: ptToPx(1),
        borderRadiusPx: ptToPx(decoration.radiusPt),
        headlineStyle: banded.has(section.section_key) ? 'reverse' : 'plain',
      },
    };
  });
}
