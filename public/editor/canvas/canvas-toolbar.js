// The strip above the canvas: page pills, layout picker, zoom control and the
// current-page indicator (Part 3).

import { ZOOM_LEVELS, setZoom, zoomBy, resetPan, effectiveScale, getZoomState } from "./canvas-view.js";

export function zoomControlMarkup() {
  return `
    <div class="zoom-control">
      <button type="button" class="zoom-step" id="zoomOut" title="Zoom out">−</button>
      <select id="zoomSelect" class="zoom-select" title="Zoom level">
        <option value="fit">Fit</option>
        ${ZOOM_LEVELS.map((level) => `<option value="${level}">${Math.round(level * 100)}%</option>`).join("")}
      </select>
      <button type="button" class="zoom-step" id="zoomIn" title="Zoom in">+</button>
      <button type="button" class="zoom-step" id="zoomReset" title="Reset pan">⤾</button>
    </div>
  `;
}

export function bindZoomControl() {
  document.getElementById("zoomIn")?.addEventListener("click", () => zoomBy(1.25));
  document.getElementById("zoomOut")?.addEventListener("click", () => zoomBy(1 / 1.25));
  document.getElementById("zoomReset")?.addEventListener("click", resetPan);
  document.getElementById("zoomSelect")?.addEventListener("change", (event) => {
    setZoom(event.target.value === "fit" ? "fit" : Number(event.target.value));
  });
  syncZoomControl();
}

// Wheel-zoom and Fit both change the scale without touching the select, so the
// control follows the canvas rather than pretending to drive it.
export function syncZoomControl() {
  const select = document.getElementById("zoomSelect");
  const readout = document.getElementById("zoomReadout");
  const { mode } = getZoomState();
  const scale = effectiveScale();

  if (select) {
    const exact = ZOOM_LEVELS.find((level) => Math.abs(level - scale) < 0.001);
    select.value = mode === "fit" ? "fit" : exact !== undefined ? String(exact) : "fit";
  }
  if (readout) readout.textContent = `${Math.round(scale * 100)}%`;
}

export function pageIndicatorMarkup(page, pages) {
  const index = pages.findIndex((p) => p.id === page?.id);
  return `
    <span class="page-indicator">
      Page <strong>${index >= 0 ? index + 1 : "—"}</strong> of ${pages.length}
      <span class="zoom-readout" id="zoomReadout"></span>
    </span>
  `;
}
