// The page canvas. Renders every section of the open page and, on live edits,
// repaints only the one section that changed (Part 14).

import { sectionRect } from "./canvas-geometry.js";
import { sectionInnerHtml, sectionClassName } from "./section-thumb.js";
import { menuMarkup, bindContextMenu, showContextMenu, hideContextMenu } from "./context-menu.js";
import { bindViewport, bindSpacebarPan, applyTransform, renderMiniMap } from "./canvas-view.js";
import { viewOfSection } from "../section-model.js";
import { computeMetrics } from "../layout/layout-metrics.js";

let handlers = {};

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

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;
  const { selectedSectionKey, draft, dirty } = selection;

  host.innerHTML = `
    <div class="canvas-viewport" id="canvasViewport">
      <div class="newspaper-canvas" id="canvasSurface" style="width:${pageWidth}px;height:${pageHeight}px;">
        ${page.sections
          .map((section) => {
            const rect = sectionRect(section, pageWidth, pageHeight);
            const view = viewOfSection(section, draft, selectedSectionKey);
            const selected = section.section_key === selectedSectionKey;
            const overflowing = computeMetrics(section, view).overflowing;
            return `
              <div class="${sectionClassName(view, { selected, dirty: selected && dirty, overflowing })}"
                   data-section-key="${section.section_key}"
                   style="left:${rect.leftPct}%;top:${rect.topPct}%;width:${rect.widthPct}%;height:${rect.heightPct}%;"
              >${sectionInnerHtml(section, view, { dirty: selected && dirty, selected })}</div>`;
          })
          .join("")}
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
  element.className = sectionClassName(view, { selected, dirty, overflowing });
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
