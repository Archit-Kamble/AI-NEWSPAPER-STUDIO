// THE REFERENCE SPORT PAGE, measured exactly (see scan.js and kit.js): a
// quick-update rail, a picture-panelled lead, a right-hand story with its
// scorecard, two reports, a separator-led feature and a squad box. No words of
// the reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 60, x1: 2739, y0: 248, y1: 4297, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, rule, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const side = (box, n, extra = {}) => inset(box, n, {
  titleFamily: 'mukta-heavy', titlePx: 8.5, titleLineHeight: lh(50, 8.5), titleGapPx: 4, ...TEXT(6.1), ...extra,
});
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});
const RAIL = { fontFamily: 'mukta-text', bodyFontPx: 6.0, lineHeight: lh(32, 6.0), textAlign: 'left', leadingPolicy: 'fixed', lineBreaking: 'greedy' };
const photo = (key, box, pictures, panels = []) => ({
  key, box, type: 'photo', story: 'BRIEF', priority: 1, style: { ...BODY, showDateline: false }, pictures, panels,
});
const brief = (key, box, px) => ({
  key, box, type: 'briefs', story: 'BRIEF', priority: 2,
  style: { ...BODY, ...RAIL, ...HEAD('mukta-heavy', px), displayLineHeight: lh(58, px), columnCount: 1 },
  pictures: [], panels: [],
});
const ticks = (box) => rule(box, 4, { ruleStyle: 'ticks', rules: ['bottom'] });

module.exports = {
  key: 'broadsheet-sport',
  name: 'Broadsheet sport (reference)',
  description: 'A quick-update rail, a picture-panelled lead, a right-hand story with its scorecard, two reports, a separator-led feature and a squad box.',
  theme: 'sport',
  scan: SCAN,
  blocks: [
    photo('today', [60, 248, 409, 566], [pic('sport-today.jpg', [60, 248, 409, 566])]),
    photo('update', [60, 582, 409, 1073], [pic('sport-update-logo.jpg', [83, 582, 390, 725]), pic('sport-update.jpg', [61, 743, 409, 1073])]),
    brief('rail-one', [60, 1099, 409, 1504], 9.7),
    photo('rail-photo', [60, 1530, 409, 1781], [pic('sport-rail-photo.jpg', [61, 1530, 409, 1781])]),
    brief('rail-two', [60, 1807, 409, 2435], 10.1),
    photo('rail-mugs', [60, 2466, 409, 2712], [pic('sport-rail-mugs.jpg', [60, 2466, 409, 2659])], [
      cell([60, 2675, 230, 2712], 'mukta-heavy', 6.0, { bold: true, align: 'center', lineHeight: 1.3 }),
      cell([230, 2675, 409, 2712], 'mukta-heavy', 6.0, { bold: true, align: 'center', lineHeight: 1.3 }),
    ]),
    brief('rail-three', [60, 2741, 409, 3444], 9.8),
    brief('rail-four', [60, 3467, 409, 4297], 10.1),
    {
      key: 'lead', box: [446, 256, 1962, 2230], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 28.9, { subheadingFontPx: 10.7, subheadingLocked: true }), displayLineHeight: lh(180, 28.9), columnCount: 1, columnWidthPx: 80.8 },
      pictures: [pic('sport-lead.jpg', [838, 680, 1962, 2216])],
      panels: [
        side([1592, 768, 1950, 1015], 1, { tint: '#ffffff', insetPx: 8 }),
        side([1572, 1040, 1962, 1500], 5, { tint: '#d8e7f2', lineGapPx: 2, titlePx: 9.0 }),
        ticks([446, 2200, 1962, 2230]),
      ],
    },
    {
      key: 'zone', box: [2001, 253, 2739, 2230], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-medium', 20.8, { subheadingFontPx: 8.5, subheadingLocked: true }), displayLineHeight: lh(113, 20.8), columnCount: 2 },
      pictures: [pic('sport-zone.jpg', [2360, 464, 2739, 1200])],
      panels: [
        { kind: 'sidebar', box: [2380, 1205, 2739, 1340], title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: 11.2, titleLineHeight: lh(53, 11.5), insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'misbah', box: [448, 2257, 1185, 3411], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 19.3), displayLineHeight: lh(101, 19.3), columnCount: 2 },
      pictures: [pic('sport-misbah.jpg', [838, 2466, 1185, 2730])],
      panels: [
        deck([449, 2467 - INK, 800, 2600], 7.9, 50),
        side([837, 2748 - INK, 1185, 3411], 1, { titlePx: 8.8, titleLineHeight: lh(54, 8.8) }),
      ],
    },
    {
      key: 'tennis', box: [1224, 2257, 2739, 3412], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 23.3, { subheadingFontPx: 8.6, subheadingLocked: true }), displayLineHeight: lh(110, 23.3), columnCount: 3, columnWidthPx: 80.8 },
      pictures: [pic('sport-tennis.jpg', [1614, 2400, 2739, 2952]), pic('sport-wawrinka.jpg', [2249, 3100, 2415, 3298])],
      panels: [
        side([2002, 2985 - INK, 2215, 3412], 3, { titlePx: 0.1, title: '', ...TEXT(6.0, 32), boldLines: [], lineGapPx: 2 }),
        side([2249, 2986 - INK, 2739, 3412], 1, { titlePx: 8.7, ...TEXT(6.0, 32) }),
      ],
    },
    photo('must-read', [450, 3451, 1961, 3513], [pic('sport-mustread.jpg', [450, 3451, 1961, 3513])]),
    {
      key: 'gurnoor', box: [448, 3540, 1962, 4297], story: 'ANALYSIS', priority: 3,
      style: { ...BODY, ...HEAD('mukta-book', 19.8), columnCount: 2, columnWidthPx: 80.8 },
      pictures: [pic('sport-gurnoor.jpg', [1228, 3656, 1962, 4297])],
      panels: [
        deck([448, 3657 - INK, 800, 3760], 8.4, 50),
        side([1240, 3680 - INK, 1560, 3990], 1, { titlePx: 8.4, tint: '#f2dce4' }),
        side([1590, 3680 - INK, 1955, 3880], 2, { titlePx: 8.4, tint: '#f2dce4' }),
      ],
    },
    {
      key: 'squad', box: [2020, 3450, 2739, 4297], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, fontFamily: 'mukta-text', bodyFontPx: 6.0, lineHeight: lh(32, 6.0), textAlign: 'justify', backgroundColor: '#eaeaea', marginPx: 5, ...HEAD('mukta-heavy', 15.0, { headlineAlign: 'center' }), displayLineHeight: lh(84, 15.0), columnCount: 1, showDateline: false },
      pictures: [pic('sport-squad.jpg', [2040, 3860, 2734, 4296]), pic('sport-squad-mug.jpg', [2604, 3635, 2707, 3845])],
      panels: [],
    },
  ],
};
