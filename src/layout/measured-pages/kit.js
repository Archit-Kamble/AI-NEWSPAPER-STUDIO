// THE PIECES A MEASURED PAGE IS MADE OF, in scan pixels - shared by every
// page measured off a scan, so a byline or a table cell is one decision.
//
// `sy` is the page's vertical scale (editor px per scan px), which a cell
// needs to know how deep its own line is.

const { PLACEHOLDER } = require('./scan');

function kit({ sy = 0.2267 } = {}) {
  // Body at 5.9 px on a 34-scan-pixel pitch, which is the reference's own.
  const BODY = { fontFamily: 'sans', bodyFontPx: 5.9, lineHeight: Math.round((34 * sy / 5.9) * 1000) / 1000, textAlign: 'justify-all', marginPx: 1, datelineStyle: 'colon', paragraphPolicy: 'as-written', displayOverlapPx: 12 };
  const HEAD = (displayFamily, headlineFontPx, extra = {}) => ({ displayFamily, headlineFontPx, headlineLocked: true, ...extra });
  // A stand-off of 0 is not "none" to the compositor - it is the default 0.6 em -
  // so a panel set tight against what it sits under states half a pixel.
  const lines = (n) => Array.from({ length: n }, () => PLACEHOLDER);

  // A SUB-HEAD set in the column: condensed, and nothing round it.
  const subhead = (box, px = 9.1, extra = {}) => ({
    kind: 'sidebar', box, title: PLACEHOLDER, lines: [], titleFamily: 'noto-condensed', titlePx: px,
    titleLineHeight: 1.25, insetPx: 0, standOffPx: 0.5, ...extra,
  });
  // THE AGENCY LINE under a deck: centred, with a rule under it.
  // Given as the column, the TOP OF ITS INK and the BOTTOM OF ITS RULE, which is
  // how it reads off a scan; the line box starts at the ink's top.
  const byline = (x0, x1, inkTop, ruleBottom) => ({
    kind: 'sidebar', box: [x0, inkTop, x1, ruleBottom], lines: ['वृत्तसंस्था'], lineFamily: 'sans', linePx: 5.9, lineAlign: 'center',
    lineHeight: 1.3, insetPx: 0, standOffPx: 0.5, rules: ['bottom'], ruleWidthPx: 0.5,
  });
  // ONE FIGURE OR WORD OF A TABLE, set where the scan puts it: a panel with no
  // rule and no ground, so the rules and the band under it show.
  const cell = (box, family, px, { bold = false, align = 'left', ink, lineHeight = 1.5, knockout } = {}) => ({
    kind: 'ornament',
    // Never shorter than its own line, or the line is not set at all.
    // Started a little above the ink, so a vowel sign above the head stroke is
    // inside the panel's own box rather than clipped by it.
    box: [box[0], box[1] - 3, box[2], Math.max(box[3], box[1] - 3 + Math.ceil((px * lineHeight + 1.2) / sy))],
    rules: [], lines: [PLACEHOLDER], lineFamily: family, linePx: px, lineBold: bold,
    lineAlign: align, lineHeight, insetPx: 0, standOffPx: 0.5, ...(ink ? { lineInk: ink } : {}), ...(knockout ? { knockout } : {}),
  });
  // A HAIRLINE ACROSS A TABLE, or - given a weight - a solid band.
  const rule = (box, weightPx = 0.5, extra = {}) => ({ kind: 'ornament', box, rules: ['top'], ruleWidthPx: weightPx, standOffPx: 0.5, ...extra });

  // Heads read off a scan by their INK top; a condensed head's line box starts
  // a hair above it.
  const INK = 3;
  // A STORY INSIDE A STORY: a condensed head over lines of ragged copy.
  const inset = (box, n, extra = {}) => ({
    kind: 'sidebar', box, title: PLACEHOLDER, lines: lines(n), titleFamily: 'noto-condensed', titlePx: 9.1,
    titleLineHeight: 1.25, titleGapPx: 3, lineFamily: 'sans', linePx: 5.75, lineHeight: 1.24, insetPx: 0, standOffPx: 0.5, ...extra,
  });
  return { BODY, HEAD, lines, subhead, byline, cell, rule, INK, inset, PLACEHOLDER };
}

module.exports = { kit };
