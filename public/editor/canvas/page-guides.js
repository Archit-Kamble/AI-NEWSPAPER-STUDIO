// Ruler guides on the newspaper page (Stage 4) - purely visual/reference
// lines a desk drags off a ruler.
//
// Stage 5 adds snapping: findGuideSnaps() below is the one place that turns
// the current guide list into snap candidates for a block being dragged
// (section-drag.js is the only caller - see that file for why blocks are the
// only object that shares this coordinate space). A guide's own position is
// never touched by a snap; only the object being dragged moves.
//
// Guides are drawn as children of #canvasSurface - the page itself, already
// scaled by canvas-view.js's CSS transform - so a guide's `top`/`left` is set
// once, in raw page pixels, and the browser scales/positions it exactly as it
// does every block on the page. No zoom or scroll math is needed for the
// guides themselves; only the ruler (ruler.js) has to do that, because it
// lives OUTSIDE the transformed page.

import { toPageCoords } from "./ruler.js";

// How far outside the page's own box a release still counts as "on the
// page" (small - a few px of forgiving margin) versus "off the page, and the
// ruler is thicker than this, so a guide dropped back on the ruler always
// deletes" (large enough to require a deliberate drag, not an accidental
// jitter at the very edge).
const DROP_TOLERANCE_PX = 8;

function surface() {
  return document.getElementById("canvasSurface");
}

function withinPage(clientX, clientY) {
  const rect = surface()?.getBoundingClientRect();
  if (!rect) return false;
  return (
    clientX >= rect.left - DROP_TOLERANCE_PX && clientX <= rect.right + DROP_TOLERANCE_PX &&
    clientY >= rect.top - DROP_TOLERANCE_PX && clientY <= rect.bottom + DROP_TOLERANCE_PX
  );
}

export function guideLayerMarkup() {
  return `<div class="page-guides" id="pageGuides"></div>`;
}

function guideMarkup(guide) {
  const position = Number(guide.position_px) || 0;
  const cls = guide.orientation === "horizontal" ? "page-guide page-guide-h" : "page-guide page-guide-v";
  const style = guide.orientation === "horizontal" ? `top:${position}px` : `left:${position}px`;
  return `<div class="${cls}" data-guide-id="${guide.id}" style="${style}">
    <span class="page-guide-hit" data-guide-hit title="Drag to move - drag off the page to remove"></span>
  </div>`;
}

// The current guide list and visibility, kept live here so section-drag.js
// can read "what can I snap to right now" at drag time without a snapshot
// going stale - the same pattern grid.js's getGeometry() already uses.
let currentGuides = [];
let currentlyVisible = true;

/** Draws the current guide list. Called on load, and after any create/move/delete. */
export function renderGuides(guides) {
  currentGuides = guides || [];
  const layer = document.getElementById("pageGuides");
  if (!layer) return;
  layer.innerHTML = currentGuides.map(guideMarkup).join("");
}

export function setGuidesVisible(visible) {
  currentlyVisible = visible;
  document.getElementById("pageGuides")?.classList.toggle("guides-hidden", !visible);
}

export function getGuides() {
  return currentGuides;
}

export function getGuidesVisible() {
  return currentlyVisible;
}

/** Emphasizes the guide(s) an in-progress drag is currently snapped to - the
 * guide line itself is the indicator, so nothing new is drawn on top of it. */
export function setActiveGuides(ids) {
  document.querySelectorAll("#pageGuides .page-guide").forEach((el) => {
    el.classList.toggle("is-target", ids.includes(Number(el.dataset.guideId)));
  });
}

// How close an object's edge must come to a user guide before it snaps -
// matches align-guides.js's own SNAP_PX exactly, so the two soft-refinement
// systems (line-up-with-a-neighbour, line-up-with-a-guide) feel identical
// under the same hand on the mouse. Both operate in page pixels, never
// screen pixels, so the same threshold means the same physical distance at
// any zoom.
const GUIDE_SNAP_PX = 6;

/**
 * Closest vertical guide to the rect's left/centre/right, and closest
 * horizontal guide to its top/middle/bottom - found independently, so a
 * drag can snap on both axes at once. A guide's own stored position is only
 * ever read here, never written: the caller moves the OBJECT to match it.
 */
export function findGuideSnaps(rect, guides) {
  let adjustX = 0;
  let activeX = null;
  let bestXDistance = Infinity;
  const xEdges = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  for (const guide of guides) {
    if (guide.orientation !== "vertical") continue;
    const at = Number(guide.position_px);
    for (const edge of xEdges) {
      const distance = Math.abs(edge - at);
      if (distance > GUIDE_SNAP_PX || distance >= bestXDistance) continue;
      bestXDistance = distance;
      adjustX = at - edge;
      activeX = guide.id;
    }
  }

  let adjustY = 0;
  let activeY = null;
  let bestYDistance = Infinity;
  const yEdges = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
  for (const guide of guides) {
    if (guide.orientation !== "horizontal") continue;
    const at = Number(guide.position_px);
    for (const edge of yEdges) {
      const distance = Math.abs(edge - at);
      if (distance > GUIDE_SNAP_PX || distance >= bestYDistance) continue;
      bestYDistance = distance;
      adjustY = at - edge;
      activeY = guide.id;
    }
  }

  return { adjustX, adjustY, activeX, activeY };
}

/**
 * A drag that starts on the ruler and ends on the page creates a guide; ends
 * anywhere else, nothing happens. The database is written exactly once, on
 * release - never during the drag.
 */
function bindRulerCreate(hooks) {
  const start = (orientation) => (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();

    const preview = document.createElement("div");
    preview.className = `page-guide ${orientation === "horizontal" ? "page-guide-h" : "page-guide-v"} page-guide-preview`;
    preview.style.display = "none";
    surface()?.appendChild(preview);

    const move = (moveEvent) => {
      const inside = withinPage(moveEvent.clientX, moveEvent.clientY);
      preview.style.display = inside ? "" : "none";
      if (!inside) return;
      const { x, y } = toPageCoords(moveEvent.clientX, moveEvent.clientY);
      if (orientation === "horizontal") preview.style.top = `${Math.round(y)}px`;
      else preview.style.left = `${Math.round(x)}px`;
    };
    const finish = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      preview.remove();

      if (!withinPage(upEvent.clientX, upEvent.clientY)) return; // released off the page - nothing created
      const { x, y } = toPageCoords(upEvent.clientX, upEvent.clientY);
      hooks.onCreateGuide?.(orientation, Math.round(orientation === "horizontal" ? y : x));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };

  document.getElementById("canvasRulerH")?.addEventListener("pointerdown", start("horizontal"));
  document.getElementById("canvasRulerV")?.addEventListener("pointerdown", start("vertical"));
}

/**
 * Dragging an existing guide. Moves visually every frame; the database is
 * touched once, on release - a new position if the release is on the page,
 * a delete if it is not (the primary, and only, deletion gesture).
 */
function bindGuideMove(hooks) {
  const layer = document.getElementById("pageGuides");
  if (!layer || layer.dataset.moveBound === "true") return;
  layer.dataset.moveBound = "true";

  layer.addEventListener("pointerdown", (event) => {
    const hit = event.target.closest("[data-guide-hit]");
    if (!hit) return;
    const guideEl = hit.closest(".page-guide");
    const id = Number(guideEl?.dataset.guideId);
    if (!guideEl || !id) return;

    // Grabbing the guide wins over anything underneath it (an image, a
    // block) - the ordinary click never reaches them from here.
    event.preventDefault();
    event.stopPropagation();

    const orientation = guideEl.classList.contains("page-guide-h") ? "horizontal" : "vertical";
    guideEl.classList.add("is-dragging");

    const move = (moveEvent) => {
      const { x, y } = toPageCoords(moveEvent.clientX, moveEvent.clientY);
      if (orientation === "horizontal") guideEl.style.top = `${Math.round(y)}px`;
      else guideEl.style.left = `${Math.round(x)}px`;
      guideEl.classList.toggle("will-remove", !withinPage(moveEvent.clientX, moveEvent.clientY));
    };
    const finish = (upEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      guideEl.classList.remove("is-dragging", "will-remove");

      if (!withinPage(upEvent.clientX, upEvent.clientY)) {
        hooks.onDeleteGuide?.(id);
        return;
      }
      const { x, y } = toPageCoords(upEvent.clientX, upEvent.clientY);
      hooks.onMoveGuide?.(id, Math.round(orientation === "horizontal" ? y : x));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  });
}

/**
 * `hooks`: { onCreateGuide(orientation, positionPx), onMoveGuide(id,
 * positionPx), onDeleteGuide(id) } - workspace.js supplies the ones that
 * actually talk to the server; this module only ever decides WHEN to call
 * them, never how a guide is persisted.
 */
export function bindGuideInteractions(hooks) {
  bindRulerCreate(hooks);
  bindGuideMove(hooks);
}
