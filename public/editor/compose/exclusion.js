// A photograph, as geometry that text has to keep out of.
//
// The naive answer is "the picture's box", and for a rectangular photograph
// that is right. For a cut-out - a subject with its background removed - it
// is badly wrong in the visible way: a person standing in a column leaves a
// rectangle of white beside them that the copy refuses to enter, which is
// exactly the "large unexplained hole" the desk complains about. The alpha
// channel already says where the subject really is.
//
// But raw alpha is also wrong, in the opposite direction. Every transparent
// pixel is not usable space:
//
//   * the gap between two fingers is free, and text must not thread it
//   * the triangle under an arm is free, and text must not go inside it
//   * hair has thousands of tiny free pockets
//   * a background remover leaves stray specks and a soft shadow
//   * copy set right up against the silhouette looks like a printing fault
//
// So the mask is not used as it arrives. It is turned into a TYPOGRAPHIC
// EXCLUSION ENVELOPE, which is a deliberately blunter shape than the picture:
//
//   raw alpha
//     -> closing        (bridge narrow concavities: fingers, hair, notches)
//     -> hole filling   (an enclosed pocket is occupied, however transparent)
//     -> dilation       (the stand-off, so copy never touches the subject)
//     -> per-band intervals
//
// The picture still PAINTS at full fidelity. Only the geometry text is
// measured against is smoothed. That separation is what lets the envelope be
// crude without the page looking crude.

import { normalise } from './intervals.js';

// How far copy stays off a subject, in ems of the body type. A stand-off in
// pixels would be one thing at 9pt and another at 24pt; in ems it is the same
// optical gap at every size, which is what a printer actually keeps.
export const STAND_OFF_EM = 0.6;

export function standOffPx(image, bodyFontPx) {
  const explicit = Number(image?.standOffPx ?? image?.stand_off_px);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return STAND_OFF_EM * (Number(bodyFontPx) || 16);
}

// ------------------------------------------------------------ mask cleanup ---

function cloneCells(cells, rows, cols) {
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    const row = new Uint8Array(cols);
    for (let c = 0; c < cols; c += 1) row[c] = cells[r]?.[c] ? 1 : 0;
    out.push(row);
  }
  return out;
}

function dilateCells(cells, rows, cols) {
  const out = cloneCells(cells, rows, cols).map((row) => new Uint8Array(row.length));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!cells[r][c]) continue;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out[rr][cc] = 1;
        }
      }
    }
  }
  return out;
}

function erodeCells(cells, rows, cols) {
  const out = cells.map((row) => new Uint8Array(row.length));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (!cells[r][c]) continue;
      let solid = true;
      for (let dr = -1; dr <= 1 && solid; dr += 1) {
        for (let dc = -1; dc <= 1 && solid; dc += 1) {
          const rr = r + dr;
          const cc = c + dc;
          // Outside the mask counts as solid, so erosion does not eat the
          // subject away at the edges of its own frame.
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          if (!cells[rr][cc]) solid = false;
        }
      }
      out[r][c] = solid ? 1 : 0;
    }
  }
  return out;
}

// Anything transparent that cannot be reached from outside the picture is a
// hole - the gap under an arm, the space inside a handle - and text must not
// be set inside it however open it is. Flood fill from the border marks what
// is genuinely outside; the rest becomes subject.
function fillEnclosed(cells, rows, cols) {
  const outside = cells.map((row) => new Uint8Array(row.length));
  const stack = [];
  for (let r = 0; r < rows; r += 1) {
    for (const c of [0, cols - 1]) if (!cells[r][c] && !outside[r][c]) { outside[r][c] = 1; stack.push([r, c]); }
  }
  for (let c = 0; c < cols; c += 1) {
    for (const r of [0, rows - 1]) if (!cells[r][c] && !outside[r][c]) { outside[r][c] = 1; stack.push([r, c]); }
  }
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      if (cells[rr][cc] || outside[rr][cc]) continue;
      outside[rr][cc] = 1;
      stack.push([rr, cc]);
    }
  }

  const out = cells.map((row) => new Uint8Array(row));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) if (!cells[r][c] && !outside[r][c]) out[r][c] = 1;
  }
  return out;
}

const envelopeCache = new WeakMap();

/**
 * The smoothed mask: closing, then hole filling.
 *
 * Cached against the mask object itself - the same photograph is measured
 * again on every keystroke, and this is the only part of composition that is
 * not linear in the length of the copy.
 */
export function exclusionEnvelope(mask) {
  if (!mask?.rows || !mask?.cols || !mask?.cells) return null;
  const hit = envelopeCache.get(mask);
  if (hit) return hit;

  const rows = mask.rows;
  const cols = mask.cols;
  // Closing = dilate then erode. It bridges concavities up to one cell wide -
  // the gap between fingers, a shoulder notch - without growing the subject.
  const closed = erodeCells(dilateCells(cloneCells(mask.cells, rows, cols), rows, cols), rows, cols);
  const filled = fillEnclosed(closed, rows, cols);

  const envelope = { rows, cols, cells: filled };
  envelopeCache.set(mask, envelope);
  return envelope;
}

/**
 * A stable content hash of a mask, for the composition fingerprint.
 *
 * `${rows}x${cols}` alone (what the fingerprint used before this) says two
 * masks are the SAME composition whenever they happen to share dimensions -
 * a cutout re-run through background removal a second time, landing on a
 * differently-shaped silhouette at the same resolution, would report an
 * unchanged fingerprint despite text wrapping around a different shape. This
 * walks every cell, so two masks of identical size but different content
 * hash differently.
 */
export function maskHash(mask) {
  if (!mask?.rows || !mask?.cols || !mask?.cells) return 'none';
  let h = 2166136261;
  const push = (n) => {
    h ^= Number(n) & 255;
    h = Math.imul(h, 16777619);
  };
  push(mask.rows);
  push(mask.cols);
  for (const row of mask.cells) {
    for (const value of row) push(value ? 1 : 0);
  }
  return (h >>> 0).toString(16);
}

// ---------------------------------------------------------- band intervals ---

function boxOf(image, pad) {
  const x = Number(image.x) || 0;
  const y = Number(image.y) || 0;
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  const rotation = Number(image.rotation) || 0;

  if (!rotation) {
    return { left: x - pad, top: y - pad, right: x + width + pad, bottom: y + height + pad };
  }
  // A rotated picture is bounded rather than followed. Copy keeps clear of
  // slightly more than it strictly must, which is the safe direction; exact
  // rotated silhouettes are not worth the arithmetic for a case the desk
  // almost never uses.
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const w = width * cos + height * sin;
  const h = width * sin + height * cos;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return { left: cx - w / 2 - pad, top: cy - h / 2 - pad, right: cx + w / 2 + pad, bottom: cy + h / 2 + pad };
}

/**
 * What one photograph occupies on one line band.
 *
 * `top`/`bottom` are the band's full vertical extent - ascent through
 * descent, not the baseline. Sampling a single y misses a matra reaching up
 * into the picture and a descender reaching down into it, which is the
 * commonest way copy ends up visibly touching a subject.
 */
export function obstacleIntervals(image, top, bottom, bodyFontPx) {
  const pad = standOffPx(image, bodyFontPx);
  const box = boxOf(image, pad);
  if (bottom <= box.top || top >= box.bottom) return [];

  const shape = image.shape || 'rect';

  if (shape === 'ellipse' && !Number(image.rotation)) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const rx = (box.right - box.left) / 2;
    const ry = (box.bottom - box.top) / 2;
    if (rx <= 0 || ry <= 0) return [];
    // The widest cut the band takes through the ellipse - the y in the band
    // nearest its centre.
    const y = Math.max(box.top, Math.min(box.bottom, Math.max(top, Math.min(bottom, cy))));
    const t = 1 - ((y - cy) / ry) ** 2;
    if (t <= 0) return [];
    const half = rx * Math.sqrt(t);
    return [{ start: cx - half, end: cx + half }];
  }

  if (shape === 'cutout' && !Number(image.rotation)) {
    const envelope = exclusionEnvelope(image.mask);
    if (envelope) {
      // The mask is sampled in the picture's own frame; the stand-off is
      // applied afterwards, by widening each occupied run and by widening the
      // band that is queried. That is a dilation by an axis-aligned box, the
      // Minkowski sum of the subject with the text's own clearance.
      const x = Number(image.x) || 0;
      const y = Number(image.y) || 0;
      const width = Number(image.width) || 0;
      const height = Number(image.height) || 0;
      if (width <= 0 || height <= 0) return [];

      const cellW = width / envelope.cols;
      const cellH = height / envelope.rows;
      const first = Math.max(0, Math.floor((top - pad - y) / cellH));
      const last = Math.min(envelope.rows - 1, Math.ceil((bottom + pad - y) / cellH) - 1);
      if (last < first) return [];

      const runs = [];
      for (let r = first; r <= last; r += 1) {
        let start = -1;
        for (let c = 0; c <= envelope.cols; c += 1) {
          const solid = c < envelope.cols && envelope.cells[r][c];
          if (solid && start === -1) start = c;
          if (!solid && start !== -1) {
            runs.push({ start: x + start * cellW - pad, end: x + c * cellW + pad });
            start = -1;
          }
        }
      }
      return normalise(runs);
    }
    // No mask yet: the background has not actually been removed, so the
    // picture is still its box. Saying otherwise would let copy run through a
    // subject that is about to appear.
  }

  return [{ start: box.left, end: box.right }];
}

/** The union of every photograph's exclusion on one band. */
export function bandObstacles(images, top, bottom, bodyFontPx) {
  const pieces = [];
  for (const image of images) pieces.push(...obstacleIntervals(image, top, bottom, bodyFontPx));
  return normalise(pieces);
}

/**
 * The visible subject's bounds inside a cut-out's own box, as fractions.
 *
 * A background remover leaves the original canvas size, so a subject standing
 * in the middle of a wide transparent field reports a box far bigger than the
 * person in it. Fitting "to the picture" then shrinks the subject to nothing.
 * Used by the visible-subject fit modes.
 */
export function visibleBounds(mask) {
  if (!mask?.rows || !mask?.cols || !mask?.cells) return null;
  let top = mask.rows;
  let bottom = -1;
  let left = mask.cols;
  let right = -1;
  for (let r = 0; r < mask.rows; r += 1) {
    for (let c = 0; c < mask.cols; c += 1) {
      if (!mask.cells[r]?.[c]) continue;
      if (r < top) top = r;
      if (r > bottom) bottom = r;
      if (c < left) left = c;
      if (c > right) right = c;
    }
  }
  if (bottom < 0) return null;
  return {
    x: left / mask.cols,
    y: top / mask.rows,
    width: (right - left + 1) / mask.cols,
    height: (bottom - top + 1) / mask.rows,
  };
}
