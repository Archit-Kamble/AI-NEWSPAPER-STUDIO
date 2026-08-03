// The page canvas. Renders every section of the open page and, on live edits,
// repaints only the one section that changed (Phase 11).

import { sectionRect } from "./canvas-geometry.js";
import { sectionInnerHtml, sectionClassName } from "./section-thumb.js";
import { viewOfSection } from "../section-model.js";

let handlers = { onSelectSection: null, onSectionAction: null };

function sectionElement(sectionKey) {
  return document.querySelector(`.newspaper-section[data-section-key="${CSS.escape(sectionKey)}"]`);
}

export function renderCanvas(page, newspaper, selection, callbacks = {}) {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;

  handlers = { ...handlers, ...callbacks };

  if (!page) {
    canvas.innerHTML = `<p class="muted">No page selected.</p>`;
    return;
  }
  if (!page.sections || !page.sections.length) {
    canvas.innerHTML = `<h3>This page has no layout yet. Pick a layout above.</h3>`;
    return;
  }

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;
  const { selectedSectionKey, draft, dirty } = selection;

  canvas.innerHTML = `
    <div class="newspaper-canvas" style="aspect-ratio:${pageWidth}/${pageHeight};">
      ${page.sections
        .map((section) => {
          const rect = sectionRect(section, pageWidth, pageHeight);
          const view = viewOfSection(section, draft, selectedSectionKey);
          const selected = section.section_key === selectedSectionKey;
          return `
            <div
              class="${sectionClassName(view, { selected, dirty: selected && dirty })}"
              data-section-key="${section.section_key}"
              style="left:${rect.leftPct}%;top:${rect.topPct}%;width:${rect.widthPct}%;height:${rect.heightPct}%;"
            >${sectionInnerHtml(section, view, { dirty: selected && dirty })}</div>
          `;
        })
        .join("")}
    </div>
  `;

  canvas.querySelectorAll(".newspaper-section").forEach((element) => {
    element.addEventListener("click", (event) => {
      const actionBtn = event.target.closest("[data-section-action]");
      if (actionBtn) {
        event.stopPropagation();
        handlers.onSectionAction?.(element.dataset.sectionKey, actionBtn.dataset.sectionAction);
        return;
      }
      handlers.onSelectSection?.(element.dataset.sectionKey);
    });
  });
}

// Phase 11: repaint exactly one section. Used for every keystroke in the editor
// so live preview costs one innerHTML write on one box, not a full re-render.
export function refreshSection(section, view, { selected = false, dirty = false } = {}) {
  const element = sectionElement(section.section_key);
  if (!element) return;
  element.className = sectionClassName(view, { selected, dirty });
  element.innerHTML = sectionInnerHtml(section, view, { dirty });
}

// Selection moved: only the two affected boxes need their classes updated.
export function refreshSelection(previousKey, currentKey) {
  if (previousKey) sectionElement(previousKey)?.classList.remove("active");
  if (currentKey) sectionElement(currentKey)?.classList.add("active");
}
