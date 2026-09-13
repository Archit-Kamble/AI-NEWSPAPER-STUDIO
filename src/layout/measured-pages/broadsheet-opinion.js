// THE REFERENCE OPINION PAGE, measured exactly (see scan.js and kit.js). Its
// columns are wider than the news pages' - 455 scan px on a 494 px pitch - and
// the editorial is one 689 px column on a looser pitch. No words of the
// reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 57, x1: 2744, y0: 248, y1: 4163, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, cell, rule, INK, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const WIDE = { columnWidthPx: 105, columnGutterPx: 9.0 };
const label = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});
// A SECTION'S DRAWN LABEL, as a block of its own above the piece it names.
const labelBlock = (key, box, file, pictureBox) => ({
  key, box, type: 'photo', story: 'BRIEF', priority: 1, style: { ...BODY, showDateline: false },
  pictures: [label(file, pictureBox)], panels: [],
});
const signature = (box) => cell(box, 'sans', 5.6, { align: 'right' });

module.exports = {
  key: 'broadsheet-opinion',
  name: 'Broadsheet opinion (reference)',
  description: 'The editorial column, a lead column with its writer card and picture, a second column, two short pieces, a letter and a cartoon.',
  scan: SCAN,
  blocks: [
    labelBlock('editorial-label', [57, 249, 746, 320], 'opinion-label-editorial.jpg', [290, 249, 517, 316]),
    {
      key: 'editorial', box: [57, 328, 746, 2491], story: 'OPINION', priority: 5,
      style: { ...BODY, fontFamily: 'serif', bodyFontPx: 6.15, lineHeight: lh(36, 6.15), ...HEAD('mukta-medium', 16.1, { headlineAlign: 'center' }), columnCount: 1, showDateline: false, displayOverlapPx: 0 },
      pictures: [],
      panels: [],
    },
    {
      key: 'lead-column', box: [807, 248, 2743, 1410], story: 'OPINION', priority: 4,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-heavy', 25.3, { headlineAlign: 'center' }), columnCount: 4, showDateline: false },
      pictures: [
        label('opinion-lead-card.jpg', [811, 525, 1261, 700]),
        label('opinion-lead-photo.jpg', [1794, 417, 2249, 711]),
      ],
      panels: [
        deck([808, 410, 1756, 515], 8.3, 48),
        { kind: 'sidebar', box: [1794, 728, 2249, 795], lines: lines(1), lineFamily: 'mukta-heavy', linePx: 6.9, lineHeight: lh(34, 6.9), insetPx: 0, standOffPx: 0.5 },
        signature([2400, 1380, 2743, 1410]),
      ],
    },
    labelBlock('second-label', [807, 1470, 1756, 1500], 'opinion-label-kamgar.jpg', [808, 1470, 1009, 1496]),
    {
      key: 'second-column', box: [807, 1508, 2743, 2497], story: 'OPINION', priority: 4,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-book', 22.2), columnCount: 4, showDateline: false },
      pictures: [label('opinion-second-card.jpg', [818, 1771, 1263, 1936])],
      panels: [
        deck([808, 1661 - INK, 1756, 1760], 7.8, 48),
        signature([2400, 2467, 2743, 2497]),
      ],
    },
    labelBlock('world-label', [57, 2549, 1000, 2580], 'opinion-label-jagbhar.jpg', [57, 2549, 155, 2576]),
    {
      key: 'world-piece', box: [57, 2598, 1999, 3280], story: 'OPINION', priority: 3,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-medium', 13.6), columnCount: 4, showDateline: false },
      pictures: [label('opinion-world-photo.jpg', [1047, 2608, 1502, 2888])],
      panels: [],
    },
    labelBlock('people-label', [2078, 2549, 2743, 2580], 'opinion-label-janman.jpg', [2078, 2549, 2185, 2576]),
    {
      key: 'people-piece', box: [2078, 2588, 2743, 3483], story: 'OPINION', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 11.6), columnCount: 1, showDateline: false },
      pictures: [label('opinion-people-photo.jpg', [2410, 2673, 2743, 2881])],
      panels: [signature([2300, 3455, 2743, 3483])],
    },
    {
      key: 'letters-note', box: [2078, 3505, 2743, 3619], type: 'photo', story: 'BRIEF', priority: 1,
      style: { ...BODY, showDateline: false },
      pictures: [],
      panels: [
        rule([2078, 3505, 2743, 3508], 0.6),
        { kind: 'sidebar', box: [2140, 3512, 2680, 3605], lines: lines(1), lineFamily: 'mukta-text', lineBold: true, linePx: 6.3, lineAlign: 'center', lineHeight: lh(29, 6.3), insetPx: 0, standOffPx: 0.5 },
        rule([2078, 3612, 2743, 3619], 1.5),
      ],
    },
    labelBlock('third-label', [57, 3321, 1000, 3360], 'opinion-label-sajjan.jpg', [57, 3321, 256, 3357]),
    {
      key: 'third-column', box: [57, 3372, 1999, 4163], story: 'OPINION', priority: 3,
      style: { ...BODY, ...WIDE, ...HEAD('mukta-medium', 20.4), columnCount: 4, showDateline: false },
      pictures: [label('opinion-third-card.jpg', [65, 3615, 511, 3775]), label('opinion-third-photo.jpg', [1047, 3494, 1502, 3776])],
      panels: [
        deck([57, 3501 - INK, 1000, 3600], 8.35, 53),
        signature([1600, 4135, 1999, 4163]),
      ],
    },
    {
      key: 'cartoon', box: [2078, 3652, 2743, 4163], type: 'photo', story: 'PHOTO_FEATURE', priority: 2,
      style: { ...BODY, showDateline: false },
      pictures: [label('opinion-label-cartoon.jpg', [2078, 3652, 2406, 3691]), label('opinion-cartoon.jpg', [2079, 3700, 2742, 4158])],
      panels: [cell([2560, 3664, 2741, 3692], 'mukta-text', 6.3, { bold: true, align: 'right' })],
    },
  ],
};
