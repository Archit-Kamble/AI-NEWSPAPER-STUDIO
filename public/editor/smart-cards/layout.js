// Deterministic newspaper geometry for a Smart Card.
//
// A Smart Card is a STRUCTURED, FINITE layout - a fixed 9x9 grid, twelve
// signs, a fixed table of rows, one quote. It is never poured through the
// character-grid or the exact compose engine built for continuous prose
// (public/editor/compose/) - that engine exists to answer "where does this
// UNKNOWN-length copy wrap", which is a materially harder problem than "does
// this FIXED, short content fit in this box, and at what size."
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
// nobody can read it, and not a `null` that makes the card vanish.

const MIN_CARD_FONT_PX = 5.5;
const CANDIDATE_FONT_PX = [9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX];
const MIN_SUDOKU_CELL_PX = 10;

function clampFrame(frame) {
  const width = Math.max(0, Number(frame?.width) || 0);
  const height = Math.max(0, Number(frame?.height) || 0);
  const padding = Math.max(0, Number(frame?.padding ?? 8) || 0);
  return { width, height, padding, innerWidth: Math.max(0, width - padding * 2), innerHeight: Math.max(0, height - padding * 2) };
}

const empty = (key) => ({ key, fitState: 'EMPTY', fontPx: 0, geometry: null, violations: [] });

/**
 * A very short character-width heuristic - deliberately approximate, unlike
 * compose.js's exact engine. That engine's character-budget CONTRACT depends
 * on real font metrics because prose is unbounded and a wrong estimate loses
 * or overflows a sentence; a Smart Card's content is short, curated,
 * structured text (a proverb, a sign's reading, one line of history) where
 * "does this roughly fit, or does it clearly not" is the bar a newspaper's
 * own daily features have always been set to. Generous rather than tight -
 * the safe direction for a fit decision that gates OVERSET.
 */
const CHAR_WIDTH_EM = 0.62;
function estimatedLines(text, fontPx, availableWidthPx) {
  const clean = String(text || '').trim();
  if (!clean) return 0;
  const charsPerLine = Math.max(1, Math.floor(availableWidthPx / (fontPx * CHAR_WIDTH_EM)));
  return Math.max(1, Math.ceil(clean.length / charsPerLine));
}

/** Bounded try-largest-first solver shared by rashi/panchang/suvichar/
 * dinvishesh: `neededHeight(fontPx)` is asked for each candidate, largest
 * first: the first one that fits within `availableHeight` wins. Never
 * unbounded - CANDIDATE_FONT_PX is a fixed, short list. */
function solveFont(availableHeight, neededHeight) {
  let fontPx = CANDIDATE_FONT_PX[CANDIDATE_FONT_PX.length - 1];
  let fitState = 'OVERSET';
  for (const candidate of CANDIDATE_FONT_PX) {
    if (neededHeight(candidate) <= availableHeight) {
      fontPx = candidate;
      fitState = 'FITS';
      break;
    }
  }
  return { fontPx, fitState };
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

function layoutRashi(data, frame) {
  const signs = Array.isArray(data?.signs) ? data.signs.filter(Boolean) : [];
  if (!signs.length) return empty('rashi');

  // Narrow frame: one column of all twelve. Wide enough for a name and a
  // line of reading side by side without wrapping to single words: two
  // columns of six, halving how tall the card needs to be.
  const WIDE_COLUMN_PX = 90;
  const columns = frame.innerWidth >= WIDE_COLUMN_PX * 2 ? 2 : 1;
  const rows = Math.ceil(signs.length / columns);
  const rowHeight = rows > 0 ? frame.innerHeight / rows : 0;
  const columnWidth = frame.innerWidth / columns;

  // Three lines per sign - name, reading, lucky metadata - as a fixed
  // allocation rather than measuring each sign's own reading text: the row
  // grid is uniform (every sign gets the same rowHeight), so the height
  // budget has to be too.
  const LINES_PER_SIGN = 3;
  const LINE_HEIGHT_RATIO = 1.28;
  const { fontPx, fitState } = solveFont(rowHeight, (candidate) => candidate * LINE_HEIGHT_RATIO * LINES_PER_SIGN);

  return {
    key: 'rashi',
    fitState,
    fontPx,
    geometry: { columns, rows, rowHeight, columnWidth },
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ---------------------------------------------------------------- panchang ---

function layoutPanchang(data, frame) {
  const items = Array.isArray(data?.items) ? data.items.filter((item) => item && item.label) : [];
  if (!items.length) return empty('panchang');

  const rows = items.length;
  const rowHeight = frame.innerHeight / rows;
  const LINE_HEIGHT_RATIO = 1.3;
  const { fontPx, fitState } = solveFont(rowHeight, (candidate) => candidate * LINE_HEIGHT_RATIO);

  return {
    key: 'panchang',
    fitState,
    fontPx,
    geometry: { rows, rowHeight },
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ---------------------------------------------------------------- suvichar ---

function layoutSuvichar(data, frame) {
  if (!data?.text) return empty('suvichar');

  const LINE_HEIGHT_RATIO = 1.4;
  const { fontPx, fitState } = solveFont(frame.innerHeight, (candidate) => {
    const quoteLines = estimatedLines(data.text, candidate, frame.innerWidth);
    const attributionLines = data.attribution ? 1 : 0;
    return (quoteLines + attributionLines) * candidate * LINE_HEIGHT_RATIO;
  });

  return {
    key: 'suvichar',
    fitState,
    fontPx,
    geometry: {},
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// -------------------------------------------------------------- dinvishesh ---

function layoutDinvishesh(data, frame) {
  const entries = Array.isArray(data?.entries) ? data.entries.filter(Boolean) : [];
  if (!entries.length) return empty('dinvishesh');

  const LINE_HEIGHT_RATIO = 1.3;
  const { fontPx, fitState } = solveFont(frame.innerHeight, (candidate) => {
    const totalLines = entries.reduce((sum, entry) => {
      const text = typeof entry === 'string' ? entry : (entry.text || '');
      return sum + estimatedLines(text, candidate, frame.innerWidth);
    }, 0);
    return totalLines * candidate * LINE_HEIGHT_RATIO;
  });

  return {
    key: 'dinvishesh',
    fitState,
    fontPx,
    geometry: {},
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
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
 */
export function layoutSmartCard(key, data, frame) {
  const fn = LAYOUTS[String(key || '')];
  if (!fn) return empty(String(key || ''));
  return fn(data, clampFrame(frame));
}

export const SMART_CARD_LAYOUT_KEYS = Object.keys(LAYOUTS);
