// What each frame of a measured layout WEARS.
//
// templates.js says where a frame is and what it is for; a template has never
// said how a block is dressed, because that is a desk decision taken per block.
// A recipe is that decision written down once for a borrowed layout: the faces,
// the locked display sizes, the grounds, the rules and the panels a reference
// page's blocks carry, so a desk does not re-make thirty choices by hand.
//
// MEASURED, NOT INVENTED. Every number was read off the desk's 300 ppi scan of
// the reference page (scripts/apply-design-recipe.js states the scale). Sizes
// are LOCKED on purpose: the reference's look is its hierarchy, and an auto-fit
// that grows or shrinks a headline to fill its measure is exactly what would
// make the copy stop looking like the page it was measured from.
//
// NOTHING OF THE REFERENCE'S WORDS IS HERE. Panel titles and lines are fixture
// placeholders a writer replaces; the reference's nameplate, section labels,
// disclaimers and copy are not carried and must not be.
//
// Values are the shared catalogues' own keys and hexes (inks.js, borders.js,
// typefaces.js, inset-panels.js), so the service's palette boundary checks them
// like any other save.
//
// Panel and picture rectangles are in the block's own pixels.

const ORANGE = '#d2601a';
const SKY = '#1b6fb0';
const CREAM = '#fbf3e9';
const BLUE_TINT = '#d8e7f2'; // vivid-sky: the reference's panel ground is a visible screen, not a wash
const LILAC = '#dfdcec'; // vivid-violet, for the same reason

const PLACEHOLDER = 'इथे मजकूर लिहा';
const points = (n) => Array.from({ length: n }, () => PLACEHOLDER);

const RECIPES = {
  'broadsheet-front': {
    'banner-package': {
      style: { displayFamily: 'mukta', headlineFontPx: 28, headlineLocked: true, bodyFontPx: 7, columnCount: 3 },
      panels: [{ kind: 'note', marker: 'numbered', x: 334, y: 34, width: 130, height: 118, title: PLACEHOLDER, lines: points(3) }],
      pictures: [{ file: 'person1.jpg', x: 267, y: 34, width: 61, height: 118 }],
    },
    'banner-advert': { style: { borderStyle: 'box' } },
    'service-rail': {
      style: { displayFamily: 'khand', headlineFontPx: 13, headlineLocked: true, bodyFontPx: 6.4, borderStyle: 'rule' },
    },
    shorts: {
      style: { displayFamily: 'khand', headlineFontPx: 12, headlineLocked: true, bodyFontPx: 6.4, headlineInk: ORANGE },
      pictures: [{ file: 'scene2.jpg', x: 0, y: 24, width: 72, height: 86 }],
    },
    lead: {
      style: {
        displayFamily: 'khand', headlineFontPx: 35, headlineLocked: true,
        subheadingFontPx: 12, subheadingLocked: true, bodyFontPx: 7, columnCount: 4,
      },
      panels: [
        { kind: 'note', marker: 'none', tint: CREAM, x: 97, y: 218, width: 93, height: 117, title: PLACEHOLDER, lines: points(2) },
        { kind: 'note', marker: 'numbered', x: 196, y: 218, width: 77, height: 142, title: PLACEHOLDER, lines: points(3) },
      ],
      pictures: [{ file: 'crowd1.jpg', x: 73, y: 107, width: 300, height: 58 }],
    },
    'right-top': {
      style: { displayFamily: 'mukta', headlineFontPx: 22, headlineLocked: true, subheadingFontPx: 11, bodyFontPx: 7, columnCount: 2 },
      panels: [{ kind: 'quote', x: 76, y: 130, width: 74, height: 60, lines: [PLACEHOLDER] }],
    },
    'right-low': {
      style: { displayFamily: 'mukta', headlineFontPx: 22, headlineLocked: true, bodyFontPx: 7, columnCount: 2 },
      pictures: [{ file: 'scene1.jpg', x: 76, y: 40, width: 72, height: 46 }],
    },
    'report-one': {
      style: { displayFamily: 'khand', headlineFontPx: 20, headlineLocked: true, subheadingFontPx: 11, bodyFontPx: 7, columnCount: 4 },
    },
    'report-two': {
      style: { displayFamily: 'mukta', headlineFontPx: 17, headlineLocked: true, subheadingFontPx: 10, bodyFontPx: 7, columnCount: 3 },
    },
    'feature-strip': {
      style: {
        displayFamily: 'mukta', headlineFontPx: 22, headlineLocked: true, bodyFontPx: 7, columnCount: 4,
        headlineStyle: 'kicker-tab-rule', accentColor: ORANGE,
      },
      fixtureKicker: 'विशेष',
      panels: [{
        kind: 'chart', x: 178, y: 75, width: 84, height: 133,
        card: { chartType: 'stat', unit: '%', items: [{ label: PLACEHOLDER, value: 74 }, { label: PLACEHOLDER, value: 65 }, { label: PLACEHOLDER, value: 48 }] },
      }],
      pictures: [{ file: 'person1.jpg', x: 87, y: 75, width: 84, height: 133 }],
    },
    'foot-advert': { style: { borderStyle: 'box' } },
  },

  'broadsheet-sport': {
    'rail-today': {
      style: {
        displayFamily: 'khand', headlineFontPx: 10, headlineLocked: true, bodyFontPx: 5.6,
        borderStyle: 'box', borderInk: SKY, headlineStyle: 'reverse', accentColor: SKY,
      },
    },
    'rail-update': {
      style: { displayFamily: 'khand', headlineFontPx: 13, headlineLocked: true, bodyFontPx: 6.4, headlineInk: ORANGE },
      pictures: [{ file: 'crowd2.jpg', x: 0, y: 30, width: 72, height: 62 }],
    },
    'rail-three': {
      style: { displayFamily: 'khand', headlineFontPx: 14, headlineLocked: true, bodyFontPx: 6.4 },
      pictures: [{ file: 'scene1.jpg', x: 0, y: 6, width: 72, height: 52 }],
    },
    'rail-four': {
      style: { displayFamily: 'khand', headlineFontPx: 14, headlineLocked: true, bodyFontPx: 6.4 },
      pictures: [{ file: 'person1.jpg', x: 0, y: 2, width: 72, height: 52 }],
    },
    'rail-five': {
      style: { displayFamily: 'khand', headlineFontPx: 13, headlineLocked: true, bodyFontPx: 6.4 },
    },
    lead: {
      style: {
        displayFamily: 'khand', headlineFontPx: 35, headlineLocked: true,
        subheadingFontPx: 12, subheadingLocked: true, bodyFontPx: 7, columnCount: 3,
      },
      panels: [
        { kind: 'note', marker: 'none', tint: BLUE_TINT, x: 237, y: 116, width: 103, height: 52, title: PLACEHOLDER, lines: points(1) },
        { kind: 'note', marker: 'none', x: 232, y: 176, width: 114, height: 220, title: PLACEHOLDER, lines: points(4) },
      ],
      pictures: [{ file: 'person1.jpg', x: 90, y: 139, width: 141, height: 364 }],
    },
    second: {
      style: { displayFamily: 'mukta', headlineFontPx: 24, headlineLocked: true, bodyFontPx: 7, columnCount: 2 },
      pictures: [{ file: 'person1.jpg', x: 99, y: 55, width: 87, height: 151 }],
    },
    'report-left': {
      style: { displayFamily: 'mukta', headlineFontPx: 20, headlineLocked: true, subheadingFontPx: 11, bodyFontPx: 7, columnCount: 2 },
      pictures: [{ file: 'person1.jpg', x: 91, y: 56, width: 95, height: 60 }],
    },
    'report-right': {
      style: { displayFamily: 'khand', headlineFontPx: 26, headlineLocked: true, bodyFontPx: 7, columnCount: 4 },
      pictures: [{ file: 'scene1.jpg', x: 89, y: 44, width: 257, height: 112 }],
    },
    'feature-strip': {
      style: {
        displayFamily: 'mukta', headlineFontPx: 19, headlineLocked: true, bodyFontPx: 7, columnCount: 3,
        headlineStyle: 'kicker-tab-rule', accentColor: ORANGE,
      },
      fixtureKicker: 'विशेष',
      panels: [{ kind: 'quote', tint: LILAC, x: 173, y: 23, width: 173, height: 161, lines: points(3) }],
    },
    'squad-box': {
      style: {
        displayFamily: 'mukta', headlineFontPx: 20, headlineLocked: true, headlineAlign: 'center', bodyFontPx: 7,
        backgroundColor: LILAC, borderStyle: 'box', borderInk: '#43308f', borderRadiusPx: 6,
      },
    },
  },
};

function recipeFor(templateKey) {
  return RECIPES[templateKey] || null;
}

module.exports = { RECIPES, recipeFor };
