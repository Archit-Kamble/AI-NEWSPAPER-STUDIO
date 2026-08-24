// The page canvas. Renders every section of the open page and, on live edits,
// repaints only the one section that changed (Part 14).

import { sectionInnerHtml, sectionClassName } from "./section-thumb.js";
import { menuMarkup, bindContextMenu, showContextMenu, hideContextMenu } from "./context-menu.js";
import { bindViewport, bindSpacebarPan, applyTransform, renderMiniMap } from "./canvas-view.js";
import { gridOverlayMarkup, getGeometry } from "./grid.js";
import {
  mastheadMarkup, folioMarkup, pageFootMarkup, registrationMarkup, imprintMarkup, contentRegion,
} from "./masthead.js";
import { columnRulesMarkup } from "./column-rules.js";
import "../layout/borders.js";
import { bindSectionDrag } from "./section-drag.js";
import { viewOfSection } from "../section-model.js";
import { computeMetrics } from "../layout/layout-metrics.js";
import { rulerMarkup, rebuildRulers, bindRulers } from "./ruler.js";
const { isRuled, borderWidthPx } = globalThis.SahasBorders;
import { guideLayerMarkup, renderGuides, bindGuideInteractions, setGuidesVisible } from "./page-guides.js";

let handlers = {};
// The page last drawn. refreshSection() repaints ONE block without being handed
// the page again, and it has to know where the matter's content band ends to
// decide whether that block is ruled off below - the same question renderCanvas()
// answers for all of them. Kept here rather than re-derived from the DOM: the
// band is a fact about the page, not about what happens to be on screen.
let renderedPage = null;

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

  renderedPage = page;
  const geometry = getGeometry() || { marginXPx: 20, marginYPx: 20, matterWidthPx: 620, pageHeightPx: 1060 };
  const matterRight = geometry.marginXPx + geometry.matterWidthPx;
  const contentBottom = contentRegion(geometry, page).bottom;
  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;
  const { selectedSectionKey, draft, dirty } = selection;

  host.innerHTML = `
    ${rulerMarkup()}
    <div class="canvas-viewport" id="canvasViewport">
     <div class="canvas-sizer" id="canvasSizer">
      <!-- The gutters are published as custom properties because the COLUMN
           RULES are drawn in them, and a rule that is not exactly centred in
           its gutter is worse than no rule at all - the eye reads it as
           belonging to one of the two stories. One source (geometry.js), so
           the stylesheet can never hold a second, drifted copy of the grid. -->
      <div class="newspaper-canvas${page.prints_colour === false ? " mono-forme" : ""}${page.origin === "common" ? " common-page" : ""}"
           id="canvasSurface" style="width:${pageWidth}px;height:${pageHeight}px;`
        + `--gutter-x:${geometry.gutterPx}px;--gutter-y:${geometry.baselinePx}px;">
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
        <!-- Under the blocks, because a rule is what the page shows BETWEEN
             two stories - anything a block draws sits on top of it. -->
        ${columnRulesMarkup(page, geometry)}
        ${page.sections
          .map((section) => {
            const view = viewOfSection(section, draft, selectedSectionKey);
            const selected = section.section_key === selectedSectionKey;
            const overflowing = computeMetrics(section, view).overflowing;
            const atRightEdge = section.x_px + section.width_px >= matterRight - 2;
            // Nothing below it but the page foot, so nothing to be ruled off
            // from - see contentRegion().
            const atFootEdge = section.y_px + section.height_px >= contentBottom - 2;
            // Positioned in page pixels, not percentages: the surface is a fixed
            // pixel canvas, and dragging has to write back the exact numbers
            // that get stored and printed.
            return `
              <div class="${sectionClassName(view, { selected, dirty: selected && dirty, overflowing, atRightEdge, atFootEdge, hasImages: Boolean((section.images || []).length) })}"
                   data-section-key="${section.section_key}"
                   style="left:${section.x_px}px;top:${section.y_px}px;width:${section.width_px}px;height:${section.height_px}px;`
              + `${view.backgroundColor ? `--block-tint:${view.backgroundColor};` : ""}`
              + `${blockRuleCss(view)}"
              >${sectionInnerHtml(section, view, { dirty: selected && dirty, selected })}</div>`;
          })
          .join("")}
        ${guideLayerMarkup()}
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
      // Shift+click a SECOND block: the story running in the block already
      // selected continues into this one. It is the oldest arrangement on a
      // printed page - a lead runs down its first leg and carries on in the
      // next - and the software already knew how to do it (jump.service.js's
      // carryOver, which has always taken an explicit target and never been
      // given one). What was missing was a way for a desk to SAY which second
      // block, and shift-click is that: no second selection model, no mode to
      // enter and leave, and the same gesture every layout tool uses to mean
      // "and this one too".
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onContinueInto?.(element.dataset.sectionKey);
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

  rebuildRulers(pageWidth, pageHeight);
  bindRulers();
  renderGuides(handlers.guides);
  setGuidesVisible(handlers.guidesVisible !== false);
  bindGuideInteractions({
    onCreateGuide: (orientation, positionPx) => handlers.onCreateGuide?.(orientation, positionPx),
    onMoveGuide: (id, positionPx) => handlers.onMoveGuide?.(id, positionPx),
    onDeleteGuide: (id) => handlers.onDeleteGuide?.(id),
  });
}

/** Guides load asynchronously, after the page has already painted - this
 * repaints just the guide layer once they arrive, without a full re-render. */
export function refreshGuides(guides) {
  handlers.guides = guides;
  renderGuides(guides);
}

/**
 * Rebuilds page-owned separator rules after a live block-border decision.
 *
 * `refreshSection()` can repaint one block, but a rule belongs to the PAIR of
 * blocks on either side of a gutter. Leaving the page layer alone after Box
 * was chosen drew a hairline beside the new box until the next full render —
 * exactly the double-rule the page-furniture model says must never exist.
 */
export function refreshColumnRules(section = null, view = null, syncedPage = null) {
  const canvas = document.querySelector('.newspaper-canvas');
  const geometry = getGeometry();
  // PAGE_SYNC carries the rows that just came back from autosave. Keeping the
  // initial render's page here made the live draft remove a rule correctly,
  // then put it back from stale `border_style: none` as soon as save landed.
  if (syncedPage) renderedPage = syncedPage;
  if (!canvas || !renderedPage || !geometry) return;

  const page = section && view
    ? {
      ...renderedPage,
      sections: (renderedPage.sections || []).map((row) =>
        row.section_key === section.section_key
          ? { ...row, border_style: view.borderStyle || row.border_style || 'none' }
          : row),
    }
    : renderedPage;
  const markup = columnRulesMarkup(page, geometry);
  canvas.querySelector('.page-rules')?.remove();
  if (!markup) return;
  const firstBlock = canvas.querySelector('.newspaper-section');
  if (firstBlock) firstBlock.insertAdjacentHTML('beforebegin', markup);
}

function applyBlockTint(element, view) {
  if (view.backgroundColor) element.style.setProperty("--block-tint", view.backgroundColor);
  else element.style.removeProperty("--block-tint");
}

// Part 14: repaint exactly one section. Used for every keystroke, so live
// preview costs one innerHTML write on one box.
/**
 * The chosen rule width, as the custom property the ruled-* classes read.
 *
 * `border_width_px` has existed on the column since it was added and the
 * compositor has always read it for the box inset - but the stylesheet had
 * `border: 1.5px` written into it, so the number the block was composed
 * against and the number it was drawn with were different, and no control
 * could change either. A rule is specified in points now (layout/borders.js).
 */
function blockRuleCss(view) {
  if (!isRuled(view.borderStyle)) return '';
  return `--block-rule:${borderWidthPx(view.borderWidthPx)}px;`;
}

function applyBlockRule(element, view) {
  const css = blockRuleCss(view);
  if (css) element.style.setProperty('--block-rule', `${borderWidthPx(view.borderWidthPx)}px`);
  else element.style.removeProperty('--block-rule');
}

export function refreshSection(section, view, { selected = false, dirty = false } = {}) {
  const element = sectionElement(section.section_key);
  if (!element) return;
  const overflowing = computeMetrics(section, view).overflowing;
  const g = getGeometry();
  const atRightEdge = g ? section.x_px + section.width_px >= g.marginXPx + g.matterWidthPx - 2 : false;
  const atFootEdge = g ? section.y_px + section.height_px >= contentRegion(g, renderedPage).bottom - 2 : false;
  element.className = sectionClassName(view, { selected, dirty, overflowing, atRightEdge, atFootEdge, hasImages: Boolean((section.images || []).length) });
  // The block's ground is a VALUE, so it lives in the element's own style and
  // not in its class list - which means this repaint has to set it too. It did
  // not, and the symptom is the one this codebase keeps meeting: the tint was
  // stored correctly, drawn correctly on a reload, and never appeared while a
  // desk was actually choosing it. Two paint paths, one of them updated.
  applyBlockTint(element, view);
  // The rule's WIDTH is a value too, and travels the same way and for the same
  // reason: a desk pressing "2 pt" must see 2 pt without a reload.
  applyBlockRule(element, view);
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
