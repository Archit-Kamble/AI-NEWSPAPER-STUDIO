// The page canvas. Renders every section of the open page and, on live edits,
// repaints only the one section that changed (Part 14).

import { sectionInnerHtml, sectionClassName } from "./section-thumb.js";
import { menuMarkup, bindContextMenu, showContextMenu, hideContextMenu } from "./context-menu.js";
import { bindViewport, bindSpacebarPan, applyTransform, renderMiniMap } from "./canvas-view.js";
import { gridOverlayMarkup, getGeometry } from "./grid.js";
import { mastheadMarkup, folioMarkup, pageFootMarkup, registrationMarkup, imprintMarkup } from "./masthead.js";
import { bindSectionDrag } from "./section-drag.js";
import { viewOfSection } from "../section-model.js";
import { computeMetrics } from "../layout/layout-metrics.js";

let handlers = {};

// A page that prints black only is not a design choice, it is what the press
// will do. Saying so on the page - and previewing the photographs in grey, which
// is how they will actually come out - is the difference between finding out
// now and finding out on the newsstand.
function monoWarningMarkup(page, geometry) {
  if (page.prints_colour !== false) return "";
  const pictures = (page.sections || []).filter(
    (section) => section.image_url || (section.images || []).length,
  );
  if (!pictures.length) return "";

  const left = geometry?.marginXPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  return `<div class="mono-forme-warning" style="left:${left}px;top:${(geometry?.marginYPx ?? 20) + 20}px;width:${width}px;">
      This page prints black only — ${pictures.length} photograph${pictures.length === 1 ? "" : "s"} will come out grey.
    </div>`;
}

function sectionElement(sectionKey) {
  return document.querySelector(`.newspaper-section[data-section-key="${CSS.escape(sectionKey)}"]`);
}

export function renderCanvas(page, newspaper, selection, callbacks = {}) {
  const host = document.getElementById("canvas");
  if (!host) return;

  handlers = { ...handlers, ...callbacks };

  if (!page) {
    host.innerHTML = `<p class="muted canvas-empty">No page selected.</p>`;
    return;
  }
  if (!page.sections?.length) {
    host.innerHTML = `<h3 class="canvas-empty">This page has no layout yet. Pick a layout above.</h3>`;
    return;
  }

  const geometry = getGeometry() || { marginXPx: 20, marginYPx: 20, matterWidthPx: 620, pageHeightPx: 1060 };
  const matterRight = geometry.marginXPx + geometry.matterWidthPx;
  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;
  const { selectedSectionKey, draft, dirty } = selection;

  host.innerHTML = `
    <div class="canvas-viewport" id="canvasViewport">
     <div class="canvas-sizer" id="canvasSizer">
      <div class="newspaper-canvas${page.prints_colour === false ? " mono-forme" : ""}${page.origin === "common" ? " common-page" : ""}"
           id="canvasSurface" style="width:${pageWidth}px;height:${pageHeight}px;">
        ${monoWarningMarkup(page, geometry)}
        ${gridOverlayMarkup()}
        <div class="align-guides" id="alignGuides"></div>
        ${mastheadMarkup(newspaper, page, geometry, {
          // The nameplate starts where the sold corner ends.
          advertWidthPx: (page.sections || []).find((s) => s.section_key === "masthead-advert")
            ? (page.sections.find((s) => s.section_key === "masthead-advert").width_px || 0) + 6
            : 0,
        })}
        ${folioMarkup(newspaper, page, geometry)}
        ${pageFootMarkup(newspaper, page, geometry)}
        ${imprintMarkup(newspaper, page, geometry)}
        ${registrationMarkup(geometry)}
        ${page.sections
          .map((section) => {
            const view = viewOfSection(section, draft, selectedSectionKey);
            const selected = section.section_key === selectedSectionKey;
            const overflowing = computeMetrics(section, view).overflowing;
            const atRightEdge = section.x_px + section.width_px >= matterRight - 2;
            // Positioned in page pixels, not percentages: the surface is a fixed
            // pixel canvas, and dragging has to write back the exact numbers
            // that get stored and printed.
            return `
              <div class="${sectionClassName(view, { selected, dirty: selected && dirty, overflowing, atRightEdge })}"
                   data-section-key="${section.section_key}"
                   style="left:${section.x_px}px;top:${section.y_px}px;width:${section.width_px}px;height:${section.height_px}px;"
              >${sectionInnerHtml(section, view, { dirty: selected && dirty, selected })}</div>`;
          })
          .join("")}
      </div>
     </div>
    </div>
    <div class="canvas-minimap" id="canvasMiniMap"></div>
    ${menuMarkup()}
  `;

  host.querySelectorAll(".newspaper-section").forEach((element) => {
    element.addEventListener("click", (event) => {
      const actionBtn = event.target.closest("[data-section-action]");
      if (actionBtn) {
        event.stopPropagation();
        handlers.onSectionAction?.(element.dataset.sectionKey, actionBtn.dataset.sectionAction);
        return;
      }
      handlers.onSelectSection?.(element.dataset.sectionKey);
    });

    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      handlers.onSelectSection?.(element.dataset.sectionKey);
      showContextMenu(element.dataset.sectionKey, event.clientX, event.clientY);
    });
  });

  bindContextMenu((sectionKey, action) => handlers.onSectionAction?.(sectionKey, action));
  bindSectionDrag((sectionKey, rect) => handlers.onMoveSection?.(sectionKey, rect));
  bindViewport();
  bindSpacebarPan();
  applyTransform();
  renderMiniMap(page, newspaper, selectedSectionKey);
}

// Part 14: repaint exactly one section. Used for every keystroke, so live
// preview costs one innerHTML write on one box.
export function refreshSection(section, view, { selected = false, dirty = false } = {}) {
  const element = sectionElement(section.section_key);
  if (!element) return;
  const overflowing = computeMetrics(section, view).overflowing;
  const g = getGeometry();
  const atRightEdge = g ? section.x_px + section.width_px >= g.marginXPx + g.matterWidthPx - 2 : false;
  element.className = sectionClassName(view, { selected, dirty, overflowing, atRightEdge });
  element.innerHTML = sectionInnerHtml(section, view, { dirty, selected });
}

// Selection moved: only the two affected boxes change, and only their chrome.
export function refreshSelection(previousKey, currentKey, sections, draft) {
  hideContextMenu();
  [previousKey, currentKey].filter(Boolean).forEach((key) => {
    const element = sectionElement(key);
    const section = sections?.find((s) => s.section_key === key);
    if (!element || !section) return;
    const selected = key === currentKey;
    element.classList.toggle("active", selected);
    const view = viewOfSection(section, draft, currentKey);
    element.innerHTML = sectionInnerHtml(section, view, { dirty: false, selected });
  });
  document.querySelectorAll(".minimap-block").forEach((block) => block.classList.remove("active"));
}
