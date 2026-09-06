// Moving and resizing a PANEL SET INSIDE A BLOCK - a fact box, a pull quote,
// a cross-head, a separator or a chart/table card - directly on the main
// canvas, the sheet a desk is actually looking at.
//
// Until this, a panel could only be dragged in the Block Editor's own
// mirrored page, which is the whole width of the screen further down, past
// the write-the-story panel. The desk's report named the gap exactly:
// "chart, table, separator, insert all should appear in editor as like a
// image so it can be adjustable, placed where editor want" - "insert" is a
// page overlay picture, and overlay-drag.js already gives THAT object this
// directness. A panel is the one editorial object left without it.
//
// Modelled on overlay-drag.js as closely as the two objects allow: same
// pointer-capture shape, same commit-once-on-release. Two differences, both
// because a panel is a different kind of thing to an overlay:
//
// - SCOPED TO THE SELECTED BLOCK ONLY. panelDragLayerMarkup() draws frames
//   for no other section, so a press can only ever land on the block already
//   open - there is nothing here that lets a desk move a panel that belongs
//   to a block they have not selected.
// - CLAMPED TO THE OWNING BLOCK, never the sheet. A panel is stored in that
//   block's own inset_panels and panelOf() at the service clamps it inside
//   that block's own width/height regardless of what reaches it, so clamping
//   to the sheet here would let the frame drift somewhere the save would
//   immediately snap it back from.
//
// It does NOT reflow the copy live while the pointer is down - overlay-drag
// does not either; both wait for the commit's structural repaint to show the
// real result. A panel's live-while-dragging reflow is a Block Editor nicety
// (block-frame.js's previewPanelRect), not the baseline this file matches.

import '../layout/inset-panels.js';
import { viewOfSection } from '../section-model.js';
const { panelsOf, INSET_PANEL_MIN_PX } = globalThis.SahasInsetPanels;

let onCommit = null;
let onSelect = null;
let active = null;

function surfaceScale(surface) {
  const rendered = surface.getBoundingClientRect().width;
  return rendered && surface.offsetWidth ? rendered / surface.offsetWidth : 1;
}

const HANDLES = ["nw", "ne", "sw", "se"];

/**
 * Frames for ONE section's own panels, in PAGE-absolute pixels (this layer is
 * a sibling of the sections, not nested inside one - the same reason the
 * page-overlay layer is - so it survives refreshSection()'s own innerHTML
 * rebuilds of the block underneath it untouched mid-drag). Only ever called
 * for the SELECTED section - see selectedPanelLayerMarkup() and
 * refreshPanelDragLayer() below, the two places that decide that.
 */
function panelFramesFor(section, view) {
  const panels = panelsOf({ ...section, inset_panels: view?.insetPanels ?? section?.inset_panels });
  return panels.map((panel) => {
    const handles = HANDLES.map((corner) =>
      `<span class="panel-drag-handle panel-drag-handle-${corner}" data-panel-drag-handle="${corner}"></span>`).join("");
    return `<div class="panel-drag-frame" data-panel-id="${panel.id}"
        data-section-key="${section.section_key}"
        style="left:${section.x_px + panel.x}px;top:${section.y_px + panel.y}px;width:${panel.width}px;height:${panel.height}px">${handles}</div>`;
  }).join("");
}

/** The layer for the page's own initial/full render - see renderCanvas(). */
export function panelDragLayerMarkup(page, draft, selectedSectionKey) {
  const section = (page?.sections || []).find((s) => s.section_key === selectedSectionKey);
  if (!section) return "<div class=\"panel-drag-layer\" data-panel-drag-layer></div>";
  const view = viewOfSection(section, draft, selectedSectionKey);
  return `<div class="panel-drag-layer" data-panel-drag-layer>${panelFramesFor(section, view)}</div>`;
}

/**
 * Keeps the layer in step with the SELECTED section's own repaint
 * (refreshSection() in canvas.js, which runs on nearly every keystroke and
 * does not touch this layer's own sibling element) or a change of selection
 * (refreshSelection()). Callers only invoke this for the section that IS or
 * IS BECOMING selected - a refresh of any other block leaves the layer alone,
 * since it belongs to whichever one is selected, not to the block that just
 * repainted. A no-op while a panel in it is being dragged, or the frame the
 * pointer is holding would be torn out from under it mid-gesture - the exact
 * trap block-frame.js's own renderPanelFrames() already avoids for the
 * identical reason.
 */
export function refreshPanelDragLayer(section, view) {
  const layer = document.querySelector("[data-panel-drag-layer]");
  if (!layer || layer.querySelector(".panel-drag-frame.is-dragging")) return;
  layer.innerHTML = section ? panelFramesFor(section, view) : "";
}

/**
 * @param commit  (sectionKey, panelId, {x, y, width, height}) - called once,
 *                on release, with the rectangle in the OWNING BLOCK's own
 *                local pixels (0,0 at that block's own top-left), which is
 *                the space page_sections.inset_panels is stored in - only
 *                when the rectangle actually changed.
 * @param select  the canvas's OWN block selection, so a press on a panel goes
 *                through the one path every other press on this sheet does.
 */
export function bindPanelDrag(surface, commit, select) {
  onCommit = commit;
  onSelect = select;
  if (!surface || surface.dataset.panelDragBound === "1") return;
  surface.dataset.panelDragBound = "1";

  surface.addEventListener("pointerdown", (event) => {
    const frame = event.target.closest(".panel-drag-frame");
    if (!frame) return;
    // Selected on POINTERDOWN, like every other object on this page.
    event.preventDefault();
    event.stopPropagation();

    const sectionEl = document.querySelector(
      `.newspaper-section[data-section-key="${CSS.escape(frame.dataset.sectionKey)}"]`,
    );
    if (!sectionEl) return;

    // ...and it is the BLOCK that is selected, not the panel. This layer is
    // only ever drawn for the block already open, so pressing a panel cannot
    // change which block a desk is on - what it restores is the gesture
    // documented for every other part of this page: clicking a block that is
    // already open selects the BLOCK itself, which is the only way back to
    // Border, Ground, Columns and Drop cap once the caret has been in the
    // body. Without it the press was swallowed by the stopPropagation above
    // and nothing at all happened over the panel's own rectangle - on a chart
    // panel a quarter of the block, on a cross-head its whole measure.
    onSelect?.(frame.dataset.sectionKey);

    const handle = event.target.closest("[data-panel-drag-handle]");
    const scale = surfaceScale(surface);
    active = {
      sectionKey: frame.dataset.sectionKey,
      panelId: frame.dataset.panelId,
      frame,
      corner: handle ? handle.dataset.panelDragHandle : null,
      startX: event.clientX,
      startY: event.clientY,
      scale,
      section: {
        x: parseFloat(sectionEl.style.left) || 0,
        y: parseFloat(sectionEl.style.top) || 0,
        width: parseFloat(sectionEl.style.width) || 0,
        height: parseFloat(sectionEl.style.height) || 0,
      },
      from: {
        x: parseFloat(frame.style.left) || 0,
        y: parseFloat(frame.style.top) || 0,
        width: parseFloat(frame.style.width) || 0,
        height: parseFloat(frame.style.height) || 0,
      },
    };
    frame.classList.add("is-dragging");
    frame.setPointerCapture?.(event.pointerId);
  });

  surface.addEventListener("pointermove", (event) => {
    if (!active) return;
    const dx = (event.clientX - active.startX) / active.scale;
    const dy = (event.clientY - active.startY) / active.scale;
    const next = rectFor(active, dx, dy);
    Object.assign(active.frame.style, {
      left: `${next.x}px`, top: `${next.y}px`,
      width: `${next.width}px`, height: `${next.height}px`,
    });
    active.next = next;
  });

  const release = (event) => {
    if (!active) return;
    const { sectionKey, panelId, from, next, section, frame } = active;
    frame.releasePointerCapture?.(event.pointerId);
    frame.classList.remove("is-dragging");
    active = null;
    if (!next) return;
    const moved = ["x", "y", "width", "height"].some((k) => Math.abs(next[k] - from[k]) > 0.5);
    if (!moved) return;
    // Back to the owning block's OWN local pixels - the frame was drawn in
    // page-absolute ones so it could sit as a sibling of every section.
    onCommit?.(sectionKey, panelId, {
      x: Math.round(next.x - section.x),
      y: Math.round(next.y - section.y),
      width: Math.round(next.width),
      height: Math.round(next.height),
    });
  };
  surface.addEventListener("pointerup", release);
  surface.addEventListener("pointercancel", release);
}

const MIN_PX = INSET_PANEL_MIN_PX || 24;

/** Where the panel goes for this pointer movement, clamped to its OWN block. */
function rectFor(state, dx, dy) {
  const { from, corner, section } = state;
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

  width = Math.min(width, section.width);
  height = Math.min(height, section.height);
  x = Math.min(Math.max(section.x, x), section.x + section.width - width);
  y = Math.min(Math.max(section.y, y), section.y + section.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
