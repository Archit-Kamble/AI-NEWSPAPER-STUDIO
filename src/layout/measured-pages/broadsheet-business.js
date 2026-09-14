// THE REFERENCE BUSINESS AND ENTERTAINMENT PAGE, measured exactly (see scan.js
// and kit.js). Its infographics and the entertainment advertorial are artwork
// and set as pictures at the scan's rectangles. No words of the reference page
// are here.

const { kit } = require('./kit');

const SCAN = { x0: 54, x1: 2747, y0: 250, y1: 4300, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'mukta-heavy', titlePx: 8.6, titleLineHeight: lh(50, 8.6), titleGapPx: 4, ...TEXT(6.2), ...extra,
});
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-business',
  name: 'Broadsheet business and entertainment (reference)',
  description: 'A prices lead with its infographic and two sidebars, a digital-payments story with its chart, three reports, an entertainment advertorial and three continued stories.',
  theme: 'business',
  scan: SCAN,
  blocks: [
    {
      key: 'prices', box: [54, 251, 1964, 1412], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 25.5, { subheadingFontPx: 10.3, subheadingLocked: true }), displayLineHeight: lh(145, 25.5), columnCount: 5, columnWidthPx: 80.8, columnGutterPx: 9.1 },
      pictures: [
        pic('business-lpg-chart.jpg', [440, 633, 1236, 1400]),
        pic('business-cng-photo.jpg', [1236, 1040, 1600, 1400]),
      ],
      panels: [
        byline(56, 404, 633, 673),
        { kind: 'ornament', box: [440, 633, 1964, 1400], rules: [], standOffPx: 0.5 },
        side([1236, 630, 1600, 1040], 1, { tint: '#f4e4dc', insetPx: 5, titlePx: 8.0, titleLineHeight: lh(50, 8.0), titleAlign: 'center' }),
        side([1614, 634 - INK, 1964, 1400], 3, { titlePx: 8.8, lineGapPx: 8 }),
        ticks([56, 1380, 1964, 1412]),
      ],
    },
    {
      key: 'payments', box: [2004, 250, 2747, 2195], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 17.9, { subheadingFontPx: 8.0, subheadingLocked: true }), displayLineHeight: lh(99, 17.9), columnCount: 1 },
      pictures: [pic('business-upi-chart.jpg', [2005, 769, 2747, 1805])],
      panels: [
        side([2006, 1827 - INK, 2360, 2150], 2, { titlePx: 8.3, marker: 'circle', lineGapPx: 3 }),
        side([2393, 1827 - INK, 2747, 2150], 3, { boldLines: [0, 1, 2], lineGapPx: 3, titlePx: 8.3 }),
        { kind: 'sidebar', box: [2006, 2156, 2747, 2195], lines: lines(1), lineFamily: 'mukta-text', lineBold: true, linePx: 5.3, lineAlign: 'right', lineHeight: 1.3, insetPx: 0, standOffPx: 0.5, rules: ['top'], ruleWidthPx: 0.5 },
      ],
    },
    {
      key: 'tax', box: [55, 1438, 405, 2200], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 11.2), displayLineHeight: lh(66, 11.2), columnCount: 1 },
      pictures: [], panels: [byline(56, 404, 1585, 1625)],
    },
    {
      key: 'court', box: [445, 1439, 1570, 2200], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 17.6), columnCount: 2 },
      pictures: [pic('business-subhash.jpg', [835, 1556, 1183, 1858])],
      panels: [
        deck([446, 1557 - INK, 800, 1690], 9.8, 51),
        byline(447, 796, 1687, 1727),
        side([834, 1884 - INK, 1190, 2200], 1, { titlePx: 8.9 }),
        side([1223, 1558 - INK, 1570, 1920], 1, { titlePx: 8.6 }),
        side([1223, 1951 - INK, 1570, 2200], 1, { titlePx: 8.6 }),
      ],
    },
    {
      key: 'manufacturing', box: [1614, 1438, 1964, 2200], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 11.0), displayLineHeight: lh(66, 11.0), columnCount: 1 },
      pictures: [], panels: [byline(1615, 1964, 1585, 1625)],
    },
    {
      key: 'filmy', box: [57, 2245, 1618, 4300], type: 'advert', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [pic('business-filmy.jpg', [57, 2245, 1618, 4300])], panels: [],
    },
    {
      key: 'jump-one', box: [1689, 2250, 2747, 3180], story: 'STANDARD', priority: 2,
      style: { ...BODY, columnWidthPx: 118, columnGutterPx: 7.4, ...HEAD('mukta-medium', 15.1), columnCount: 2, showDateline: false },
      pictures: [], panels: [],
    },
    {
      key: 'jump-two', box: [1689, 3206, 2747, 3830], story: 'STANDARD', priority: 2,
      style: { ...BODY, columnWidthPx: 118, columnGutterPx: 7.4, ...HEAD('mukta-medium', 13.5), columnCount: 2, showDateline: false },
      pictures: [], panels: [],
    },
    {
      key: 'jump-three', box: [1689, 3851, 2747, 4300], story: 'STANDARD', priority: 2,
      style: { ...BODY, columnWidthPx: 118, columnGutterPx: 7.4, ...HEAD('mukta-medium', 14.4), columnCount: 2, showDateline: false },
      pictures: [], panels: [],
    },
  ],
};
