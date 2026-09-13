// THE REFERENCE LOCAL PAGE, measured exactly (see scan.js and kit.js). Scan
// pixels on the desk's 2800 x 4440 scan; type sizes are editor pixels fitted
// to the scan's ink widths. No words of the reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 57, x1: 2744, y0: 246, y1: 4300, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'noto-condensed', titlePx: 9.2, titleLineHeight: lh(52, 9.2), titleGapPx: 4, ...TEXT(6.1), ...extra,
});
const photo = (key, box, pictures, panels = []) => ({
  key, box, type: 'photo', story: 'PHOTO_FEATURE', priority: 2, style: { ...BODY, showDateline: false }, pictures, panels,
});
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-local',
  name: 'Broadsheet local (reference)',
  description: 'A one-column rail story, a picture-led irrigation lead with two sidebars, a short award story beside a corner advert, a three-column report, a report with a quote and a tinted warning, a picture box, a report, a separator-led planning story and a half-page advert.',
  theme: 'city',
  scan: SCAN,
  blocks: [
    {
      key: 'rail', box: [57, 248, 410, 1712], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 11.3), displayLineHeight: lh(67, 11.3), columnCount: 1 },
      pictures: [], panels: [byline(57, 408, 463, 503)],
    },
    {
      key: 'lead', box: [445, 252, 1571, 1712], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 24.9, { subheadingFontPx: 10.2, subheadingLocked: true }), displayLineHeight: lh(150, 24.9), columnCount: 3 },
      pictures: [{ file: 'reference-lokmat/local-lead.jpg', box: [837, 656, 1186, 1082], standOffPx: 1 }],
      panels: [
        byline(448, 796, 633, 673),
        side([1226, 639 - INK, 1571, 1360], 1, { lineGapPx: 3 }),
        side([1226, 1374 - INK, 1571, 1660], 1, { titlePx: 9.4 }),
        ticks([447, 1672, 1571, 1712]),
      ],
    },
    {
      key: 'award', box: [1615, 248, 2023, 930], story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('mukta-medium', 11.2), displayLineHeight: lh(66, 11.2), columnCount: 1 },
      pictures: [], panels: [byline(1615, 2023, 394, 435)],
    },
    photo('corner-advert', [2052, 246, 2744, 930], [{ file: 'reference-lokmat/local-corner-advert.jpg', box: [2052, 246, 2744, 929], standOffPx: 1 }]),
    {
      key: 'report', box: [1614, 962, 2744, 1712], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 14.3), columnCount: 3 },
      pictures: [], panels: [],
    },
    {
      key: 'report-quote', box: [57, 1744, 1343, 2566], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 16.4), columnCount: 3 },
      pictures: [],
      panels: [
        byline(57, 408, 1856, 1897),
        { kind: 'sidebar', box: [836, 1860, 1343, 2130], title: '“', lines: lines(3), titleFamily: 'rozha', titlePx: 30, titleLineHeight: 0.62, titleGapPx: 1, ...TEXT(5.95, 31), boldLines: [2], insetPx: 0, standOffPx: 0.5 },
        { kind: 'sidebar', box: [837, 2151, 1343, 2558], tint: '#fbf3e9', title: PLACEHOLDER, lines: lines(1), titleFamily: 'noto-condensed', titlePx: 11.9, titleLineHeight: 1.3, titleGapPx: 3, ...TEXT(6.15), insetPx: 9, standOffPx: 0.5 },
      ],
    },
    photo('picture-box', [57, 2593, 796, 3447], [{ file: 'reference-lokmat/local-picture.jpg', box: [58, 2656, 797, 3400], standOffPx: 1 }], [
      cell([293, 2606, 560, 2649], 'mukta-heavy', 10.9, { bold: true, align: 'center', lineHeight: 1.3 }),
      { kind: 'sidebar', box: [57, 3412, 796, 3447], lines: lines(1), ...TEXT(5.9), insetPx: 0, standOffPx: 0.5 },
    ]),
    {
      key: 'report-savarkar', box: [836, 2593, 1344, 3447], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 12.0), displayLineHeight: lh(69, 12.0), columnCount: 1 },
      pictures: [], panels: [byline(837, 1343, 2740, 2781)],
    },
    photo('must-read', [59, 3484, 1342, 3546], [{ file: 'reference-lokmat/local-mustread-mark.jpg', box: [566, 3484, 638, 3546], standOffPx: 1 }], [
      rule([59, 3509, 556, 3523], 3, { ruleInk: '#fb9f0b' }),
      rule([845, 3509, 1342, 3523], 3, { ruleInk: '#fb9f0b' }),
      rule([648, 3485, 833, 3544], 13, { ruleInk: '#e42424' }),
      cell([648, 3495, 833, 3534], 'noto-condensed', 8.6, { bold: true, align: 'center', knockout: true, lineHeight: 1.2 }),
    ]),
    {
      key: 'planning', box: [57, 3580, 1343, 4300], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 21.6), displayLineHeight: lh(112, 21.6), displayOverlapPx: 20, columnCount: 3 },
      pictures: [],
      panels: [
        byline(57, 408, 3794, 3834),
        side([836, 3805 - INK, 1343, 4065], 1, { titlePx: 8.7 }),
        side([836, 4077 - INK, 1343, 4300], 1, { titlePx: 8.9 }),
      ],
    },
    photo('half-advert', [1424, 1736, 2744, 4296], [{ file: 'reference-lokmat/local-half-advert.jpg', box: [1424, 1736, 2744, 4296], standOffPx: 1 }]),
  ],
};
