// HOW A PAGE IS DRESSED - the paper's own look, stated once.//
// THE GROUND IS A "VIVID" TINT, not the pale original a desk's own manual
// picker uses. Measured, not chosen by eye: pixel-sampled directly from
// Pudhari's own reference pages (their Sports and विश्वसंचार pages,
// screenshotted at full resolution) after the desk asked for something
// closer to what a real vivid entertainment/feature page looks like. Real
// block grounds there cluster around a 15-20% mix of their own ink into
// white; this catalogue's ORIGINAL tints were mixed at roughly 5-8% and
// read, by comparison, washed out. inks.js's `vivid-*` entries are the
// same eighteen already-legibility-tested inks, screened at the measured
// share (0.17) - never a new, unverified hue, and black body type keeps
// 18-19:1 contrast against every one of them.
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
import { rolesForPage, groundUnits, roleOf } from './block-roles.js';

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
  { key: 'red', label: 'Red', tint: hexOf(TINTS, 'vivid-red'), ink: hexOf(INKS, 'red') },
  { key: 'blue', label: 'Blue', tint: hexOf(TINTS, 'vivid-blue'), ink: hexOf(INKS, 'blue') },
  { key: 'green', label: 'Green', tint: hexOf(TINTS, 'vivid-green'), ink: hexOf(INKS, 'green') },
  { key: 'purple', label: 'Purple', tint: hexOf(TINTS, 'vivid-purple'), ink: hexOf(INKS, 'purple') },
  { key: 'orange', label: 'Orange', tint: hexOf(TINTS, 'vivid-orange'), ink: hexOf(INKS, 'orange') },
  { key: 'teal', label: 'Teal', tint: hexOf(TINTS, 'vivid-teal'), ink: hexOf(INKS, 'teal') },
  // THIRTEEN MORE, paired the same way as the six above - one TINT, one INK,
  // never a mixed shade. `slate` pairs with the existing grey ground rather
  // than a new tint of its own: it is a dark blue-grey distinct from black,
  // and grey is already the neutral ground this palette has.
  { key: 'maroon', label: 'Maroon', tint: hexOf(TINTS, 'vivid-maroon'), ink: hexOf(INKS, 'maroon') },
  { key: 'rose', label: 'Rose', tint: hexOf(TINTS, 'vivid-rose'), ink: hexOf(INKS, 'rose') },
  { key: 'navy', label: 'Navy', tint: hexOf(TINTS, 'vivid-navy'), ink: hexOf(INKS, 'navy') },
  { key: 'sky', label: 'Sky', tint: hexOf(TINTS, 'vivid-sky'), ink: hexOf(INKS, 'sky') },
  { key: 'forest', label: 'Forest', tint: hexOf(TINTS, 'vivid-forest'), ink: hexOf(INKS, 'forest') },
  { key: 'olive', label: 'Olive', tint: hexOf(TINTS, 'vivid-olive'), ink: hexOf(INKS, 'olive') },
  { key: 'amber', label: 'Amber', tint: hexOf(TINTS, 'vivid-amber'), ink: hexOf(INKS, 'amber') },
  { key: 'rust', label: 'Rust', tint: hexOf(TINTS, 'vivid-rust'), ink: hexOf(INKS, 'rust') },
  { key: 'brown', label: 'Brown', tint: hexOf(TINTS, 'vivid-brown'), ink: hexOf(INKS, 'brown') },
  { key: 'plum', label: 'Plum', tint: hexOf(TINTS, 'vivid-plum'), ink: hexOf(INKS, 'plum') },
  { key: 'violet', label: 'Violet', tint: hexOf(TINTS, 'vivid-violet'), ink: hexOf(INKS, 'violet') },
  { key: 'slate', label: 'Slate', tint: hexOf(TINTS, 'grey'), ink: hexOf(INKS, 'slate') },
  { key: 'pine', label: 'Pine', tint: hexOf(TINTS, 'vivid-pine'), ink: hexOf(INKS, 'pine') },
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
// HOW MUCH OF A PAGE IS DRESSED - measured off the reference, not chosen.
//
// The desk's report was that this "looks very saturated", and the cause was
// quantity, not hue: `full` dressed EVERY block. Measuring the reference
// paper's own pages (tinted area as a share of the tint-or-white area, its
// photographs excluded) says otherwise:
//
//   Sports page          45% tinted
//   विश्वसंचार page       50% tinted
//   आपले जग (ordinary)   27% tinted
//
// So even the most decorated page in that paper is about HALF white. A page
// where every block carries a ground has no plain copy left to make the
// dressed blocks mean anything - which is exactly what "saturated" describes.
//
// `share` is a share of the page's dressable BLOCKS rather than of its area,
// so these sit a little under the measured area figures: the blocks a styler
// dresses first are the larger ones, and a smaller count of them covers a
// larger share of the sheet.
/**
 * `grounds` NAMES THE ROLES THAT MAY CARRY A TINT AT THIS LEVEL, and it is
 * the ONE authority on that. It absorbed `sparesLead`, which said the same
 * thing about one role in a second way - "is 'lead' in this list" is exactly
 * what that flag meant, and two mechanisms answering one question is the
 * drift this file's own header warns about.
 *
 * A role alone cannot decide this. A big secondary story must not be tinted
 * on a FRONT page - a ground on two large neighbouring blocks is two leads -
 * and it must be tinted on a FEATURE page, which is what the reference paper
 * does: its Sports and रविवार धमाल pages carry a ground behind every story,
 * its front page behind two small ones. Same role, different page, and the
 * page is what says which.
 *
 * Written as a list rather than a rank because the levels are not a ladder
 * that a role can sit on a rung of - `sober` and `full` want different SETS,
 * not different amounts of one thing. THE ORDER OF THE LIST IS THE PRIORITY
 * a thin budget is spent in: a front page reaches for its चौकट first, a
 * feature page for its lead.
 *
 * `heads` NAMES THE ROLES THAT CARRY A HEADLINE SCREEN INSTEAD OF A GROUND.
 *
 * The desk described TWO kinds of dressed block, not one: "a light colour
 * background then same colour but medium dark shade border then dark colour
 * heading, SOME HEADLINES ONLY HAVING BACKGROUND COLORS". The first was
 * built; the second is a block with no ground at all and a screen behind its
 * headline, and it is what stops a dressed page reading as rows of identical
 * tinted boxes.
 *
 * `inks.js` has offered `band` / `band-deck` / `band-both` since the screens
 * were written and NOTHING HAD EVER CHOSEN ONE - measured, 0 of 5686 blocks
 * in this newsroom's database, against 5068 plain and 614 accent. Three of
 * the six treatments the catalogue offers had never been drawn, because a
 * desk would have had to find them by hand on one block at a time. The same
 * shape as `list_style` and `drop_cap`, one level up.
 *
 * A block never takes both. Two grounds on one block is muddy, and the ground
 * is the stronger device, so grounds are spent first and heads take what is
 * left of the same budget.
 *
 * `share` COUNTS UNITS, NOT BLOCKS. A run of equal blocks in one hue is one
 * decoration a reader perceives, not ten - so a grid run costs one, the same
 * as the single चौकट beside it. Counting rectangles made a ten-cell run cost
 * more than a whole page's budget and so left the one device a city page most
 * wants permanently unaffordable.
 */
export const DECORATION = {
  none: { share: 0, headlineInk: false, band: 0, radiusPt: 0, rule: 'none', grounds: [], heads: [] },
  // A front page. Fewer than one block in six, nothing else touched, corners
  // square: the level that has to still read as a newspaper, not a magazine.
  sober: { share: 0.15, headlineInk: true, band: 0, radiusPt: 0, rule: 'box', grounds: ['sidebar'], heads: [] },
  light: { share: 0.3, headlineInk: true, band: 1, radiusPt: 0, rule: 'box', grounds: ['sidebar', 'grid'], heads: ['secondary'] },
  // A feature page - about half of it, which is what the reference measures.
  full: { share: 0.55, headlineInk: true, band: 1, radiusPt: 3, rule: 'box', grounds: ['lead', 'sidebar', 'grid', 'secondary'], heads: ['brief'] },
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

  // WHAT EACH BLOCK IS, before anything about what it wears. Ordering by area
  // and dressing the top share of it was the old rule, and area cannot rank
  // equals: on this paper's own page four - ten blocks of 150x176 - it tinted
  // two of the ten, chosen by nothing but sort stability. See block-roles.js.
  const roles = rolesForPage(candidates, (a, b) => touching(a, b, geometry));
  const units = groundUnits(candidates, roles, decoration.grounds || []);

  // THE BUDGET IS SPENT IN WHOLE UNITS. A grid run is one object, so it is
  // dressed entirely or not at all; taking a grid partially is the exact
  // fault this replaces. The first unit is always affordable - a page whose
  // only ground-carrying unit is bigger than its budget would otherwise come
  // out bare, and a page with nothing dressed is not what a theme was chosen
  // for.
  // A UNIT CHOOSES ITS HUE ONCE, AGAINST EVERY NEIGHBOUR ITS MEMBERS HAVE.
  //
  // Not cell by cell. A run is one object, so it makes one choice - and its
  // neighbours are the union of its members', because a colour that clears
  // the first cell's neighbour may sit right beside the last cell's. Choosing
  // per cell and then copying the first cell's answer to the rest was tried
  // and put 17 clashing pairs on this newspaper's own four pages: a sidebar
  // and the run beside it in one hue, a dressed lead and the run under it in
  // another. The fixture the suite is built on has no run touching a sidebar,
  // so 1145 tests passed over it.
  const chosen = [];
  const assigned = new Map();
  const budget = Math.max(1, Math.round(candidates.length * decoration.share));
  let spent = 0;
  if (hues.length && decoration.share > 0) {
    for (const unit of units) {
      // One unit, one unit of budget - see `share` on DECORATION above.
      if (spent && spent + 1 > budget) continue;
      const taken = new Set();
      for (const member of unit.members) {
        for (const [otherKey, hue] of assigned) {
          if (unit.members.some((m) => m.section_key === otherKey)) continue;
          const other = candidates.find((s) => s.section_key === otherKey);
          if (other && touching(member, other, geometry)) taken.add(hue.key);
        }
      }
      // The first hue in the theme's own order that no neighbour is wearing.
      // Falling back to the first when every hue is taken is right rather than
      // leaving the block bare: a page with more neighbours than colours has to
      // repeat one somewhere, and a missing ground is more visible than a
      // repeated one.
      const hue = hues.find((one) => !taken.has(one.key)) || hues[0];
      for (const member of unit.members) {
        chosen.push(member);
        // EVERY CELL OF A RUN WEARS ONE HUE. The members of a run are one
        // object to the eye, so colouring them apart would say they are
        // several - and a per-cell choice would do exactly that, since every
        // cell of a run touches the next.
        assigned.set(member.section_key, hue);
      }
      spent += 1;
    }
  }

  // THE HEADLINE SCREENS - a block with no ground and a screen behind its
  // head, which is the second kind of dressed block the desk described. They
  // take what is left of the same budget, after the grounds, because a ground
  // is the stronger device; and a block that took a ground never also takes a
  // screen.
  const screened = new Map();
  if (hues.length && decoration.share > 0 && (decoration.heads || []).length) {
    // WHAT THE GROUNDS DID NOT SPEND. One budget for the page, grounds first.
    let left = budget - spent;
    for (const unit of groundUnits(candidates, roles, decoration.heads)) {
      if (left <= 0) break;
      const member = unit.members[0];
      if (!member || assigned.has(member.section_key)) continue;
      const taken = new Set();
      for (const [otherKey, hue] of [...assigned, ...screened]) {
        const other = candidates.find((s) => s.section_key === otherKey);
        if (other && touching(member, other, geometry)) taken.add(hue.key);
      }
      screened.set(member.section_key, hues.find((one) => !taken.has(one.key)) || hues[0]);
      left -= 1;
    }
  }

  // THE REVERSED BAND GOES ON THE LEAD, not on the biggest thing that happens
  // to be tinted. White type out of a solid panel is what a page LEADS with,
  // and the lead is the one block whose role says so - `mayBand`. More than
  // one of them on a page is two leads.
  const banded = new Set();
  if (decoration.band) {
    for (const section of candidates) {
      if (banded.size >= decoration.band) break;
      const role = roleOf(roles.get(section.section_key));
      if (role?.mayBand) banded.add(section.section_key);
    }
  }

  return candidates.map((section) => {
    const hue = assigned.get(section.section_key);
    const role = roleOf(roles.get(section.section_key));
    const isBanded = banded.has(section.section_key);
    // A BLOCK WITH NO HUE IS NOT NECESSARILY BARE. The lead and the briefs
    // never take a ground - that is their role's decision, not the budget's -
    // but the lead still carries the page's band at the strongest level.
    if (!hue) {
      const screen = screened.get(section.section_key);
      if (screen && !isBanded) {
        // NO GROUND, a screen behind the headline, and the rule and the head
        // in the same ink - the "headlines only having background colors"
        // block, which is a lighter device than a tint over the whole frame.
        return {
          sectionKey: section.section_key,
          patch: {
            ...BARE,
            accentColor: screen.ink,
            borderInk: screen.ink,
            headlineInk: decoration.headlineInk ? screen.ink : null,
            borderStyle: decoration.rule,
            borderWidthPx: ptToPx(1),
            borderRadiusPx: ptToPx(decoration.radiusPt),
            headlineStyle: 'band',
          },
        };
      }
      if (!isBanded || !hues.length) return { sectionKey: section.section_key, patch: { ...BARE } };
      const lead = hues[0];
      return {
        sectionKey: section.section_key,
        patch: { ...BARE, accentColor: lead.ink, headlineInk: lead.ink, headlineStyle: 'reverse' },
      };
    }
    return {
      sectionKey: section.section_key,
      patch: {
        backgroundColor: hue.tint,
        accentColor: hue.ink,
        borderInk: hue.ink,
        headlineInk: decoration.headlineInk && role?.headlineInk !== false ? hue.ink : null,
        borderStyle: role?.rule === false ? 'none' : decoration.rule,
        borderWidthPx: ptToPx(1),
        borderRadiusPx: ptToPx(decoration.radiusPt),
        headlineStyle: isBanded ? 'reverse' : 'plain',
      },
    };
  });
}
