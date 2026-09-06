// A BLOCK IS A RECTANGLE, UNTIL A CORNER IS CUT OFF IT.
//
// The desk's report: "our layout blocks are rectangle make them with
// different shapes." What this file offers is deliberately narrower than
// "any polygon" - a rectangle with one or more of its corners cut off at 45
// degrees - and that narrowness is the whole safety argument.
//
// THE COMPOSITOR'S SCANLINE ALGORITHM IS NOT TOUCHED. Every cut corner is an
// OBSTACLE, in exactly the vocabulary a photograph and a चौकट panel already
// are (compose/exclusion.js's `obstacleIntervals`, fed by section-adapter.js's
// `obstaclesOf`) - a rectangle (here, a triangle) the pour already knows how
// to keep type clear of. `fillRow`, `viableIntervals` and the balancer do not
// gain one new line of code; they simply route around one more shape, the way
// they already route around a drop cap, a picture and a panel. A genuinely
// new outline - a hexagon, a ribbon with a concave notch - would need the
// compositor itself to understand a new obstacle geometry, which is exactly
// the "replace the compositor" move CLAUDE.md's engineering rules already
// forbid without the kind of exhaustive measurement this session's remaining
// budget cannot respons­ibly spend. A corner cut is the shape this budget can
// prove correct.
//
// THE CANVAS, THE OBSTACLE AND THE EXPORT DRAW THE SAME POLYGON. One function
// (`shapedRectPoints`) computes it; canvas.js turns it into a CSS
// `clip-path`, section-adapter.js turns the same corners into obstacle boxes,
// and print-model.js turns it into the one stroked/filled `poly` item every
// writer already draws roundedRectPoints() through. A clip that did not match
// its own exclusion would crop live text at the very corner this exists to
// decorate - the one failure mode that matters here, and it is why this file
// is the single source both readers use.

/**
 * Eleven shapes, plus the rectangle every block already is.
 *
 * `corners` names which corners are cut, each `'tl'|'tr'|'bl'|'br'` -
 * `exclusion.js`'s own vocabulary, not invented here. `cutShare` is the
 * depth of each cut as a fraction of the block's SHORTER side, clamped
 * below so a very shallow block never has its two cuts meet and cross -
 * see `cutPx` below.
 */
export const BLOCK_SHAPES = [
  { key: 'rectangle', label: 'Rectangle', corners: [], cutShare: 0 },
  // One corner - a torn-ticket notch, the commonest device: a highlighted
  // quote or a category label with one corner folded back.
  { key: 'notch-tr', label: 'Notched corner (top right)', corners: ['tr'], cutShare: 0.16 },
  { key: 'notch-tl', label: 'Notched corner (top left)', corners: ['tl'], cutShare: 0.16 },
  { key: 'notch-br', label: 'Notched corner (bottom right)', corners: ['br'], cutShare: 0.16 },
  { key: 'notch-bl', label: 'Notched corner (bottom left)', corners: ['bl'], cutShare: 0.16 },
  // Two opposite corners - reads as a slanted, chevron-like panel. Common
  // for a page's lead device or a section's own banner block.
  { key: 'chevron', label: 'Chevron (diagonal corners)', corners: ['tl', 'br'], cutShare: 0.14 },
  { key: 'chevron-alt', label: 'Chevron (other diagonal)', corners: ['tr', 'bl'], cutShare: 0.14 },
  // Two cuts on the SAME side make a restrained bevel. This is the useful
  // newspaper version of a trapezoid: a section strip, profile panel or data
  // block can gain direction while all copy still runs around the two exact
  // corner obstacles the compositor already understands.
  { key: 'bevel-top', label: 'Bevelled top', corners: ['tl', 'tr'], cutShare: 0.24 },
  { key: 'bevel-bottom', label: 'Bevelled bottom', corners: ['bl', 'br'], cutShare: 0.24 },
  { key: 'bevel-left', label: 'Bevelled left', corners: ['tl', 'bl'], cutShare: 0.24 },
  { key: 'bevel-right', label: 'Bevelled right', corners: ['tr', 'br'], cutShare: 0.24 },
  // All four - the octagon panel a printed page uses for a badge, a stat box
  // or a standout fact.
  { key: 'octagon', label: 'Octagon (all corners)', corners: ['tl', 'tr', 'bl', 'br'], cutShare: 0.12 },
];

export const BLOCK_SHAPE_KEYS = BLOCK_SHAPES.map((s) => s.key);

export function blockShapeOf(key) {
  return BLOCK_SHAPES.find((s) => s.key === key) || BLOCK_SHAPES[0];
}

export function sanitiseBlockShape(value) {
  const key = String(value ?? '').trim();
  return BLOCK_SHAPE_KEYS.includes(key) && key !== 'rectangle' ? key : null;
}

/**
 * The cut depth in editor px, for a block of this width/height.
 *
 * A share of the SHORTER side, so a wide banner and a tall sidebar both get a
 * cut that reads as the same proportion rather than a fixed number of pixels
 * looking generous on a small block and trivial on a large one. Halved again
 * when two cuts share an edge (chevron, octagon) so the two triangles on one
 * side can never meet or cross - the geometry that would make the "excluded"
 * region ambiguous.
 */
export function cutPx(shape, widthPx, heightPx) {
  const shorter = Math.min(Number(widthPx) || 0, Number(heightPx) || 0);
  if (shorter <= 0) return 0;
  const perEdgeCorners = new Map();
  for (const corner of shape.corners) {
    for (const edge of edgesOf(corner)) {
      perEdgeCorners.set(edge, (perEdgeCorners.get(edge) || 0) + 1);
    }
  }
  const sharesAnEdge = [...perEdgeCorners.values()].some((n) => n > 1);
  const raw = shorter * shape.cutShare;
  // Never more than 45% of the shorter side even unshared, and halved again
  // when shared - both bounds exist so two triangles on one block can never
  // touch, which is what would make `obstacleIntervals` describe a shape
  // that is not actually a simple corner cut any more.
  const bounded = Math.min(raw, shorter * 0.45);
  return sharesAnEdge ? bounded / 2 : bounded;
}

function edgesOf(corner) {
  // Which of the block's four edges a corner sits on.
  const map = { tl: ['top', 'left'], tr: ['top', 'right'], bl: ['bottom', 'left'], br: ['bottom', 'right'] };
  return map[corner] || [];
}

/**
 * THE OBSTACLE BOXES - one per cut corner, in the SAME coordinate space the
 * block's own x_px/y_px live in (page pixels, not block-local), which is
 * what `obstaclesOf()` in section-adapter.js already expects every entry it
 * pushes to be in.
 */
export function cornerObstacles(shapeKey, x, y, width, height) {
  const shape = blockShapeOf(shapeKey);
  if (!shape.corners.length) return [];
  const d = cutPx(shape, width, height);
  if (d <= 0) return [];
  return shape.corners.map((corner) => {
    const box = corner === 'tl' ? { x, y }
      : corner === 'tr' ? { x: x + width - d, y }
        : corner === 'bl' ? { x, y: y + height - d }
          : { x: x + width - d, y: y + height - d };
    return { shape: 'corner', corner, x: box.x, y: box.y, width: d, height: d, standOffPx: 0 };
  });
}

/**
 * THE ROUNDED-CORNER OBSTACLE BOXES - the same idea as `cornerObstacles()`,
 * for a block whose Corner control (border_radius_px) is rounded rather than
 * cut. A cut corner is a straight 45deg chord and exclusion.js's 'corner'
 * shape traces exactly that; a circular arc's own missing sliver is LARGER
 * than that chord (the arc bulges toward the block's own corner point more
 * than a straight diagonal does), so tracing it as a triangle would still
 * leave a thin wedge where composed type could sit outside the rounded
 * shape's own visible ink. These are plain rectangles instead - the same
 * default `exclusionIntervals()` already gives an obstacle with no `shape`
 * at all - one full radius-by-radius square per corner, which is a superset
 * of the true missing sliver and therefore never under-excludes it.
 *
 * Radius is clamped to half the shorter side, mirroring the clamp
 * `borderRadiusPx()`'s own CSS already applies (a `pill` radius is an end
 * cap, not a shape that folds through itself) - a block with no shape and no
 * ordinary rounding calls this with radius 0 and gets nothing back.
 */
export function roundedCornerObstacles(radiusPx, x, y, width, height) {
  const r = Math.max(0, Math.min(Number(radiusPx) || 0, Math.min(width, height) / 2));
  if (r <= 0) return [];
  return [
    { x, y, width: r, height: r, standOffPx: 0 },
    { x: x + width - r, y, width: r, height: r, standOffPx: 0 },
    { x, y: y + height - r, width: r, height: r, standOffPx: 0 },
    { x: x + width - r, y: y + height - r, width: r, height: r, standOffPx: 0 },
  ];
}

/**
 * THE VISIBLE POLYGON - a closed point list, clockwise from the top-left,
 * in the block's OWN LOCAL coordinates (0,0 at its own top-left corner),
 * which is what a CSS `clip-path: polygon()` and print-model.js's `poly`
 * item both want. Straight edges between cuts come free, the same way
 * `roundedRectPoints()`'s arcs already join into a path with no extra code
 * for the runs between them.
 */
export function shapedRectPoints(shapeKey, width, height) {
  const shape = blockShapeOf(shapeKey);
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!shape.corners.length) return [[0, 0], [w, 0], [w, h], [0, h]];
  const d = cutPx(shape, w, h);
  const cut = new Set(shape.corners);
  const points = [];
  // Walk the four corners clockwise from top-left; a cut corner contributes
  // its two flanking points instead of the one square corner.
  if (cut.has('tl')) { points.push([0, d], [d, 0]); } else { points.push([0, 0]); }
  if (cut.has('tr')) { points.push([w - d, 0], [w, d]); } else { points.push([w, 0]); }
  if (cut.has('br')) { points.push([w, h - d], [w - d, h]); } else { points.push([w, h]); }
  if (cut.has('bl')) { points.push([d, h], [0, h - d]); } else { points.push([0, h]); }
  return points;
}

/** The same polygon as a CSS `clip-path: polygon(...)` value, in percent. */
export function clipPathFor(shapeKey, width, height) {
  const points = shapedRectPoints(shapeKey, width, height);
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  return `polygon(${points.map(([x, y]) => `${((x / w) * 100).toFixed(2)}% ${((y / h) * 100).toFixed(2)}%`).join(', ')})`;
}
