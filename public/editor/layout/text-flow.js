// The character grid: how a block is divided between picture and copy, and
// exactly how much copy there is room for.
//
// A block is cut into cells one body-character wide and one line tall. Each
// picture marks the cells it covers as occupied - from its box if it is a
// rectangle, from its ellipse if it is oval, from its alpha if it is a cut-out.
// The headline takes the top rows, the subheading the next, and every free cell
// left over is body text:
//
//     H H H H H H H H H H H H
//     S S S S S S S S S S S S
//     T T T T T T T I I I I I
//     T T T T T T T I I I I I
//     T T T T T T T T T T T T
//
// Counting the T cells gives a real character budget, and the budget already
// knows where the picture is. That is what the AI is briefed with: not "write
// 400 words", but "write exactly this many characters, in this shape". A
// ragged cut-out just produces ragged rows, so text runaround falls out of the
// same calculation instead of needing a separate one.
//
// All of this is in editor pixels (2 px per mm of the 330 x 530 mm page).

import './publication-type.js';

export const DEFAULT_BODY_FONT_PX = globalThis.SahasPublicationType.DEFAULT_BODY_FONT_PX;

// Average glyph advance as a fraction of font size, measured rather than
// guessed: probed in a real browser against the newspaper's own font stack.
// Marathi body copy in Noto Serif Devanagari averaged ~0.36 across three
// representative samples; English in Georgia averaged ~0.41. 0.5 (the
// original guess) overstated both by 25-40%, so the grid always believed
// noticeably fewer characters fit per line than actually do - the budget the
// AI is briefed with, and the "X% of the room for copy used" readout, were
// both built on that undercount. A block reporting "98% used" while visibly
// short of its own bottom edge was not a rendering bug: the AI had genuinely
// been told to stop at a number well below what the block could hold, and
// then correctly reported having reached it. Set to 0.4 rather than the bare
// Marathi measurement - close enough to fix the undercount for both
// languages without cutting it so fine that a conjunct-heavy headline or a
// wide English word overflows a line the budget assumed would hold it.
const AVG_CHAR_WIDTH_RATIO = 0.4;

// Devanagari needs a taller line than Latin. Marathi stacks vowel signs above
// the shirorekha (ि े ै ो ं) and below the baseline (ु ृ), so a 1.25 line box
// crops them: "शेतकऱ्यांसाठी" sets as "शतकऱ्यासाठा". This is a property of the
// script, not a taste setting, so it is a floor rather than a default.
import { plainText } from "./rich-text.js";
import "./caption-geometry.js";

export const MIN_LINE_HEIGHT = 1.45;
// The lowest line height ANY face may be set at: the tightest measured ink box
// (Noto Sans Devanagari, 1.305 em - see font-metrics.js). A block may ask for
// this; the compositor still floors it at its own face's need, so asking for
// it on the serif sets the serif exactly as before.
export const MIN_MEASURED_LINE_HEIGHT = 1.305;
export const { PLACED_CAPTION_METRICS, captionBox } = globalThis.SahasCaptionGeometry;

// The paper's own byline, used when a story has no reporter to name.
//
// Every newspaper has one and uses it constantly - agency copy, a desk
// rewrite, a filler - and this paper's is its own name. A generic "वार्ताहर"
// (correspondent) says less than that and is what the desk asked to be rid of.
//
// It is a DEFAULT REPORTER, deliberately, and not a rule inside datelineText()
// below: it is written onto the block's own `reporter_name` when copy is
// written into it, so it is a value the desk can see in Story details and
// change or clear. A block that should carry no byline at all - a caption
// panel, a filler - is still a block with an empty reporter, and still prints
// nothing. A rule here could not have said that.
export const DEFAULT_BYLINE = 'साहस वार्ता';

// Printed by both normal and flowed story renderers. This is SAHAS furniture,
// not AI-authored copy, so it has its own capacity accounting.
export function datelineText(view = {}) {
  // THE BLOCK MAY DECLINE ONE. A standing feature, a table of results, a
  // picture box and an advert all routinely carry a location without wanting
  // it printed as a dateline, and until this existed the only way to say no
  // was to clear the location itself - which also loses it from the story's
  // own record and from anything that files by place.
  //
  // Asked HERE rather than at the eight callers on purpose. This one function
  // is what the canvas, the Block Editor, the character grid's capacity count,
  // the compositor, the `.sla` and the press model all ask, so a block that
  // has turned its dateline off is a block none of them sets one for - and,
  // just as important, one that all of them agree has those characters back.
  // A flag honoured by the renderers but not by the capacity count would say a
  // block was full while showing it short.
  if (view.showDateline === false || view.show_dateline === false) return '';
  const parts = [view.location, view.author ?? view.reporterName ?? view.reporter_name]
    .map((part) => String(part || '').trim()).filter(Boolean);
  if (!parts.length) return '';
  const style = view.datelineStyle ?? view.dateline_style;
  return style === 'colon' ? `${parts.join(', ')} : ` : `■ ${parts.join(', ')} `;
}

// HOW A DATELINE IS SET. A Marathi daily either opens the story with a square
// and the place ("■ सातारा ") or sets the place and a colon ("सातारा : ") - the
// second is how the reference broadsheet sets every story. Both are the one
// prefix datelineText() returns, so every surface that measures or draws a
// dateline agrees on it without knowing there are two.
export const DATELINE_STYLES = Object.freeze(['square', 'colon']);

/**
 * The dateline/byline is newspaper furniture, not reporter-authored body
 * markup. Its range lives immediately BEFORE body offset zero because the
 * compositor prefixes it to the body while authored marks remain indexed to
 * the stored story alone. One helper keeps browser, neutral print model and
 * Scribus on that same coordinate convention.
 */
export function marksWithDateline(marks = [], prefixLength = 0) {
  const length = Math.max(0, Number(prefixLength) || 0);
  return length ? [{ tag: 'b', start: -length, end: 0 }, ...marks] : [...marks];
}

// The one translation from a persisted section (snake case) or an editor view
// (camel case) into the flow engine. Keeping it here prevents fit, preflight
// and quality from each quietly choosing different defaults.
function flowValue(section, overrides, camel, snake, fallback) {
  if (overrides[camel] !== undefined && overrides[camel] !== null) return overrides[camel];
  if (overrides[snake] !== undefined && overrides[snake] !== null) return overrides[snake];
  if (section[snake] !== undefined && section[snake] !== null) return section[snake];
  if (section[camel] !== undefined && section[camel] !== null) return section[camel];
  return fallback;
}

function numeric(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function flowViewFromSection(section = {}, overrides = {}) {
  return {
    headline: flowValue(section, overrides, "headline", "headline", ""),
    subheading: flowValue(section, overrides, "subheading", "subheading", ""),
    body: flowValue(section, overrides, "body", "body", ""),
    kicker: flowValue(section, overrides, "kicker", "kicker", ""),
    location: flowValue(section, overrides, "location", "location", ""),
    author: flowValue(section, overrides, "author", "reporter_name", ""),
    // Carried, or every capacity number this grid quotes for a block with no
    // dateline is one dateline's worth of characters short of the truth.
    showDateline: flowValue(section, overrides, "showDateline", "show_dateline", true) !== false,
    datelineStyle: flowValue(section, overrides, "datelineStyle", "dateline_style", null),
    marginPx: numeric(flowValue(section, overrides, "marginPx", "margin_px", 12), 12),
    columnCount: numeric(flowValue(section, overrides, "columnCount", "column_count", 1), 1),
    lineHeight: Math.max(MIN_LINE_HEIGHT, numeric(flowValue(section, overrides, "lineHeight", "line_height", MIN_LINE_HEIGHT), MIN_LINE_HEIGHT)),
    headlineFontPx: numeric(flowValue(section, overrides, "headlineFontPx", "headline_font_px", 34), 34),
    subheadingFontPx: numeric(flowValue(section, overrides, "subheadingFontPx", "subheading_font_px", 20), 20),
    bodyFontPx: numeric(
      flowValue(section, overrides, "bodyFontPx", "body_font_px", DEFAULT_BODY_FONT_PX),
      DEFAULT_BODY_FONT_PX,
    ),
  };
}

export function measureSectionFlow(section = {}, overrides = {}, images = null) {
  const view = flowViewFromSection(section, overrides);
  const flowImages = images === null ? (section.images || []).map(flowImageFromRow) : images;
  const map = buildFlowMap(section, view, flowImages);
  const bodyCharsUsed = map.authoredBodyCharsUsed;
  const bodyCharBudget = map.bodyCharBudget;
  const fixedBodyPrefixChars = map.fixedBodyPrefixChars;
  const writableBodyCharBudget = Math.max(0, bodyCharBudget - fixedBodyPrefixChars);
  const totalBodyCharsUsed = map.totalBodyCharsUsed;
  return {
    view, map, bodyCharBudget, bodyCharsUsed, fixedBodyPrefixChars,
    writableBodyCharBudget, authoredBodyCharsUsed: bodyCharsUsed, totalBodyCharsUsed,
    overflowing: totalBodyCharsUsed > bodyCharBudget,
    overflowChars: Math.max(0, totalBodyCharsUsed - bodyCharBudget),
    fillRatio: writableBodyCharBudget ? bodyCharsUsed / writableBodyCharBudget : (bodyCharsUsed ? Infinity : 0),
    authoredBodyFillRatio: writableBodyCharBudget ? bodyCharsUsed / writableBodyCharBudget : (bodyCharsUsed ? Infinity : 0),
    physicalBodyFillRatio: bodyCharBudget ? totalBodyCharsUsed / bodyCharBudget : (totalBodyCharsUsed ? Infinity : 0),
  };
}

export const CELL = { KICKER: "K", HEADLINE: "H", SUBHEADING: "S", TEXT: "T", IMAGE: "I", EMPTY: "." };

// Below this many cells wide, a run cannot hold ordinary prose at all - every
// row a picture leaves this narrow forces the SAME word to break character by
// character down the whole column ("शहरात/ील/मुख्य/चौकात/रोज/सकाळी/होणार/ी" -
// found live, a photo-feature block whose picture left a 5-cell sliver for ten
// rows straight, the ONLY width available anywhere in that flow). Matches
// bandBox()'s own MIN_BAND_SHARE reasoning for the headline/subheading bands:
// below a usable width, showing nothing reads far better than a column of
// single glyphs. Used both here, to keep bodyCharBudget honest about what a
// block can actually hold (never claim room the render will refuse to use),
// and in pourIntoRuns(), which is what actually refuses it.
export const MIN_RUN_CHARS = 4;

// Turns a point into the picture's own frame, so a rotated picture is tested
// against an upright rectangle. Rotation is about the picture's top-left, which
// is where Fabric anchors it.
function toLocal(image, cx, cy) {
  const angle = ((Number(image.rotation) || 0) * Math.PI) / 180;
  if (!angle) return { x: cx - image.x, y: cy - image.y };
  const dx = cx - image.x;
  const dy = cy - image.y;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

function rectCovers(image, cx, cy) {
  const p = toLocal(image, cx, cy);
  return p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height;
}

function ellipseCovers(image, cx, cy) {
  const rx = image.width / 2;
  const ry = image.height / 2;
  if (rx <= 0 || ry <= 0) return false;
  const p = toLocal(image, cx, cy);
  const dx = (p.x - rx) / rx;
  const dy = (p.y - ry) / ry;
  return dx * dx + dy * dy <= 1;
}

// A cut-out carries an occupancy mask sampled from its alpha channel - a grid
// of booleans, coarse on purpose, since a cell is already the smallest unit
// that matters. Until a background has actually been removed there is no mask,
// and the picture behaves as its box.
function cutoutCovers(image, cx, cy) {
  const mask = image.mask;
  if (!mask?.rows || !mask.cols || !mask.cells) return rectCovers(image, cx, cy);
  if (!rectCovers(image, cx, cy)) return false;
  const p = toLocal(image, cx, cy);
  const col = Math.min(mask.cols - 1, Math.floor((p.x / image.width) * mask.cols));
  const row = Math.min(mask.rows - 1, Math.floor((p.y / image.height) * mask.rows));
  return Boolean(mask.cells[row]?.[col]);
}

function covers(image, cx, cy) {
  // Stand-off keeps copy from touching the picture, the way a printed page does.
  const pad = Number(image.standOffPx) || 0;
  // Stand-off widens the shape in its own frame, so it stays square to a
  // rotated picture rather than to the page.
  const padded = {
    ...image,
    x: image.x,
    y: image.y,
    width: image.width + pad * 2,
    height: image.height + pad * 2,
  };
  if (pad) {
    const angle = ((Number(image.rotation) || 0) * Math.PI) / 180;
    padded.x = image.x - (pad * Math.cos(angle) - pad * Math.sin(angle));
    padded.y = image.y - (pad * Math.sin(angle) + pad * Math.cos(angle));
  }
  if (image.shape === "ellipse") return ellipseCovers(padded, cx, cy);
  if (image.shape === "cutout") return cutoutCovers(padded, cx, cy);
  return rectCovers(padded, cx, cy);
}

function rowsFor(heightPx, cellHeight) {
  return heightPx > 0 ? Math.max(1, Math.ceil(heightPx / cellHeight)) : 0;
}

/**
 * Builds the grid for one block.
 *
 * `images` are placed in block-content coordinates - the same space the
 * composition canvas drags them in.
 */
export function buildFlowMap(section, view, images = []) {
  const padding = Number(view.marginPx) || 12;
  const blockWidth = Number(section?.width_px) || 0;
  const blockHeight = Number(section?.height_px) || 0;

  const contentWidth = Math.max(0, blockWidth - padding * 2);
  const contentHeight = Math.max(0, blockHeight - padding * 2);

  const bodyFont = Number(view.bodyFontPx) || DEFAULT_BODY_FONT_PX;
  const lineHeight = Math.max(MIN_LINE_HEIGHT, Number(view.lineHeight) || 1.25);

  const cellWidth = Math.max(1, bodyFont * AVG_CHAR_WIDTH_RATIO);
  const cellHeight = Math.max(1, bodyFont * lineHeight);

  // Pictures are placed against the block's own top-left corner - that is what
  // the composition canvas drags them in and what `section_images` stores. The
  // grid works inside the block's margin, so a picture has to be moved into
  // that frame before it is asked which cells it covers. Skipping this shifted
  // every runaround by the margin and let copy print over the subject.
  const placed = images.flatMap((image) => {
    const photograph = {
      ...image,
      x: (Number(image.x) || 0) - padding,
      y: (Number(image.y) || 0) - padding,
    };
    const caption = captionBox(image);
    if (!caption) return [photograph];
    return [photograph, {
      ...caption,
      x: caption.x - padding,
      y: caption.y - padding,
      shape: 'rect',
      standOffPx: caption.standOffPx,
      occupancy: 'caption',
    }];
  });

  const cols = Math.max(0, Math.floor(contentWidth / cellWidth));
  const rows = Math.max(0, Math.floor(contentHeight / cellHeight));

  // The headline and subheading claim whole rows off the top - they are set
  // across the measure, not wrapped around the picture.
  const kickerText = plainText(view.kicker);
  const headlineText = plainText(view.headline);
  const subheadingText = plainText(view.subheading);
  const kickerRows = kickerText
    ? rowsFor(estimateHeight(kickerText, view.bodyFontPx * 1.05, contentWidth), cellHeight) + 1
    : 0;
  const headlineRows = headlineText
    ? rowsFor(estimateHeight(headlineText, view.headlineFontPx, contentWidth), cellHeight)
    : 0;
  const subheadingRows = subheadingText
    ? rowsFor(estimateHeight(subheadingText, view.subheadingFontPx, contentWidth), cellHeight)
    : 0;

  const grid = [];
  let imageCells = 0;

  for (let row = 0; row < rows; row += 1) {
    const line = [];
    // Cell centre, in block-content coordinates.
    const cy = row * cellHeight + cellHeight / 2;

    for (let col = 0; col < cols; col += 1) {
      const cx = col * cellWidth + cellWidth / 2;

      const occupied = placed.some((image) => covers(image, cx, cy));
      if (occupied) {
        line.push(CELL.IMAGE);
        imageCells += 1;
        continue;
      }
      if (row < kickerRows) {
        line.push(CELL.KICKER);
        continue;
      }
      if (row < kickerRows + headlineRows) {
        line.push(CELL.HEADLINE);
        continue;
      }
      if (row < kickerRows + headlineRows + subheadingRows) {
        line.push(CELL.SUBHEADING);
        continue;
      }
      line.push(CELL.TEXT);
    }
    grid.push(line);
  }

  // The USABLE budget, not a raw count of every free cell. pourIntoRuns()
  // refuses to pour real prose into a run narrower than MIN_RUN_CHARS - a run
  // that narrow, sustained because a picture leaves no wider row anywhere in
  // the flow, would only ever produce single-character lines. A flat count of
  // every free cell (including ones inside such a run) used to be handed to
  // the AI as the block's real capacity: a block could be briefed to fill
  // room the renderer would then refuse to use, the exact "the AI was told
  // about room it does not actually have" bug this whole grid exists to
  // prevent for headline/subheading overflow. Computed here with flowRuns()
  // itself (same row-scan, same MIN_RUN_CHARS), so this can never drift from
  // what pourIntoRuns() actually does with the same grid.
  const usableRuns = flowRuns({ grid, rows, cols }, CELL.TEXT);
  const usableBudget = usableRuns.reduce(
    (sum, run) => sum + (run.length >= MIN_RUN_CHARS ? run.length : 0), 0,
  );

  return {
    cols,
    rows,
    cellWidth: Number(cellWidth.toFixed(2)),
    cellHeight: Number(cellHeight.toFixed(2)),
    grid,
    kickerRows,
    headlineRows,
    subheadingRows,
    imageCells,
    // One cell holds one character. This is the number the AI is given -
    // usableBudget, not the raw textCells count (see above).
    bodyCharBudget: usableBudget,
    // Marathi averages roughly six characters a word including the space.
    bodyWordBudget: Math.round(usableBudget / 6),
    // What the copy will SET, not how it is marked up. Two words in bold take
    // exactly as much room as two words that are not.
    // Compatibility alias: authored AI body only. Explicit physical fields
    // below include the automatic dateline printed by SAHAS.
    usedChars: plainText(view.body).length,
    fixedBodyPrefixChars: datelineText(view).length,
    authoredBodyCharsUsed: plainText(view.body).length,
    totalBodyCharsUsed: datelineText(view).length + plainText(view.body).length,
  };
}

// How tall a run of text sets at this size, across this width - the one
// estimate every consumer of a block's geometry shares (the character grid,
// the Space read-out, the overflow flag on the canvas), so "how full is this
// block" has one answer instead of several. Always at MIN_LINE_HEIGHT: a
// block whose real CSS renders at a shorter line height than this estimate
// assumed finishes its copy short of the bottom of the box while still
// reading as "98% used" - the estimate was the one place this was already
// right, so section-model.js's `lineHeight` is floored to match it instead.
export function estimateHeight(text, fontPx, availableWidthPx) {
  if (!text || !fontPx || availableWidthPx <= 0) return 0;
  const perLine = Math.max(1, Math.floor(availableWidthPx / (fontPx * AVG_CHAR_WIDTH_RATIO)));
  return Math.ceil(text.length / perLine) * fontPx * MIN_LINE_HEIGHT;
}

// Kept beside estimateHeight so every caller derives headline/deck rows from
// the exact same width and line-height model, never from body typography.
export function estimateLineCount(text, fontPx, availableWidthPx) {
  if (!text || !fontPx || availableWidthPx <= 0) return 0;
  return Math.max(1, Math.round(estimateHeight(text, fontPx, availableWidthPx) / (fontPx * MIN_LINE_HEIGHT)));
}

// The map as the picture the editor drew for us. This exact string goes into
// the AI request, because it says more in twelve lines than any prose brief.
export function flowAscii(map, { maxCols = 60, maxRows = 40 } = {}) {
  const colStep = map.cols > maxCols ? Math.ceil(map.cols / maxCols) : 1;
  const rowStep = map.rows > maxRows ? Math.ceil(map.rows / maxRows) : 1;

  const lines = [];
  for (let row = 0; row < map.rows; row += rowStep) {
    const line = [];
    for (let col = 0; col < map.cols; col += colStep) {
      line.push(map.grid[row][col]);
    }
    lines.push(line.join(" "));
  }
  return lines.join("\n");
}

// How full the block is, for the Space read-out and the overflow warning.
export function flowFit(map) {
  const budget = map.bodyCharBudget;
  return {
    budget,
    used: map.usedChars,
    remaining: budget - map.usedChars,
    overflowing: map.usedChars > budget,
    ratio: budget ? Math.min(1, map.usedChars / budget) : 0,
  };
}

// A `section_images` row as the grid wants it. One converter, used by the
// composition canvas, the Space read-out and the AI brief, so the three can
// never disagree about where a picture is.
export function flowImageFromRow(row) {
  return {
    x: Number(row.x_px) || 0,
    y: Number(row.y_px) || 0,
    width: Number(row.width_px) || 0,
    height: Number(row.height_px) || 0,
    shape: row.shape || "rect",
    rotation: Number(row.rotation) || 0,
    standOffPx: Number(row.stand_off_px) || 0,
    mask: row.mask || null,
    caption: row.caption || '',
  };
}

// The widest column span that is free of pictures across EVERY row of a band.
//
// The headline and the deck are set as whole wrapped lines rather than poured
// cell by cell, so they need one rectangle rather than a run per row. Without
// this a headline printed straight over a picture standing in its band; with
// it, it sets in the space beside the picture, which is what a page designer
// would do.
export function bandSpan(map, kind) {
  const rows = [];
  for (let row = 0; row < map.rows; row += 1) {
    if (map.grid[row].includes(kind)) rows.push(row);
  }
  if (!rows.length) return null;

  let best = null;
  let start = -1;
  for (let col = 0; col <= map.cols; col += 1) {
    const free = col < map.cols && rows.every((row) => map.grid[row][col] === kind);
    if (free && start === -1) start = col;
    if (!free && start !== -1) {
      const run = { col: start, length: col - start };
      if (!best || run.length > best.length) best = run;
      start = -1;
    }
  }
  return best;
}

// How far a picture-free share of a band's own measure still counts as "the
// band avoided the picture" rather than "the picture ate the band". Below
// this, squeezing a headline into a sliver reads far worse than letting the
// clash show - the picture is in the wrong place, not the headline. Shared
// so the canvas and the Block Editor draw the same box for the same reason;
// it used to live only in section-thumb.js, as a local closure block-frame.js
// could not see, which is why the editor never dodged a picture at all (see
// PROJECT_STATUS.md, Bug #1/#3).
const MIN_BAND_SHARE = 0.5;

// The widest picture-free rectangle a band (the headline or the subheading)
// can set across, within its own row range. `kind` is CELL.HEADLINE or
// CELL.SUBHEADING; `fallbackLeft` is used when no free span clears the
// MIN_BAND_SHARE threshold, in which case the band is drawn at the full
// measure and left to clash with the picture rather than being squeezed.
export function bandBox(map, kind, padding, measure, fallbackLeft) {
  const span = bandSpan(map, kind);
  if (!span || span.length * map.cellWidth < measure * MIN_BAND_SHARE) {
    return { left: fallbackLeft, width: measure, safe: false, reason: 'INSUFFICIENT_PICTURE_FREE_BAND' };
  }
  return { left: padding + span.col * map.cellWidth, width: span.length * map.cellWidth, safe: true, reason: null };
}

// Contiguous runs of one kind of cell, row by row. A run is a piece of line
// that text can actually be set on - the gaps are where the picture is.
export function flowRuns(map, kind) {
  const runs = [];
  for (let row = 0; row < map.rows; row += 1) {
    let start = -1;
    for (let col = 0; col <= map.cols; col += 1) {
      const matches = col < map.cols && map.grid[row][col] === kind;
      if (matches && start === -1) start = col;
      if (!matches && start !== -1) {
        runs.push({ row, col: start, length: col - start });
        start = -1;
      }
    }
  }
  return runs;
}

// Pours text into those runs, breaking on spaces so words are not cut in half.
// This is the rendering counterpart of the character budget: the same runs the
// AI is asked to fill are the runs the text is drawn into, so what is composed
// on screen is what was briefed.
export function pourIntoRuns(runs, text) {
  const words = String(text || "").split(/(\s+)/).filter((piece) => piece !== "");
  const filled = [];
  let buffer = "";
  let poured = 0;

  // The widest run there is. A word is only ever broken if it cannot fit even
  // there; anywhere else it waits for the next line. Breaking a word merely
  // because a short run beside a picture could not take it produced "अतिवृ-
  // ष्टीग्रस" on one side of the subject and "त" on the other, which is not
  // hyphenation, it is damage.
  const widest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  if (widest < MIN_RUN_CHARS) return [];

  for (const run of runs) {
    let line = "";
    while (words.length || buffer) {
      const next = buffer || words.shift();
      buffer = "";
      // A word too long for even the widest run has to be broken, or nothing
      // would ever fit.
      if (next.length > run.length && !line) {
        if (next.length <= widest) {
          buffer = next;
          break;
        }
        line = next.slice(0, run.length);
        buffer = next.slice(run.length);
        break;
      }
      if (line.length + next.length > run.length) {
        buffer = next;
        break;
      }
      line += next;
    }
    const trimmed = line.replace(/\s+$/, "");
    // Where this run's text began in the source. The canvas needs it to put
    // bold and italic back on the right words after the pour has broken the
    // copy into cell-aligned pieces (see rich-text.js).
    if (trimmed) filled.push({ ...run, text: trimmed, at: poured });
    poured += line.length;
    if (!words.length && !buffer) break;
  }
  return filled;
}
