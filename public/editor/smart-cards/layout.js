// Deterministic newspaper geometry for a Smart Card.
//
// A Smart Card is a STRUCTURED, FINITE layout - a fixed 9x9 grid, twelve
// signs, a fixed table of rows, one quote. It is never poured through the
// character-grid or the exact compose engine built for continuous prose
// (public/editor/compose/) - that engine exists to answer "where does this
// UNKNOWN-length copy wrap", which is a materially harder problem than "does
// this FIXED, short content fit in this box, and at what size."
//
// It DOES, however, share that engine's measurement authority. This module
// used to answer "does it fit" from `text.length * 0.62em` - a constant that
// cannot see a matra costing no width, and so reported FITS for a rashi sign
// whose real reading text ran to twenty repeated sentences. Two real,
// reproduced false-fit bugs (a rashi row that could never hold what it
// claimed to, a panchang value column measured by font height alone, never
// by its own width) came from exactly that gap. So the wrap decision below
// reads the SAME real shaped advances compose.js does (shaper.js's HarfBuzz
// shaping when it has loaded, font-metrics.js's own hmtx advances as the
// same-shape fallback for the moment before it has) rather than a second,
// approximate width model.
//
// Pure: no DOM, no fetch, no editor state - a plain {key, data, frame} in,
// one deterministic geometry object out, exactly like public/editor/compose/
// and public/editor/layout/image-geometry.js. Same input always gives the
// same output, in Node (preflight) and in the browser (the page canvas, the
// Block Editor, the AI proposal preview) - the same rule that keeps the
// composition engine from ever showing the desk two different pages.
//
// Every solver here clamps to a documented MINIMUM legible size rather than
// silently shrinking past it - `fitState: 'OVERSET'` is the honest answer to
// "this card does not fit its block", not a smaller and smaller font until
// nobody can read it, and not a `null` that makes the card vanish. And the
// layout carries the exact lines it resolved - `readingLines`, `labelLines`,
// `valueLines`, `quoteLines`, the dinvishesh `lines` - so the renderer paints
// what was measured rather than asking the browser to wrap the text a
// second time, possibly onto a different set of lines.

import { measureWidth as hmtxWidth, minLineHeightFor } from '../compose/font-metrics.js';
import { shapeWidthPx, isShaperReady } from '../compose/shaper.js';
import { breakPieces, trimEndClusters } from '../compose/graphemes.js';

// Devanagari numerals - how this paper prints a number. Duplicated from
// smart-cards.js's own DIGITS/devanagari() (not imported - smart-cards.js
// imports THIS module, and layout.js has to pre-resolve final display text,
// digits included, for the renderer to print verbatim without ever
// reprocessing a line this module already measured and wrapped).
const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
function devanagariDigits(value) {
  return String(value ?? '').replace(/\d/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
}

const MIN_CARD_FONT_PX = 5.5;
// solveFont() below already does the right thing - try the LARGEST candidate
// first, fall back only when it genuinely does not fit - so raising this
// ladder's ceiling can only ever help a card that has room to spare; a dense
// card (rashi's twelve signs, a five-row panchang) simply fails every large
// candidate exactly as before and falls through to the same small sizes this
// ladder always had. But the ceiling itself used to stop at 9px for every
// card type alike, tuned against rashi's worst case and never revisited for
// the others - so a short card in a large frame (a one-line suvichar quote,
// a two-entry dinvishesh) had no candidate above 9px to grow into and left
// most of its own block blank. Confirmed live: a real suvichar card (one
// short quote + attribution) solved at 9px in a frame with room for far
// more, using under half the block's height.
const CANDIDATE_FONT_PX = [32, 28, 24, 20, 18, 16, 14, 12, 11, 10, 9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX];
const MIN_SUDOKU_CELL_PX = 10;

// One comfortable-reading multiplier over the face's own clip-free minimum
// (minLineHeightFor - ascent + descent, so a Marathi vowel sign is never
// cropped), defined once and used everywhere in this module - never a
// second, looser constant per card type the way LINE_HEIGHT_RATIO used to be
// (1.28 for rashi, 1.3 for panchang, 1.4 for suvichar - three numbers, none
// of them checked against the font they were sizing).
const LEADING_MULTIPLIER = 1.08;
const GAP_PX = 6;

function clampFrame(frame) {
  const width = Math.max(0, Number(frame?.width) || 0);
  const height = Math.max(0, Number(frame?.height) || 0);
  const padding = Math.max(0, Number(frame?.padding ?? 8) || 0);
  return { width, height, padding, innerWidth: Math.max(0, width - padding * 2), innerHeight: Math.max(0, height - padding * 2) };
}

const empty = (key) => ({ key, fitState: 'EMPTY', fontPx: 0, geometry: null, violations: [] });

// ------------------------------------------------------------- measurement ---

/**
 * Real HarfBuzz shaping when it has loaded; the font's own hmtx advances as a
 * same-shape, slightly-wide fallback for the moment before it has - the exact
 * pattern compose.js's own `measure()` already uses, so a Smart Card and an
 * ordinary article agree about what a Marathi run costs.
 */
function measure(text, fontPx, family, weight) {
  const base = isShaperReady() ? shapeWidthPx(text, fontPx, family, weight) : null;
  return base !== null ? base : hmtxWidth(text, fontPx, family, weight);
}

function lineHeightFor(fontPx, family = 'serif', weight = 400) {
  return minLineHeightFor(family, weight) * LEADING_MULTIPLIER * fontPx;
}

/**
 * Wraps `text` into the lines it will actually print at `fontPx`, breaking
 * only where graphemes.js's breakPieces() says a line may legally end -
 * never inside an akshara, never with an invented hyphen. Filled greedily,
 * trimmed at a cluster boundary, and - if a single legal piece is wider than
 * the whole available width - `hardOverset: true` rather than a silent clip.
 */
export function wrapSmartText(text, { width, fontPx, family = 'serif', weight = 400 }) {
  const clean = String(text || '').trim();
  if (!clean) return { lines: [], hardOverset: false };

  const pieces = breakPieces(clean);
  const lines = [];
  let current = '';
  let currentWidth = 0;
  let hardOverset = false;

  const flush = () => {
    const trimmed = trimEndClusters(current);
    if (trimmed) lines.push({ text: trimmed, width: measure(trimmed, fontPx, family, weight) });
    current = '';
    currentWidth = 0;
  };

  for (const piece of pieces) {
    const pieceWidth = measure(piece, fontPx, family, weight);
    if (current && currentWidth + pieceWidth > width) flush();
    if (!current && pieceWidth > width) hardOverset = true;
    current += piece;
    currentWidth += pieceWidth;
  }
  flush();

  return { lines, hardOverset };
}

/** One un-broken run, measured as a single atomic unit - for short labelled
 * metadata (a sign's name, a panchang label, a rashi lucky line) that is
 * meant to sit on one line by editorial design, not prose to be poured. A
 * piece too wide for its column is a real violation, reported the same way
 * an overlong prose token is, never silently wrapped mid-word. */
function measureAtomic(text, fontPx, family, weight, width) {
  const clean = String(text || '');
  if (!clean) return { line: '', width: 0, hardOverset: false };
  const w = measure(clean, fontPx, family, weight);
  return { line: clean, width: w, hardOverset: w > width };
}

/**
 * Bounded try-largest-first solver shared by every card type:
 * `neededHeight(candidate)` is asked for each candidate font size, largest
 * first, and must return `{height, hardOverset, ...resolved content}`. The
 * first candidate whose height fits (and did not hard-overset) wins; if none
 * does, the smallest legible candidate is still returned - drawn at the
 * floor, flagged OVERSET, never shrunk further to hide it.
 */
function solveFont(availableHeight, neededHeight) {
  let last = null;
  for (const candidate of CANDIDATE_FONT_PX) {
    const need = neededHeight(candidate);
    last = { ...need, fontPx: candidate };
    if (need.height <= availableHeight && !need.hardOverset) {
      return { ...last, fitState: 'FITS' };
    }
  }
  return { ...last, fitState: 'OVERSET' };
}

// ---------------------------------------------------------------- subtitle ---

const SUBTITLE_WEIGHT = 400;

/**
 * The subtitle's own resolved lines and height, solved ONCE before the card
 * body - a card used to report FITS and then gain extra, unaccounted-for
 * subtitle height on top of that answer. Bounded to the same candidate list
 * as everything else in this module.
 */
// A SUBTITLE MAY NOT EAT ITS OWN CARD.
//
// This chose the largest candidate size whose lines fitted the card's WIDTH
// and never looked at its height, so a short subtitle took whatever the
// biggest candidate was. Measured on the first card that ever carried one:
// "जिल्हानिहाय पाऊस" solved at 32 px on a 188x200 card and took 113 px of it -
// 57%, three times the size of the chart underneath, reading as a headline
// rather than as the line under one.
//
// It had never run on real data. No stored card of any kind carries a subtitle
// (checked across the table), so this rule has been latent since it was
// written and the first card to use it is the one that found it.
const MAX_SUBTITLE_SHARE = 0.28;

function solveSubtitle(text, frame) {
  const clean = String(text || '').trim();
  if (!clean) return { fontPx: 0, lineHeightPx: 0, lines: [], height: 0, hardOverset: false };

  const ceiling = Math.max(0, frame.innerHeight) * MAX_SUBTITLE_SHARE;
  let chosen = null;
  let widest = null;
  for (const fontPx of CANDIDATE_FONT_PX) {
    const wrapped = wrapSmartText(clean, { width: frame.innerWidth, fontPx, family: 'serif', weight: SUBTITLE_WEIGHT });
    const lineHeightPx = lineHeightFor(fontPx, 'serif', SUBTITLE_WEIGHT);
    const candidate = {
      fontPx, lineHeightPx, lines: wrapped.lines.map((l) => l.text),
      height: wrapped.lines.length * lineHeightPx + GAP_PX, hardOverset: wrapped.hardOverset,
    };
    if (wrapped.hardOverset) { chosen = candidate; continue; }
    // The first size that fits the width AND leaves the card most of itself.
    if (candidate.height <= ceiling || !ceiling) return candidate;
    // Remembered in case every size is over the share - a very tall subtitle
    // on a very short card - so the smallest that at least fits the width is
    // still what gets returned rather than nothing.
    widest = candidate;
    chosen = candidate;
  }
  return widest || chosen;
}

// ----------------------------------------------------------------- sudoku ---

function isGrid(grid) {
  return Array.isArray(grid) && grid.length === 9 && grid.every((row) => Array.isArray(row) && row.length === 9);
}

function layoutSudoku(data, frame) {
  const grid = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : null;
  if (!grid) return empty('sudoku');

  const cellRaw = Math.floor(Math.min(frame.innerWidth / 9, frame.innerHeight / 9));
  // Clamped UP to the minimum, never shrunk past it - a sudoku smaller than
  // this is not a puzzle a reader can solve, so it is drawn at the floor and
  // flagged OVERSET rather than made unreadable to avoid the flag.
  const cell = Math.max(MIN_SUDOKU_CELL_PX, cellRaw);
  const fitState = cellRaw < MIN_SUDOKU_CELL_PX ? 'OVERSET' : 'FITS';
  const gridSize = cell * 9;
  const top = Math.max(0, (frame.innerHeight - gridSize) / 2);

  return {
    key: 'sudoku',
    fitState,
    fontPx: Math.max(1, cell * 0.62),
    geometry: { cell, gridSize, top },
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------- rashi ---

const RASHI_NAME_WEIGHT = 700;
const MIN_NAME_WIDTH_PX_EM = 2;

function rashiItemHeight(sign, { readingWidth, fontPx, lineHeightPx }) {
  const reading = wrapSmartText(sign.text, { width: readingWidth, fontPx, family: 'serif', weight: 400 });
  const luckText = [
    sign.luckyNumber != null ? `शुभ अंक ${devanagariDigits(sign.luckyNumber)}` : '',
    sign.luckyColour ? `शुभ रंग ${sign.luckyColour}` : '',
  ].filter(Boolean).join(' · ');
  const luck = luckText ? measureAtomic(luckText, fontPx, 'serif', 400, readingWidth) : null;

  const readingLines = reading.lines.map((l) => l.text);
  const luckLines = luck ? [luck.line] : [];
  const lines = Math.max(1, readingLines.length + luckLines.length);
  const hardOverset = reading.hardOverset || Boolean(luck?.hardOverset);

  return { readingLines, luckLines, height: lines * lineHeightPx, hardOverset };
}

function layoutRashi(data, frame) {
  const signs = Array.isArray(data?.signs) ? data.signs.filter(Boolean) : [];
  if (!signs.length) return empty('rashi');

  // Narrow frame: one column of all twelve. Wide enough for a name and a
  // line of reading side by side without wrapping to single words: two
  // columns of six, halving how tall the card needs to be.
  const WIDE_COLUMN_PX = 90;
  const columns = frame.innerWidth >= WIDE_COLUMN_PX * 2 ? 2 : 1;
  const rows = Math.ceil(signs.length / columns);
  const columnWidth = columns > 0 ? frame.innerWidth / columns : frame.innerWidth;

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    // The name column is only as wide as the widest sign name actually
    // needs, at THIS candidate size - not a guessed fraction of the card.
    const maxNameWidth = signs.reduce((max, sign) => Math.max(max, measure(sign.name || '', fontPx, 'serif', RASHI_NAME_WEIGHT)), 0);
    const nameWidth = Math.min(columnWidth * 0.35, Math.max(fontPx * MIN_NAME_WIDTH_PX_EM, maxNameWidth + GAP_PX));
    const readingWidth = Math.max(0, columnWidth - nameWidth - GAP_PX);

    const items = signs.map((sign) => ({ ...rashiItemHeight(sign, { readingWidth, fontPx, lineHeightPx }), key: sign.key, name: sign.name || '' }));
    const hardOverset = items.some((item) => item.hardOverset);

    const rowHeights = [];
    for (let r = 0; r < rows; r += 1) {
      const left = items[r];
      const right = columns === 2 ? items[r + rows] : null;
      rowHeights.push(Math.max(left?.height || 0, right?.height || 0));
    }
    const height = rowHeights.reduce((sum, h) => sum + h, 0);

    return { height, hardOverset, items, rowHeights, nameWidth, lineHeightPx };
  });

  return {
    key: 'rashi',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: { columns, rows, rowHeights: solved.rowHeights, columnWidth, nameWidth: solved.nameWidth, lineHeightPx: solved.lineHeightPx },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ---------------------------------------------------------------- panchang ---

const PANCHANG_LABEL_WEIGHT = 700;

function layoutPanchang(data, frame) {
  const rows = Array.isArray(data?.items) ? data.items.filter((item) => item && item.label) : [];
  if (!rows.length) return empty('panchang');

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const maxLabelWidth = rows.reduce((max, item) => Math.max(max, measure(item.label, fontPx, 'serif', PANCHANG_LABEL_WEIGHT)), 0);
    const labelWidth = Math.min(frame.innerWidth * 0.4, maxLabelWidth + GAP_PX);
    const valueWidth = Math.max(0, frame.innerWidth - labelWidth - GAP_PX);

    let hardOverset = false;
    const items = rows.map((item) => {
      const label = measureAtomic(item.label, fontPx, 'serif', PANCHANG_LABEL_WEIGHT, labelWidth);
      const value = wrapSmartText(item.text ?? '', { width: valueWidth, fontPx, family: 'serif', weight: 400 });
      if (label.hardOverset || value.hardOverset) hardOverset = true;
      const valueLines = value.lines.map((l) => l.text);
      const lineCount = Math.max(1, valueLines.length);
      return { label: item.label, labelLines: [label.line], valueLines, rowHeight: lineCount * lineHeightPx };
    });

    const height = items.reduce((sum, item) => sum + item.rowHeight, 0);
    return { height, hardOverset, items, labelWidth, valueWidth, lineHeightPx };
  });

  return {
    key: 'panchang',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: { rows: rows.length, labelWidth: solved.labelWidth, valueWidth: solved.valueWidth, lineHeightPx: solved.lineHeightPx },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------- chart ---
//
// A newspaper's information graphic, solved the same way every other card is.
//
// TWO KINDS, AND THE REASON THERE ARE ONLY TWO. A bar and a stat row are made
// of RECTANGLES and type, and a rectangle is something all four export writers
// already draw. A pie needs bezier arcs and a line chart needs a polyline, and
// the print model has neither primitive - its four item kinds are fill, text,
// image and rule, and rules are axis-aligned. Adding arcs to the PDF, the
// IDML, the .sla and Word is four separate pieces of geometry work, and a
// chart that drew on screen and vanished from the plate would be worse than
// no chart. So these two are exact everywhere, and the other two are honestly
// absent rather than half-present.
//
// The bars run ACROSS, not up. A Marathi category label is long ("छत्रपती
// संभाजीनगर"), and a vertical bar chart has to set those labels sideways or
// abbreviate them; a horizontal bar reads them on their own baseline at the
// body size.

const CHART_BAR_GAP_PX = 2;
const CHART_VALUE_GAP_PX = 4;

function chartRows(data) {
  return Array.isArray(data?.items)
    ? data.items.filter((item) => item && item.label != null && Number.isFinite(Number(item.value)))
    : [];
}

function layoutChart(data, frame) {
  const rows = chartRows(data);
  if (!rows.length) return empty('chart');
  const kind = data?.chartType === 'stat' ? 'stat' : 'bar';
  const unit = String(data?.unit || '');
  const source = String(data?.source || '');
  const peak = rows.reduce((max, item) => Math.max(max, Math.abs(Number(item.value))), 0) || 1;
  const valueText = (item) => `${devanagariDigits(item.value)}${unit ? ` ${unit}` : ''}`;

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'sans', 400);
    const sourceHeight = source ? lineHeightPx : 0;

    if (kind === 'stat') {
      // Every figure gets a column of its own, as wide as the card divides
      // into. The number is set large over its caption, which is the shape a
      // newspaper sets a run of statistics in.
      const columns = Math.max(1, Math.min(rows.length, Math.floor(frame.innerWidth / (fontPx * 6)) || 1));
      const columnWidth = frame.innerWidth / columns;
      const figurePx = fontPx * 2.2;
      const figureLine = lineHeightFor(figurePx, 'sans', 700);
      let hardOverset = false;
      const items = rows.map((item) => {
        const caption = wrapSmartText(String(item.label), { width: columnWidth - GAP_PX, fontPx, family: 'sans', weight: 400 });
        if (caption.hardOverset) hardOverset = true;
        return {
          label: String(item.label),
          value: Number(item.value),
          valueText: valueText(item),
          captionLines: caption.lines.map((l) => l.text),
          rowHeight: figureLine + Math.max(1, caption.lines.length) * lineHeightPx,
        };
      });
      const bands = Math.ceil(items.length / columns);
      const bandHeight = items.reduce((max, item) => Math.max(max, item.rowHeight), 0);
      return {
        height: bands * bandHeight + sourceHeight, hardOverset, items, kind,
        columns, columnWidth, figurePx, figureLine, bandHeight, lineHeightPx, sourceHeight, source, peak,
      };
    }

    const labelCap = frame.innerWidth * 0.42;
    const widest = rows.reduce((max, item) => Math.max(max, measure(String(item.label), fontPx, 'sans', 400)), 0);
    const labelWidth = Math.min(labelCap, widest + GAP_PX);
    const valueWidth = rows.reduce((max, item) => Math.max(max, measure(valueText(item), fontPx, 'sans', 700)), 0);
    const trackWidth = Math.max(0, frame.innerWidth - labelWidth - valueWidth - CHART_VALUE_GAP_PX);
    let hardOverset = trackWidth <= fontPx;
    const rowHeight = lineHeightPx + CHART_BAR_GAP_PX;
    const items = rows.map((item) => {
      const label = measureAtomic(String(item.label), fontPx, 'sans', 400, labelWidth);
      if (label.hardOverset) hardOverset = true;
      return {
        label: label.line,
        value: Number(item.value),
        valueText: valueText(item),
        barWidth: Math.max(1, (Math.abs(Number(item.value)) / peak) * trackWidth),
        rowHeight,
      };
    });
    return {
      height: items.length * rowHeight + sourceHeight, hardOverset, items, kind,
      labelWidth, trackWidth, valueWidth, rowHeight, lineHeightPx, sourceHeight, source, peak,
    };
  });

  return {
    key: 'chart',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      chartType: solved.kind, rows: rows.length, peak: solved.peak,
      labelWidth: solved.labelWidth || 0, trackWidth: solved.trackWidth || 0,
      valueWidth: solved.valueWidth || 0, rowHeight: solved.rowHeight || 0,
      columns: solved.columns || 0, columnWidth: solved.columnWidth || 0,
      figurePx: solved.figurePx || 0, figureLine: solved.figureLine || 0,
      bandHeight: solved.bandHeight || 0,
      lineHeightPx: solved.lineHeightPx, sourceHeight: solved.sourceHeight || 0,
      source: solved.source || '',
    },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ---------------------------------------------------------------- suvichar ---

function layoutSuvichar(data, frame) {
  if (!data?.text) return empty('suvichar');

  const RULE_RESERVE_PX = 10;
  const ATTRIBUTION_RATIO = 0.85;

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const quote = wrapSmartText(data.text, { width: frame.innerWidth, fontPx, family: 'serif', weight: 400 });
    const quoteLines = quote.lines.map((l) => l.text);
    let hardOverset = quote.hardOverset;

    let attributionLines = [];
    let attributionFontPx = 0;
    let attributionLineHeightPx = 0;
    let attributionHeight = 0;
    if (data.attribution) {
      attributionFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * ATTRIBUTION_RATIO);
      attributionLineHeightPx = lineHeightFor(attributionFontPx, 'serif', 400);
      const attribution = wrapSmartText(data.attribution, { width: frame.innerWidth, fontPx: attributionFontPx, family: 'serif', weight: 400 });
      attributionLines = attribution.lines.map((l) => l.text);
      hardOverset = hardOverset || attribution.hardOverset;
      attributionHeight = attributionLines.length * attributionLineHeightPx + GAP_PX;
    }

    const height = RULE_RESERVE_PX + quoteLines.length * lineHeightPx + attributionHeight;
    return { height, hardOverset, quoteLines, attributionLines, lineHeightPx, attributionFontPx, attributionLineHeightPx, ruleReservePx: RULE_RESERVE_PX };
  });

  return {
    key: 'suvichar',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: { lineHeightPx: solved.lineHeightPx, attributionFontPx: solved.attributionFontPx, attributionLineHeightPx: solved.attributionLineHeightPx, ruleReservePx: solved.ruleReservePx },
    quoteLines: solved.quoteLines,
    attributionLines: solved.attributionLines,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// -------------------------------------------------------------- dinvishesh ---

function layoutDinvishesh(data, frame) {
  const entries = Array.isArray(data?.entries) ? data.entries.filter(Boolean) : [];
  if (!entries.length) return empty('dinvishesh');

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    let hardOverset = false;
    const items = entries.map((entry) => {
      const text = typeof entry === 'string' ? entry : (entry.text || '');
      const wrapped = wrapSmartText(text, { width: frame.innerWidth, fontPx, family: 'serif', weight: 400 });
      if (wrapped.hardOverset) hardOverset = true;
      const lines = wrapped.lines.map((l) => l.text);
      return { lines, height: Math.max(1, lines.length) * lineHeightPx };
    });
    const height = items.reduce((sum, item) => sum + item.height, 0);
    return { height, hardOverset, items, lineHeightPx };
  });

  return {
    key: 'dinvishesh',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: { rows: entries.length, lineHeightPx: solved.lineHeightPx },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------ router ---

const LAYOUTS = {
  sudoku: layoutSudoku,
  'sudoku-solution': layoutSudoku,
  rashi: layoutRashi,
  panchang: layoutPanchang,
  suvichar: layoutSuvichar,
  dinvishesh: layoutDinvishesh,
  chart: layoutChart,
};

/**
 * The one geometry answer for a Smart Card - what smartCardMarkup() draws
 * from, and what preflight checks for SMART_CARD_OVERSET without rendering
 * anything.
 *
 * `frame` is the OUTER logical block dimensions (newspaper pixels, never
 * screen/editor-zoomed pixels - the Editor scales the whole rendered card as
 * one object afterward, exactly like it already does for headline/body,
 * rather than asking this solver for a different font at a different size).
 *
 * The subtitle is solved FIRST, against the frame's own width, and its real
 * height is deducted before the card body is solved - a card used to report
 * FITS and then gain extra, unmeasured subtitle height on top of that
 * answer once smartCardMarkup() drew it.
 */
export function layoutSmartCard(key, data, frame) {
  const fn = LAYOUTS[String(key || '')];
  if (!fn) return empty(String(key || ''));

  const clamped = clampFrame(frame);
  const subtitle = solveSubtitle(data?.subtitle, clamped);
  const bodyFrame = { ...clamped, innerHeight: Math.max(0, clamped.innerHeight - subtitle.height) };

  const result = fn(data, bodyFrame);
  if (result.fitState === 'EMPTY') return result;

  const fitState = subtitle.hardOverset || result.fitState === 'OVERSET' ? 'OVERSET' : 'FITS';
  return {
    ...result,
    subtitle,
    fitState,
    exactShaping: isShaperReady(),
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

export const SMART_CARD_LAYOUT_KEYS = Object.keys(LAYOUTS);

/**
 * The frame a Smart Card has to solve against, taken directly from an EXACT
 * composition (public/editor/compose/, composeSection() with an empty body
 * and no images - the display bands still reserve their own real room, the
 * card just takes over where the body would otherwise start).
 *
 * This replaces a second, approximate estimate (text-flow.js's buildFlowMap(),
 * asked only for its kicker/headline/subheading row count) that could - and
 * did - disagree with the exact composition every other measurement in this
 * project already uses: a headline that auto-fit to a smaller size changed
 * its real line count, but the row-count estimate did not track that, so the
 * card above/below it was solving against a frame that was already wrong.
 *
 * `padding` defaults to 0 deliberately - `composition.content` has ALREADY
 * had the block's own edge padding (marginPx) subtracted on every side, and
 * `bodyTop` already accounts for whatever kicker/headline/deck came before,
 * so there is nothing left for this solver to reserve a second time. A
 * caller that passes a non-zero padding here is asking for real DOM padding
 * the card's own wrapper actually applies - the rule the whole redesign
 * exists to hold: solver padding equals rendered padding, exactly, never a
 * hidden second number.
 */
export function smartCardFrameFromComposition(composition, { padding = 0 } = {}) {
  const left = Number(composition?.content?.left) || 0;
  const right = Number(composition?.content?.right) || 0;
  const bottom = Number(composition?.content?.bottom) || 0;
  const top = Number(composition?.bodyTop ?? composition?.content?.top) || 0;
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    padding,
  };
}
