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
// The paper's own inks. A chart may be printed in any of them - see chartInk().
import { INKS, sanitiseInk } from '../layout/inks.js';
// The paper's running body size, read from the one catalogue that owns it
// rather than restated here. publication-type.js is a dual CJS/global script
// (its CJS branch is guarded on `typeof module`), so importing it for its
// side effect installs `SahasPublicationType` in both Node and the browser.
import '../layout/publication-type.js';

const RUNNING_BODY_PX = (globalThis.SahasPublicationType
  && globalThis.SahasPublicationType.DEFAULT_BODY_FONT_PX) || 6.4;

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
// 12.7 pt - comfortably above the paper's 9 pt body, which is the point of a
// standing ornament. Below it a one-line सुविचार is not worth the line.
const STRIP_MIN_FONT_PX = 9;
// A month of closes drawn deeper than this against its own span stops
// describing the month and starts dramatising it.
const MAX_TREND_PLOT_OF_WIDTH = 0.72;
// A band gap may open to this multiple of the card's standard gap and no
// further. Past it the bands stop reading as one panel.
const MAX_BAND_GAP_GROWTH = 4;

// One comfortable-reading multiplier over the face's own clip-free minimum
// (minLineHeightFor - ascent + descent, so a Marathi vowel sign is never
// cropped), defined once and used everywhere in this module - never a
// second, looser constant per card type the way LINE_HEIGHT_RATIO used to be
// (1.28 for rashi, 1.3 for panchang, 1.4 for suvichar - three numbers, none
// of them checked against the font they were sizing).
const LEADING_MULTIPLIER = 1.08;
const GAP_PX = 6;

// Registered artwork for the four standing newspaper cards. The files are
// deliberately part of the card renderer rather than ordinary section images:
// they belong to the card's finite geometry, travel with it to every edition,
// and are emitted by the same export walk as the card's type.
// EVERY CARD IS RULED, AND THE PAPER HAS TWO INKS FOR IT.
//
// The accent for a standing feature of the paper; black for a commercial block,
// because an advertisement and a प्रकटपत्र are not the paper speaking. पंचांग
// and राशिभविष्य carry the DOUBLE band - heavy outside, hairline inside - which
// is what distinguishes an almanac from an ordinary ruled box in a printed
// daily.
//
// It lives here, in the module both sides import, rather than in the export
// walk: a rule is ink at the frame's own edge, and the SOLVER has to know about
// it because type may not be set under it (see CARD_RULE_CLEARANCE_PX).
// `weightPx` is the rule's own weight, the SAME on all four sides. A display
// advertisement and a प्रकटपत्र are ruled a shade heavier than the paper's own
// standing boxes, which with the black ink is how a reader tells a commercial
// block from editorial at a glance.
export const CARD_BORDERS = Object.freeze({
  suvichar: { ink: '#8a1428', double: false, weightPx: 0.6 },
  dinvishesh: { ink: '#8a1428', double: false, weightPx: 0.6 },
  panchang: { ink: '#8a1428', double: true, weightPx: 0.6 },
  rashi: { ink: '#8a1428', double: true, weightPx: 0.6 },
  havaman: { ink: '#8a1428', double: false, weightPx: 0.6 },
  market: { ink: '#8a1428', double: false, weightPx: 0.6 },
  sudoku: { ink: '#8a1428', double: false, weightPx: 0.6 },
  advert: { ink: '#202024', double: false, weightPx: 1.2 },
  tender: { ink: '#202024', double: false, weightPx: 0.8 },
});

// A ruled box sets its type INSIDE its own rule. Without this the market
// panel's chart caption and its y-axis figures began at x=0 of the content box
// and the card's own hairline was drawn straight through them - photographed on
// the page in print view. It is the same argument BOX_INSET_PX makes for an
// ordinary ruled block, at the smaller scale a card works in.
// A single hairline is 0.6px of ink; the almanac's double band is about 2.8.
// The clearance is that ink plus a hair of air - not a flat number, because on
// a 148px almanac a generous inset costs the value column a whole size step.
const CARD_RULE_INK_PX = 0.6;
// The almanac's band: a hairline, a hair of paper, and the heavy rule outside
// it. Its ink reaches 2.8px in from the frame's edge whatever the outer rule
// weighs, so the clearance is measured from there.
const DOUBLE_RULE_INK_PX = 2.8;
// A hair over half a millimetre of air between the card's own rule and the
// first thing set inside it. Measured on the page in print view: with the
// clearance taken off the CONTENT box and the rule then drawn round that same
// rectangle, the air bought nothing at all - the market panel's every band sat
// at l2 t2 r2 of a ring drawn at 2,2, the sudoku's grid ran to within 1px of
// it top and bottom, and राशिभविष्य's sign artwork stood 0.2px off the
// almanac band's inner hairline. The rule goes at the BLOCK's edge now and
// this is measured from there, so it is air the type actually gets.
const CARD_RULE_AIR_PX = 2;

/**
 * A card's own rule: its ink, its drawn weight, and the room type may not
 * enter. One lookup, so the solver, the browser and the press walk cannot
 * disagree about where a card's edge is.
 */
export function cardRuleFor(key) {
  const border = CARD_BORDERS[String(key || '')];
  if (!border) return null;
  const weightPx = Number(border.weightPx) || CARD_RULE_INK_PX;
  const inkPx = border.double ? DOUBLE_RULE_INK_PX : weightPx;
  return { ...border, weightPx, inkPx, clearancePx: inkPx + CARD_RULE_AIR_PX };
}

const CARD_ARTWORK = Object.freeze({
  // THE सुविचार MARK OPENS THE LINE IT NAMES.
  //
  // This card is a one-line strip now (see layoutSuvichar), and on a strip a
  // centred head above the line is a second band the strip does not have room
  // for. The mark therefore sets at the head of the line and the quote and its
  // credit run on after it - mark, thought, name, one rule of type across the
  // column, which is how a printed thought-for-the-day is set.
  suvichar: { file: 'assets/smart-cards/SuvicharwithoutBG.png', aspect: 1300 / 664, placement: 'inline', heightShare: 0.52, widthShare: 0.16 },
  //                          ^ a LEAD-IN mark, sized against the line of type
  //                          it opens rather than against the strip: at 0.74
  //                          it stood half again as tall as the words and read
  //                          as a logo pasted beside them.
  //                          ^ the mark stands INSIDE the card's own rule now,
  //                          so it may not fill the frame edge to edge: at
  //                          0.86 it measured 3px past the drawn card box.
  // दिनविशेष IS TWO ROWS: THE NAME, AND THE DAY UNDER IT.
  //
  // Set as two columns the wordmark took a third of the box's WIDTH from the
  // entries, and on a 190px box that is the measure the reading matter needed.
  // The standing name goes across the head of the box with the day's entries
  // as centred bullets beneath - which is what पंचांग already does, and now
  // in the same hand: denvishash.png is 1380x752, the same artwork family as
  // panchangwithoutBG.png, where dinvishesh-title-v2.png was a wide 4.16:1
  // banner drawn by somebody else.
  //
  // The FILE was half margin. Measured: the word's ink filled 70% of
  // denvishash.png's width and 50% of its height, against 88-98% for the other
  // three marks - so the box this reserved was twice the depth of the letters
  // in it, and the mark drew small and adrift in a band of nothing. The asset
  // is cropped to its own ink now (989x399) and the aspect is the real one.
  dinvishesh: { file: 'assets/smart-cards/denvishash.png', aspect: 989 / 399, placement: 'top', heightShare: 0.26, widthShare: 0.62 },
  panchang: { file: 'assets/smart-cards/panchangwithoutBG.png', aspect: 1380 / 752, placement: 'top', heightShare: 0.245, widthShare: 0.82 },
  // THE NAMEPLATE SITS IN THE MIDDLE OF THE WHEEL, NOT ABOVE IT.
  //
  // राशिभविष्य is printed as a tall leg of twelve boxes, and the paper's own
  // name for the column goes in a band across its waist - between the sixth
  // sign and the seventh - which is what a Marathi daily does and what makes
  // the block read as one column rather than a list under a heading.
  // 'middle' therefore returns the whole frame as the content box and the
  // band's rectangle beside it; the card leaves the gap itself, because only
  // the card knows where its rows fall.
  rashi: { file: 'assets/smart-cards/rashi-bhavishyawithoutBG.png', aspect: 1380 / 752, placement: 'middle', heightShare: 0.13, widthShare: 0.66 },
});

const RASHI_ARTWORK_KEYS = new Set([
  'mesh', 'vrishabh', 'mithun', 'kark', 'sinh', 'kanya',
  'tula', 'vrishchik', 'dhanu', 'makar', 'kumbh', 'meen',
]);

function rashiArtworkFile(sign) {
  let key = String(sign?.key || '').trim().toLowerCase();
  if (key === 'vrischik') key = 'vrishchik';
  return RASHI_ARTWORK_KEYS.has(key) ? `assets/smart-cards/rashi-${key}.png` : null;
}

/**
 * Reserve the exact rectangle occupied by a card's registered artwork and
 * return the remaining content box. Both are expressed in the OUTER frame's
 * coordinates so the browser and all press writers can place them directly.
 */
function cardArtworkFor(key, frame) {
  const config = CARD_ARTWORK[key];
  // THE RULE IS THE BLOCK'S OWN EDGE, ON ALL FOUR SIDES.
  //
  // It used to follow the CONTENT box - the rectangle the type is set in -
  // which put the ink exactly where the first word starts and left the block
  // itself unruled. Photographed in print view: पंचांग and हवामान carried a
  // rule floating 2px inside a block that had none of its own (the desk's
  // "no outer border for the block"), while every band of the market panel,
  // the sudoku's grid and राशिभविष्य's sign artwork were drawn hard against
  // that same rule. One rectangle cannot be both the edge of the card and the
  // edge of its type; the rule takes the frame and the type stands clear of it.
  const rule = cardRuleFor(key);
  const pad = Math.max(frame.padding, rule ? rule.clearancePx : 0);
  const innerWidth = Math.max(0, frame.width - pad * 2);
  const innerHeight = Math.max(0, frame.height - pad * 2);
  const content = { x: pad, y: pad, width: innerWidth, height: innerHeight };
  const borderBox = rule ? { x: 0, y: 0, width: frame.width, height: frame.height } : null;
  if (!config || innerWidth <= 0 || innerHeight <= 0) {
    return { artwork: null, content, borderBox };
  }

  const gap = Math.min(GAP_PX, Math.max(2, innerHeight * 0.06));
  const height = Math.max(0, Math.min(
    innerHeight * config.heightShare,
    (innerWidth * config.widthShare) / config.aspect,
  ));
  const width = height * config.aspect;

  if (config.placement === 'inline') {
    const x = pad;
    const y = pad + (innerHeight - height) / 2;
    return {
      artwork: { file: config.file, x, y, width, height },
      borderBox,
      content: {
        x: x + width + gap,
        y: pad,
        width: Math.max(0, innerWidth - width - gap),
        height: innerHeight,
      },
    };
  }

  if (config.placement === 'middle') {
    // The band's own depth: the artwork plus a hair of air either side. The
    // card is handed the whole frame and the band, and decides which of its
    // rows fall above and below.
    const bandHeight = height + gap * 2;
    const x = pad + (innerWidth - width) / 2;
    const y = pad + (innerHeight - bandHeight) / 2 + gap;
    return {
      artwork: { file: config.file, x, y, width, height },
      content,
      borderBox,
      band: { height: bandHeight, gap },
    };
  }

  const finalWidth = config.stretch ? innerWidth * config.widthShare : width;
  const x = pad + (innerWidth - finalWidth) / 2;
  const y = pad;
  return {
    artwork: { file: config.file, x, y, width: finalWidth, height, stretch: Boolean(config.stretch) },
    borderBox,
    content: {
      x: pad,
      y: y + height + gap,
      width: innerWidth,
      height: Math.max(0, innerHeight - height - gap),
    },
  };
}

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
function solveFont(availableHeight, neededHeight, candidates = CANDIDATE_FONT_PX) {
  let last = null;
  for (const candidate of candidates) {
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
// A subtitle introduces the card; it is not the card. Half again as large as
// what it labels is the most a label can be and still read as one.
const MAX_SUBTITLE_OF_BODY = 1.5;

function solveSubtitle(text, frame, maxFontPx = Infinity) {
  const clean = String(text || '').trim();
  if (!clean) return { fontPx: 0, lineHeightPx: 0, lines: [], height: 0, hardOverset: false };

  const ceiling = Math.max(0, frame.innerHeight) * MAX_SUBTITLE_SHARE;
  let chosen = null;
  for (const fontPx of CANDIDATE_FONT_PX) {
    if (fontPx > maxFontPx) continue;
    const wrapped = wrapSmartText(clean, { width: frame.innerWidth, fontPx, family: 'serif', weight: SUBTITLE_WEIGHT });
    const lineHeightPx = lineHeightFor(fontPx, 'serif', SUBTITLE_WEIGHT);
    const candidate = {
      fontPx, lineHeightPx, lines: wrapped.lines.map((l) => l.text),
      height: wrapped.lines.length * lineHeightPx + GAP_PX, hardOverset: wrapped.hardOverset,
    };
    chosen = candidate;
    if (wrapped.hardOverset) continue;
    // The largest size that fits the width AND leaves the card most of itself.
    if (!ceiling || candidate.height <= ceiling) return candidate;
  }
  // Nothing fitted the share at any legible size. The subtitle is still DRAWN -
  // never silently dropped, never shrunk past legibility to make a number come
  // out right - and it is flagged, which is what turns the card OVERSET and
  // tells the desk the block is too small for what is in it. Shrinking until
  // it fitted would have traded a visible fault for an invisible one, and that
  // is exactly what the first version of this ceiling did: a subtitle of two
  // hundred words came back FITS, set in type nobody could read.
  return { ...chosen, hardOverset: true };
}

// ----------------------------------------------------------------- sudoku ---

function isGrid(grid) {
  return Array.isArray(grid) && grid.length === 9 && grid.every((row) => Array.isArray(row) && row.length === 9);
}

function layoutSudoku(data, frame) {
  const grid = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : null;
  if (!grid) return empty('sudoku');

  // THE HEADING IS AN INVITATION, NOT A LABEL.
  //
  // The desk's report: the puzzle "should have more words like solve this
  // today's sudoku rather than just having sudoku". A printed puzzle box names
  // the day, asks the reader to play, and states the rule and the difficulty -
  // that is what makes it a feature rather than a grid somebody left on the
  // page.
  const headingText = isGrid(data?.grid)
    ? `आजचे सुडोकू सोडवा — प्रत्येक ओळ, स्तंभ व ३×३ चौकटीत १ ते ९ अंक भरा${data?.difficulty ? ` · काठिण्य : ${data.difficulty}` : ''}`
    : 'कालच्या सुडोकूचे उत्तर — तुमचे उत्तर तपासून पाहा';
  // This is an instruction band, not a one-word badge. Pick the largest size
  // that holds the complete sentence on one line so it uses the wide measure
  // above the square instead of turning into a tall second title.
  // A rung larger than it was ([11 …]): the band is the card's own heading and
  // was setting a shade under the numerals it introduces. It still holds the
  // whole sentence on one line - the search below is unchanged - so the only
  // effect is that the largest size it can reach is now larger.
  const headingCandidates = [14, 13, 12, 11, 10, 9, 8, 7, 6.5, 6];
  let headingFontPx = headingCandidates[headingCandidates.length - 1];
  let heading = measureAtomic(headingText, headingFontPx, 'serif', 700, frame.innerWidth);
  for (const candidate of headingCandidates) {
    const measured = measureAtomic(headingText, candidate, 'serif', 700, frame.innerWidth);
    headingFontPx = candidate;
    heading = measured;
    if (!measured.hardOverset) break;
  }
  const headingLineHeightPx = lineHeightFor(headingFontPx, 'serif', 700);
  const headingGap = Math.min(5, Math.max(2, frame.innerHeight * 0.018));
  const gridHeight = Math.max(0, frame.innerHeight - headingLineHeightPx - headingGap);
  const cellRaw = Math.floor(Math.min(frame.innerWidth / 9, gridHeight / 9));
  // Clamped UP to the minimum, never shrunk past it - a sudoku smaller than
  // this is not a puzzle a reader can solve, so it is drawn at the floor and
  // flagged OVERSET rather than made unreadable to avoid the flag.
  const cell = Math.max(MIN_SUDOKU_CELL_PX, cellRaw);
  const fitState = cellRaw < MIN_SUDOKU_CELL_PX || heading.hardOverset ? 'OVERSET' : 'FITS';
  const gridSize = cell * 9;
  const top = headingLineHeightPx + headingGap
    + Math.max(0, (gridHeight - gridSize) / 2);

  return {
    key: 'sudoku',
    fitState,
    fontPx: Math.max(1, cell * 0.62),
    geometry: {
      cell, gridSize, top, headingText: heading.line,
      headingFontPx, headingLineHeightPx, headingGap,
    },
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------- rashi ---

const RASHI_NAME_WEIGHT = 700;
const RASHI_COLUMN_GAP_PX = 6;
const RASHI_ITEM_PADDING_PX = 3;
const RASHI_READING_MAX_LINES = 3;

function rashiItemHeight(sign, { readingWidth, luckWidth, fontPx, lineHeightPx, iconSize, rowHeight }) {
  const name = measureAtomic(sign.name || '', fontPx, 'serif', RASHI_NAME_WEIGHT, readingWidth);
  const reading = wrapSmartText(sign.text, { width: readingWidth, fontPx, family: 'serif', weight: 400 });
  const luckParts = [
    sign.luckyNumber != null ? `शुभ अंक ${devanagariDigits(sign.luckyNumber)}` : '',
    sign.luckyColour ? `शुभ रंग ${sign.luckyColour}` : '',
  ].filter(Boolean);
  const luckFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.86);
  const luckLineHeightPx = lineHeightFor(luckFontPx, 'serif', 700);
  const measuredLuck = luckParts.map((part) => measureAtomic(part, luckFontPx, 'serif', 700, luckWidth));
  const luckLines = measuredLuck.map((part) => part.line);
  const luckOverset = measuredLuck.some((part) => part.hardOverset);

  const readingLines = reading.lines.map((line) => line.text);
  const textHeight = Math.max(1, 1 + readingLines.length) * lineHeightPx;
  const emblemHeight = iconSize + (luckLines.length ? 2 + luckLines.length * luckLineHeightPx : 0);
  const neededHeight = Math.max(emblemHeight, textHeight) + RASHI_ITEM_PADDING_PX * 2;
  const hardOverset = name.hardOverset
    || reading.hardOverset
    || readingLines.length > RASHI_READING_MAX_LINES
    || luckOverset
    || neededHeight > rowHeight;

  return {
    key: sign.key || '',
    name: name.line,
    imageFile: rashiArtworkFile(sign),
    readingLines,
    luckLines,
    luckFontPx,
    luckLineHeightPx,
    height: neededHeight,
    hardOverset,
  };
}

function rashiArrangement(signs, frame, columns) {
  const rows = Math.ceil(signs.length / columns);
  const columnGap = columns > 1 ? RASHI_COLUMN_GAP_PX : 0;
  const columnWidth = (frame.innerWidth - columnGap * (columns - 1)) / columns;
  // The nameplate's band comes out of the card's middle before the rows are
  // measured - it is not room the signs may use - and it falls on a row
  // boundary, halfway down, so the column reads as six over six.
  const bandHeight = Number(frame.band?.height) || 0;
  const bandAfterRow = bandHeight > 0 ? Math.round(rows / 2) : -1;
  const rowHeight = rows > 0 ? Math.max(0, frame.innerHeight - bandHeight) / rows : frame.innerHeight;
  const iconSize = Math.max(0, Math.min(46, columnWidth * 0.29, rowHeight * 0.54));
  const readingWidth = Math.max(0, columnWidth - iconSize - GAP_PX - RASHI_ITEM_PADDING_PX * 2);
  return { rows, columnGap, columnWidth, rowHeight, iconSize, readingWidth, bandHeight, bandAfterRow };
}

/**
 * THE TWELVE SIGNS ARE SET IN AS MANY COLUMNS AS THE FRAME WILL CARRY.
 *
 * The count used to be a two-way rule - one column, or two once the frame
 * reached 180 px - and it was written for the tall narrow box this card
 * usually gets. Given a WIDE one it is the wrong shape twice over: on a real
 * 620 x 320 features block the twelve signs set as two columns of six, which
 * makes each row 53 px deep, and a row that shallow rejects every candidate
 * above 7.5 px. Measured on the page: 7.5 px is 10.6 pt of reading matter set
 * across a 150 mm card - unreadable, and half the block's own width spent on
 * nothing.
 *
 * The frame decides, not a constant. Every column count whose column is still
 * wide enough to set a name beside a reading is tried, and the one that
 * resolves the LARGEST type wins - the same argument `measureColumns()` makes
 * for body copy, and for the same reason: more columns means shallower rows
 * only if the sign count forces it, and here three columns of four is both
 * wider-rowed and better proportioned than two of six. Ties go to the
 * arrangement with the fewest empty cells, then to the fewest columns, so a
 * card can never gain a ragged last column for no typographic gain.
 */
function layoutRashi(data, frame) {
  const signs = Array.isArray(data?.signs) ? data.signs.filter(Boolean) : [];
  if (!signs.length) return empty('rashi');

  const WIDE_COLUMN_PX = 90;
  const candidates = [];
  for (let columns = 1; columns <= Math.min(signs.length, 6); columns += 1) {
    const shape = rashiArrangement(signs, frame, columns);
    if (columns > 1 && shape.columnWidth < WIDE_COLUMN_PX) continue;
    const solved = solveFont(frame.innerHeight, (fontPx) => {
      const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
      const items = signs.map((sign) => rashiItemHeight(sign, {
        readingWidth: shape.readingWidth,
        luckWidth: shape.iconSize,
        fontPx,
        lineHeightPx,
        iconSize: shape.iconSize,
        rowHeight: shape.rowHeight,
      }));
      return { height: frame.innerHeight, hardOverset: items.some((i) => i.hardOverset), items, lineHeightPx };
    });
    candidates.push({
      columns,
      shape,
      solved,
      empties: shape.rows * columns - signs.length,
      // How many signs the arrangement cannot set. Every candidate reports the
      // same `height` (the frame's), so when NOTHING fits there is no overflow
      // measure to rank by and every arrangement lands on the ladder's floor -
      // at which point "fewest columns" would pick one column of twelve in a
      // 260 px frame, which is worse than the two the old fixed rule gave.
      // The count of signs that genuinely will not set is the honest ranking.
      unset: (solved.items || []).filter((item) => item.hardOverset).length,
    });
  }
  if (!candidates.length) candidates.push({
    columns: 1,
    shape: rashiArrangement(signs, frame, 1),
    solved: solveFont(frame.innerHeight, (fontPx) => {
      const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
      const shape = rashiArrangement(signs, frame, 1);
      const items = signs.map((sign) => rashiItemHeight(sign, {
        readingWidth: shape.readingWidth, luckWidth: shape.iconSize, fontPx,
        lineHeightPx, iconSize: shape.iconSize, rowHeight: shape.rowHeight,
      }));
      return { height: frame.innerHeight, hardOverset: items.some((i) => i.hardOverset), items, lineHeightPx };
    }),
    empties: 0,
  });

  const fitting = candidates.filter((c) => c.solved.fitState === 'FITS');
  const pool = fitting.length ? fitting : candidates;
  const best = pool.reduce((winner, candidate) => {
    if (!winner) return candidate;
    if (candidate.solved.fontPx !== winner.solved.fontPx) {
      return candidate.solved.fontPx > winner.solved.fontPx ? candidate : winner;
    }
    if (candidate.unset !== winner.unset) return candidate.unset < winner.unset ? candidate : winner;
    if (candidate.empties !== winner.empties) return candidate.empties < winner.empties ? candidate : winner;
    // Deepest rows last: at equal type and equal raggedness the arrangement
    // that gives each sign the most room is the better page. It is also what
    // decides the all-OVERSET case, where every candidate reports the ladder's
    // floor and there is nothing else to separate them - one column of twelve
    // in a 260 px frame is worse than two of six, however you count it.
    if (candidate.shape.rowHeight !== winner.shape.rowHeight) {
      return candidate.shape.rowHeight > winner.shape.rowHeight ? candidate : winner;
    }
    return candidate.columns < winner.columns ? candidate : winner;
  }, null);

  const { shape, solved, columns } = best;
  return {
    key: 'rashi',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      columns,
      rows: shape.rows,
      rowHeights: Array.from({ length: shape.rows }, () => shape.rowHeight),
      rowHeight: shape.rowHeight,
      columnWidth: shape.columnWidth,
      columnGap: shape.columnGap,
      iconSize: shape.iconSize,
      readingWidth: shape.readingWidth,
      itemPadding: RASHI_ITEM_PADDING_PX,
      lineHeightPx: solved.lineHeightPx,
      readingMaxLines: RASHI_READING_MAX_LINES,
      // Where the nameplate's band falls, in ROWS, and how deep it is. Every
      // surface that places a sign adds it: the canvas as an extra grid track,
      // the export walk as an offset on the rows below it. One number, read by
      // both, so the band cannot land in two different places.
      bandHeight: shape.bandHeight,
      bandAfterRow: shape.bandAfterRow,
    },
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
    // THE CELL'S INSET IS THE SOLVER'S, NOT THE STYLESHEET'S.
    //
    // `.smart-card-table td` carried `padding: 0.15em 0.3em`, which the solver
    // knew nothing about. At the 24 px this card was solving to, that is 14.4
    // px of horizontal padding the value column never had and 7.2 px of extra
    // height on every row - so the solver reported FITS with every value on
    // one line while the browser wrapped "१२ तास ४७ मिनिटे" onto two and
    // pushed शके off the bottom of the block. Photographed on a real card.
    // The numbers are computed here and applied inline by the renderer and the
    // export walk, so all three surfaces use the one inset.
    const cellPadX = fontPx * 0.3;
    const cellPadY = fontPx * 0.15;
    const maxLabelWidth = rows.reduce((max, item) => Math.max(max, measure(item.label, fontPx, 'serif', PANCHANG_LABEL_WEIGHT)), 0);
    const labelWidth = Math.min(frame.innerWidth * 0.4, maxLabelWidth + cellPadX * 2 + GAP_PX);
    const valueWidth = Math.max(0, frame.innerWidth - labelWidth);
    // What the type actually has, inside the cell's own inset.
    // The cell's own rule eats into its text width as surely as its padding
    // does - `.smart-card-panchang td` carries a 0.5px left border, and a
    // half pixel is exactly the margin a wrapping decision turns on.
    const cellRulePx = 0.5;
    const labelTextWidth = Math.max(0, labelWidth - cellPadX * 2);
    const valueTextWidth = Math.max(0, valueWidth - cellPadX * 2 - cellRulePx);
    // The rule under each row is real ink and takes real room.
    const ruleHeight = 0.4;

    let hardOverset = false;
    const items = rows.map((item) => {
      const label = measureAtomic(item.label, fontPx, 'serif', PANCHANG_LABEL_WEIGHT, labelTextWidth);
      const value = wrapSmartText(item.text ?? '', { width: valueTextWidth, fontPx, family: 'serif', weight: 400 });
      if (label.hardOverset || value.hardOverset) hardOverset = true;
      const valueLines = value.lines.map((l) => l.text);
      const lineCount = Math.max(1, valueLines.length);
      return {
        label: item.label,
        labelLines: [label.line],
        valueLines,
        rowHeight: lineCount * lineHeightPx + cellPadY * 2 + ruleHeight,
        textNudgeY: String(item.label).replace(/\s/g, '') === 'राहुकाळ'
          ? -Math.max(0, (lineCount - 1) * lineHeightPx / 2)
          : 0,
      };
    });

    const height = items.reduce((sum, item) => sum + item.rowHeight, 0);
    return {
      height, hardOverset, items, labelWidth, valueWidth,
      labelTextWidth, valueTextWidth, cellPadX, cellPadY, ruleHeight, lineHeightPx,
    };
  });

  // THE ROWS FILL THE RING.
  //
  // Five rows solved for legibility rarely add up to exactly the box they were
  // given, and what is left showed as a sixth, EMPTY row inside the almanac's
  // own double band - photographed on the page in print view. A printed table
  // spends that on its rows, which is also the more legible answer. Bounded by
  // half a line so a nearly-empty card cannot become a ladder.
  const stack = solved.items.reduce((sum, item) => sum + item.rowHeight, 0);
  const spare = Math.max(0, frame.innerHeight - stack);
  const perRow = solved.items.length
    ? Math.min(spare / solved.items.length, solved.lineHeightPx * 0.5)
    : 0;
  const items = perRow > 0.2
    ? solved.items.map((item) => ({ ...item, rowHeight: item.rowHeight + perRow }))
    : solved.items;

  return {
    key: 'panchang',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      rows: rows.length,
      labelWidth: solved.labelWidth,
      valueWidth: solved.valueWidth,
      labelTextWidth: solved.labelTextWidth,
      valueTextWidth: solved.valueTextWidth,
      cellPadX: solved.cellPadX,
      cellPadY: solved.cellPadY,
      ruleHeight: solved.ruleHeight,
      lineHeightPx: solved.lineHeightPx,
    },
    items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------- chart ---
//
// A newspaper's information graphic, solved the same way every other card is.
//
// FIVE KINDS, AND ONE PRIMITIVE UNDERNEATH THEM.
//
// A bar and a stat row are rectangles and type, which every writer already
// drew. A pie, a line and a dot plot are the ones this used to say could not
// be done, on the reasoning that a pie needs bezier arcs and a line needs a
// polyline, and that adding those to the PDF, the IDML and the .sla was three
// separate pieces of geometry work.
//
// The premise was wrong, and pleasantly so: an arc turned into SEGMENTS is a
// polygon, and so is a line chart, and so is a dot. So there is one new
// neutral item - `poly`, a point list with an ink and an optional stroke - and
// each writer gained one small branch that draws straight lines. The
// segmentation happens HERE, once, so every surface draws the identical
// polygon and no writer can round an arc differently from another. At 300 dpi
// a 32-segment quarter turn sits under a third of a pixel from the true arc,
// which is finer than a press can hold registration.
//
// The bars still run ACROSS, not up.
//
// A Marathi category label is long ("छत्रपती संभाजीनगर"), and a vertical bar
// chart has to set those labels sideways or abbreviate them; a horizontal bar
// reads them on their own baseline at the body size.

const CHART_BAR_GAP_PX = 2;
const CHART_VALUE_GAP_PX = 4;
// How many straight segments one whole turn of an arc is drawn with. 64 puts a
// quarter turn inside a third of a press pixel at 300 dpi.
const ARC_SEGMENTS = 64;
const CHART_KINDS = new Set(['bar', 'stat', 'pie', 'line', 'dots']);

// THE PAPER'S ACCENT, AND THE TINTS A PIE'S SLICES ARE PRINTED IN.
//
// A newspaper prints a pie in tints of ONE ink, not in a rainbow - it has four
// plates and a colour a desk mixed in a browser is an ink no press can lay
// down. Eight steps, so a chart with more slices than a reader can tell apart
// repeats rather than inventing one.
//
// Here, and only here, because three surfaces ask: the canvas, the export walk
// and (through the export walk) all three writers. Two copies of a colour
// table is the drift this codebase has been bitten by twice.
export const CHART_ACCENT = '#c8102e';
const SLICE_SHADES = [1, 0.72, 0.48, 0.3, 0.86, 0.6, 0.4, 0.22];

/**
 * WHICH ink this chart is printed in - one of the paper's four, never a
 * colour a desk mixed in a browser.
 *
 * The desk asked to be able to "add different color to graph to look it
 * beautiful", and that is a fair thing to want; what it must not become is a
 * colour wheel. SAHAS prints from four plates, so a chart gets to choose which
 * PLATE it prints from - red, blue, green or plain black - and its slices are
 * then tints of that one ink, which is what a printed chart actually is and
 * what keeps a five-slice pie legible on newsprint. Black charts print with no
 * fourth plate at all, which is what a mono page needs.
 *
 * Anything unrecognised falls back to the paper's red, so an old card and a
 * hand-edited payload both still draw.
 */
export function chartInk(data) {
  const chosen = sanitiseInk(data?.ink);
  if (chosen) return chosen;
  // 'black' is a real choice and carries no hex (inks.js: black is the absence
  // of a mark), so it cannot come back from sanitiseInk and is asked for by
  // key. A chart set in black is drawn in tints of black.
  if (String(data?.ink || '').toLowerCase() === 'black' || data?.ink === '#111111') return '#111111';
  return CHART_ACCENT;
}

/** The four a chart may be set in, for a control to offer. */
export const CHART_INKS = Object.freeze(
  INKS.map((entry) => ({ key: entry.key, label: entry.label, hex: entry.hex || '#111111' })),
);

/** The ink slice `index` is printed in - a real hex, so every writer draws it. */
export function sliceInk(index, base = CHART_ACCENT) {
  const shade = SLICE_SHADES[index % SLICE_SHADES.length];
  const value = parseInt(String(base || CHART_ACCENT).slice(1), 16);
  const mix = (channel) => Math.round(255 - (255 - channel) * shade);
  const r = mix((value >> 16) & 0xff);
  const g = mix((value >> 8) & 0xff);
  const b = mix(value & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A circle, or the slice of one, as a closed point list. */
export function arcPoints(cx, cy, radius, fromTurn, toTurn, { centre = true } = {}) {
  const steps = Math.max(2, Math.ceil(Math.abs(toTurn - fromTurn) * ARC_SEGMENTS));
  const points = centre ? [[cx, cy]] : [];
  for (let i = 0; i <= steps; i += 1) {
    // Clockwise from twelve o'clock, which is where a reader expects a pie to
    // start and the direction they expect it to run.
    const turn = fromTurn + ((toTurn - fromTurn) * i) / steps;
    const angle = turn * Math.PI * 2 - Math.PI / 2;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return points;
}

function chartRows(data) {
  return Array.isArray(data?.items)
    ? data.items.filter((item) => item && item.label != null && Number.isFinite(Number(item.value)))
    : [];
}

function layoutChart(data, frame) {
  const rows = chartRows(data);
  if (!rows.length) return empty('chart');
  const kind = CHART_KINDS.has(data?.chartType) ? data.chartType : 'bar';
  const unit = String(data?.unit || '');
  const source = String(data?.source || '');
  const peak = rows.reduce((max, item) => Math.max(max, Math.abs(Number(item.value))), 0) || 1;
  const valueText = (item) => `${devanagariDigits(item.value)}${unit ? ` ${unit}` : ''}`;
  // Resolved ONCE, here, and carried out in the geometry below - so the canvas,
  // the Block Editor and all three export writers read the chart's ink off the
  // one solve instead of each importing the constant and each being free to
  // disagree with the others about what colour the chart is.
  const ink = chartInk(data);

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

    // A PIE. Every slice is a share of one turn, and the legend is beside it -
    // a Marathi label will not fit inside a slice and setting it at an angle
    // is not something a newspaper does.
    if (kind === 'pie') {
      const total = rows.reduce((sum, item) => sum + Math.abs(Number(item.value)), 0) || 1;
      // The legend reads "label — value", so it is MEASURED as that. Measured
      // on the label alone it was a third too narrow and every entry was
      // clipped mid-figure: "सातारा — ८४" for 842.
      const legendNeeded = rows.reduce((max, item) => Math.max(max,
        measure(`${item.label} — ${valueText(item)}`, fontPx, 'sans', 400)), 0) + fontPx * 1.4;
      // Half the card at most - past that the wheel stops being the thing a
      // reader looks at. When the entries need more than that the TYPE comes
      // down until they fit, which is what solveFont() is for and what every
      // other card here already does; capping the box and setting the text
      // into it anyway is how the legend came to read "सातारा — ८४२ ि".
      const legendCap = frame.innerWidth * 0.5;
      const legendWidth = Math.min(legendCap, legendNeeded);
      const diameter = Math.max(0, Math.min(frame.innerWidth - legendWidth - GAP_PX,
        frame.innerHeight - sourceHeight));
      const radius = diameter / 2;
      let turn = 0;
      const items = rows.map((item, index) => {
        const share = Math.abs(Number(item.value)) / total;
        const slice = { label: String(item.label), value: Number(item.value), valueText: valueText(item),
          share, from: turn, to: turn + share, swatch: index, ink: sliceInk(index, ink) };
        turn += share;
        return slice;
      });
      const legendLine = lineHeightPx;
      return {
        height: Math.max(diameter, items.length * legendLine) + sourceHeight,
        hardOverset: radius <= fontPx || legendNeeded > legendCap, items, kind,
        radius, diameter, legendWidth, legendLine, lineHeightPx, sourceHeight, source, peak, total,
      };
    }

    // A LINE, and DOTS - the same plot, drawn two ways. The value axis is the
    // height of the plot and the categories are spaced evenly across it; the
    // labels sit under it on their own baseline.
    if (kind === 'line' || kind === 'dots') {
      const labelBand = lineHeightPx;
      const valueBand = lineHeightPx;
      const plotHeight = Math.max(0, frame.innerHeight - labelBand - valueBand - sourceHeight);
      // THE PLOT IS INSET BY HALF A LABEL AT EACH END. The first reading sits
      // at x=0 and the last at the full width, and each carries a label
      // CENTRED on it - so both ran off the edge of the block and were clipped.
      // Photographed: "गारा" for सातारा at the left and "पु" for पुणे at the
      // right, on a chart whose middle two labels were perfect.
      const widestLabel = rows.reduce((max, item) => Math.max(max,
        measure(String(item.label), fontPx, 'sans', 400),
        measure(valueText(item), fontPx, 'sans', 700)), 0);
      const inset = Math.min(widestLabel / 2, frame.innerWidth * 0.25);
      const plotWidth = Math.max(0, frame.innerWidth - inset * 2);
      const step = rows.length > 1 ? plotWidth / (rows.length - 1) : 0;
      const low = rows.reduce((min, item) => Math.min(min, Number(item.value)), Infinity);
      const high = rows.reduce((max, item) => Math.max(max, Number(item.value)), -Infinity);
      const span = high - low || 1;
      const items = rows.map((item, index) => {
        const value = Number(item.value);
        return {
          label: String(item.label), value, valueText: valueText(item),
          x: inset + (rows.length > 1 ? index * step : plotWidth / 2),
          // Down the page from the plot's own top, which is where the highest
          // value sits.
          y: valueBand + plotHeight - ((value - low) / span) * plotHeight,
        };
      });
      return {
        height: valueBand + plotHeight + labelBand + sourceHeight,
        // AND TWO LABELS MAY NOT TOUCH. solveFont() was maximising the type
        // against the plot's HEIGHT alone, so four Marathi categories in a
        // 268 px block set at a size where the labels ran into one another -
        // photographed as "सातारकोल्हापूसांगली पुणे", which is four place
        // names a reader cannot separate. Width is a fit condition too, and
        // the type comes down until it holds.
        hardOverset: plotHeight <= fontPx || plotWidth <= fontPx
          || (rows.length > 1 && widestLabel > step), items, kind,
        plotHeight, valueBand, labelBand, step, low, high, span, inset, plotWidth,
        dotRadius: Math.max(1, fontPx * 0.22), lineWidth: Math.max(0.5, fontPx * 0.09),
        lineHeightPx, sourceHeight, source, peak,
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
      chartType: solved.kind, rows: rows.length, peak: solved.peak, ink,
      labelWidth: solved.labelWidth || 0, trackWidth: solved.trackWidth || 0,
      valueWidth: solved.valueWidth || 0, rowHeight: solved.rowHeight || 0,
      columns: solved.columns || 0, columnWidth: solved.columnWidth || 0,
      figurePx: solved.figurePx || 0, figureLine: solved.figureLine || 0,
      bandHeight: solved.bandHeight || 0,
      lineHeightPx: solved.lineHeightPx, sourceHeight: solved.sourceHeight || 0,
      source: solved.source || '',
      // The pie, and the line/dot plot. Published beside the bar's numbers
      // rather than in a shape of their own, because every reader of this
      // geometry - the canvas, the Block Editor, the export walk and preflight
      // - reads one object and switches on `chartType`.
      radius: solved.radius || 0, diameter: solved.diameter || 0,
      legendWidth: solved.legendWidth || 0, legendLine: solved.legendLine || 0,
      total: solved.total || 0,
      plotHeight: solved.plotHeight || 0, valueBand: solved.valueBand || 0,
      labelBand: solved.labelBand || 0, step: solved.step || 0,
      low: solved.low ?? 0, high: solved.high ?? 0, span: solved.span || 1,
      dotRadius: solved.dotRadius || 0, lineWidth: solved.lineWidth || 0,
      inset: solved.inset || 0, plotWidth: solved.plotWidth || 0,
    },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ---------------------------------------------------------------- suvichar ---

/**
 * THE THOUGHT FOR THE DAY IS A DISPLAY QUOTE, NOT A CAPTION.
 *
 * This solved the quote and its attribution as ONE ATOMIC LINE
 * (`measureAtomic(displayLine, ...)`, `singleLine: true`) - so the only way a
 * long quote could fit was to shrink until the whole sentence sat on a single
 * row. Photographed on a real 268x300 block: the nameplate artwork inline at
 * the left, the entire quote set at 8 px on one line beside it, and rather
 * more than half the block standing empty underneath. A reader meets this box
 * as the one piece of writing on the page that is meant to be read slowly, and
 * it was the smallest type on the page.
 *
 * It is set the way a printed paper sets a pull quote instead: the words WRAP,
 * they are centred on the measure, and the size is chosen to FILL the block
 * rather than to avoid wrapping. Attribution goes on its own line under a
 * short centred rule - which is what makes the artwork above and the lines
 * below read as one column rather than a picture with a sentence next to it
 * (the desk's report: "suvichar name in image should align with next lines").
 */
function layoutSuvichar(data, frame) {
  if (!data?.text) return empty('suvichar');

  const quoteText = String(data.text || '').trim();
  const attributionText = String(data.attribution || '').trim();

  // A quote is set with air around it - a printed thought-for-the-day is never
  // jammed against its own rule. But the air is the TYPE's, not the block's:
  // a flat 6% of a 620 px strip is 37 px each side, which on a one-line strip
  // is 74 px of measure spent on margin and cost the quote a whole size step
  // (measured: 563 px of type refused by a 544 px measure at 14 px, set at 12
  // instead). Bounded by the type it is protecting, it is the same air on a
  // narrow card and stops growing on a wide one.
  // A WRAPPED PANEL INSETS ITS MEASURE; A STRIP DOES NOT NEED TO.
  //
  // The strip's mark, quote and credit are set down as one centred group
  // (layoutSmartCard), so the air either side is the centring's and a side
  // inset here is measure spent twice. Worse, it was spent in two different
  // places: the solver took it off the measure and the renderer wrote it again
  // as the blockquote's own padding, inside a box already cut to the row's
  // drawn width - so the quote shrank and WRAPPED, 48px of type in a 30px
  // strip. Measured in the DOM: quote-text 8px above the card and 10px below.
  const insetFor = (fontPx, oneLineOnly) => (oneLineOnly
    ? 0
    : Math.max(4, Math.min(frame.innerWidth * 0.06, fontPx * 1.5)));

  // A सुविचार IS A ONE-LINE STRIP.
  //
  // A thought for the day is printed as a single rule of type across the head
  // of a column, with its credit at the end - not as a paragraph in a panel.
  // Wrapped to three lines it stops being an ornament and starts competing
  // with the stories beside it, which is what the desk reported.
  //
  // So the search runs twice: first refusing every size at which the quote
  // will not hold one line, and only if NO size does - a very long quote in a
  // narrow column - falling back to the wrapped panel, which is the honest
  // answer rather than a clipped strip.
  const solveWith = (oneLineOnly) => solveFont(frame.innerHeight, (fontPx) => {
    const sideInset = insetFor(fontPx, oneLineOnly);
    const measureWidth = Math.max(1, frame.innerWidth - sideInset * 2);
    // The quote leads; the attribution is deliberately smaller, as a credit is.
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400) * 1.18;
    const creditFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.62);
    const creditLineHeightPx = lineHeightFor(creditFontPx, 'sans', 400);

    const quote = wrapSmartText(quoteText, {
      width: measureWidth, fontPx, family: 'serif', weight: 700,
    });
    const credit = attributionText
      ? wrapSmartText(`— ${attributionText}`, {
        width: measureWidth, fontPx: creditFontPx, family: 'sans', weight: 400,
      })
      : { lines: [], hardOverset: false };

    const quoteLines = quote.lines.map((line) => line.text);
    const attributionLines = credit.lines.map((line) => line.text);

    // A ONE-LINE सुविचार CARRIES ITS CREDIT ON THE LINE.
    //
    // Stacked under a centred rule, the credit costs the strip its whole
    // second band - measured on a 620x72 block, that held the quote down to
    // 12 px when the strip had room for far more. A printed one-line thought
    // for the day runs "…quote… — Name" and stops, so the credit is measured
    // INTO the line and the rule goes. The quote's own drawn width is stated
    // for the writers, which is how the plate sets the credit after it without
    // measuring anything a second time.
    const creditText = attributionText ? `— ${attributionText}` : '';
    const creditGap = fontPx * 0.6;
    const quoteInlineWidth = measure(quoteLines[0] || '', fontPx, 'serif', 700);
    const creditInlineWidth = creditText ? measure(creditText, creditFontPx, 'sans', 400) : 0;
    const inlineCredit = Boolean(oneLineOnly && creditText && quoteLines.length === 1
      && quoteInlineWidth + creditGap + creditInlineWidth <= measureWidth);

    const quoteHeight = Math.max(1, quoteLines.length) * lineHeightPx;
    const creditHeight = inlineCredit ? 0 : attributionLines.length * creditLineHeightPx;
    // The rule between the two, and the air either side of it.
    const ruleGap = creditHeight ? Math.max(4, fontPx * 0.55) : 0;
    const ruleWidth = Math.min(measureWidth * 0.4, Math.max(18, fontPx * 3));

    return {
      height: quoteHeight + (creditHeight ? ruleGap * 2 + creditHeight : 0),
      hardOverset: quote.hardOverset || credit.hardOverset
        || (oneLineOnly && quoteLines.length > 1)
        // A strip that cannot get its credit onto the line is not a strip.
        || (oneLineOnly && Boolean(creditText) && !inlineCredit),
      inlineCredit,
      creditText,
      creditGap,
      quoteInlineWidth,
      creditInlineWidth,
      quoteLines,
      attributionLines,
      lineHeightPx,
      creditFontPx,
      creditLineHeightPx,
      quoteHeight,
      creditHeight,
      ruleGap,
      ruleWidth,
      sideInset,
      measureWidth,
      displayLine: attributionText ? `${quoteText} — ${attributionText}` : quoteText,
      oneLine: quoteLines.length === 1,
    };
  });


  // A STRIP IS ONLY A STRIP WHILE IT CAN BE READ.
  //
  // Preferring one line at any size is how a 268 px column came to set an
  // 82-character quote at 5.5 px - 7.8 pt, smaller than the paper's own body -
  // which is not a strip, it is an accident. Below STRIP_MIN_FONT_PX the
  // wrapped pull quote is the better answer and takes over, which is what a
  // narrow column gets in print.
  const oneLiner = solveWith(true);
  const solved = oneLiner.fitState === 'FITS' && oneLiner.fontPx >= STRIP_MIN_FONT_PX
    ? oneLiner
    : solveWith(false);

  return {
    key: 'suvichar',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      inlineCredit: solved.inlineCredit,
      creditText: solved.creditText,
      creditGap: solved.creditGap,
      quoteInlineWidth: solved.quoteInlineWidth,
      creditInlineWidth: solved.creditInlineWidth,
      // What the strip's mark should be set to: the line of type it opens.
      // Both are centred in the same box, so equal heights put their tops on
      // one line - which is the format the desk asked for (mark, quote,
      // credit, one rule of type) and what a lead-in mark does in print.
      markHeightPx: solved.lineHeightPx,
      // THE MARK IS PART OF THE LINE, NOT A LOGO PARKED AT THE MARGIN.
      //
      // cardArtworkFor() reserves an `inline` mark at the content box's left
      // edge and the strip then centres its row in what is LEFT, so the two
      // ended up at opposite ends of a wide strip - measured on the page, the
      // mark at x=0 and the first word 77px away with 30px of nothing between
      // the mark and the row it opens. The row's own drawn width is stated so
      // layoutSmartCard() can set the mark, the gap and the row down as one
      // centred group, which is the format a printed thought-for-the-day has:
      // mark, thought, credit, one rule of type.
      stripRowWidthPx: solved.oneLine
        ? solved.quoteInlineWidth + (solved.inlineCredit ? solved.creditGap + solved.creditInlineWidth : 0)
        : 0,
      lineHeightPx: solved.lineHeightPx,
      creditFontPx: solved.creditFontPx,
      creditLineHeightPx: solved.creditLineHeightPx,
      quoteHeight: solved.quoteHeight,
      creditHeight: solved.creditHeight,
      ruleGap: solved.ruleGap,
      ruleWidth: solved.ruleWidth,
      sideInset: solved.sideInset,
      measureWidth: solved.measureWidth,
      // Kept so nothing that read this field breaks; it is no longer true and
      // no renderer consults it.
      singleLine: false,
    },
    displayLine: solved.displayLine,
    quoteLines: solved.quoteLines,
    attributionLines: solved.attributionLines,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// -------------------------------------------------------------- dinvishesh ---

/**
 * A DINVISHESH ENTRY IS NEWSPAPER TYPE, NOT A POSTER.
 *
 * `solveFont()` takes the largest candidate that fits, which is right for a
 * card whose whole job is display - the सुविचार pull quote - and wrong for a
 * list. Measured on a real 307 x 200 features block carrying the one entry
 * this day's curated table holds: the solver reached the ladder's 32 px top,
 * which is 45 pt. Nothing in a printed daily sets a standing list item at 45
 * pt; beside a 9 pt column it reads as a poster pasted onto the page, and the
 * desk reported exactly that.
 *
 * So the entry has a CEILING as well as a floor, stated against the paper's
 * own running body (`publication-type.js`): at most `MAX_ENTRY_OF_BODY` times
 * the size the columns beside it are set in. A feature list is set larger
 * than body copy and nowhere near display.
 *
 * And the room the ceiling gives back is spent on AIR, not on letters - the
 * same rule the compositor already follows when it closes the last fraction
 * of a column with the leading. The entries spread evenly down the box, which
 * is how a printed दिनविशेष sets, instead of clumping at the top under a
 * hand's width of white.
 */
const MAX_ENTRY_OF_BODY = 2.5;
// The entries are a LIST, not a ladder: the gap between them opens a little,
// and what is left over centres the stack in its box rather than being spent
// on more air between two lines. Opening the gap to fill the box put the first
// entry hard against the top rule and the last against the bottom - measured on
// the page, and the desk asked for the bullets to sit in the middle.
const MAX_ENTRY_ROW_GAP_RATIO = 0.6;

function layoutDinvishesh(data, frame) {
  const entries = Array.isArray(data?.entries) ? data.entries.filter(Boolean) : [];
  if (!entries.length) return empty('dinvishesh');

  const ceiling = RUNNING_BODY_PX * MAX_ENTRY_OF_BODY;
  const candidates = CANDIDATE_FONT_PX.filter((px) => px <= ceiling);

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const textInset = Math.max(4, fontPx * 0.72);
    const rowGap = Math.min(2, fontPx * 0.2);
    let hardOverset = false;
    const items = entries.map((entry) => {
      const text = typeof entry === 'string' ? entry : (entry.label || entry.text || '');
      const symbol = typeof entry === 'object' && entry.symbol ? String(entry.symbol) : '\u25c6';
      const wrapped = wrapSmartText(text, {
        width: Math.max(0, frame.innerWidth - textInset), fontPx, family: 'serif', weight: 400,
      });
      if (wrapped.hardOverset) hardOverset = true;
      const lines = wrapped.lines.map((l) => l.text);
      return { symbol, lines, height: Math.max(1, lines.length) * lineHeightPx };
    });
    const height = items.reduce((sum, item) => sum + item.height, 0)
      + Math.max(0, items.length - 1) * rowGap;
    return { height, hardOverset, items, lineHeightPx, textInset, rowGap };
  }, candidates.length ? candidates : [MIN_CARD_FONT_PX]);

  // Bounded vertical justification: the leftover opens the gaps between
  // entries, up to a gap of its own line and no further. Anything beyond that
  // is a genuine hole in the box and stays one - the block is simply deeper
  // than the day's curated entries need.
  const gaps = Math.max(0, solved.items.length - 1);
  const residual = Math.max(0, frame.innerHeight - solved.height);
  const rowGap = gaps > 0
    ? Math.min(solved.rowGap + residual / gaps, solved.lineHeightPx * MAX_ENTRY_ROW_GAP_RATIO)
    : solved.rowGap;
  const stackHeight = solved.items.reduce((sum, item) => sum + item.height, 0) + gaps * rowGap;
  // Equal air above the first entry and below the last. The canvas gets it
  // from `align-content: center`; the export walk reads this number, or the
  // two surfaces would centre differently.
  const topOffset = Math.max(0, (frame.innerHeight - stackHeight) / 2);

  return {
    key: 'dinvishesh',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      rows: entries.length, lineHeightPx: solved.lineHeightPx,
      textInset: solved.textInset, rowGap, stackHeight, topOffset,
      // A ruled box with the nameplate on one line at its head and the day's
      // entries as centred bullets under it - which is the दिनविशेष a Marathi
      // daily prints, and what the desk asked for. The rule is stated here so
      // the canvas and the plate draw the same one.
      boxed: true,
      centred: true,
    },
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ----------------------------------------------------------------- havaman ---

function weatherNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? devanagariDigits(number) : '—';
}

/**
 * THE WEATHER BOX IS A FORECAST, NOT A PARAGRAPH IN A PANEL.
 *
 * The previous layout put every city in an equal cell of a grid whose height
 * was the WHOLE remaining block, and the renderer centred each cell's four
 * small lines inside it. With one city - which is this paper's ordinary case,
 * सातारा - that meant four lines of 12 px type floating in the middle of a
 * 250 px panel with a hand's width of white above and below. Photographed: the
 * desk's report that "havaman is not working" is what a reader sees, and the
 * builder was fetching real Open-Meteo data correctly the whole time.
 *
 * A printed weather box leads with the NUMBER. So one city is set as a proper
 * forecast panel - the place, the condition, then the maximum and minimum as
 * display figures with their own labels, and the rain beneath - and several
 * cities fall back to one compact ruled row each, which is how a paper prints
 * a district table. Both are solved by the same font search.
 */
const HAVAMAN_SOLO_MAX = 1;

function layoutHavaman(data, frame) {
  const cities = Array.isArray(data?.cities) ? data.cities.filter((city) => city && city.name) : [];
  if (!cities.length) return empty('havaman');

  const sourceText = String(data.source || 'स्रोत : Open-Meteo').trim();
  const solo = cities.length <= HAVAMAN_SOLO_MAX;

  // ---- one city: a forecast panel that fills the block --------------------
  if (solo) {
    const city = cities[0];
    const solved = solveFont(frame.innerHeight, (fontPx) => {
      const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
      // The reading the box exists for, set as display figures.
      const figureFontPx = fontPx * 2.6;
      const figureLineHeightPx = lineHeightFor(figureFontPx, 'sans', 700);
      const capFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.82);
      const capLineHeightPx = lineHeightFor(capFontPx, 'sans', 400);
      const sourceFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.76);
      const sourceLineHeightPx = lineHeightFor(sourceFontPx, 'serif', 400);

      const inset = Math.max(3, fontPx * 0.5);
      const width = Math.max(1, frame.innerWidth - inset * 2);
      const halfWidth = Math.max(1, (width - GAP_PX) / 2);

      const place = measureAtomic(city.name, fontPx * 1.25, 'serif', 700, width);
      const condition = wrapSmartText(city.condition || '', {
        width, fontPx, family: 'serif', weight: 400,
      });
      const maxText = `${weatherNumber(city.maxC)}°`;
      const minText = `${weatherNumber(city.minC)}°`;
      const maxFigure = measureAtomic(maxText, figureFontPx, 'sans', 700, halfWidth);
      const minFigure = measureAtomic(minText, figureFontPx, 'sans', 700, halfWidth);
      const rain = wrapSmartText(
        `पाऊस ${weatherNumber(city.rainMm)} मिमी · शक्यता ${weatherNumber(city.rainChance)}%`,
        { width, fontPx, family: 'serif', weight: 400 },
      );
      const source = wrapSmartText(sourceText, {
        width, fontPx: sourceFontPx, family: 'serif', weight: 400,
      });

      const placeHeight = lineHeightFor(fontPx * 1.25, 'serif', 700);
      const conditionLines = condition.lines.map((l) => l.text);
      const rainLines = rain.lines.map((l) => l.text);
      const sourceLines = source.lines.map((l) => l.text);
      const conditionHeight = Math.max(1, conditionLines.length) * lineHeightPx;
      const figureHeight = figureLineHeightPx + capLineHeightPx;
      const rainHeight = Math.max(1, rainLines.length) * lineHeightPx;
      const sourceHeight = Math.max(1, sourceLines.length) * sourceLineHeightPx;

      return {
        height: placeHeight + conditionHeight + GAP_PX + figureHeight + GAP_PX
          + rainHeight + GAP_PX + sourceHeight,
        hardOverset: place.hardOverset || condition.hardOverset || rain.hardOverset
          || source.hardOverset || maxFigure.hardOverset || minFigure.hardOverset,
        solo: true,
        placeLine: place.line,
        placeFontPx: fontPx * 1.25,
        placeHeight,
        conditionLines,
        conditionHeight,
        maxText,
        minText,
        maxLabel: 'कमाल',
        minLabel: 'किमान',
        figureFontPx,
        figureLineHeightPx,
        capFontPx,
        capLineHeightPx,
        figureHeight,
        halfWidth,
        rainLines,
        rainHeight,
        sourceLines,
        sourceFontPx,
        sourceLineHeightPx,
        sourceHeight,
        inset,
        width,
        lineHeightPx,
      };
    }, [22, 20, 18, 16, 14, 12, 11, 10, 9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX]);

    return {
      key: 'havaman',
      fitState: solved.fitState,
      fontPx: solved.fontPx,
      geometry: {
        solo: true,
        columns: 1,
        rows: 1,
        lineHeightPx: solved.lineHeightPx,
        placeFontPx: solved.placeFontPx,
        placeHeight: solved.placeHeight,
        conditionHeight: solved.conditionHeight,
        figureFontPx: solved.figureFontPx,
        figureLineHeightPx: solved.figureLineHeightPx,
        capFontPx: solved.capFontPx,
        capLineHeightPx: solved.capLineHeightPx,
        figureHeight: solved.figureHeight,
        halfWidth: solved.halfWidth,
        rainHeight: solved.rainHeight,
        inset: solved.inset,
        width: solved.width,
        sourceFontPx: solved.sourceFontPx,
        sourceLineHeightPx: solved.sourceLineHeightPx,
        sourceHeight: solved.sourceHeight,
        gap: GAP_PX,
      },
      placeLine: solved.placeLine,
      conditionLines: solved.conditionLines,
      rainLines: solved.rainLines,
      figures: [
        { label: solved.maxLabel, text: solved.maxText, kind: 'max' },
        { label: solved.minLabel, text: solved.minText, kind: 'min' },
      ],
      sourceLines: solved.sourceLines,
      // Kept so a caller written against the old shape still finds a list.
      items: [{ key: city.key || '', name: solved.placeLine }],
      violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
    };
  }

  // ---- several cities: one ruled row each, as a district table ------------
  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const sourceFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.76);
    const sourceLineHeightPx = lineHeightFor(sourceFontPx, 'serif', 400);
    const source = wrapSmartText(sourceText, {
      width: frame.innerWidth, fontPx: sourceFontPx, family: 'serif', weight: 400,
    });
    const sourceLines = source.lines.map((l) => l.text);
    const sourceHeight = Math.max(1, sourceLines.length) * sourceLineHeightPx;

    const nameWidth = frame.innerWidth * 0.36;
    const tempWidth = frame.innerWidth * 0.26;
    const restWidth = Math.max(0, frame.innerWidth - nameWidth - tempWidth);
    const rowPadding = Math.max(1.5, fontPx * 0.28);
    let hardOverset = source.hardOverset;

    const items = cities.map((city) => {
      const name = measureAtomic(city.name, fontPx, 'serif', 700, nameWidth - 4);
      const temp = measureAtomic(
        `${weatherNumber(city.maxC)}° / ${weatherNumber(city.minC)}°`,
        fontPx, 'sans', 700, tempWidth - 4,
      );
      const rest = wrapSmartText(
        `${city.condition || ''} · पाऊस ${weatherNumber(city.rainMm)} मिमी (${weatherNumber(city.rainChance)}%)`,
        { width: restWidth - 4, fontPx, family: 'serif', weight: 400 },
      );
      hardOverset ||= name.hardOverset || temp.hardOverset || rest.hardOverset;
      const restLines = rest.lines.map((l) => l.text);
      return {
        key: city.key || '',
        name: name.line,
        tempText: temp.line,
        restLines,
        rowHeight: Math.max(1, restLines.length) * lineHeightPx + rowPadding * 2,
      };
    });

    const rowsHeight = items.reduce((sum, item) => sum + item.rowHeight, 0);
    return {
      height: rowsHeight + GAP_PX + sourceHeight,
      hardOverset,
      solo: false,
      items,
      lineHeightPx,
      nameWidth,
      tempWidth,
      restWidth,
      rowPadding,
      rowsHeight,
      sourceLines,
      sourceFontPx,
      sourceLineHeightPx,
      sourceHeight,
    };
  }, [16, 14, 12, 11, 10, 9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX]);

  return {
    key: 'havaman',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      solo: false,
      columns: 1,
      rows: cities.length,
      lineHeightPx: solved.lineHeightPx,
      nameWidth: solved.nameWidth,
      tempWidth: solved.tempWidth,
      restWidth: solved.restWidth,
      rowPadding: solved.rowPadding,
      rowsHeight: solved.rowsHeight,
      sourceFontPx: solved.sourceFontPx,
      sourceLineHeightPx: solved.sourceLineHeightPx,
      sourceHeight: solved.sourceHeight,
      gap: GAP_PX,
    },
    items: solved.items,
    sourceLines: solved.sourceLines,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------ market ---

/**
 * THE RATE TABLE A PAPER ACTUALLY PRINTS.
 *
 * Three columns, not two: what it is, what it closed at, and how far it moved
 * - and the move is given BOTH in the instrument's own unit and as a
 * percentage, which is how a market table is set everywhere. The rows are also
 * grouped: निर्देशांक first, then सराफा, with a small head over each, because
 * an index in points and a metal in rupees per १० ग्रॅम are not the same kind
 * of number and a reader should not have to work that out from the label.
 *
 * Every column width here is measured against the REAL widest cell rather than
 * taken as a share of the frame - a fixed 42/35/23 split had the rupee figures
 * (₹१,३८,२९४) running into the change column on a narrow block while the
 * label column stood half empty.
 */
const MARKET_GROUP_LABELS = Object.freeze({ index: 'निर्देशांक', bullion: 'सराफा बाजार' });

function layoutMarket(data, frame) {
  const rows = Array.isArray(data?.items)
    ? data.items.filter((item) => item && item.label && item.value != null).slice(0, 10)
    : [];
  if (!rows.length) return empty('market');

  // Rows in their groups, in the order the groups were first seen, so a
  // payload with no `group` at all still lays out as one plain table.
  const groupOrder = [];
  for (const row of rows) {
    const group = String(row.group || '');
    if (!groupOrder.includes(group)) groupOrder.push(group);
  }
  const grouped = groupOrder.length > 1;

  const solved = solveFont(frame.innerHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const titleFontPx = fontPx * 1.35;
    const titleLineHeightPx = lineHeightFor(titleFontPx, 'serif', 700);
    const headFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.8);
    const headLineHeightPx = lineHeightFor(headFontPx, 'sans', 700);
    const unitFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.72);
    const sourceFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.76);
    const sourceLineHeightPx = lineHeightFor(sourceFontPx, 'serif', 400);
    const rowPadding = Math.max(1.2, fontPx * 0.22);

    const title = wrapSmartText(data.title || 'शेअर / सोने बाजार', {
      width: frame.innerWidth, fontPx: titleFontPx, family: 'serif', weight: 700,
    });
    const asOfText = String(data.asOf || '').trim();
    const asOf = asOfText
      ? measureAtomic(asOfText, headFontPx, 'sans', 400, frame.innerWidth)
      : { line: '', hardOverset: false };

    // THE COLUMNS ARE MEASURED, NOT GUESSED.
    const widest = (pick, weight, size) => rows.reduce(
      (max, row) => Math.max(max, measure(String(pick(row) || ''), size, 'sans', weight)), 0,
    );
    const valueNeeded = widest((r) => r.value, 700, fontPx) + 6;
    const changeNeeded = widest(
      (r) => `\u25BC ${r.delta ? `${r.delta}  ` : ''}${r.change}`, 700, fontPx,
    ) + 6;
    const valueWidth = Math.min(frame.innerWidth * 0.42, valueNeeded);
    const changeWidth = Math.min(frame.innerWidth * 0.3, changeNeeded);
    const labelWidth = Math.max(0, frame.innerWidth - valueWidth - changeWidth);

    let hardOverset = title.hardOverset || asOf.hardOverset;

    const items = rows.map((row) => {
      const label = measureAtomic(row.label, fontPx, 'serif', 700, labelWidth - 4);
      const unitText = row.unit ? `(${row.unit})` : '';
      const unit = unitText
        ? measureAtomic(unitText, unitFontPx, 'sans', 400, labelWidth - 4)
        : { line: '', hardOverset: false };
      const value = measureAtomic(String(row.value), fontPx, 'sans', 700, valueWidth - 4);
      hardOverset ||= label.hardOverset || value.hardOverset || unit.hardOverset;
      // ONE LINE PER ROW.
      //
      // The move was set as two stacked lines - the percentage over the change
      // in the instrument's own unit - and measured in the running DOM that
      // column rendered 40 px inside a 29 px row and bled through the rule
      // into the row below, on every row. A rate table's row is one line; the
      // absolute move joins the percentage on that line when the column can
      // hold both, and is dropped when it cannot, which is what a narrow
      // column does in print rather than stacking.
      const changeOnly = String(row.change || '');
      const withDelta = row.delta ? `${row.delta}  ${changeOnly}` : changeOnly;
      const bothFit = row.delta
        && measure(`\u25BC ${withDelta}`, fontPx, 'sans', 700) <= changeWidth - 4;
      const changeText = bothFit ? withDelta : changeOnly;
      const change = measureAtomic(changeText, fontPx, 'sans', 700, changeWidth - 4);
      hardOverset ||= change.hardOverset;
      return {
        group: String(row.group || ''),
        labelText: label.line,
        // The label's own drawn width, stated here so a writer can set the
        // unit beside it without measuring anything a second time - the rule
        // this module's header records: one measurement authority, never two.
        labelWidthPx: measure(label.line, fontPx, 'serif', 700),
        unitText: unit.line,
        valueText: value.line,
        changeText: change.line,
        deltaText: '',
        direction: row.direction
          || (String(row.change || '').trim().startsWith('-') || String(row.change || '').trim().startsWith('\u2212') ? 'down'
            : String(row.change || '').trim().startsWith('+') ? 'up' : 'flat'),
        rowHeight: lineHeightPx + rowPadding * 2,
      };
    });

    // A group head costs one line of its own.
    const heads = grouped ? groupOrder.length : 0;
    const headHeight = heads * (headLineHeightPx + rowPadding);

    // THE MONTH'S LINE.
    //
    // A rate table says whether today moved; it cannot say whether the month
    // did, and a printed market panel always carries both. The line is solved
    // here - normalised into the panel's own box, as a POLY the way every
    // other chart in this product is (arcPoints() made the same argument for a
    // pie), so the browser and the plate draw one point list rather than two
    // roundings of one curve.
    const trend = data.trend && Array.isArray(data.trend.values) && data.trend.values.length >= 3
      ? data.trend : null;
    const trendLabelFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.8);
    const trendLabelLineHeightPx = lineHeightFor(trendLabelFontPx, 'sans', 700);
    const trendFootFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.72);
    const trendFootLineHeightPx = lineHeightFor(trendFootFontPx, 'sans', 400);
    // The plot is a band, not a square: a month of closes is a shape, and a
    // deep box exaggerates a quiet month into a mountain range.
    const trendPlotHeight = trend ? Math.max(22, Math.min(56, frame.innerWidth * 0.28)) : 0;
    let trendHead = { line: '', hardOverset: false };
    let trendPoints = [];
    let trendArea = [];
    let trendHigh = 0;
    let trendLow = 0;
    let trendAxis = null;
    if (trend) {
      const headText = `${String(data.trendLabel || 'गेल्या महिन्याचा कल')} · ${trend.label || ''}`.trim();
      trendHead = measureAtomic(headText, trendLabelFontPx, 'sans', 700, frame.innerWidth);
      hardOverset ||= trendHead.hardOverset;

      const values = trend.values.map(Number).filter((v) => Number.isFinite(v));
      trendHigh = Math.max(...values);
      trendLow = Math.min(...values);

      // A CHART WITHOUT ITS SCALE IS A DECORATION.
      //
      // The line alone says the month wobbled; it cannot say between what and
      // what, or over which days. The high and the low label the y axis at the
      // two points the reader can actually verify against the rate table above,
      // and the first and last session date label the x axis. Both are
      // measured, so the plot is given the room that is left rather than the
      // labels being laid over the line.
      const highLabel = String(trend.high || '');
      const lowLabel = String(trend.low || '');
      const axisWidth = Math.max(
        measure(highLabel, trendFootFontPx, 'sans', 400),
        measure(lowLabel, trendFootFontPx, 'sans', 400),
      ) + 3;
      const plotWidth = Math.max(1, frame.innerWidth - axisWidth);

      // A flat month is a flat line down the middle, never a division by zero.
      const span = trendHigh - trendLow || 1;
      const stepX = values.length > 1 ? plotWidth / (values.length - 1) : 0;
      trendPoints = values.map((value, index) => ({
        x: axisWidth + index * stepX,
        y: trendPlotHeight - ((value - trendLow) / span) * trendPlotHeight,
      }));
      // The tint under the line is the same point list closed along the foot,
      // so it can never disagree with the line above it.
      trendArea = [
        { x: axisWidth, y: trendPlotHeight },
        ...trendPoints,
        { x: trendPoints[trendPoints.length - 1].x, y: trendPlotHeight },
      ];
      trendAxis = {
        width: axisWidth,
        plotWidth,
        highLabel,
        lowLabel,
        fromLabel: String(trend.from || ''),
        toLabel: String(trend.to || ''),
        changeLabel: String(trend.changePercent || ''),
        sessionsLabel: trend.sessions ? `${devanagariDigits(trend.sessions)} सत्रे` : '',
      };
    }
    const trendHeight = trend
      ? trendLabelLineHeightPx + 2 + trendPlotHeight + 2 + trendFootLineHeightPx
      : 0;

    // NO "मागील सत्र" PARAGRAPH. It restated in prose what the ▲▼ column and
    // the month's line already say in figures, and a rate panel that explains
    // its own table twice is a panel with nothing to add. Removed at the
    // source too - market.js no longer composes the sentence - rather than
    // being left unrendered, which would be a payload nobody reads.
    const noteText = String(data.note || '').trim();
    const noteWrapped = noteText
      ? wrapSmartText(noteText, { width: frame.innerWidth, fontPx: sourceFontPx, family: 'serif', weight: 400 })
      : { lines: [], hardOverset: false };
    const source = wrapSmartText(data.source || 'स्रोत : संपादकीय पडताळणी', {
      width: frame.innerWidth, fontPx: sourceFontPx, family: 'serif', weight: 400,
    });
    hardOverset ||= noteWrapped.hardOverset || source.hardOverset;

    const titleLines = title.lines.map((line) => line.text);
    const noteLines = noteWrapped.lines.map((line) => line.text);
    const sourceLines = source.lines.map((line) => line.text);

    const titleHeight = Math.max(1, titleLines.length) * titleLineHeightPx
      + (asOf.line ? headLineHeightPx : 0);
    const rowsHeight = items.reduce((sum, item) => sum + item.rowHeight, 0) + headHeight;
    const noteHeight = noteLines.length * sourceLineHeightPx;
    const sourceHeight = Math.max(1, sourceLines.length) * sourceLineHeightPx;

    // title -> table, table -> chart, chart/note -> source. The note rides
    // against the chart above it (it is that chart's own caveat), so it does
    // not open a gap of its own.
    const gapCount = 2 + (trendHeight ? 1 : 0);
    return {
      height: titleHeight + GAP_PX + rowsHeight
        + (trendHeight ? GAP_PX + trendHeight : 0)
        + (noteHeight ? 2 + noteHeight : 0)
        + GAP_PX + sourceHeight,
      gapCount,
      hardOverset,
      items,
      titleLines,
      asOfLine: asOf.line,
      sourceLines,
      noteLines,
      titleHeight,
      sourceHeight,
      noteHeight,
      headHeight,
      trendHeadLine: trendHead.line,
      trendAxis,
      trendPoints,
      trendArea,
      trendHeight,
      trendPlotHeight,
      trendLabelFontPx,
      trendLabelLineHeightPx,
      trendFootFontPx,
      trendFootLineHeightPx,
      trendHigh,
      trendLow,
      titleFontPx,
      titleLineHeightPx,
      headFontPx,
      headLineHeightPx,
      unitFontPx,
      sourceFontPx,
      sourceLineHeightPx,
      lineHeightPx,
      labelWidth,
      valueWidth,
      changeWidth,
      rowPadding,
      rowsHeight,
    };
  }, [14, 12, 11, 10, 9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX]);

  // THE CHART TAKES THE ROOM THAT IS LEFT.
  //
  // solveFont() stops at the largest type that fits, and on a whole-leg block
  // that leaves the panel finishing at little over half its own depth - a
  // 307x620 market column measured 55% set, with the rest white. A printed
  // market panel does not answer that by inflating its rate table; it draws a
  // bigger chart, which is the one element on the card whose whole job is to
  // use height.
  //
  // The points are already normalised into the plot box, so growing it is a
  // proportional rescale of their y - no re-measurement, no re-wrap, and the
  // line the browser draws is still the line the plate draws.
  // THE ROOM LEFT OVER IS SPREAD, NOT STACKED.
  //
  // Two goes at this were wrong in the same way. Giving the WHOLE residual of
  // a 620px leg to the chart drew a 0.9% month as a mountain range. Capping
  // the chart and centring what was left put ~55px of white between the
  // panel's own top rule and its title - a hole at the head of the box, which
  // is the first thing a reader meets and the desk reported it at once.
  //
  // A compositor opens the LEADING. So the chart takes what it can carry, and
  // the rest opens the gaps BETWEEN the bands evenly - title to table, table
  // to chart, chart to note, note to source - up to a gap of its own. Anything
  // still left is a genuine hole and sits at the FOOT, where a printed panel
  // can carry it; never at the head.
  const residual = Math.max(0, frame.innerHeight - solved.height);
  const plotCeiling = frame.innerWidth * MAX_TREND_PLOT_OF_WIDTH;
  const grownPlotHeight = solved.trendPoints.length
    ? Math.min(plotCeiling, solved.trendPlotHeight + residual)
    : solved.trendPlotHeight;
  const scaleY = solved.trendPlotHeight > 0 ? grownPlotHeight / solved.trendPlotHeight : 1;
  const grow = (points) => points.map((pt) => ({ x: pt.x, y: pt.y * scaleY }));

  const spare = Math.max(0, residual - (grownPlotHeight - solved.trendPlotHeight));
  const gapCount = solved.gapCount || 1;
  const gap = Math.min(GAP_PX * MAX_BAND_GAP_GROWTH, GAP_PX + spare / gapCount);

  return {
    key: 'market',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      grouped,
      groupOrder,
      groupLabels: MARKET_GROUP_LABELS,
      titleHeight: solved.titleHeight,
      sourceHeight: solved.sourceHeight,
      noteHeight: solved.noteHeight,
      titleFontPx: solved.titleFontPx,
      titleLineHeightPx: solved.titleLineHeightPx,
      headFontPx: solved.headFontPx,
      headLineHeightPx: solved.headLineHeightPx,
      unitFontPx: solved.unitFontPx,
      unitLineHeightPx: lineHeightFor(solved.unitFontPx, 'sans', 400),
      sourceFontPx: solved.sourceFontPx,
      sourceLineHeightPx: solved.sourceLineHeightPx,
      lineHeightPx: solved.lineHeightPx,
      labelWidth: solved.labelWidth,
      valueWidth: solved.valueWidth,
      changeWidth: solved.changeWidth,
      rowPadding: solved.rowPadding,
      rowsHeight: solved.rowsHeight,
      headHeight: solved.headHeight,
      gap,
      trendHeight: solved.trendHeight + (grownPlotHeight - solved.trendPlotHeight),
      trendPlotHeight: grownPlotHeight,
      trendLabelFontPx: solved.trendLabelFontPx,
      trendLabelLineHeightPx: solved.trendLabelLineHeightPx,
      trendFootFontPx: solved.trendFootFontPx,
      trendFootLineHeightPx: solved.trendFootLineHeightPx,
      // (the resolved band gap is set above; GAP_PX is only its floor)
    },
    trend: solved.trendPoints.length ? {
      headLine: solved.trendHeadLine,
      axis: solved.trendAxis,
      points: grow(solved.trendPoints),
      area: grow(solved.trendArea),
      plotHeight: grownPlotHeight,
      width: frame.innerWidth,
      ink: chartInk(data),
    } : null,
    titleLines: solved.titleLines,
    asOfLine: solved.asOfLine,
    sourceLines: solved.sourceLines,
    noteLines: solved.noteLines,
    items: solved.items,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

// ------------------------------------------------------------------ tender ---

/**
 * A PRINTED प्रकटपत्र, IN ITS OWN BANDS.
 *
 * The reference the desk supplied is a real Maharashtra government notice as
 * this paper printed it, and its shape is not decoration - a reader and a
 * pleader both look for the same things in the same places:
 *
 *   महाराष्ट्र शासन                      issuer, over
 *   उपजिल्हाधिकारी (भूसंपादन) क्र. २१      the office, centred
 *   ────────────────────────────────
 *   Email ID : ...            पत्ता :- ...   a ruled band, two ends
 *   ────────────────────────────────
 *   क्रमांक: ...         सातारा. दिनांक- ...  a second ruled band
 *   ────────────────────────────────
 *   भुमि संपादन अधिनियम ... कलम २१          the legal subject, centred
 *              प्रकटपत्र                    the title, large, centred
 *   body paragraphs, justified, indented
 *              परिशिष्ट                    the appendix title
 *   गाव- ...     तालुका- ...     जिल्हा- ...  group heads over the table
 *   [ the ruled table ]
 *   ठिकाण :- ...                             place and date, left
 *   दिनांक :- ...                  प्रवीण साळुंके      signatory, right
 *                                   उपजिल्हाधिकारी      designation
 *   जिमाका /सातारा/ ...                        footer note, left
 *
 * The previous layout had the fields but not the bands: contact sat at the
 * foot as one plain line, there was no place/date pair, no appendix title, no
 * group heads and no signature block - so a desk got a notice that carried the
 * facts and did not look like the thing it is.
 */

// The formal rule, cell borders and fixed 2 px inner inset are real vertical
// ink in the browser. They do not belong to any text line, but they still
// consume the notice frame. Measured against the rendered DOM at the largest
// fitting candidate, 20 px is the complete non-type allowance; charging it
// here prevents a mathematically FITS notice from clipping its signature.
const TENDER_RENDER_ALLOWANCE_PX = 20;

// THE NOTICE'S OWN FRAME IS REAL WIDTH, TOO.
//
// `.smart-card-tender` draws a 0.8 px rule and insets its type 2 px inside it,
// on all four sides - so the corridor the copy actually has is 5.6 px narrower
// than the block's content box. The solver measured against the full width and
// every wrapped line came out 5.6 px too long: photographed on a real notice,
// the right-hand end of every paragraph and the date band ran under the rule
// and off the card. Charged here so the measured width is the drawn width.
const TENDER_FRAME_INSET_PX = 2 + 0.8;

function layoutTender(data, frame) {
  if (!data?.issuer || (!data?.subject && !Array.isArray(data?.paragraphs))) return empty('tender');
  const paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs.filter(Boolean).slice(0, 12) : [];
  const tableHeaders = Array.isArray(data?.table?.headers) ? data.table.headers.filter((cell) => cell != null).slice(0, 6) : [];
  const tableRows = tableHeaders.length && Array.isArray(data?.table?.rows)
    ? data.table.rows.filter(Array.isArray).slice(0, 20) : [];
  const tableGroups = Array.isArray(data?.tableGroups)
    ? data.tableGroups.filter(Boolean).slice(0, 4) : [];

  // The corridor inside the notice's own rule and inset.
  const noticeWidth = Math.max(1, frame.innerWidth - TENDER_FRAME_INSET_PX * 2);

  const solved = solveFont(frame.innerHeight - TENDER_FRAME_INSET_PX * 2, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const strongLineHeightPx = lineHeightFor(fontPx, 'serif', 700);
    const issuerFontPx = fontPx * 1.18;
    const issuerLineHeightPx = lineHeightFor(issuerFontPx, 'serif', 700);
    const titleFontPx = fontPx * 1.9;
    const titleLineHeightPx = lineHeightFor(titleFontPx, 'serif', 700);
    const smallFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.88);
    const smallLineHeightPx = lineHeightFor(smallFontPx, 'serif', 400);
    const gap = Math.max(2, fontPx * 0.45);
    // A notice's paragraphs are set justified with an opening indent, the same
    // way this paper sets its running copy.
    const indentPx = fontPx * 1.6;
    const bandPadY = Math.max(1.5, fontPx * 0.25);
    let hardOverset = false;
    const band = (text, width, size, weight = 400) => {
      const wrapped = wrapSmartText(text || '', { width, fontPx: size, family: 'serif', weight });
      hardOverset ||= wrapped.hardOverset;
      return wrapped.lines.map((line) => line.text);
    };

    const issuerLines = band(data.issuer, noticeWidth, issuerFontPx, 700);
    const officeLines = band(data.office, noticeWidth, fontPx, 700);

    // Two ruled bands, each with a left end and a right end.
    //
    // THE BAND IS SPLIT BY WHAT ITS TWO ENDS NEED, NOT DOWN THE MIDDLE.
    // A Latin email address is long and a पत्ता is usually short, so a flat
    // half broke "Email ID : slaomo21satara@gmail.com" onto a second line
    // while the address half sat with room to spare - photographed on the
    // notice, and it reads as a misaligned label because a wrapped
    // continuation is not where the eye expects the value. Each end is
    // measured; if both fit the band they get what they asked for, and only a
    // genuinely over-long pair falls back to halves.
    const halfWidth = Math.max(0, (noticeWidth - gap) / 2);
    const emailText = data.email ? `Email ID : ${data.email}` : '';
    const addressText = data.address ? `पत्ता :- ${data.address}` : '';
    const emailNeeds = emailText ? measure(emailText, smallFontPx, 'serif', 400) + 2 : 0;
    const addressNeeds = addressText ? measure(addressText, smallFontPx, 'serif', 400) + 2 : 0;
    const contactFits = emailNeeds + addressNeeds <= noticeWidth - gap;
    // When both ends are long the address can WRAP and the email cannot - it
    // is one unbreakable Latin run - so the email keeps what it needs up to
    // most of the band and the address takes the rest over two lines. Split
    // down the middle, "Email ID : …@gmail.com" broke after the label and the
    // value sat on a line of its own, which is what the desk saw.
    const EMAIL_MAX_SHARE = 0.62;
    const emailWidth = contactFits
      ? Math.max(emailNeeds, 1)
      : Math.max(halfWidth, Math.min(emailNeeds, (noticeWidth - gap) * EMAIL_MAX_SHARE));
    const addressWidth = Math.max(1, noticeWidth - gap - emailWidth);
    const emailLines = band(emailText, emailWidth, smallFontPx, 400);
    const addressLines = band(addressText, addressWidth, smallFontPx, 400);
    const referenceLines = band(data.reference, halfWidth, smallFontPx, 400);
    const dateLines = band(data.date, halfWidth, smallFontPx, 400);

    const subjectLines = band(data.subject, noticeWidth, fontPx, 700);
    const titleLines = band(data.noticeTitle || 'प्रकटपत्र', noticeWidth, titleFontPx, 700);

    // The first line of a paragraph is indented, so it is measured narrower.
    const paragraphItems = paragraphs.map((text) => {
      const wrapped = wrapSmartText(text || '', {
        width: Math.max(1, noticeWidth - indentPx), fontPx, family: 'serif', weight: 400,
      });
      hardOverset ||= wrapped.hardOverset;
      const lines = wrapped.lines.map((line) => line.text);
      return { lines, height: lines.length * lineHeightPx, indentPx };
    });

    const columnCount = Math.max(1, tableHeaders.length);
    const columnWidth = noticeWidth / columnCount;
    const cellPadX = Math.max(1.5, fontPx * 0.22);
    const resolveCells = (cells, weight) => {
      const resolved = Array.from({ length: columnCount }, (_, index) =>
        band(cells[index] || '', Math.max(0, columnWidth - cellPadX * 2), fontPx, weight));
      return {
        cells: resolved,
        height: Math.max(1, ...resolved.map((lines) => lines.length)) * lineHeightPx + bandPadY * 2,
      };
    };
    const tableTitleLines = tableHeaders.length && data.tableTitle
      ? band(data.tableTitle, noticeWidth, fontPx, 700) : [];
    const groupWidth = tableGroups.length ? noticeWidth / tableGroups.length : 0;
    const groupLines = tableGroups.map((text) => band(text, Math.max(0, groupWidth - 4), fontPx, 700));
    const groupHeight = groupLines.length
      ? Math.max(1, ...groupLines.map((lines) => lines.length)) * strongLineHeightPx + bandPadY
      : 0;
    const table = tableHeaders.length ? {
      columnCount, columnWidth, cellPadX,
      header: resolveCells(tableHeaders, 700),
      rows: tableRows.map((row) => resolveCells(row, 400)),
    } : null;

    // The close: place and date on the left, the signature block on the right.
    const placeLines = band(data.place ? `ठिकाण :- ${data.place}` : '', halfWidth, fontPx, 400);
    const noticeDateLines = band(data.noticeDate ? `दिनांक :- ${data.noticeDate}` : '', halfWidth, fontPx, 400);
    const signatoryLines = band(data.signatory, halfWidth, fontPx, 700);
    const designationLines = band(data.signatoryDesignation, halfWidth, smallFontPx, 400);
    const signOfficeLines = band(data.signatoryOffice, halfWidth, smallFontPx, 400);
    const contactLines = band(data.contact, noticeWidth, smallFontPx, 400);
    const footerLines = band(data.footerNote, noticeWidth, smallFontPx, 400);

    const lineBlock = (lines, lineHeight) => lines.length * lineHeight;
    const contactBandHeight = (emailLines.length || addressLines.length)
      ? Math.max(emailLines.length, addressLines.length) * smallLineHeightPx + bandPadY * 2 : 0;
    const referenceBandHeight = (referenceLines.length || dateLines.length)
      ? Math.max(referenceLines.length, dateLines.length) * smallLineHeightPx + bandPadY * 2 : 0;
    const tableHeight = table ? table.header.height + table.rows.reduce((sum, row) => sum + row.height, 0) : 0;
    const closeLeft = lineBlock(placeLines, lineHeightPx) + lineBlock(noticeDateLines, lineHeightPx);
    const closeRight = lineBlock(signatoryLines, strongLineHeightPx)
      + lineBlock(designationLines, smallLineHeightPx)
      + lineBlock(signOfficeLines, smallLineHeightPx);
    const closeHeight = Math.max(closeLeft, closeRight);

    const height = lineBlock(issuerLines, issuerLineHeightPx)
      + lineBlock(officeLines, strongLineHeightPx)
      + contactBandHeight
      + referenceBandHeight
      + gap
      + lineBlock(subjectLines, strongLineHeightPx)
      + lineBlock(titleLines, titleLineHeightPx)
      + gap
      + paragraphItems.reduce((sum, item) => sum + item.height + gap, 0)
      + (tableTitleLines.length ? lineBlock(tableTitleLines, strongLineHeightPx) : 0)
      + groupHeight
      + (tableHeight ? tableHeight + gap : 0)
      + lineBlock(contactLines, smallLineHeightPx)
      + (closeHeight ? closeHeight + gap : 0)
      + lineBlock(footerLines, smallLineHeightPx)
      + gap * 2
      + TENDER_RENDER_ALLOWANCE_PX;

    return {
      height, hardOverset, issuerLines, officeLines, emailLines, addressLines,
      emailWidth, addressWidth,
      referenceLines, dateLines, subjectLines, titleLines, paragraphItems,
      tableTitleLines, groupLines, groupHeight, groupWidth, table,
      placeLines, noticeDateLines, signatoryLines, designationLines, signOfficeLines,
      contactLines, footerLines,
      contactBandHeight, referenceBandHeight, closeHeight, halfWidth,
      lineHeightPx, strongLineHeightPx, smallFontPx, smallLineHeightPx,
      issuerFontPx, issuerLineHeightPx, titleFontPx, titleLineHeightPx,
      gap, indentPx, bandPadY, cellPadX,
    };
  });

  return {
    key: 'tender', fitState: solved.fitState, fontPx: solved.fontPx,
    geometry: {
      lineHeightPx: solved.lineHeightPx, strongLineHeightPx: solved.strongLineHeightPx,
      smallFontPx: solved.smallFontPx, smallLineHeightPx: solved.smallLineHeightPx,
      issuerFontPx: solved.issuerFontPx, issuerLineHeightPx: solved.issuerLineHeightPx,
      titleFontPx: solved.titleFontPx, titleLineHeightPx: solved.titleLineHeightPx,
      gap: solved.gap, indentPx: solved.indentPx, bandPadY: solved.bandPadY,
      // The contact band's two ends, split by what each needs rather than
      // down the middle. The reference band below it stays on halves - a
      // number and a date are both short.
      emailWidth: solved.emailWidth, addressWidth: solved.addressWidth,
      cellPadX: solved.cellPadX, halfWidth: solved.halfWidth,
      noticeWidth, frameInsetPx: TENDER_FRAME_INSET_PX,
      contactBandHeight: solved.contactBandHeight,
      referenceBandHeight: solved.referenceBandHeight,
      groupHeight: solved.groupHeight, groupWidth: solved.groupWidth,
      closeHeight: solved.closeHeight,
    },
    issuerLines: solved.issuerLines, officeLines: solved.officeLines,
    emailLines: solved.emailLines, addressLines: solved.addressLines,
    referenceLines: solved.referenceLines, dateLines: solved.dateLines,
    subjectLines: solved.subjectLines, titleLines: solved.titleLines,
    paragraphItems: solved.paragraphItems,
    tableTitleLines: solved.tableTitleLines, groupLines: solved.groupLines,
    table: solved.table,
    placeLines: solved.placeLines, noticeDateLines: solved.noticeDateLines,
    signatoryLines: solved.signatoryLines, designationLines: solved.designationLines,
    signOfficeLines: solved.signOfficeLines,
    contactLines: solved.contactLines, footerLines: solved.footerLines,
    violations: solved.fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

/**
 * A DISPLAY ADVERTISEMENT.
 *
 * The one card on this paper whose words are not the newspaper's own, and it
 * is set the way an advert desk sets one: a ruled panel, the advertiser's
 * name as a small head, the shout line as large as the panel will carry, a
 * standfirst under it, the detail as short lines, the offer in a reversed
 * flash, and the contact on a rule at the foot. The artwork - supplied or
 * generated - takes a share of the panel at the top and the type sets under
 * it, so the advert reads as one object rather than a picture with words
 * beside it.
 *
 * Every band is optional. An advert with nothing but a name and a telephone
 * number is a real advert and must set cleanly.
 */
const ADVERT_IMAGE_SHARE = 0.42;

function layoutAdvert(data, frame) {
  const headlineText = String(data?.headline || '').trim();
  const advertiserText = String(data?.advertiser || '').trim();
  const lines = Array.isArray(data?.lines) ? data.lines.filter(Boolean).slice(0, 8) : [];
  if (!headlineText && !advertiserText && !lines.length) return empty('advert');

  const imageUrl = String(data?.imageUrl || '').trim();
  const inset = Math.max(3, frame.innerWidth * 0.035);
  const measureWidth = Math.max(1, frame.innerWidth - inset * 2);
  // The picture's own share of the panel, reserved before the type is solved
  // so the words are never measured against room the artwork is holding.
  const imageHeight = imageUrl ? Math.round(frame.innerHeight * ADVERT_IMAGE_SHARE) : 0;
  const typeHeight = Math.max(0, frame.innerHeight - imageHeight);

  const solved = solveFont(typeHeight, (fontPx) => {
    const lineHeightPx = lineHeightFor(fontPx, 'serif', 400);
    const shoutFontPx = fontPx * 2.1;
    const shoutLineHeightPx = lineHeightFor(shoutFontPx, 'sans', 700);
    const nameFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.92);
    const nameLineHeightPx = lineHeightFor(nameFontPx, 'sans', 700);
    const standFontPx = fontPx * 1.1;
    const standLineHeightPx = lineHeightFor(standFontPx, 'serif', 400);
    const smallFontPx = Math.max(MIN_CARD_FONT_PX, fontPx * 0.86);
    const smallLineHeightPx = lineHeightFor(smallFontPx, 'sans', 400);
    const rowGap = Math.max(1.5, fontPx * 0.28);

    const wrap = (text, size, family, weight) => wrapSmartText(String(text || ''), {
      width: measureWidth, fontPx: size, family, weight,
    });

    const name = wrap(advertiserText, nameFontPx, 'sans', 700);
    const shout = wrap(headlineText, shoutFontPx, 'sans', 700);
    const stand = wrap(data?.subheadline, standFontPx, 'serif', 400);
    const detail = lines.map((text) => wrap(text, fontPx, 'serif', 400));
    const offer = wrap(data?.offer, fontPx, 'sans', 700);
    const contact = wrap(data?.contact, smallFontPx, 'sans', 700);
    const address = wrap(data?.address, smallFontPx, 'sans', 400);
    const footer = wrap(data?.footer, smallFontPx, 'serif', 400);

    const hardOverset = [name, shout, stand, offer, contact, address, footer, ...detail]
      .some((wrapped) => wrapped.hardOverset);

    const nameLines = name.lines.map((l) => l.text);
    const shoutLines = shout.lines.map((l) => l.text);
    const standLines = stand.lines.map((l) => l.text);
    const detailLines = detail.flatMap((wrapped) => wrapped.lines.map((l) => l.text));
    const offerLines = offer.lines.map((l) => l.text);
    const contactLines = contact.lines.map((l) => l.text);
    const addressLines = address.lines.map((l) => l.text);
    const footerLines = footer.lines.map((l) => l.text);

    const offerHeight = offerLines.length ? offerLines.length * lineHeightPx + rowGap * 2 : 0;
    const height = nameLines.length * nameLineHeightPx
      + (shoutLines.length ? rowGap + shoutLines.length * shoutLineHeightPx : 0)
      + (standLines.length ? standLines.length * standLineHeightPx : 0)
      + (detailLines.length ? rowGap + detailLines.length * lineHeightPx : 0)
      + (offerHeight ? rowGap + offerHeight : 0)
      + (contactLines.length ? rowGap + contactLines.length * smallLineHeightPx : 0)
      + addressLines.length * smallLineHeightPx
      + (footerLines.length ? rowGap + footerLines.length * smallLineHeightPx : 0);

    return {
      height, hardOverset,
      nameLines, shoutLines, standLines, detailLines, offerLines,
      contactLines, addressLines, footerLines,
      lineHeightPx, shoutFontPx, shoutLineHeightPx, nameFontPx, nameLineHeightPx,
      standFontPx, standLineHeightPx, smallFontPx, smallLineHeightPx,
      offerHeight, rowGap,
    };
  }, [24, 20, 18, 16, 14, 12, 11, 10, 9, 8, 7.5, 7, 6.5, 6, MIN_CARD_FONT_PX]);

  return {
    key: 'advert',
    fitState: solved.fitState,
    fontPx: solved.fontPx,
    geometry: {
      inset,
      measureWidth,
      imageUrl,
      imageHeight,
      typeHeight,
      lineHeightPx: solved.lineHeightPx,
      shoutFontPx: solved.shoutFontPx,
      shoutLineHeightPx: solved.shoutLineHeightPx,
      nameFontPx: solved.nameFontPx,
      nameLineHeightPx: solved.nameLineHeightPx,
      standFontPx: solved.standFontPx,
      standLineHeightPx: solved.standLineHeightPx,
      smallFontPx: solved.smallFontPx,
      smallLineHeightPx: solved.smallLineHeightPx,
      offerHeight: solved.offerHeight,
      rowGap: solved.rowGap,
      aiArtwork: Boolean(data?.aiArtwork),
    },
    nameLines: solved.nameLines,
    shoutLines: solved.shoutLines,
    standLines: solved.standLines,
    detailLines: solved.detailLines,
    offerLines: solved.offerLines,
    contactLines: solved.contactLines,
    addressLines: solved.addressLines,
    footerLines: solved.footerLines,
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
  havaman: layoutHavaman,
  market: layoutMarket,
  tender: layoutTender,
  advert: layoutAdvert,
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
  const normalKey = String(key || '');
  const fn = LAYOUTS[normalKey];
  if (!fn) return empty(String(key || ''));

  const clamped = clampFrame(frame);
  const { artwork, content, band, borderBox } = cardArtworkFor(normalKey, clamped);
  const frameFor = (width) => ({
    width,
    height: content.height,
    padding: 0,
    innerWidth: width,
    innerHeight: content.height,
    // A 'middle' nameplate takes a band out of the card's own middle rather
    // than off its top, so the card is told about it and leaves the gap where
    // its rows fall. Absent for every other placement.
    band: band || null,
  });
  const solveAt = (width) => {
    const contentFrame = frameFor(width);
    const subtitle = solveSubtitle(data?.subtitle, contentFrame);
    const bodyFrame = { ...contentFrame, innerHeight: Math.max(0, contentFrame.innerHeight - subtitle.height) };
    return { contentFrame, subtitle, result: fn(data, bodyFrame) };
  };

  let contentWidth = content.width;
  let { contentFrame, subtitle, result } = solveAt(contentWidth);
  if (result.fitState === 'EMPTY') return result;

  // A LEAD-IN MARK IS SET TO THE LINE, SO ITS FOOTPRINT IS NOT KNOWN UNTIL
  // THE LINE IS.
  //
  // cardArtworkFor() can only reserve an `inline` mark from a share of the
  // frame, and सुविचार then sets it to the line of type it opens - so on a
  // strip only a line or two deep the reserved box was SMALLER than the line
  // (measured on a 620x36 strip: mark 16px against a 23.8px line) and the two
  // no longer shared a height, which is the whole reason their tops agree.
  // One correction pass: the mark's real footprint is worked out from the
  // resolved line and the card is solved again against the measure that
  // actually leaves. Bounded at one, like the subtitle pass above it.
  const markConfig = CARD_ARTWORK[normalKey];
  const markGap = artwork ? content.x - (artwork.x + artwork.width) : 0;
  const availWidth = artwork ? content.x + content.width - artwork.x : content.width;
  if (artwork && markConfig?.placement === 'inline') {
    const wanted = Math.min(Number(result.geometry?.markHeightPx) || 0, content.height);
    const wantWidth = wanted > 0
      ? Math.max(1, availWidth - wanted * markConfig.aspect - markGap)
      : contentWidth;
    if (Math.abs(wantWidth - contentWidth) > 1) {
      const restated = solveAt(wantWidth);
      if (restated.result.fitState !== 'EMPTY') {
        contentWidth = wantWidth;
        ({ contentFrame, subtitle, result } = restated);
      }
    }
  }

  // A SUBTITLE MAY NOT OUTRANK THE CARD IT LABELS.
  //
  // The height share alone does not settle this: on a 149x275 stat card a
  // one-line subtitle at 28 px is well inside 28% of the frame, and the
  // figures it introduces resolved to 26.4 px - so the label was the largest
  // type on the card and the statistics were the second largest. Photographed
  // on page six of a six-page edition.
  //
  // The card's own resolved size is not known until its body has been solved,
  // which is why this is a second pass rather than a bound handed to
  // solveSubtitle() up front. Exactly one extra pass, and only when the
  // subtitle is actually too big: capping it frees room, so the body can only
  // get larger and never oversets on the strength of this.
  const cap = result.fontPx * MAX_SUBTITLE_OF_BODY;
  if (subtitle.fontPx > cap) {
    subtitle = solveSubtitle(data?.subtitle, contentFrame, cap);
    const bodyFrame = { ...contentFrame, innerHeight: Math.max(0, contentFrame.innerHeight - subtitle.height) };
    const restated = fn(data, bodyFrame);
    if (restated.fitState !== 'EMPTY') result = restated;
  }

  const fitState = subtitle.hardOverset || result.fitState === 'OVERSET' ? 'OVERSET' : 'FITS';
  // A CARD MAY SIZE ITS OWN MARK TO THE TYPE IT OPENS.
  //
  // cardArtworkFor() has to reserve the mark's box BEFORE the card is solved,
  // so it can only work from shares of the frame. सुविचार's strip knows better
  // once its line height is resolved: a lead-in mark set to the line it opens
  // puts its top on the words' top, because the two are centred in the same
  // box. Shrinking it can only give the quote more measure, never less, so
  // nothing recomposes.
  const markHeight = Math.min(Number(result.geometry?.markHeightPx) || 0, content.height);
  // Placed against the CONTENT box, not against the artwork's own reserved
  // rectangle. The quote is centred in the content box, so centring the mark in
  // that same box is what actually puts the two tops on one line - centring it
  // in the frame instead left it 8px low, measured in the DOM (mark centre 43,
  // line centre 35).
  let sized = artwork && markHeight > 0 && markHeight !== artwork.height
    ? {
      ...artwork,
      width: artwork.width * (markHeight / artwork.height),
      height: markHeight,
      y: content.y + (content.height - markHeight) / 2,
    }
    : artwork;
  let contentBox = { ...content, width: contentWidth };

  // A LEAD-IN MARK AND THE LINE IT OPENS ARE ONE CENTRED GROUP.
  //
  // The mark is reserved at the content box's left edge before the card is
  // solved, and a strip then centres its row in what is left - so on a 618px
  // strip the mark sat at x=0 hard against the card's rule and the first word
  // began 77px away. Once the row's own drawn width is known the two are set
  // down together: mark, gap, row, centred in the box they share. Only the
  // horizontal moves, so the mark stays on the row's own line.
  const rowWidth = Number(result.geometry?.stripRowWidthPx) || 0;
  if (sized && rowWidth > 0 && markConfig?.placement === 'inline') {
    // A hair over the shaped measure: the browser draws a nowrap line from the
    // same advances but rounds where HarfBuzz does not, and a box cut to the
    // exact number would centre a line half a pixel wider than itself.
    const rowBox = rowWidth + 2;
    // THE LINE IS THE CARD; THE MARK YIELDS TO IT.
    //
    // The correction pass above narrows the measure by the mark's real
    // footprint and the card re-solves against it, but the two need not land
    // on the same size in one pass - and when they do not it is the mark that
    // gives way, never the words. Without this the row was cut to the room
    // left over and its nowrap line ran 7px past a card that clips.
    const markRoom = Math.max(0, availWidth - markGap - rowBox);
    if (sized.width > markRoom) {
      sized = {
        ...sized,
        width: markRoom,
        height: sized.height * (markRoom / sized.width),
        y: content.y + (content.height - sized.height * (markRoom / sized.width)) / 2,
      };
    }
    const groupWidth = sized.width + markGap + rowBox;
    const left = artwork.x + Math.max(0, (availWidth - groupWidth) / 2);
    sized = { ...sized, x: left };
    contentBox = { x: left + sized.width + markGap, y: content.y, width: rowBox, height: content.height };
  }

  return {
    ...result,
    artwork: sized,
    contentBox,
    // The rectangle this card's own rule follows: the BLOCK's own edge, so the
    // four sides are the same rule at the same distance from the paper's grid
    // whatever furniture the card puts inside itself. Null when the card is
    // unruled, and then nothing is drawn.
    borderBox: borderBox || null,
    subtitle,
    fitState,
    exactShaping: isShaperReady(),
    violations: fitState === 'OVERSET' ? ['SMART_CARD_OVERSET'] : [],
  };
}

/**
 * THE BLOCK A CARD WANTS, WHEN IT IS BRINGING ITS OWN.
 *
 * A Smart Card used to be poured into whatever block the desk had already
 * selected, which put the work in the wrong order: a sub-editor had to go and
 * find - or make, and size - a frame before they could see what the card even
 * looked like. The desk's report: "rather than fixing smart blocks at layout,
 * after generating a smart block it will generate a new block with all data
 * already filled in."
 *
 * So each card states the frame a printed paper actually gives it, in block
 * pixels (2 px = 1 mm). These are the shapes, not arbitrary numbers:
 *
 *   panchang / rashi   a tall single column - a table read down
 *   suvichar           a wide, shallow strip - one quote across a measure
 *   dinvishesh         the same strip, a little deeper for two entries
 *   sudoku             SQUARE, because the puzzle is
 *   havaman / market   a single column panel
 *   tender             a whole leg of a page - a statutory notice is long
 *   advert             a display rectangle, the commonest booked size
 *
 * A caller may still override; this is the default a desk gets for free.
 */
export const SMART_CARD_BLOCK_SIZE = Object.freeze({
  // Sized from what each card IS on a printed page, not from what its data
  // happens to need on one day. A standing almanac box is small and square-ish;
  // the horoscope and the market panel are whole legs of a page; a सुविचार is
  // a one-line strip across the top of a column.
  // 205: measured, the five rows solve to the same 14px type at 205 as at 232
  // and leave 6.7px of slack instead of 27. The extra sat INSIDE the almanac's
  // own double ring and read as a sixth, empty row - photographed on the page.
  panchang: { width: 148, height: 205 },
  rashi: { width: 307, height: 620 },
  // ONE LINE TALL, AND THE WIDTH OF THE PAGE.
  //
  // A thought for the day is a rule of type across the head of the sheet, and
  // this asked for a 307px leg 72px deep - room for three lines of a thing
  // that sets in one. Photographed on the page: a 23.8px line centred in 67px
  // of content, with the rest white. 620 is the paper's own full measure, and
  // 32 is that line plus the card's rule and a hair of air either side.
  suvichar: { width: 620, height: 32 },
  // Wider than it was: the name now runs ACROSS the head of the box rather
  // than standing in a column of it, and a 190px box gives that mark too
  // little measure to be read as a nameplate.
  dinvishesh: { width: 268, height: 160 },
  sudoku: { width: 232, height: 268 },
  // 168, not 210: measured, the forecast panel solves to the same 9px type at
  // 160 as at 210, so the extra 50px was air the panel then centred its
  // content in - which is the desk's "too much gap between सातारा and स्रोत".
  havaman: { width: 148, height: 168 },
  market: { width: 307, height: 620 },
  tender: { width: 300, height: 620 },
  advert: { width: 268, height: 300 },
  chart: { width: 268, height: 240 },
});

export function smartCardBlockSize(key) {
  return SMART_CARD_BLOCK_SIZE[String(key || '')] || { width: 268, height: 260 };
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

  // AND CLEAR OF WHATEVER THE COPY WAS SET CLEAR OF.
  //
  // Running copy meets an obstacle one scanline at a time - that is what the
  // whole engine does, and why a photograph costs it nothing but an interval.
  // A Smart Card cannot: it is solved as a GRID, so a sudoku's nine columns
  // or a chart's bars are placed against the frame as a whole and there is no
  // scanline for a silhouette to narrow. A page overlay laid across a card
  // block therefore left the card's geometry untouched and simply COVERED it,
  // while the prose blocks either side of it set clear correctly.
  //
  // So the card is given the largest clear rectangle instead. Per obstacle,
  // the four rectangles that avoid it - above, below, left, right - and the
  // biggest of them wins; with one overlay, which is the ordinary case, that
  // is exact. It is bounded, deterministic and cannot enlarge the frame, so a
  // block with nothing over it composes byte for byte as before.
  const box = clearBox({ left, top, right, bottom }, composition?.obstacles);
  return {
    width: Math.max(0, box.right - box.left),
    height: Math.max(0, box.bottom - box.top),
    padding,
    // Where that rectangle starts, relative to the frame the card would have
    // had. Every surface that DRAWS a card adds these to its own origin; a
    // surface that only measures one can ignore them. Zero unless something
    // is actually in the way.
    offsetX: box.left - left,
    offsetY: box.top - top,
  };
}

/** The area of a box, or 0 if it has been cut away to nothing. */
const boxArea = (b) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

/**
 * The largest sub-rectangle of `box` that meets none of `obstacles`.
 *
 * An obstacle's own stand-off is included: a card set hard against a
 * photograph's edge is as wrong as one set hard against a column rule.
 */
function clearBox(box, obstacles) {
  const list = Array.isArray(obstacles) ? obstacles : [];
  let out = box;
  for (const raw of list) {
    if (!raw) continue;
    const pad = Math.max(0, Number(raw.standOffPx) || 0);
    const o = {
      left: (Number(raw.x) || 0) - pad,
      top: (Number(raw.y) || 0) - pad,
      right: (Number(raw.x) || 0) + (Number(raw.width) || 0) + pad,
      bottom: (Number(raw.y) || 0) + (Number(raw.height) || 0) + pad,
    };
    // Not in the way at all - by far the commonest case, and it must cost
    // nothing.
    if (o.right <= out.left || o.left >= out.right || o.bottom <= out.top || o.top >= out.bottom) continue;
    const candidates = [
      { ...out, bottom: Math.min(out.bottom, o.top) },
      { ...out, top: Math.max(out.top, o.bottom) },
      { ...out, right: Math.min(out.right, o.left) },
      { ...out, left: Math.max(out.left, o.right) },
    ];
    out = candidates.reduce((best, c) => (boxArea(c) > boxArea(best) ? c : best), candidates[0]);
  }
  return out;
}
