// THE REFERENCE STATE PAGE, measured exactly (see scan.js and kit.js). Scan
// pixels on the desk's 2800 x 4440 scan; type sizes are editor pixels fitted
// to the scan's ink widths. No words of the reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 57, x1: 2744, y0: 248, y1: 4302, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

// Leading from a pitch read off the scan (shirorekha to shirorekha, scan px).
const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const RAIL = { fontFamily: 'mukta-text', bodyFontPx: 5.85, lineHeight: lh(32, 5.85), textAlign: 'left' };
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'noto-condensed', titlePx: 9.3, titleLineHeight: lh(51, 9.3), titleGapPx: 4, ...TEXT(6.2), ...extra,
});
const caption = (box, px = 5.9) => ({ kind: 'sidebar', box, lines: lines(1), ...TEXT(px), insetPx: 0, standOffPx: 0.5 });
const blank = (box) => ({ kind: 'ornament', box, rules: [], standOffPx: 0.5 });
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });
const brief = (key, box, px, pitch) => ({
  key, box, type: 'briefs', story: 'BRIEF', priority: 2,
  style: { ...BODY, ...RAIL, ...HEAD('mukta-heavy', px), displayLineHeight: lh(pitch, px), columnCount: 1 },
  pictures: [], panels: [],
});

module.exports = {
  key: 'broadsheet-state',
  name: 'Broadsheet state (reference)',
  description: 'A quick-update rail of briefs and pictures, a picture-led top story beside a narrow column, a drugs-campaign lead with a tinted panel, a right story with a quote, four reports and a separator-led feature.',
  theme: 'state',
  scan: SCAN,
  blocks: [
    {
      key: 'update-art', box: [57, 248, 405, 870], type: 'photo', story: 'BRIEF', priority: 2,
      style: { ...BODY, showDateline: false },
      pictures: [
        { file: 'reference-lokmat/state-update-logo.jpg', box: [79, 248, 386, 394], standOffPx: 1 },
        { file: 'reference-lokmat/state-rail-photo.jpg', box: [57, 407, 405, 713], standOffPx: 1 },
      ],
      panels: [caption([57, 724, 405, 870])],
    },
    brief('rail-one', [57, 895, 405, 1270], 10.1, 60),
    brief('rail-two', [57, 1291, 405, 1830], 9.6, 60),
    brief('rail-three', [57, 1846, 405, 2356], 10.3, 59),
    {
      key: 'rail-photo', box: [57, 2373, 405, 2818], type: 'photo', story: 'BRIEF', priority: 2,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/state-rail-photo2.jpg', box: [57, 2373, 405, 2697], standOffPx: 1 }],
      panels: [caption([57, 2708, 405, 2818])],
    },
    brief('rail-four', [57, 2832, 405, 3245], 10.3, 58),
    brief('rail-five', [57, 3259, 405, 3700], 10.4, 56),
    brief('rail-six', [57, 3716, 405, 4302], 10.1, 57),
    {
      key: 'top-story', box: [448, 248, 2353, 1305], story: 'LEAD', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 21.2), columnCount: 5 },
      pictures: [
        { file: 'reference-lokmat/state-top.jpg', box: [840, 361, 2353, 1067], standOffPx: 1 },
        { file: 'reference-lokmat/state-top-inset.jpg', box: [882, 929, 1173, 1302], standOffPx: 1 },
      ],
      panels: [
        byline(449, 797, 361, 401),
        blank([840, 1067, 1210, 1305]),
        side([1227, 1097 - INK, 2353, 1305], 1, { titlePx: 9.0, ...TEXT(6.2) }),
      ],
    },
    {
      key: 'top-side', box: [2395, 249, 2744, 1305], story: 'SECONDARY', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed', 10.7), displayLineHeight: lh(58, 10.7), columnCount: 1 },
      pictures: [],
      panels: [byline(2395, 2744, 426, 469)],
    },
    {
      key: 'lead', box: [449, 1338, 1967, 2738], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 23.7, { subheadingFontPx: 11.0, subheadingLocked: true }), displayLineHeight: lh(136, 23.7), columnCount: 4 },
      pictures: [{ file: 'reference-lokmat/state-lead.jpg', box: [840, 1721, 1573, 2321], standOffPx: 1 }],
      panels: [
        byline(450, 800, 1721, 1761),
        blank([840, 2321, 1574, 2367]),
        side([837, 2367, 1574, 2693], 2, { tint: '#f4e4dc', insetPx: 5, titlePx: 9.0, lineGapPx: 4 }),
        side([1616, 1721 - INK, 1967, 2700], 5, { lineGapPx: 5 }),
        ticks([450, 2700, 1967, 2738]),
      ],
    },
    {
      key: 'right', box: [2006, 1338, 2744, 2736], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 21.9), displayLineHeight: lh(108, 21.9), columnCount: 2 },
      pictures: [
        { file: 'reference-lokmat/state-right-mark.jpg', box: [2038, 1710, 2327, 1759], standOffPx: 1 },
        { file: 'reference-lokmat/state-right.jpg', box: [2392, 1584, 2744, 1880], standOffPx: 1 },
      ],
      panels: [
        { kind: 'sidebar', box: [2006, 1586 - INK, 2392, 1700], title: PLACEHOLDER, lines: [], titleFamily: 'noto-condensed', titlePx: 10.9, titleLineHeight: lh(54, 10.9), insetPx: 0, standOffPx: 0.5 },
        cell([2006, 1786, 2356, 1815], 'sans', 5.9, { bold: true, align: 'center' }),
        byline(2006, 2356, 1823, 1863),
        side([2395, 1890 - INK, 2744, 2360], 3, { titlePx: 8.9, boldLines: [2], lineGapPx: 3 }),
        { kind: 'sidebar', box: [2395, 2376, 2744, 2736], title: '“', lines: lines(3), titleFamily: 'rozha', titlePx: 30, titleLineHeight: 0.62, titleGapPx: 1, ...TEXT(6.2), insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'report-one', box: [450, 2765, 1189, 3517], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 15.8), displayLineHeight: lh(85, 15.8), columnCount: 2 },
      pictures: [{ file: 'reference-lokmat/state-report-mug.jpg', box: [451, 3012, 616, 3176], standOffPx: 2 }],
      panels: [byline(452, 800, 2944, 2985)],
    },
    {
      key: 'report-two', box: [1224, 2765, 1574, 3517], story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('noto-condensed-light', 11.1), displayLineHeight: lh(65, 11.1), columnCount: 1 },
      pictures: [],
      panels: [byline(1225, 1572, 2910, 2951)],
    },
    {
      key: 'report-picture', box: [1616, 2765, 2356, 3517], type: 'photo', story: 'PHOTO_FEATURE', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed', 11.75), columnCount: 1, showDateline: false },
      pictures: [{ file: 'reference-lokmat/state-report-photo.jpg', box: [1616, 2827, 2355, 3411], standOffPx: 1 }],
      panels: [{ kind: 'sidebar', box: [1616, 3420, 2356, 3517], lines: lines(1), ...TEXT(6.1, 30), insetPx: 0, standOffPx: 0.5 }],
    },
    {
      key: 'report-three', box: [2395, 2765, 2744, 3517], story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('noto-condensed-light', 11.9), displayLineHeight: lh(65, 11.9), columnCount: 1 },
      pictures: [],
      panels: [byline(2395, 2744, 2910, 2951)],
    },
    {
      key: 'must-read', box: [448, 3553, 1963, 3615], type: 'photo', story: 'ANALYSIS', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/state-mustread-mark.jpg', box: [1073, 3553, 1145, 3615], standOffPx: 1 }],
      panels: [
        rule([452, 3578, 1064, 3592], 3, { ruleInk: '#fb9f0b' }),
        rule([1352, 3578, 1963, 3592], 3, { ruleInk: '#fb9f0b' }),
        rule([1156, 3554, 1340, 3613], 13, { ruleInk: '#e42424' }),
        cell([1156, 3564, 1340, 3603], 'noto-condensed', 8.6, { bold: true, align: 'center', knockout: true, lineHeight: 1.2 }),
      ],
    },
    {
      key: 'feature-strip', box: [448, 3630, 1963, 4302], story: 'ANALYSIS', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 21.3), columnCount: 4 },
      pictures: [{ file: 'reference-lokmat/state-feature.jpg', box: [840, 3816, 1008, 4008], standOffPx: 1 }],
      panels: [
        { kind: 'sidebar', box: [448, 3757 - INK, 798, 3860], title: PLACEHOLDER, lines: [], titleFamily: 'noto-condensed', titlePx: 9.0, titleLineHeight: lh(51, 9.0), insetPx: 0, standOffPx: 0.5 },
        byline(448, 798, 3862, 3902),
        { kind: 'sidebar', box: [839, 3757 - INK, 1330, 3805], title: PLACEHOLDER, lines: [], titleFamily: 'noto-condensed', titlePx: 9.4, insetPx: 0, standOffPx: 0.5 },
        { kind: 'sidebar', box: [1020, 3813, 1330, 4072], lines: lines(1), ...TEXT(6.2), insetPx: 0, standOffPx: 0.5 },
        cell([840, 4015, 1008, 4040], 'sans', 5.6, { bold: true, align: 'center' }),
        { kind: 'sidebar', box: [839, 4078, 1330, 4302], lines: lines(2), ...TEXT(6.2), boldLines: [0], lineGapPx: 2, insetPx: 0, standOffPx: 0.5 },
        side([1366, 3757 - INK, 1580, 4302], 2, { titlePx: 9.1, marker: 'circle', lineGapPx: 5 }),
        side([1616, 3766 - INK, 1963, 3980], 1, { titlePx: 9.4 }),
        side([1616, 3990 - INK, 1963, 4302], 2, { titlePx: 9.4, lineGapPx: 3 }),
      ],
    },
    {
      key: 'feature-side', box: [2006, 3549, 2744, 4302], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed', 15.8), displayLineHeight: lh(82, 15.8), columnCount: 2 },
      pictures: [{ file: 'reference-lokmat/state-feature-side.jpg', box: [2392, 3728, 2744, 3952], standOffPx: 1 }],
      panels: [cell([2395, 3960, 2744, 3990], 'noto-condensed', 7.5, { bold: true, align: 'center' })],
    },
  ],
};
