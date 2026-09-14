// THE REFERENCE NATIONAL AND WORLD PAGE, measured exactly (see scan.js and
// kit.js): a rail of labelled briefs, a question-and-answer top story, a
// photo-led lead with its column of sidebars, a right-hand story, three
// reports, a supplied advert and a separator-led science story. No words of
// the reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 57, x1: 2744, y0: 248, y1: 4295, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'mukta-heavy', titlePx: 8.8, titleLineHeight: lh(50, 8.8), titleGapPx: 4, ...TEXT(6.1), ...extra,
});
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});
const RAIL = { fontFamily: 'mukta-text', bodyFontPx: 6.0, lineHeight: lh(32, 6.0), textAlign: 'justify', leadingPolicy: 'fixed' };
const photo = (key, box, pictures, panels = []) => ({
  key, box, type: 'photo', story: 'BRIEF', priority: 1, style: { ...BODY, showDateline: false }, pictures, panels,
});
const brief = (key, box, px, pitch = 60) => ({
  key, box, type: 'briefs', story: 'BRIEF', priority: 2,
  style: { ...BODY, ...RAIL, ...HEAD('mukta-heavy', px), displayLineHeight: lh(pitch, px), columnCount: 1 },
  pictures: [], panels: [],
});
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-world',
  name: 'Broadsheet national and world (reference)',
  description: 'A rail of labelled briefs, a question-and-answer top story, a photo-led lead with its sidebars, a right-hand story, three reports, an advert and a separator-led science story.',
  theme: 'world',
  scan: SCAN,
  blocks: [
    photo('factcheck', [57, 248, 407, 311], [pic('world-factcheck-logo.jpg', [58, 248, 361, 311])]),
    brief('rail-one', [57, 325, 407, 1225], 10.4),
    photo('viral', [57, 1245, 407, 1610], [pic('world-viral-logo.jpg', [59, 1258, 391, 1332]), pic('world-viral.jpg', [58, 1349, 406, 1603])]),
    brief('rail-two', [57, 1625, 407, 2210], 10.2),
    photo('trending', [57, 2230, 407, 2295], [pic('world-trending-logo.jpg', [57, 2252, 402, 2295])]),
    brief('rail-three', [57, 2300, 407, 2845], 9.2),
    brief('rail-four', [57, 2855, 407, 3420], 10.4),
    {
      key: 'house', box: [444, 248, 2744, 910], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 20.8), columnCount: 5, columnWidthPx: 80.8 },
      pictures: [pic('world-house.jpg', [837, 362, 1573, 714])],
      panels: [
        { kind: 'sidebar', box: [837, 730, 1573, 905], lines: lines(1), lineBold: false, ...TEXT(6.1), insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'lead', box: [444, 927, 1963, 2381], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 24.9, { subheadingFontPx: 10.6, subheadingLocked: true }), displayLineHeight: lh(155, 24.9), columnCount: 4, columnWidthPx: 80.8 },
      pictures: [pic('world-lead1.jpg', [837, 1313, 1573, 1709]), pic('world-lead2.jpg', [837, 1730, 1573, 2069])],
      panels: [
        byline(446, 794, 1313, 1353),
        { kind: 'sidebar', box: [837, 2075, 1573, 2125], lines: lines(1), lineFamily: 'mukta-text', lineBold: true, linePx: 6.0, lineAlign: 'center', lineHeight: 1.3, insetPx: 0, standOffPx: 0.5 },
        { kind: 'sidebar', box: [837, 2145 - INK, 1573, 2200], title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: 8.4, titleLineHeight: 1.3, insetPx: 0, standOffPx: 0.5 },
        side([1616, 1314 - INK, 1963, 1640], 2, { lineGapPx: 3, boldLines: [1] }),
        side([1616, 1646, 1963, 1940], 1, { title: '', titlePx: 0.1, boldLines: [0] }),
        side([1616, 1951 - INK, 1963, 2200], 1, { titlePx: 9.0 }),
        side([1616, 2205, 1963, 2360], 1, { title: '', titlePx: 0.1, boldLines: [0] }),
        ticks([446, 2360, 1963, 2381]),
      ],
    },
    {
      key: 'draft-roll', box: [2003, 927, 2744, 2390], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 20.8, { subheadingFontPx: 8.8, subheadingLocked: true }), displayLineHeight: lh(114, 20.8), columnCount: 2, columnWidthPx: 80.8 },
      pictures: [pic('world-rahul.jpg', [2394, 1165, 2741, 1440])],
      panels: [
        byline(2004, 2354, 1279, 1319),
        side([2393, 1476 - INK, 2744, 1750], 2, { titlePx: 10.0, titleLineHeight: lh(50, 10.0), marker: 'circle', lineGapPx: 3 }),
        side([2393, 1760, 2744, 2390], 1, { titlePx: 10.0, titleLineHeight: lh(50, 10.0) }),
      ],
    },
    {
      key: 'justice', box: [448, 2426, 1185, 3411], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 18.5), displayLineHeight: lh(90, 18.5), columnCount: 2, columnWidthPx: 80.8 },
      pictures: [],
      panels: [
        deck([448, 2629 - INK, 800, 2735], 8.5, 50),
        byline(449, 796, 2740, 2781),
        side([837, 2629, 1185, 3411], 2, { tint: '#fbf3e9', insetPx: 5, titlePx: 8.8, boldLines: [1], lineGapPx: 5 }),
      ],
    },
    {
      key: 'manipur', box: [1225, 2424, 1694, 3411], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 15.9), displayLineHeight: lh(78, 15.9), columnCount: 1 },
      pictures: [], panels: [],
    },
    {
      key: 'mamata', box: [1727, 2425, 2744, 2601], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, columnWidthPx: 116, columnGutterPx: 6, ...HEAD('mukta-book', 11.5), columnCount: 2 },
      pictures: [], panels: [],
    },
    {
      key: 'advert', box: [1728, 2626, 2744, 4274], type: 'advert', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [pic('world-advert.jpg', [1728, 2626, 2744, 4274])], panels: [],
    },
    photo('must-read', [60, 3451, 1692, 3512], [pic('world-mustread.jpg', [60, 3451, 1692, 3512])]),
    {
      key: 'science', box: [57, 3529, 1692, 4295], story: 'ANALYSIS', priority: 3,
      style: { ...BODY, columnWidthPx: 93.1, columnGutterPx: 9.1, ...HEAD('mukta-book', 23.3), displayLineHeight: lh(107, 23.3), columnCount: 2 },
      pictures: [pic('world-science.jpg', [502, 3758, 904, 4070])],
      panels: [
        { kind: 'sidebar', box: [502, 4090, 904, 4165], lines: lines(1), ...TEXT(6.1), insetPx: 0, standOffPx: 0.5 },
        side([948, 3761 - INK, 1300, 4295], 2, { titlePx: 8.6, boldLines: [1], lineGapPx: 3 }),
        side([1345, 3759 - INK, 1692, 4295], 2, { titlePx: 8.6, marker: 'circle', lineGapPx: 3 }),
      ],
    },
  ],
};
