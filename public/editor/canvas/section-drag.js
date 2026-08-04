// Moving and resizing blocks on the page.
//
// A page designer lays out a real inside page by dragging: a block is picked
// up, dropped on a column, pulled to the depth the story needs. Everything
// snaps to the column grid horizontally and the baseline vertically, so text
// lines up across the page the way it does in a national daily - the editor
// cannot accidentally place a block half a column off.
//
// The block follows the pointer live; the write happens once, on release.

import { snapRect, matterBox, minWidthPx, minHeightPx, getGeometry } from "./grid.js";
import { findAlignments, drawGuides, clearGuides } from "./align-guides.js";

let onCommit = null;
let active = null;

// The canvas is scaled by a CSS transform, so pointer pixels are not page
// pixels. Measure the surface rather than tracking the zoom level.
function surfaceScale(surface) {
  const rendered = surface.getBoundingClientRect().width;
  return rendered && surface.offsetWidth ? rendered / surface.offsetWidth : 1;
}

function applyRect(element, rect) {
  element.style.left = `${rect.x}px`;
  element.style.top = `${rect.y}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

// Which edges a handle moves. Anything not listed stays put.
const HANDLE_EDGES = {
  nw: { left: true, top: true },
  n: { top: true },
  ne: { right: true, top: true },
  e: { right: true },
  se: { right: true, bottom: true },
  s: { bottom: true },
  sw: { left: true, bottom: true },
  w: { left: true },
};

function resizedRect(start, handle, dx, dy) {
  const edges = HANDLE_EDGES[handle] || {};
  let { x, y, width, height } = start;
  let right = x + width;
  let bottom = y + height;

  if (edges.left) x += dx;
  if (edges.right) right += dx;
  if (edges.top) y += dy;
  if (edges.bottom) bottom += dy;

  // A handle dragged past the opposite edge would invert the block; clamp
  // instead, which is what every layout tool does.
  const minW = minWidthPx();
  const minH = minHeightPx();
  if (right - x < minW) {
    if (edges.left) x = right - minW;
    else right = x + minW;
  }
  if (bottom - y < minH) {
    if (edges.top) y = bottom - minH;
    else bottom = y + minH;
  }

  return { x, y, width: right - x, height: bottom - y };
}

function showGrid(on) {
  document.getElementById("canvasGrid")?.classList.toggle("visible", on);
  document.body.classList.toggle("dragging-block", on);
}

function beginDrag(event, element, handle) {
  const surface = document.getElementById("canvasSurface");
  if (!surface || !getGeometry()) return;

  event.preventDefault();
  event.stopPropagation();

  const scale = surfaceScale(surface);
  // Every other block on the page, measured once. Measuring them on each
  // pointermove would be re-reading the whole page sixty times a second.
  const others = [...surface.querySelectorAll(".newspaper-section")]
    .filter((el) => el !== element)
    .map((el) => ({
      x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight,
    }));

  active = {
    element,
    handle,
    others,
    sectionKey: element.dataset.sectionKey,
    startX: event.clientX,
    startY: event.clientY,
    scale,
    start: {
      x: element.offsetLeft,
      y: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    },
    moved: false,
  };

  element.setPointerCapture?.(event.pointerId);
  element.classList.add("dragging");
  showGrid(true);
}

function onPointerMove(event) {
  if (!active) return;
  const dx = (event.clientX - active.startX) / active.scale;
  const dy = (event.clientY - active.startY) / active.scale;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) active.moved = true;

  const box = matterBox();
  let rect;
  if (active.handle) {
    rect = resizedRect(active.start, active.handle, dx, dy);
  } else {
    rect = { ...active.start, x: active.start.x + dx, y: active.start.y + dy };
    // A moved block keeps its size and stays on the page.
    rect.x = Math.min(box.right - rect.width, Math.max(box.left, rect.x));
    rect.y = Math.min(box.bottom - rect.height, Math.max(box.top, rect.y));
  }

  // Snap to the grid first, then look for a neighbour to line up with. The grid
  // is the hard rule - a block must cover whole columns - and alignment is the
  // refinement inside it, so it can only ever move the block by a few pixels
  // and never off the column it just landed on.
  const snapped = snapRect(rect);
  const { adjustX, adjustY, guides } = findAlignments(snapped, active.others, {
    resizing: Boolean(active.handle),
  });

  if (active.handle) {
    // Resizing moves the edge under the hand, not the whole block.
    const edges = HANDLE_EDGES[active.handle] || {};
    if (edges.left) { snapped.x += adjustX; snapped.width -= adjustX; }
    else if (edges.right) snapped.width += adjustX;
    if (edges.top) { snapped.y += adjustY; snapped.height -= adjustY; }
    else if (edges.bottom) snapped.height += adjustY;
  } else {
    snapped.x += adjustX;
    snapped.y += adjustY;
  }

  drawGuides(guides);
  applyRect(active.element, snapped);
}

function endDrag(event) {
  if (!active) return;
  const { element, sectionKey, moved } = active;
  element.releasePointerCapture?.(event.pointerId);
  element.classList.remove("dragging");
  showGrid(false);
  clearGuides();

  const rect = {
    x: element.offsetLeft,
    y: element.offsetTop,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
  active = null;

  // A click that never moved is a selection, not a layout change - committing
  // it would write to the database on every click.
  if (moved) onCommit?.(sectionKey, rect);
}

export function bindSectionDrag(commit) {
  onCommit = commit;

  document.querySelectorAll(".newspaper-section").forEach((element) => {
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      // Buttons inside the block do their own job.
      if (event.target.closest("[data-section-action]")) return;

      const handle = event.target.closest(".section-handle");
      if (handle) return beginDrag(event, element, handle.dataset.handle);

      // Only the selected block moves, so a stray drag on a neighbour cannot
      // rearrange the page by accident.
      if (!element.classList.contains("active")) return;
      beginDrag(event, element, null);
    });

    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
  });
}
