// THE REFERENCE MISCELLANY PAGE, measured exactly (see scan.js and kit.js): a
// sponsored profile and supplied adverts set as their own artwork, a picture-
// less economy lead with two sidebars, and four stories. No words of the
// reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 57, x1: 2744, y0: 241, y1: 4292, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const artwork = (key, box) => ({
  key, box, type: 'advert', story: 'ADVERTISEMENT', priority: 1, style: { ...BODY, showDateline: false },
  pictures: [pic(`misc-${key}.jpg`, box)], panels: [],
});
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'mukta-heavy', titlePx: 8.0, titleLineHeight: lh(48, 8.0), titleGapPx: 4, ...TEXT(6.2), ...extra,
});
const WIDE = { columnWidthPx: 108.4, columnGutterPx: 9.2 };
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-miscellany',
  name: 'Broadsheet miscellany (reference)',
  description: 'A sponsored profile, an economy lead with two sidebars, a foreign brief, a cabinet story, a court column, a news report, a separator-led price story, and supplied adverts.',
  scan: SCAN,
  blocks: [
    artwork('profile', [57, 241, 1046, 2382]),
    artwork('savings', [57, 2420, 1046, 2832]),
    {
      key: 'economy', box: [1102, 247, 2352, 1128], story: 'LEAD', priority: 5,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-heavy', 26.5, { subheadingFontPx: 11.1, subheadingLocked: true }), displayLineHeight: lh(145, 26.5), columnCount: 1 },
      pictures: [],
      panels: [
        byline(1106, 1575, 633, 673),
        side([1615, 621 - INK, 1965, 1110], 3, { lineGapPx: 6, boldLines: [1] }),
        side([2004, 622 - INK, 2352, 1110], 3, { lineGapPx: 6, boldLines: [1] }),
        ticks([1105, 1100, 2002, 1128]),
      ],
    },
    {
      key: 'foreign', box: [2393, 248, 2744, 1110], story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('mukta-medium', 11.0), displayLineHeight: lh(67, 11.0), columnCount: 1 },
      pictures: [], panels: [],
    },
    artwork('corrigendum', [2054, 1131, 2743, 1558]),
    {
      key: 'cabinet', box: [1104, 1142, 2050, 1556], story: 'SECONDARY', priority: 3,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-medium', 15.3), columnCount: 2 },
      pictures: [], panels: [byline(1105, 1575, 1245, 1290)],
    },
    {
      key: 'court', box: [1103, 1575, 1342, 2830], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 10.1), displayLineHeight: lh(58, 10.1), columnCount: 1 },
      pictures: [], panels: [byline(1103, 1342, 1755, 1795)],
    },
    artwork('recruitment', [1381, 1558, 2743, 3120]),
    {
      key: 'drone', box: [57, 2872, 1381, 3414], story: 'SECONDARY', priority: 3,
      style: { ...BODY, columnWidthPx: 81.9, columnGutterPx: 7.4, ...HEAD('mukta-medium', 14.1), columnCount: 2 },
      pictures: [],
      panels: [side([836, 2976 - INK, 1381, 3414], 1, { titlePx: 8.8, ...TEXT(6.2, 34) })],
    },
    artwork('bank', [1428, 3139, 2743, 4292]),
    {
      key: 'must-read', box: [57, 3449, 1381, 3510], type: 'photo', story: 'ANALYSIS', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [pic('misc-mustread.jpg', [57, 3449, 1381, 3510])],
      panels: [],
    },
    {
      key: 'prices', box: [57, 3535, 1381, 4292], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-book', 25.4), displayLineHeight: lh(129, 25.4), columnCount: 1 },
      pictures: [],
      panels: [
        byline(58, 530, 3794, 3835),
        side([569, 3793 - INK, 925, 4292], 2, { titlePx: 10.1, titleLineHeight: lh(49, 10.1), marker: 'circle', lineGapPx: 4 }),
        side([958, 3790 - INK, 1381, 4292], 2, { titlePx: 8.8, titleLineHeight: lh(52, 8.8), boldLines: [1], lineGapPx: 6 }),
      ],
    },
  ],
};
