// THE REFERENCE LOCAL SPORT AND NOTICES PAGE, measured exactly (see scan.js and
// kit.js). Three sport stories across the top, a bank of supplied notices set
// as their own artwork, a sport story and a results rail. No words of the
// reference page are here.

const { kit } = require('./kit');

const SCAN = { x0: 56, x1: 2744, y0: 249, y1: 4293, top: 56 };
const SY = (1008 - SCAN.top) / (SCAN.y1 - SCAN.y0);
const { BODY, HEAD, lines, byline, cell, INK, inset, PLACEHOLDER } = kit({ sy: SY });

const lh = (pitch, px) => Math.round((pitch * SY / px) * 100) / 100;
const TEXT = (px, pitch = 32) => ({ lineFamily: 'mukta-text', linePx: px, lineHeight: lh(pitch, px) });
const pic = (file, box) => ({ file: `reference-lokmat/${file}`, box, standOffPx: 1 });
const deck = (box, px, pitch) => ({
  kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'mukta-heavy', titlePx: px,
  titleLineHeight: lh(pitch, px), insetPx: 0, standOffPx: 0.5,
});
const caption = (box) => cell(box, 'mukta-heavy', 6.0, { bold: true, align: 'center', lineHeight: 1.3 });
const notice = (key, box) => ({
  key, box, type: 'advert', story: 'ADVERTISEMENT', priority: 1, style: { ...BODY, showDateline: false },
  pictures: [pic(`localsport-${key}.jpg`, box)], panels: [],
});
// The sport story's own narrower columns: 275 scan px on a 307 px pitch.
const NARROW = { columnWidthPx: 63.4, columnGutterPx: 7.4 };

module.exports = {
  key: 'broadsheet-local-sport',
  name: 'Broadsheet local sport and notices (reference)',
  description: 'Three sport stories across the top, a bank of notices, a sport story with its results rail and a tinted result.',
  theme: 'sport',
  scan: SCAN,
  blocks: [
    {
      key: 'club', box: [56, 249, 797, 1450], story: 'SECONDARY', priority: 3,
      style: { ...BODY, ...HEAD('mukta-medium', 18.2), displayLineHeight: lh(103, 18.2), columnCount: 2 },
      pictures: [pic('localsport-snooker.jpg', [447, 461, 797, 684])],
      panels: [deck([57, 464 - INK, 407, 640], 8.3, 52), byline(57, 408, 633, 673)],
    },
    {
      key: 'table-tennis', box: [834, 249, 1965, 1640], story: 'LEAD', priority: 5,
      style: { ...BODY, ...HEAD('mukta-heavy', 26.2, { subheadingFontPx: 10.6, subheadingLocked: true }), displayLineHeight: lh(146, 26.2), columnCount: 3 },
      pictures: [
        pic('localsport-tt1.jpg', [1226, 599, 1431, 821]), pic('localsport-tt2.jpg', [1454, 599, 1659, 835]),
        pic('localsport-tt3.jpg', [1226, 862, 1431, 1079]), pic('localsport-tt4.jpg', [1454, 862, 1659, 1079]),
      ],
      panels: [
        byline(836, 1187, 599, 639),
        caption([1226, 822, 1431, 860]), caption([1454, 836, 1659, 860]),
        caption([1226, 1082, 1431, 1122]), caption([1454, 1082, 1659, 1122]),
        { kind: 'sidebar', box: [1700, 596, 1965, 1115], lines: lines(1), ...TEXT(6.0), insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'taekwondo', box: [2004, 251, 2744, 1650], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...HEAD('mukta-book', 19.6), displayLineHeight: lh(110, 19.6), columnCount: 2 },
      pictures: [pic('localsport-taekwondo.jpg', [2395, 490, 2744, 870])],
      panels: [
        deck([2004, 489 - INK, 2355, 660], 8.4, 48),
        byline(2004, 2355, 633, 673),
        { kind: 'sidebar', box: [2394, 887 - INK, 2744, 1650], title: PLACEHOLDER, lines: lines(2), titleFamily: 'noto-condensed', titlePx: 9.5, titleLineHeight: 1.3, titleGapPx: 3, ...TEXT(6.1, 34), lineGapPx: 0, insetPx: 0, standOffPx: 0.5 },
      ],
    },
    notice('daund', [56, 1509, 715, 2003]),
    notice('mahatransco', [56, 2026, 715, 2602]),
    notice('kolhapur', [56, 2624, 715, 3447]),
    notice('pmc', [56, 3468, 1374, 4292]),
    notice('dharashiv', [731, 1673, 1390, 2167]),
    notice('mahavitaran-one', [731, 2190, 1390, 2766]),
    notice('mahavitaran-two', [731, 2788, 1390, 3447]),
    notice('baramati', [1407, 2542, 2395, 3366]),
    notice('lonavala', [1407, 3387, 2395, 4292]),
    {
      key: 'academies', box: [1466, 1674, 2744, 2500], story: 'SECONDARY', priority: 4,
      style: { ...BODY, ...NARROW, ...HEAD('mukta-medium', 16.4), columnCount: 3 },
      pictures: [pic('localsport-academy.jpg', [1809, 1793, 2013, 1937])],
      panels: [
        deck([1467, 1794 - INK, 1745, 1915], 8.1, 55),
        byline(1467, 1742, 1890, 1931),
        cell([1774, 1940, 1890, 2020], 'mukta-heavy', 6.0, { bold: true, lineHeight: 1.3 }),
        cell([1900, 1940, 2048, 2020], 'mukta-heavy', 6.0, { bold: true, lineHeight: 1.3 }),
        { kind: 'sidebar', box: [2400, 1790, 2744, 2500], title: PLACEHOLDER, lines: lines(2), titleFamily: 'noto-condensed', titlePx: 9.9, titleLineHeight: 1.3, titleGapPx: 2, ...TEXT(6.0, 34), insetPx: 0, standOffPx: 0.5 },
      ],
    },
    {
      key: 'eagles', box: [2472, 2530, 2744, 3600], story: 'BRIEF', priority: 2,
      style: { ...BODY, ...HEAD('mukta-medium', 10.9), displayLineHeight: lh(67, 10.9), columnCount: 1 },
      pictures: [], panels: [byline(2472, 2744, 2740, 2781)],
    },
    {
      key: 'result', box: [2474, 3614, 2744, 4292], type: 'briefs', story: 'BRIEF', priority: 2,
      style: { ...BODY, fontFamily: 'mukta-text', bodyFontPx: 6.1, lineHeight: lh(33, 6.1), textAlign: 'left', backgroundColor: '#f4e4dc', marginPx: 7, ...HEAD('mukta-medium', 13.8), displayLineHeight: lh(51, 13.8), columnCount: 1, showDateline: false },
      pictures: [], panels: [],
    },
  ],
};
