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

// Average glyph advance as a fraction of font size. The same ratio
// layout-metrics.js uses, kept deliberately identical so the two never disagree
// about how much fits.
const AVG_CHAR_WIDTH_RATIO = 0.5;

// Devanagari needs a taller line than Latin. Marathi stacks vowel signs above
// the shirorekha (ि े ै ो ं) and below the baseline (ु ृ), so a 1.25 line box
// crops them: "शेतकऱ्यांसाठी" sets as "शतकऱ्यासाठा". This is a property of the
// script, not a taste setting, so it is a floor rather than a default.
const MIN_LINE_HEIGHT = 1.45;

export const CELL = { HEADLINE: "H", SUBHEADING: "S", TEXT: "T", IMAGE: "I", EMPTY: "." };

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

  const bodyFont = Number(view.bodyFontPx) || 16;
  const lineHeight = Math.max(MIN_LINE_HEIGHT, Number(view.lineHeight) || 1.25);

  const cellWidth = Math.max(1, bodyFont * AVG_CHAR_WIDTH_RATIO);
  const cellHeight = Math.max(1, bodyFont * lineHeight);

  // Pictures are placed against the block's own top-left corner - that is what
  // the composition canvas drags them in and what `section_images` stores. The
  // grid works inside the block's margin, so a picture has to be moved into
  // that frame before it is asked which cells it covers. Skipping this shifted
  // every runaround by the margin and let copy print over the subject.
  const placed = images.map((image) => ({
    ...image,
    x: (Number(image.x) || 0) - padding,
    y: (Number(image.y) || 0) - padding,
  }));

  const cols = Math.max(0, Math.floor(contentWidth / cellWidth));
  const rows = Math.max(0, Math.floor(contentHeight / cellHeight));

  // The headline and subheading claim whole rows off the top - they are set
  // across the measure, not wrapped around the picture.
  const headlineRows = view.headline
    ? rowsFor(estimateHeight(view.headline, view.headlineFontPx, contentWidth), cellHeight)
    : 0;
  const subheadingRows = view.subheading
    ? rowsFor(estimateHeight(view.subheading, view.subheadingFontPx, contentWidth), cellHeight)
    : 0;

  const grid = [];
  let textCells = 0;
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
      if (row < headlineRows) {
        line.push(CELL.HEADLINE);
        continue;
      }
      if (row < headlineRows + subheadingRows) {
        line.push(CELL.SUBHEADING);
        continue;
      }
      line.push(CELL.TEXT);
      textCells += 1;
    }
    grid.push(line);
  }

  return {
    cols,
    rows,
    cellWidth: Number(cellWidth.toFixed(2)),
    cellHeight: Number(cellHeight.toFixed(2)),
    grid,
    headlineRows,
    subheadingRows,
    imageCells,
    // One cell holds one character. This is the number the AI is given.
    bodyCharBudget: textCells,
    // Marathi averages roughly six characters a word including the space.
    bodyWordBudget: Math.round(textCells / 6),
    usedChars: (view.body || "").length,
  };
}

function estimateHeight(text, fontPx, availableWidthPx) {
  if (!text || !fontPx || availableWidthPx <= 0) return 0;
  const perLine = Math.max(1, Math.floor(availableWidthPx / (fontPx * AVG_CHAR_WIDTH_RATIO)));
  return Math.ceil(text.length / perLine) * fontPx * MIN_LINE_HEIGHT;
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

  // The widest run there is. A word is only ever broken if it cannot fit even
  // there; anywhere else it waits for the next line. Breaking a word merely
  // because a short run beside a picture could not take it produced "अतिवृ-
  // ष्टीग्रस" on one side of the subject and "त" on the other, which is not
  // hyphenation, it is damage.
  const widest = runs.reduce((max, run) => Math.max(max, run.length), 0);

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
    if (trimmed) filled.push({ ...run, text: trimmed });
    if (!words.length && !buffer) break;
  }
  return filled;
}
