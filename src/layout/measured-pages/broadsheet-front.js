// THE REFERENCE FRONT PAGE, measured exactly. Rectangles are scan pixels on
// the desk's 2800 x 4440 scan; type sizes are editor pixels from matching each
// role's face against the scan (see scan.js). No words of the reference page
// are here - panels carry placeholders.

const { kit } = require('./kit');

const { BODY, HEAD, lines, subhead, byline, cell, rule, INK, inset, PLACEHOLDER } = kit({ sy: 0.2267 });

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
        inset([836, 607 - INK, 1181, 1168], 14, { titlePx: 9.3 }),
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
      // THE MARKET RAIL: four headed tables, each a drawn mark beside a head
      // and ruled rows of figures - set as cells, one per figure, where the
      // scan puts it. Figures are placeholders; the desk's own come in daily.
      key: 'rail-markets', box: [58, 1200, 407, 1913], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, columnCount: 1, showDateline: false },
      pictures: [
        { file: 'reference-lokmat/front-mk-weather.jpg', box: [58, 1200, 161, 1297], standOffPx: 1 },
        { file: 'reference-lokmat/front-mk-celsius.jpg', box: [318, 1205, 402, 1292], standOffPx: 1 },
        { file: 'reference-lokmat/front-mk-rupee.jpg', box: [59, 1355, 165, 1423], standOffPx: 1 },
        { file: 'reference-lokmat/front-mk-gold.jpg', box: [63, 1523, 167, 1613], standOffPx: 1 },
        { file: 'reference-lokmat/front-mk-bull.jpg', box: [59, 1708, 160, 1779], standOffPx: 1 },
      ],
      panels: [
        cell([174, 1208, 320, 1258], 'mukta-heavy', 12.0, { bold: true, lineHeight: 1.2 }),
        cell([174, 1256, 320, 1294], 'sans', 6.9),
        cell([58, 1304, 130, 1334], 'sans', 6.1), cell([160, 1304, 230, 1334], 'sans', 6.1), cell([226, 1304, 245, 1334], 'sans', 6.1),
        cell([246, 1304, 320, 1334], 'sans', 6.1), cell([340, 1304, 406, 1334], 'sans', 6.1, { align: 'right' }),
        rule([58, 1336, 406, 1338]),
        cell([179, 1350, 400, 1436], 'mukta-heavy', 7.9, { bold: true, lineHeight: 1.22 }),
        cell([86, 1434, 200, 1464], 'sans', 5.7), cell([280, 1438, 406, 1464], 'sans', 6.6, { bold: true, align: 'right' }),
        rule([59, 1468, 406, 1470]),
        cell([86, 1472, 200, 1504], 'sans', 5.7), cell([280, 1476, 406, 1504], 'sans', 6.6, { bold: true, align: 'right' }),
        rule([59, 1508, 406, 1510]),
        cell([179, 1536, 400, 1596], 'mukta-heavy', 12.7, { bold: true, lineHeight: 1.2 }),
        cell([58, 1620, 110, 1652], 'sans', 6.1), cell([112, 1620, 290, 1652], 'sans', 5.5),
        cell([296, 1622, 332, 1652], 'sans', 6.1, { ink: '#e42424', align: 'center' }), cell([336, 1622, 406, 1652], 'sans', 6.1, { align: 'right' }),
        rule([59, 1654, 406, 1656]),
        cell([58, 1656, 110, 1688], 'sans', 6.1), cell([110, 1656, 290, 1688], 'sans', 5.5),
        cell([296, 1658, 332, 1688], 'sans', 6.1, { ink: '#e42424', align: 'center' }), cell([336, 1658, 406, 1688], 'sans', 6.1, { align: 'right' }),
        rule([59, 1690, 406, 1692]),
        cell([172, 1716, 407, 1770], 'mukta-heavy', 12.0, { bold: true, lineHeight: 1.2 }),
        cell([58, 1790, 180, 1822], 'sans', 6.1), cell([180, 1790, 290, 1822], 'sans', 6.1, { align: 'center' }),
        cell([296, 1790, 332, 1822], 'sans', 6.1, { ink: '#e42424', align: 'center' }), cell([336, 1790, 406, 1822], 'sans', 6.1, { align: 'right' }),
        rule([58, 1822, 407, 1824]),
        cell([58, 1824, 180, 1854], 'sans', 6.1), cell([180, 1824, 290, 1854], 'sans', 6.1, { align: 'center' }),
        cell([296, 1824, 332, 1854], 'sans', 6.1, { ink: '#e42424', align: 'center' }), cell([336, 1824, 406, 1854], 'sans', 6.1, { align: 'right' }),
        rule([58, 1856, 407, 1858]),
        rule([58, 1878, 406, 1913], 8),
        cell([58, 1880, 406, 1912], 'sans', 5.0, { bold: true, align: 'center', knockout: true }),
      ],
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
        // The byline FOLLOWS the deck: 3.8 px below where the copy would start,
        // measured off the calibration composition - so a deck one line
        // shorter than the reference's moves it up rather than leaving the
        // story's first lines standing above it.
        { ...byline(446, 797, 1687, 1727), id: 'lead-byline', followDisplay: true, followGapPx: 3.8 },
        { id: 'lead-caption', kind: 'sidebar', box: [835, 1978 - INK, 2013, 2146], title: PLACEHOLDER, lines: lines(3), titleFamily: 'noto-condensed', titlePx: 9.3, titleLineHeight: 1.25, titleGapPx: 3, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5 },
        inset([835, 2148, 1182, 2886], 2, { id: 'lead-scholarship', boldFamily: 'mukta-text', tint: '#f4e4dc', insetPx: 5, titlePx: 9.0, boldLines: [1], lineGapPx: 5 }),
        inset([1224, 2149 - INK, 1572, 2886], 2, { id: 'lead-numbered', boldFamily: 'mukta-text', marker: 'circle', boldLines: [1], lineGapPx: 0.4 }),
        inset([1611, 2445 - INK, 2011, 2886], 1, { id: 'lead-jarange', boldFamily: 'mukta-text' }),
        rule([446, 2891, 2013, 2909], 4, { id: 'lead-foot-rule', ruleStyle: 'ticks' }),
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
        { kind: 'sidebar', box: [2411, 1831, 2744, 2185], title: '“', lines: lines(4), titleFamily: 'mukta-heavy', titlePx: 40, titleLineHeight: 0.62, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'right-foot', box: [2057, 2219, 2744, 3412], story: 'SECONDARY', priority: 3,
      style: { ...BODY, ...HEAD('noto-condensed-light', 15.4), displayLineHeight: 1.28, columnCount: 2 },
      pictures: [{ file: 'reference-lokmat/front-rightfoot.jpg', box: [2440, 2408, 2744, 2601], standOffPx: 1 }],
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
      // THE MUST-READ SEPARATOR: a marigold rule broken by a mark and a red chip.
      key: 'must-read', box: [56, 3451, 2010, 3512], type: 'photo', story: 'ANALYSIS', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [{ file: 'reference-lokmat/front-mustread-mark.jpg', box: [900, 3451, 972, 3512], standOffPx: 1 }],
      panels: [
        rule([59, 3476, 890, 3489], 3, { ruleInk: '#fb9f0b' }),
        rule([1178, 3476, 2010, 3489], 3, { ruleInk: '#fb9f0b' }),
        rule([982, 3452, 1166, 3510], 13, { ruleInk: '#e42424' }),
        cell([982, 3462, 1166, 3500], 'noto-condensed', 8.6, { bold: true, align: 'center', knockout: true, lineHeight: 1.2 }),
      ],
    },
    {
      key: 'feature-strip', box: [56, 3520, 2010, 4296], story: 'ANALYSIS', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 21.7, { displayLineHeight: 1.19, headlineAlign: 'left' }), columnCount: 5 },
      pictures: [{ file: 'reference-lokmat/front-feature.jpg', box: [448, 3764, 792, 4296], standOffPx: 1 }],
      panels: [
        byline(57, 407, 3764, 3800),
        // BARS, because the reference's own feature carries a bar chart - the
        // figures set as large percentages was this page's most visible
        // remaining difference from it. The bars run ACROSS (smart-cards read
        // a long Marathi category label, which a vertical bar would have to
        // set sideways or abbreviate), and a printed chart carries its source.
        {
          kind: 'chart', box: [835, 3764, 1190, 4296], standOffPx: 0.5,
          card: {
            chartType: 'bar',
            unit: '%',
            source: PLACEHOLDER,
            // SHORT stand-ins, because a chart label is short. The panel's
            // usual placeholder is a sentence, and three sentences beside
            // three bars and three figures cannot set in an 82px column at a
            // legible size - the card composed OVERSET and the canvas drew the
            // dashed marker that says so on an otherwise finished page.
            items: [
              { label: 'एक', value: 74 },
              { label: 'दोन', value: 65 },
              { label: 'तीन', value: 48 },
            ],
          },
        },
        inset([1222, 3765 - INK, 1563, 4296], 1, { titlePx: 9.3 }),
        inset([1610, 3765 - INK, 2010, 4296], 4, { titlePx: 9.3, lineGapPx: 8 }),
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
