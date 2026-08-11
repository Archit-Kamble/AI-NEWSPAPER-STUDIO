// Rulers along the top and left of the newspaper page - tick marks in PAGE
// pixels (never screen or zoom-scaled pixels), aligned to wherever the page
// actually is on screen right now.
//
// The page is drawn with a real CSS transform, scaled from its own top-left
// (canvas-view.js's own note explains why - a transform there, not a width
// trick). Nothing here re-derives that scale or the sizer's centring math:
// it reads #canvasSurface's live getBoundingClientRect(), which the browser
// has already resolved including the transform, the centring margin and the
// current scroll position - the one robust way to answer "where is page
// pixel 0 on screen right now" without a second copy of layout math
// canvas-view.js already owns.
//
// Tick marks themselves are drawn once per zoom change (rebuildRulers) and
// only ever REPOSITIONED on scroll (alignRulers, via a CSS transform) - a
// scroll event fires far too often to rebuild forty tick elements on every
// one of them.

import { effectiveScale } from "./canvas-view.js";

// 1-2-5 progression - what every ruler uses, so labels neither crowd
// together at high zoom nor thin out to nothing at low zoom.
const STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const MIN_MAJOR_SCREEN_PX = 50;

function majorStepFor(scale) {
  return STEPS.find((step) => step * scale >= MIN_MAJOR_SCREEN_PX) || STEPS[STEPS.length - 1];
}

function viewport() {
  return document.getElementById("canvasViewport");
}
function surface() {
  return document.getElementById("canvasSurface");
}

export function rulerMarkup() {
  return `
    <div class="canvas-ruler-corner" id="canvasRulerCorner" title="Drag from a ruler onto the page to add a guide"></div>
    <div class="canvas-ruler canvas-ruler-h" id="canvasRulerH" data-ruler-axis="h">
      <div class="ruler-ticks" id="rulerTicksH"></div>
    </div>
    <div class="canvas-ruler canvas-ruler-v" id="canvasRulerV" data-ruler-axis="v">
      <div class="ruler-ticks" id="rulerTicksV"></div>
    </div>
  `;
}

function buildTicks(pageLength, majorStep) {
  const minorStep = majorStep / 5;
  const ticks = [];
  for (let v = 0; v <= pageLength; v += minorStep) {
    const value = Math.round(v);
    ticks.push({ value, major: value % majorStep === 0 });
  }
  return ticks;
}

function tickDom(ticks, scale, axis) {
  return ticks
    .map((tick) => {
      const pos = Math.round(tick.value * scale);
      const cls = `ruler-tick${tick.major ? " ruler-tick-major" : ""}`;
      const label = tick.major ? `<span class="ruler-tick-label">${tick.value}</span>` : "";
      return axis === "h"
        ? `<span class="${cls}" style="left:${pos}px">${label}</span>`
        : `<span class="${cls}" style="top:${pos}px">${label}</span>`;
    })
    .join("");
}

let pageSize = { width: 660, height: 1060 };

/** Redraws the tick marks themselves - call when the page or the zoom changes. */
export function rebuildRulers(pageWidth, pageHeight) {
  pageSize = { width: pageWidth, height: pageHeight };
  const scale = effectiveScale();
  const majorStep = majorStepFor(scale);

  const ticksH = document.getElementById("rulerTicksH");
  const ticksV = document.getElementById("rulerTicksV");
  if (ticksH) {
    ticksH.innerHTML = tickDom(buildTicks(pageWidth, majorStep), scale, "h");
    ticksH.style.width = `${Math.round(pageWidth * scale)}px`;
  }
  if (ticksV) {
    ticksV.innerHTML = tickDom(buildTicks(pageHeight, majorStep), scale, "v");
    ticksV.style.height = `${Math.round(pageHeight * scale)}px`;
  }
  alignRulers();
}

/** Re-run rebuildRulers() at the page size last given to it - for a zoom change. */
export function refreshRulers() {
  rebuildRulers(pageSize.width, pageSize.height);
}

/**
 * Repositions (never rebuilds) the tick marks so they stay under the page as
 * it scrolls. Cheap: two getBoundingClientRect() reads and two transforms.
 */
export function alignRulers() {
  const page = surface();
  const rulerH = document.getElementById("canvasRulerH");
  const rulerV = document.getElementById("canvasRulerV");
  const ticksH = document.getElementById("rulerTicksH");
  const ticksV = document.getElementById("rulerTicksV");
  if (!page || !rulerH || !rulerV) return;

  const pageRect = page.getBoundingClientRect();
  const hRect = rulerH.getBoundingClientRect();
  const vRect = rulerV.getBoundingClientRect();

  if (ticksH) ticksH.style.transform = `translateX(${Math.round(pageRect.left - hRect.left)}px)`;
  if (ticksV) ticksV.style.transform = `translateY(${Math.round(pageRect.top - vRect.top)}px)`;
}

/**
 * Converts a screen point into PAGE pixels - the one place this maths is
 * done, so guide creation/dragging (page-guides.js) and any future caller
 * read the exact same page origin the ruler itself is drawn from.
 */
export function toPageCoords(clientX, clientY) {
  const page = surface();
  const scale = effectiveScale() || 1;
  if (!page) return { x: 0, y: 0 };
  const rect = page.getBoundingClientRect();
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

export function bindRulers() {
  const host = viewport();
  if (!host || host.dataset.rulerBound === "true") return;
  host.dataset.rulerBound = "true";

  // Scroll fires far more often than a tick rebuild needs - align only,
  // and even that coalesced to one paint per frame.
  let raf = null;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      alignRulers();
    });
  };
  host.addEventListener("scroll", onScroll, { passive: true });

  // A window/dock resize can move the page within the viewport (the sizer's
  // centring margin changes) without necessarily firing a scroll event.
  new ResizeObserver(() => alignRulers()).observe(host);
}
