// THE REFERENCE FRONT PAGE, measured exactly. Rectangles are scan pixels on
// the desk's 2800 x 4440 scan; type sizes are editor pixels from matching each
// role's face against the scan (see scan.js). No words of the reference page
// are here - panels carry placeholders.

const { PLACEHOLDER } = require('./scan');

const BODY = { fontFamily: 'sans', bodyFontPx: 5.9, lineHeight: 1.307, textAlign: 'justify', marginPx: 1, datelineStyle: 'colon', paragraphPolicy: 'as-written' };
const HEAD = (displayFamily, headlineFontPx, extra = {}) => ({ displayFamily, headlineFontPx, headlineLocked: true, ...extra });
// A stand-off of 0 is not "none" to the compositor - it is the default 0.6 em -
// so a panel set tight against what it sits under states half a pixel.
const lines = (n) => Array.from({ length: n }, () => PLACEHOLDER);

// A SUB-HEAD set in the column: condensed, and nothing round it.
const subhead = (box, px = 9.1, extra = {}) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'noto-condensed', titlePx: px,
  titleLineHeight: 1.25, insetPx: 0, standOffPx: 0.5, ...extra,
});
// THE AGENCY LINE under a deck: centred, with a rule under it.
// Given as the column, the TOP OF ITS INK and the BOTTOM OF ITS RULE, which is
// how it reads off a scan; the line box starts at the ink's top.
const byline = (x0, x1, inkTop, ruleBottom) => ({
  kind: 'sidebar', box: [x0, inkTop, x1, ruleBottom], lines: ['वृत्तसंस्था'], lineFamily: 'sans', linePx: 5.9, lineAlign: 'center',
  lineHeight: 1.3, insetPx: 0, standOffPx: 0.5, rules: ['bottom'], ruleWidthPx: 0.5,
});
// Heads read off a scan by their INK top; a condensed head's line box starts
// a hair above it.
const INK = 3;
// A STORY INSIDE A STORY: a condensed head over lines of ragged copy.
const inset = (box, n, extra = {}) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: lines(n), titleFamily: 'noto-condensed', titlePx: 9.1,
  titleLineHeight: 1.25, titleGapPx: 3, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5, ...extra,
});

module.exports = {
  key: 'broadsheet-front',
  name: 'Broadsheet front (reference)',
  description: 'A five-column opening package beside a picture box, a market rail and news shorts, a four-column picture lead, a right-hand pair, two reports, a separator-led feature with its chart, and a display advert.',
  scan: { x0: 57, x1: 2744, y0: 485, y1: 4296, top: 144 },
  blocks: [
    {
      key: 'package', box: [57, 485, 2004, 1168], story: 'LEAD', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 21.7, { headlineAlign: 'center' }), displayLineHeight: 1.15, columnCount: 5 },
      pictures: [{ file: 'reference-lokmat/front-dj-logo.jpg', box: [59, 729, 407, 840], standOffPx: 1 }, { file: 'reference-lokmat/front-package.jpg', box: [1224, 608, 1552, 1168], standOffPx: 1 }],
      panels: [
        subhead([57, 607 - INK, 407, 725], 9.1, { titleLineHeight: 1.32 }),
        byline(57, 407, 871, 911),
        inset([836, 607 - INK, 1190, 1168], 14, { titlePx: 9.3 }),
        inset([1593, 607 - INK, 2004, 1162], 3, { marker: 'circle', lineGapPx: 3 }),
      ],
    },
    {
      key: 'corner-advert', box: [2058, 485, 2744, 1166], type: 'photo', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY, marginPx: 1 },
      pictures: [{ file: 'reference-lokmat/front-corner.jpg', box: [2084, 485, 2744, 1110], standOffPx: 1, }],
      panels: [
        { kind: 'sidebar', box: [2084, 1112, 2744, 1150], lines: [PLACEHOLDER], lineFamily: 'noto-condensed', lineBold: true, linePx: 7.4, lineAlign: 'center', lineHeight: 1.2, insetPx: 0, standOffPx: 0.5 },
        { kind: 'ornament', box: [2058, 485, 2744, 1166], rules: ['left', 'bottom'], ruleWidthPx: 0.7, standOffPx: 0.5 },
      ],
    },
    {
      key: 'rail-markets', box: [58, 1200, 407, 1913], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('noto-condensed', 11.5), columnCount: 1 },
      pictures: [],
      panels: [],
    },
    {
      // The section's own artwork and the short's photograph, above the head -
      // a block of its own, because a head sets at the top of its block.
      key: 'shorts-art', box: [58, 1945, 407, 2508], type: 'photo', story: 'BRIEF', priority: 2,
      style: { ...BODY },
      pictures: [{ file: 'reference-lokmat/front-shorts-logo.jpg', box: [94, 1945, 374, 2075], standOffPx: 1 }, { file: 'reference-lokmat/front-shorts.jpg', box: [59, 2099, 407, 2508], standOffPx: 1 }],
      panels: [],
    },
    {
      key: 'rail-shorts', box: [58, 2530, 407, 2905], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('noto-condensed', 11.3), displayLineHeight: 1.24, columnCount: 1, bodyFontPx: 5.6, textAlign: 'left' },
      pictures: [],
      panels: [],
    },
    {
      key: 'lead', box: [446, 1200, 2013, 2910], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 28.0, { subheadingFontPx: 11.4, subheadingLocked: true }), displayLineHeight: 1.33, columnCount: 4 },
      pictures: [
        { file: 'reference-lokmat/front-lead1.jpg', box: [835, 1688, 2012, 1960], standOffPx: 1 },
        { file: 'reference-lokmat/front-lead2.jpg', box: [1611, 2152, 2011, 2424], standOffPx: 1 },
      ],
      panels: [
        byline(446, 797, 1687, 1727),
        { kind: 'sidebar', box: [835, 1978 - INK, 2013, 2130], title: PLACEHOLDER, lines: lines(3), titleFamily: 'noto-condensed', titlePx: 9.3, titleLineHeight: 1.25, titleGapPx: 3, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5 },
        inset([835, 2148, 1182, 2863], 2, { tint: '#f4e4dc', insetPx: 5, titlePx: 9.0, boldLines: [1], lineGapPx: 5 }),
        inset([1224, 2149 - INK, 1572, 2872], 2, { marker: 'circle', boldLines: [1], lineGapPx: 4 }),
        inset([1611, 2445 - INK, 2011, 2872], 1),
        { kind: 'ornament', box: [446, 2891, 2013, 2909], rules: ['bottom'], ruleWidthPx: 0.5, standOffPx: 0.5 },
      ],
    },
    {
      key: 'right-top', box: [2057, 1185, 2744, 2185], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('noto-condensed', 17.8), displayLineHeight: 1.18, columnCount: 2 },
      pictures: [],
      panels: [
        subhead([2057, 1386 - INK, 2381, 1480], 7.9),
        byline(2057, 2381, 1483, 1523),
        inset([2411, 1386 - INK, 2744, 1822], 6, { titlePx: 9.2 }),
        { kind: 'sidebar', box: [2411, 1831, 2744, 2185], title: '“', lines: lines(4), titleFamily: 'mukta-heavy', titlePx: 16, titleLineHeight: 0.9, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'right-foot', box: [2057, 2219, 2744, 3412], story: 'SECONDARY', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed-light', 15.4), displayLineHeight: 1.28, columnCount: 2 },
      pictures: [{ file: 'reference-lokmat/front-rightfoot.jpg', box: [2440, 2398, 2744, 2601], standOffPx: 1 }],
      panels: [
        subhead([2057, 2413 - INK, 2407, 2510], 9.0),
        byline(2057, 2407, 2536, 2577),
        inset([2439, 2616 - INK, 2744, 3412], 1),
      ],
    },
    {
      key: 'report-left', box: [57, 2934, 1190, 3416], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-semibold', 16.7), displayLineHeight: 1.2, columnCount: 3 },
      pictures: [],
      panels: [
        subhead([57, 3053 - INK, 407, 3165], 9.0),
        byline(57, 407, 3182, 3223),
      ],
    },
    {
      key: 'report-right', box: [1225, 2933, 2015, 3416], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-semibold', 13.3), displayLineHeight: 1.2, columnCount: 2 },
      pictures: [],
      panels: [
        subhead([1225, 3018 - INK, 1602, 3135], 9.1),
        byline(1225, 1602, 3148, 3189),
      ],
    },
    {
      key: 'feature-strip', box: [56, 3451, 2010, 4296], story: 'ANALYSIS', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 21.7, { displayLineHeight: 1.19, headlineAlign: 'left', headlineStyle: 'kicker-chip-rule', accentColor: '#e42424', borderInk: '#fb9f0b' }), columnCount: 5, kicker: undefined },
      pictures: [{ file: 'reference-lokmat/front-feature.jpg', box: [448, 3760, 792, 4296], standOffPx: 1 }],
      panels: [
        byline(57, 407, 3760, 3800),
        { kind: 'chart', box: [835, 3758, 1190, 4296], card: { chartType: 'stat', unit: '%', items: [{ label: `${PLACEHOLDER} १`, value: 74 }, { label: `${PLACEHOLDER} २`, value: 65 }, { label: `${PLACEHOLDER} ३`, value: 48 }] }, standOffPx: 0.5 },
        inset([1222, 3758 - INK, 1580, 4296], 1, { titlePx: 9.3 }),
        inset([1610, 3758 - INK, 2010, 4296], 4, { titlePx: 9.3, lineGapPx: 8 }),
      ],
    },
    {
      key: 'foot-advert', box: [2063, 3451, 2744, 4296], type: 'advert', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY },
      pictures: [{ file: 'reference-lokmat/front-foot-advert.jpg', box: [2063, 3451, 2744, 4296], standOffPx: 1 }],
      panels: [],
    },
  ],
};
