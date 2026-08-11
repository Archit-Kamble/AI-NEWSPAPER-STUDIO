// Align tools for a multi-selection of pictures within one open block
// (Stage 7).
//
// Pictures are the one object here with real, freely-persisted X/Y/W/H -
// a block's geometry is always re-snapped to the column grid server-side
// (PROJECT_STATUS.md's Stage 5 finding), and headline/subheading/body have
// no coordinate at all, only a row count from the character grid. So
// pictures inside the currently open block are what this aligns; nothing
// else in the model has freely movable geometry to align against.

function boundsOf(rects) {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { left, top, right, bottom };
}

/**
 * `rows`: picture rows (x_px/y_px/width_px/height_px/id), at least 2.
 * `kind`: left | center | right | top | middle | bottom.
 *
 * Returns `{ [id]: { x } | { y } }` - only the axis the alignment moves,
 * one entry per row. Aligns to the bounding box of the WHOLE selection, the
 * convention every page-layout tool uses once more than two objects are
 * involved, rather than "everyone lines up with whichever was clicked last".
 */
export function computeAlignment(rows, kind) {
  if (!Array.isArray(rows) || rows.length < 2) return {};
  const rects = rows.map((r) => ({
    id: r.id,
    x: Number(r.x_px) || 0,
    y: Number(r.y_px) || 0,
    width: Number(r.width_px) || 0,
    height: Number(r.height_px) || 0,
  }));
  const box = boundsOf(rects);
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;

  const patches = {};
  for (const r of rects) {
    switch (kind) {
      case "left": patches[r.id] = { x: Math.round(box.left) }; break;
      case "right": patches[r.id] = { x: Math.round(box.right - r.width) }; break;
      case "center": patches[r.id] = { x: Math.round(centerX - r.width / 2) }; break;
      case "top": patches[r.id] = { y: Math.round(box.top) }; break;
      case "bottom": patches[r.id] = { y: Math.round(box.bottom - r.height) }; break;
      case "middle": patches[r.id] = { y: Math.round(centerY - r.height / 2) }; break;
      default: break;
    }
  }
  return patches;
}

export const ALIGN_KINDS = ["left", "center", "right", "top", "middle", "bottom"];
