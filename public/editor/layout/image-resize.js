// Pure resize arithmetic for a placed picture's frame - eight handles
// (n/s/e/w plus the four corners), not the four corners this editor used to
// offer. An edge handle changes ONE axis; a corner changes both,
// independently by default; Shift preserves the aspect ratio on either
// kind. No DOM: block-frame.js supplies the pointer deltas and applies the
// returned rectangle.

/**
 * Resizes `rect` from one handle, by pointer delta `(dx, dy)`.
 *
 * `handle` is any of "n" "s" "e" "w" "ne" "nw" "se" "sw" - a handle only
 * ever moves the edges its own letters name, so "e" cannot touch height and
 * "se" always touches both. `preserveAspect` (Shift held) keeps the
 * rectangle's starting width/height ratio: a corner derives height from the
 * dragged width, anchored at the OPPOSITE corner (which never moves); an
 * edge has no opposite corner to anchor to, so it derives the other axis
 * symmetrically around the rectangle's own centre on that axis instead.
 */
export function resizeRect(rect, handle, dx, dy, options = {}) {
  const { bounds, minWidth = 24, minHeight = 24, preserveAspect = false } = options;
  const startRatio = rect.height / Math.max(1, rect.width);

  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  let x = rect.x;
  let y = rect.y;
  let width = rect.width;
  let height = rect.height;

  if (handle.includes('e')) width += dx;
  if (handle.includes('w')) { x += dx; width -= dx; }
  if (handle.includes('s')) height += dy;
  if (handle.includes('n')) { y += dy; height -= dy; }

  if (preserveAspect) {
    const touchesX = handle.includes('e') || handle.includes('w');
    const touchesY = handle.includes('n') || handle.includes('s');
    if (touchesX && touchesY) {
      // Corner: width is the primary axis (matching this project's
      // existing pre-8-handle corner behaviour), height follows it. The
      // anchor is whichever corner is diagonally OPPOSITE the one being
      // dragged - it must never move.
      height = width * startRatio;
      if (handle.includes('n')) y = bottom - height;
    } else if (touchesX) {
      const centerY = rect.y + rect.height / 2;
      height = width * startRatio;
      y = centerY - height / 2;
    } else if (touchesY) {
      const centerX = rect.x + rect.width / 2;
      width = height / Math.max(0.0001, startRatio);
      x = centerX - width / 2;
    }
  }

  // Minimum size, anchored on whichever edge the handle actually moved -
  // shrinking past the floor snaps that edge back rather than letting the
  // OPPOSITE edge drift, which would silently relocate the picture.
  if (width < minWidth) {
    if (handle.includes('w')) x = right - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (handle.includes('n')) y = bottom - minHeight;
    height = minHeight;
  }

  // Bounds clamp - a picture resized past the block/page edge is clipped
  // back to it, the edge that moved giving way rather than the picture
  // being allowed to hang off the page.
  if (bounds) {
    if (x < bounds.x) { width -= bounds.x - x; x = bounds.x; }
    if (y < bounds.y) { height -= bounds.y - y; y = bounds.y; }
    if (x + width > bounds.x + bounds.width) width = bounds.x + bounds.width - x;
    if (y + height > bounds.y + bounds.height) height = bounds.y + bounds.height - y;
    width = Math.max(minWidth, width);
    height = Math.max(minHeight, height);
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** The eight handles, in the order a caller typically renders them. */
export const RESIZE_HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
