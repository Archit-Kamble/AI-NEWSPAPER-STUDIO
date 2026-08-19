// The column grid, fetched once from GET /api/geometry.
//
// The numbers that decide how the page prints - px per mm, the matter box, the
// column positions, the baseline - are computed on the server in
// src/layout/geometry.js. This module holds the fetched copy and does the
// snapping maths for dragging. It never invents a number of its own.

let geometry = null;

export async function loadGeometry() {
  if (!geometry) geometry = await fetch("/api/geometry").then((r) => r.json());
  return geometry;
}

export function getGeometry() {
  return geometry;
}

const nearest = (value, points) =>
  points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function minWidthPx() {
  return Math.round(geometry?.columnPx || 60);
}
export function minHeightPx() {
  return (geometry?.baselinePx || 8) * 4;
}

export function matterBox() {
  const g = geometry;
  if (!g) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: g.marginXPx,
    top: g.marginYPx,
    right: g.marginXPx + g.matterWidthPx,
    bottom: g.marginYPx + g.matterHeightPx,
  };
}

// Snap a dragged rectangle onto the column grid horizontally and the baseline
// vertically, keeping it inside the matter box. Mirrors snapGeometry() in
// src/services/pageSection.service.js, which is authoritative - this exists so
// the block follows the pointer to the same place it will be saved.
export function snapRect(rect) {
  const g = geometry;
  if (!g) return rect;
  const box = matterBox();
  const minH = minHeightPx();

  // Left edge onto a column start, right edge onto a column end, so a block
  // always covers whole columns and never begins inside a gutter.
  const x = nearest(Math.round(rect.x), g.snapLeftPx);
  const rightCandidates = g.snapRightPx.filter((p) => p > x);
  const x2 = nearest(
    x + Math.round(rect.width),
    rightCandidates.length ? rightCandidates : [g.snapRightPx[g.snapRightPx.length - 1]],
  );

  const snapY = (v) => Math.round(v / g.baselinePx) * g.baselinePx;
  const y = clamp(snapY(rect.y), box.top, box.bottom - minH);
  const height = clamp(snapY(rect.height), minH, box.bottom - y);

  return { x, y, width: x2 - x, height };
}

// A free rectangle in the first gap big enough to hold it - where "Add block"
// puts a new block when the editor has not drawn one.
export function findFreeRect(sections, width, height) {
  const g = geometry;
  const box = matterBox();
  const step = g?.baselinePx || 8;
  const overlaps = (r) =>
    sections.some(
      (s) =>
        r.x < Number(s.x_px) + Number(s.width_px) &&
        Number(s.x_px) < r.x + r.width &&
        r.y < Number(s.y_px) + Number(s.height_px) &&
        Number(s.y_px) < r.y + r.height,
    );

  for (let y = box.top; y + height <= box.bottom; y += step) {
    for (const x of g?.snapLeftPx || [box.left]) {
      if (x + width > box.right) continue;
      const rect = { x, y, width, height };
      if (!overlaps(rect)) return rect;
    }
  }
  // Nothing free. The block still has to be added - refusing would be worse
  // than adding an overlapping one - but it may not be added exactly ON TOP of
  // the last one that was, which is what this used to do. The fallback rect
  // was a constant, so pressing "+ Block" on a full page N times produced N
  // blocks at identical coordinates. Measured on the fixture front page: eight
  // blocks at one spot, and only the last of them reachable - the other seven
  // could not be selected, dragged or deleted, because every click landed on
  // the one drawn over them. Preflight reported the collisions correctly and
  // the desk had no way to act on the report.
  //
  // So the fallback CASCADES, the way every layout tool offsets a duplicate:
  // one baseline step along and one up for each block already parked at the
  // spot, which leaves every block an edge of its own to be clicked on. It
  // still overlaps - the page is full, that is the honest state - but nothing
  // is ever hidden underneath.
  // The cascade moves a whole COLUMN across and a baseline up, never a bare
  // pixel step: snapRect() puts a left edge onto a column start, so nudging x
  // by `step` is snapped straight back where it came from and only the row
  // ever changed. Measured that way on a full page: block-1 at (20,848),
  // block-2 at (20,840), block-3 at (20,840) again - two of the three still
  // on top of each other.
  //
  // Candidates are therefore taken from the grid the block will be snapped to,
  // bottom row first and left to right, which is where a compositor drops one
  // more item on a finished page.
  const parked = (r) => sections.some(
    (s) => Math.abs(Number(s.x_px) - r.x) < 1 && Math.abs(Number(s.y_px) - r.y) < 1,
  );
  const columns = (g?.snapLeftPx || [box.left]).filter((left) => left + width <= box.right);
  const home = snapRect({ x: columns[0] ?? box.left, y: box.bottom - height, width, height });

  for (let row = 0; row < 40; row += 1) {
    const y = Math.max(box.top, box.bottom - height - row * step);
    for (const x of (columns.length ? columns : [box.left])) {
      const candidate = snapRect({ x, y, width, height });
      if (!parked(candidate)) return candidate;
    }
  }
  // Every origin on the grid is taken. Better a stack than no block at all.
  return home;
}

// The guide lines drawn under the page while a block is being dragged.
export function gridOverlayMarkup() {
  const g = geometry;
  if (!g) return "";
  const columns = [];
  for (let i = 0; i < g.gridColumns; i += 1) {
    const left = g.marginXPx + i * (g.columnPx + g.gutterPx);
    columns.push(
      `<span class="grid-column" style="left:${left}px;width:${Math.round(g.columnPx)}px"></span>`,
    );
  }
  return `
    <div class="canvas-grid" id="canvasGrid" aria-hidden="true">
      <span class="grid-matter" style="left:${g.marginXPx}px;top:${g.marginYPx}px;width:${g.matterWidthPx}px;height:${g.matterHeightPx}px"></span>
      ${columns.join("")}
    </div>
  `;
}
