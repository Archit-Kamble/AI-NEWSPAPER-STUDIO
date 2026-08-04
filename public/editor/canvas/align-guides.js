// Alignment guides — the red lines that appear while a block is being dragged.
//
// The column grid already stops a block landing half a column off, and the
// baseline already stops it landing between text lines. Neither tells a
// designer the thing they are actually looking for, which is: *is this block
// level with that one?*
//
// A page reads as designed when edges line up across it - the top of a report
// with the top of the picture beside it, the foot of a column with the foot of
// the one next to it. Getting that right by eye at 54% zoom is guesswork. So
// while a block moves, its edges are compared with every other block's edges,
// and when one is within a few pixels the block snaps to it and a line is drawn
// through both, the way every layout tool has done it for thirty years.
//
// Only edges that could actually be seen to align are offered: a vertical guide
// needs the two blocks to overlap horizontally somewhere, or the line would be
// pointing at a coincidence rather than a relationship.

const SNAP_PX = 6;

/** Every edge of a rectangle worth aligning to, on one axis. */
function edgesOf(rect, axis) {
  return axis === 'x'
    ? [
        { at: rect.x, kind: 'left' },
        { at: rect.x + rect.width / 2, kind: 'centre' },
        { at: rect.x + rect.width, kind: 'right' },
      ]
    : [
        { at: rect.y, kind: 'top' },
        { at: rect.y + rect.height / 2, kind: 'middle' },
        { at: rect.y + rect.height, kind: 'bottom' },
      ];
}

/**
 * Finds the nearest alignment on each axis, and returns both the correction to
 * apply and the lines to draw.
 *
 * `moving` is the rectangle being dragged; `others` are the rest of the blocks
 * on the page. `resizing` tells it not to shift the whole block - when a handle
 * is being pulled, only the edge under the hand should move.
 */
export function findAlignments(moving, others, { resizing = false } = {}) {
  const guides = [];
  let adjustX = 0;
  let adjustY = 0;

  for (const axis of ['x', 'y']) {
    const movingEdges = edgesOf(moving, axis);
    let best = null;

    for (const other of others) {
      for (const target of edgesOf(other, axis)) {
        for (const edge of movingEdges) {
          const distance = Math.abs(edge.at - target.at);
          if (distance > SNAP_PX) continue;
          if (best && distance >= best.distance) continue;
          best = { distance, at: target.at, delta: target.at - edge.at, kind: edge.kind, other };
        }
      }
    }

    if (!best) continue;
    if (axis === 'x') adjustX = best.delta;
    else adjustY = best.delta;

    // The line spans from the topmost to the bottommost of the two blocks (or
    // leftmost to rightmost), so it visibly connects the pair it is about
    // rather than running the whole page and meaning nothing.
    const a = moving;
    const b = best.other;
    guides.push(
      axis === 'x'
        ? {
            axis: 'x',
            at: best.at,
            from: Math.min(a.y, b.y),
            to: Math.max(a.y + a.height, b.y + b.height),
            kind: best.kind,
          }
        : {
            axis: 'y',
            at: best.at,
            from: Math.min(a.x, b.x),
            to: Math.max(a.x + a.width, b.x + b.width),
            kind: best.kind,
          },
    );
  }

  // Resizing must not translate the block - the correction belongs to whichever
  // edge is under the hand, and the caller applies it there.
  return { adjustX, adjustY, guides, resizing };
}

/** Draws the guides onto the page's overlay. */
export function drawGuides(guides) {
  const layer = document.getElementById('alignGuides');
  if (!layer) return;
  layer.innerHTML = guides
    .map((guide) =>
      guide.axis === 'x'
        ? `<span class="align-guide align-guide-v" style="left:${guide.at}px;top:${guide.from}px;height:${guide.to - guide.from}px;"></span>`
        : `<span class="align-guide align-guide-h" style="top:${guide.at}px;left:${guide.from}px;width:${guide.to - guide.from}px;"></span>`,
    )
    .join('');
}

export function clearGuides() {
  const layer = document.getElementById('alignGuides');
  if (layer) layer.innerHTML = '';
}
