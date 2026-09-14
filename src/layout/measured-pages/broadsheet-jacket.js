// THE REFERENCE JACKET PAGE, measured exactly (see scan.js and kit.js). The
// scan's own nameplate band is not this paper's to copy, so the page keeps the
// scan's proportions (`uniform`) and starts where the scan's matter does. Its
// adverts are supplied artwork. No words of the reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 58, x1: 2744, y0: 486, y1: 4295, uniform: true };
const SY = 620 / (SCAN.x1 - SCAN.x0);
const { BODY, HEAD, lines, byline, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const artwork = (key, box) => ({
  key, box, type: 'advert', story: 'ADVERTISEMENT', priority: 1, style: { ...BODY, showDateline: false },
  pictures: [pic(`jacket-${key}.jpg`, box)], panels: [],
});
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});

module.exports = {
  key: 'broadsheet-jacket',
  name: 'Broadsheet jacket (reference)',
  description: 'A jacket page under the nameplate: a corner advert, a verse box and a shorts item, a lead with its five points and photograph, a weather story, and two supplied adverts.',
  scan: SCAN,
  blocks: [
    artwork('corner', [58, 486, 408, 1326]),
    {
      key: 'verse', box: [59, 1369, 408, 1947], type: 'briefs', story: 'BRIEF', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [],
      panels: [
        { kind: 'sidebar', box: [59, 1369, 408, 1947], title: PLACEHOLDER, lines: lines(4), titleFamily: 'mukta-heavy', titlePx: 9.5, titleGapPx: 2, ...TEXT(6.3, 33), boldLines: [0, 2], lineGapPx: 4, insetPx: 6, standOffPx: 0.5, ruleWidthPx: 0.7 },
      ],
    },
    { key: 'shorts-logo', box: [58, 1981, 408, 2120], type: 'photo', story: 'BRIEF', priority: 1, style: { ...BODY, showDateline: false }, pictures: [pic('jacket-shorts-logo.jpg', [93, 1981, 373, 2110])], panels: [] },
    {
      key: 'shorts', box: [58, 2157, 408, 2596], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, fontFamily: 'mukta-text', bodyFontPx: 6.2, lineHeight: lh(32, 6.2), textAlign: 'left', ...HEAD('mukta-heavy', 10.9), displayLineHeight: lh(58, 10.9), columnCount: 1 },
      pictures: [], panels: [],
    },
    {
      key: 'court-note', box: [447, 485, 1360, 770], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('mukta-heavy', 7.6), columnCount: 2, columnWidthPx: 80.8, showDateline: false },
      pictures: [], panels: [],
    },
    {
      key: 'lead', box: [445, 795, 1360, 2596], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 26.5, { subheadingFontPx: 9.2, subheadingLocked: true }), displayLineHeight: lh(134, 26.5), columnCount: 2, columnWidthPx: 80.8 },
      pictures: [pic('jacket-lead.jpg', [835, 1839, 1360, 2220])],
      panels: [
        byline(446, 796, 1245, 1285),
        inset([835, 1240 - INK, 1360, 1830], 3, { titleFamily: 'mukta-heavy', titlePx: 7.4, marker: 'circle', ...TEXT(6.2), lineGapPx: 3 }),
        inset([835, 2230, 1360, 2596], 2, { title: '', titlePx: 0.1, marker: 'circle', ...TEXT(6.2), lineGapPx: 3 }),
        // Holds the strip between the deck and the byline, which the reference leaves to the byline alone.
        { kind: 'ornament', box: [446, 1180, 796, 1245], rules: [], insetPx: 0, standOffPx: 0.5 },
      ],
    },
    artwork('health', [58, 2627, 1066, 4281]),
    {
      key: 'weather', box: [1112, 2640, 1360, 4295], story: 'STANDARD', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 12.8), displayLineHeight: lh(56, 12.8), columnCount: 1 },
      pictures: [pic('jacket-weather-map.jpg', [1106, 3756, 1359, 3955])],
      panels: [byline(1114, 1359, 2842, 2883), { kind: 'sidebar', box: [1106, 3960, 1360, 4295], lines: lines(3), ...TEXT(6.0), lineGapPx: 3, insetPx: 0, standOffPx: 0.5 }],
    },
    {
      key: 'teasers', box: [1402, 486, 2744, 540], type: 'briefs', story: 'BRIEF', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [],
      panels: [{ kind: 'sidebar', box: [1402, 486, 2744, 540], lines: lines(1), lineFamily: 'mukta-text', lineBold: true, linePx: 7.6, lineHeight: 1.3, insetPx: 0, standOffPx: 0.5 }],
    },
    artwork('lic', [1401, 565, 2744, 4293]),
  ],
};
