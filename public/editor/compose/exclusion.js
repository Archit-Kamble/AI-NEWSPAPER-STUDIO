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
import '../layout/publication-type.js';
// The SAME crop/fit/flip transform paint (picture-style.js) and resize
// (image-resize.js) already resolve a placement through - a cutout's
// exclusion envelope follows it too, computed straight from the obstacle
// object itself (resolvePlacedImage() already reads camelCase x/y/width/
// height/fitMode/flipH/flipV/sourceWidth/sourceHeight with sane defaults for
// whatever a caller omits), so a test or caller that builds a bare
// {x,y,width,height,shape:'cutout',mask} object still gets the same
// behaviour this file had before - just resolved through one function
// instead of duplicating its defaults here.
import { resolvePlacedImage, isWholeSourceCrop, sourceRectToFrameBounds } from '../layout/image-geometry.js';

// How far copy stays off a subject, in ems of the body type. A stand-off in
// pixels would be one thing at 9pt and another at 24pt; in ems it is the same
// optical gap at every size, which is what a printer actually keeps.
export const STAND_OFF_EM = 0.6;
const DEFAULT_BODY_FONT_PX = globalThis.SahasPublicationType.DEFAULT_BODY_FONT_PX;

export function standOffPx(image, bodyFontPx) {
  const explicit = Number(image?.standOffPx ?? image?.stand_off_px);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return STAND_OFF_EM * (Number(bodyFontPx) || DEFAULT_BODY_FONT_PX);
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

/**
 * A stable fingerprint INPUT for one image - every field that can change
 * what obstacleIntervals() returns, not only the four geometry fields the
 * composition fingerprint used to hash. `Contain -> Stretch` or a flip
 * changes the exclusion a cutout produces without touching x/y/width/height
 * at all; a fingerprint blind to that told a caller nothing had changed when
 * the actual composed page had. Consumed as one joined string, not an
 * object, so `compose.js`'s own fingerprint stays a flat hash of strings
 * exactly as it already was for every other field.
 */
export function imageFingerprint(image) {
  return [
    image.x, image.y, image.width, image.height,
    image.sourceWidth, image.sourceHeight,
    image.cropX, image.cropY, image.cropWidth, image.cropHeight,
    image.fitMode,
    image.rotation, Number(Boolean(image.flipH)), Number(Boolean(image.flipV)),
    image.shape, image.standOffPx,
    maskHash(image.mask),
  ].join(',');
}

// ---------------------------------------------------------- band intervals ---

function boxOf(image, pad) {
  const x = Number(image.x) || 0;
  const y = Number(image.y) || 0;
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  const rotation = (((Number(image.rotation) || 0) % 360) + 360) % 360;

  // A quarter turn (0/90/180/270 - the only angles the Editor's Rotate
  // control ever persists) never grows the picture's OUTER footprint: the
  // placement frame itself is fixed (block-frame.js never moves it), and
  // picture-style.js/image-geometry.js rotate only the CONTENT inside it,
  // about the frame's own fixed centre, after swapping the inner target's
  // axes - a landscape localTarget rotated 90 degrees exactly refills the
  // SAME portrait frame it started in, never more or less of it (verified
  // numerically when sourceRectToFrameBounds() was built). Widening the box
  // here anyway - as if the frame itself had rotated and swapped its own
  // width/height - used to compute a NARROWER-in-one-axis, shifted gate
  // that could reject a query band the exact cutout path further down would
  // otherwise have found a real obstacle in, before that path ever ran.
  if (rotation % 90 === 0) {
    return { left: x - pad, top: y - pad, right: x + width + pad, bottom: y + height + pad };
  }
  // A genuinely in-between angle DOES grow the visual footprint beyond the
  // frame's own rectangle, so it is bounded rather than followed here. Copy
  // keeps clear of slightly more than it strictly must, which is the safe
  // direction; exact rotated silhouettes are not worth the arithmetic for a
  // case the Editor's own Rotate control cannot even produce.
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

  if (shape === 'cutout') {
    const envelope = exclusionEnvelope(image.mask);
    // The mask was rasterised over the TRIMMED cutout's own pixels
    // (cutout.service.js's occupancyMask(), at the cut-out media asset's own
    // width/height - D1 made that the SAME number image-geometry.js reads
    // as sourceWidth/sourceHeight). A naive `frameWidth / envelope.cols`
    // only agreed with that once the frame happened to share the source's
    // aspect ratio - true by construction the moment a picture is first
    // placed, but not any more once Phase E's independent-axis resize or a
    // non-'contain' fit mode can make the frame a different shape than its
    // source. Every occupied cell is resolved through the SAME transform
    // paint and resize already use (image-geometry.js's
    // sourceRectToFrameBounds()): crop, fit, flip, and now rotation too -
    // exact at 0/90/180/270 (the only turns the Editor's own Rotate control
    // ever persists; an axis-aligned rectangle rotated by a multiple of 90
    // degrees is still axis-aligned, so the bounding box of its four
    // transformed corners IS the transformed rectangle, not an
    // approximation). Anything this cannot represent exactly - an
    // in-between rotation angle, or a persisted crop narrower than the
    // whole source (paint does not draw that yet either - see
    // isWholeSourceCrop()'s own note) - falls through to the frame's own
    // conservative box below, matching what a rotated rect/ellipse already
    // does rather than inventing a new failure mode.
    const geometry = envelope ? resolvePlacedImage(image) : null;
    const exact = envelope && geometry
      && geometry.frame.width > 0 && geometry.frame.height > 0
      && geometry.rotation % 90 === 0
      && isWholeSourceCrop(geometry);

    if (exact) {
      const source = geometry.source;
      const cellW = (source.width || 1) / envelope.cols;
      const cellH = (source.height || 1) / envelope.rows;
      const visibleTop = top - pad;
      const visibleBottom = bottom + pad;

      // The mask grid is fixed and small (occupancyMask()'s own 44 rows), so
      // every occupied run is resolved individually rather than trying to
      // invert the transform to find which rows/columns the query band
      // could touch - cheaper to read correctly than to invert, and
      // `sourceRectToFrameBounds()` returns null (never a wrong shape) the
      // moment a run cannot be resolved exactly, which the "exact" gate
      // above already ruled out anyway.
      const runs = [];
      for (let r = 0; r < envelope.rows; r += 1) {
        let start = -1;
        for (let c = 0; c <= envelope.cols; c += 1) {
          const solid = c < envelope.cols && envelope.cells[r][c];
          if (solid && start === -1) start = c;
          if (!solid && start !== -1) {
            const rect = { x: start * cellW, y: r * cellH, width: (c - start) * cellW, height: cellH };
            const bounds = sourceRectToFrameBounds(geometry, rect);
            if (bounds && bounds.right > bounds.left && bounds.bottom > visibleTop && bounds.top < visibleBottom) {
              runs.push({ start: bounds.left - pad, end: bounds.right + pad });
            }
            start = -1;
          }
        }
      }
      return normalise(runs);
    }
    // Either no mask yet (the background has not actually been removed, so
    // the picture is still its box - saying otherwise would let copy run
    // through a subject that is about to appear), or a mask that cannot be
    // resolved exactly (non-quarter rotation, or a non-default crop paint
    // does not draw yet) - both fall through to the frame's own
    // conservative box below, computed by boxOf() above with its own
    // rotation handling, rather than trusting a stale, untransformed
    // silhouette.
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
