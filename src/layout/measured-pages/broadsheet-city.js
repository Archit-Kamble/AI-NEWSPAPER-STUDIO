// THE REFERENCE CITY PAGE, measured exactly (see scan.js and kit.js). Scan
// pixels on the desk's 2800 x 4440 scan; type sizes are editor pixels fitted
// to the scan's ink widths. No words of the reference page are here.

const { kit } = require('./kit');

// Page two carries the legal imprint, so its matter stops at 948.
const SCAN = { x0: 57, x1: 2744, y0: 345, y1: 4300, top: 56, bottom: 948 };
const SY = (SCAN.bottom - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, rule, INK, inset } = kit({ sy: SY });

// The rail and the sidebars on this page are set in Mukta, ragged, on a
// 31-32 scan pixel pitch.
// Leading from a pitch read off the scan (shirorekha to shirorekha, scan px).
const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const RAIL = { fontFamily: 'mukta-text', bodyFontPx: 5.75, lineHeight: lh(31, 5.75), textAlign: 'left', leadingPolicy: 'fixed', lineBreaking: 'greedy' };
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'noto-condensed', titlePx: 9.2, titleLineHeight: lh(51, 9.2), titleGapPx: 4,
  lineFamily: 'mukta-text', linePx: 6.0, lineHeight: lh(32, 6.0), ...extra,
});
const quote = (box, n) => ({
  kind: 'sidebar', box, title: '“', lines: lines(n), titleFamily: 'rozha', titlePx: 24, titleLineHeight: 0.62, titleGapPx: 1,
  lineFamily: 'mukta-text', linePx: 6.0, lineHeight: lh(32, 6.0), insetPx: 0, standOffPx: 0.5,
});
// A ticked rule drawn at the foot of its box, so the box can reach up and
// keep the copy above clear of it.
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-city',
  name: 'Broadsheet city front (reference)',
  description: 'A quick-update rail, a four-column picture lead with two sidebars, a picture-topped right story, a banner report, a half-page advert and three reports.',
  theme: 'city',
  scan: SCAN,
  blocks: [
    {
      key: 'update-art', box: [57, 345, 400, 500], type: 'photo', story: 'BRIEF', priority: 2,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/city-update-logo.jpg', box: [80, 348, 388, 494], standOffPx: 1 }],
      panels: [],
    },
    {
      key: 'rail-update', box: [57, 515, 400, 1200], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, ...RAIL, ...HEAD('mukta-heavy', 10.1), displayLineHeight: lh(52, 10.1), columnCount: 1 },
      pictures: [], panels: [],
    },
    {
      key: 'rail-two', box: [57, 1229, 400, 1745], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, ...RAIL, ...HEAD('mukta-heavy', 9.3), displayLineHeight: lh(52, 9.3), columnCount: 1 },
      pictures: [], panels: [],
    },
    {
      key: 'lead', box: [440, 345, 1966, 1745], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 26.6, { subheadingFontPx: 11.2, subheadingLocked: true, subheadingAlign: 'center' }), displayLineHeight: lh(134, 26.6), columnCount: 4 },
      pictures: [{ file: 'reference-lokmat/city-lead.jpg', box: [836, 754, 1187, 1147], standOffPx: 1 }],
      panels: [
        byline(446, 797, 735, 775),
        side([1226, 733 - INK, 1572, 1380], 3, { titlePx: 8.64, lineGapPx: 4 }),
        side([1615, 733 - INK, 1966, 1380], 1, { titlePx: 8.6 }),
        side([1226, 1404 - INK, 1966, 1700], 1, { titlePx: 9.35 }),
        ticks([446, 1696, 1966, 1742]),
        // the column above the photograph is empty on the scan
        { kind: 'ornament', box: [836, 733, 1187, 754], rules: [], standOffPx: 0.5 },
      ],
    },
    {
      key: 'right-art', box: [2004, 345, 2744, 745], type: 'photo', story: 'SECONDARY', priority: 4,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/city-right.jpg', box: [2005, 349, 2744, 689], standOffPx: 1 }],
      panels: [cell([2006, 708, 2744, 738], 'mukta-text', 5.9)],
    },
    {
      key: 'right-top', box: [2004, 755, 2744, 2205], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 18.6), displayLineHeight: lh(103, 18.6), columnCount: 2 },
      pictures: [],
      panels: [
        byline(2004, 2355, 973, 1013),
        side([2394, 980 - INK, 2744, 1525], 1, { titlePx: 9.16 }),
        side([2394, 1540 - INK, 2744, 2205], 2, { titlePx: 9.3, lineGapPx: 5 }),
      ],
    },
    {
      key: 'banner-report', box: [56, 1775, 1966, 2195], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('noto-condensed', 19.1), columnCount: 5 },
      pictures: [],
      panels: [byline(57, 407, 1890, 1931)],
    },
    {
      key: 'half-advert', box: [57, 2210, 1419, 4300], type: 'photo', story: 'ADVERTISEMENT', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/city-advert.jpg', box: [57, 2210, 1419, 4300], standOffPx: 1 }],
      panels: [],
    },
    {
      key: 'report-wide', box: [1457, 2218, 2744, 3255], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 18.1), displayLineHeight: lh(102, 18.1), columnCount: 1 },
      pictures: [],
      panels: [
        byline(1459, 1966, 2434, 2475),
        side([2004, 2441 - INK, 2335, 3245], 3, { titlePx: 9.4, marker: 'circle', lineGapPx: 5 }),
        quote([2366, 2440, 2744, 2925], 3),
        quote([2366, 2932, 2744, 3245], 3),
        // the story's own column stops at 1966; everything right of it is sidebars
        { kind: 'ornament', box: [1975, 2430, 2744, 3255], rules: [], standOffPx: 0.5 },
      ],
    },
    {
      key: 'report-narrow', box: [1457, 3272, 1966, 4300], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed-light', 14.0), displayLineHeight: lh(71, 14.0), columnCount: 1 },
      pictures: [],
      panels: [byline(1459, 1966, 3420, 3461)],
    },
    {
      key: 'report-picture', box: [2004, 3272, 2744, 4300], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed-light', 16.2), displayLineHeight: lh(84, 16.2), columnCount: 2 },
      pictures: [{ file: 'reference-lokmat/city-report.jpg', box: [2394, 3461, 2744, 3667], standOffPx: 1 }],
      panels: [byline(2004, 2355, 3454, 3495)],
    },
  ],
};
