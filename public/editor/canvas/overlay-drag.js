// Moving and resizing a picture that is laid ON THE PAGE, across blocks.
//
// The same shape as section-drag.js and for the same reasons: the picture
// follows the pointer live, the write happens once on release, and the canvas
// is scaled by a CSS transform so pointer pixels are measured against the
// surface rather than tracked from a zoom level.
//
// What it does NOT do is snap to the column grid. A block does, because a page
// reads as a page when its columns line up. A photograph laid across two
// stories is a deliberate break in that grid - that is the whole reason a desk
// reaches for one - so forcing it back onto the grid would remove the only
// thing it is for. It is still clamped to the sheet.

import { getGeometry } from "./grid.js";

let onCommit = null;
let active = null;
let selectedId = null;

function surfaceScale(surface) {
  const rendered = surface.getBoundingClientRect().width;
  return rendered && surface.offsetWidth ? rendered / surface.offsetWidth : 1;
}

const HANDLES = ["nw", "ne", "sw", "se"];

export function overlayHandlesMarkup() {
  return HANDLES.map((corner) =>
    `<span class="overlay-handle overlay-handle-${corner}" data-overlay-handle="${corner}"></span>`).join("");
}

export function selectedOverlayId() {
  return selectedId;
}

export function setSelectedOverlay(id) {
  selectedId = id == null ? null : String(id);
  document.querySelectorAll(".page-overlay").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.overlayId === selectedId);
  });
}

/**
 * @param commit  (id, {x, y, width, height}) - called once, on release, only
 *                when the rectangle actually changed.
 */
export function bindOverlayDrag(surface, commit) {
  onCommit = commit;
  if (!surface || surface.dataset.overlayDragBound === "1") return;
  surface.dataset.overlayDragBound = "1";

  surface.addEventListener("pointerdown", (event) => {
    const figure = event.target.closest(".page-overlay");
    if (!figure) {
      // A press anywhere else on the sheet drops the selection, so an overlay
      // never stays armed while a desk is working on a block.
      if (selectedId) setSelectedOverlay(null);
      return;
    }
    // Selected on POINTERDOWN, like every other object on this page - a click
    // is only dispatched when down and up land on the same element, and a
    // drag guarantees they do not.
    setSelectedOverlay(figure.dataset.overlayId);

    const handle = event.target.closest("[data-overlay-handle]");
    const scale = surfaceScale(surface);
    active = {
      id: figure.dataset.overlayId,
      figure,
      corner: handle ? handle.dataset.overlayHandle : null,
      startX: event.clientX,
      startY: event.clientY,
      scale,
      from: {
        x: parseFloat(figure.style.left) || 0,
        y: parseFloat(figure.style.top) || 0,
        width: parseFloat(figure.style.width) || 0,
        height: parseFloat(figure.style.height) || 0,
      },
    };
    figure.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  surface.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = (event.clientX - active.startX) / active.scale;
    const dy = (event.clientY - active.startY) / active.scale;
    const next = rectFor(active, dx, dy);
    Object.assign(active.figure.style, {
      left: `${next.x}px`, top: `${next.y}px`,
      width: `${next.width}px`, height: `${next.height}px`,
    });
    active.next = next;
  });

  const release = (event) => {
    if (!active) return;
    const { id, from, next } = active;
    active.figure.releasePointerCapture?.(event.pointerId);
    active = null;
    if (!next) return;
    const moved = ["x", "y", "width", "height"].some((k) => Math.abs(next[k] - from[k]) > 0.5);
    if (moved) onCommit?.(id, next);
  };
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);
}

const MIN_PX = 16;

/** Where the picture goes for this pointer movement, clamped to the sheet. */
function rectFor(state, dx, dy) {
  const g = getGeometry();
  const sheetW = g?.pageWidthPx ?? 660;
  const sheetH = g?.pageHeightPx ?? 1060;
  const { from, corner } = state;
  let { x, y, width, height } = from;

  if (!corner) {
    x = from.x + dx;
    y = from.y + dy;
  } else {
    if (corner.includes("w")) { x = from.x + dx; width = from.width - dx; }
    if (corner.includes("e")) { width = from.width + dx; }
    if (corner.includes("n")) { y = from.y + dy; height = from.height - dy; }
    if (corner.includes("s")) { height = from.height + dy; }
    if (width < MIN_PX) { if (corner.includes("w")) x = from.x + from.width - MIN_PX; width = MIN_PX; }
    if (height < MIN_PX) { if (corner.includes("n")) y = from.y + from.height - MIN_PX; height = MIN_PX; }
  }

  width = Math.min(width, sheetW);
  height = Math.min(height, sheetH);
  x = Math.min(Math.max(0, x), sheetW - width);
  y = Math.min(Math.max(0, y), sheetH - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
