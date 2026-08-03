// Part 3: the canvas viewport - zoom, pan and the minimap.
//
// Zoom is a real scale factor on the page element, not a CSS width trick, so a
// section's proportions are identical at every level - what a page designer
// checks at 300% is the same geometry that prints. "Fit" is recomputed from the
// container, so it survives a window or dock resize.

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

const state = { mode: "fit", scale: 1, panX: 0, panY: 0, spaceHeld: false, panning: false };
let onChange = null;

export function configure(handler) {
  onChange = handler;
}

export function getZoomState() {
  return { ...state };
}

function viewport() {
  return document.getElementById("canvasViewport");
}

function surface() {
  return document.getElementById("canvasSurface");
}

export function fitScale() {
  const host = viewport();
  const page = surface();
  if (!host || !page) return 1;
  const pageWidth = page.offsetWidth || 1;
  const pageHeight = page.offsetHeight || 1;
  const padding = 48;
  return Math.min(
    (host.clientWidth - padding) / pageWidth,
    (host.clientHeight - padding) / pageHeight,
  );
}

export function applyTransform() {
  const page = surface();
  if (!page) return;
  const scale = state.mode === "fit" ? fitScale() : state.scale;
  page.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
  onChange?.(effectiveScale());
}

export function effectiveScale() {
  return state.mode === "fit" ? fitScale() : state.scale;
}

export function setZoom(value) {
  if (value === "fit") {
    state.mode = "fit";
    state.panX = 0;
    state.panY = 0;
  } else {
    state.mode = "manual";
    state.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }
  applyTransform();
}

export function zoomBy(factor, anchor) {
  const previous = effectiveScale();
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previous * factor));
  if (next === previous) return;

  // Keep the point under the cursor fixed while zooming, the way every design
  // tool behaves - otherwise the page slides away from what you are inspecting.
  if (anchor) {
    const ratio = next / previous;
    state.panX = anchor.x - ratio * (anchor.x - state.panX);
    state.panY = anchor.y - ratio * (anchor.y - state.panY);
  }
  state.mode = "manual";
  state.scale = next;
  applyTransform();
}

export function resetPan() {
  state.panX = 0;
  state.panY = 0;
  applyTransform();
}

export function bindViewport() {
  const host = viewport();
  if (!host || host.dataset.bound === "true") return;
  host.dataset.bound = "true";

  // Ctrl/⌘ + wheel zooms; a plain wheel keeps scrolling the viewport.
  host.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    { passive: false },
  );

  // Middle mouse pans anywhere; space + left-drag pans the way Photoshop does.
  host.addEventListener("pointerdown", (event) => {
    const isMiddle = event.button === 1;
    const isSpaceDrag = event.button === 0 && state.spaceHeld;
    if (!isMiddle && !isSpaceDrag) return;

    event.preventDefault();
    state.panning = true;
    host.setPointerCapture(event.pointerId);
    host.classList.add("panning");

    const startX = event.clientX - state.panX;
    const startY = event.clientY - state.panY;

    const onMove = (moveEvent) => {
      state.panX = moveEvent.clientX - startX;
      state.panY = moveEvent.clientY - startY;
      applyTransform();
    };
    const onUp = () => {
      state.panning = false;
      host.classList.remove("panning");
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
  });

  host.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
}

// Space is a global modifier, but must never hijack typing in the editor.
export function bindSpacebarPan() {
  if (document.body.dataset.spacePanBound === "true") return;
  document.body.dataset.spacePanBound = "true";

  const isTyping = (target) =>
    target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || isTyping(event.target)) return;
    if (!document.getElementById("canvasViewport")) return;
    state.spaceHeld = true;
    document.getElementById("canvasViewport")?.classList.add("space-held");
    event.preventDefault();
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space") return;
    state.spaceHeld = false;
    document.getElementById("canvasViewport")?.classList.remove("space-held");
  });

  window.addEventListener("blur", () => {
    state.spaceHeld = false;
    document.getElementById("canvasViewport")?.classList.remove("space-held");
  });
}

// The minimap mirrors the page at a fixed small size and shows which part of it
// the viewport is currently looking at.
export function renderMiniMap(page, newspaper, selectedSectionKey) {
  const map = document.getElementById("canvasMiniMap");
  if (!map || !page) return;

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;

  map.innerHTML = `
    <div class="minimap-page" style="aspect-ratio:${pageWidth}/${pageHeight};">
      ${(page.sections || [])
        .map((section) => {
          const filled = Boolean(section.headline || section.body || section.image_url);
          return `<span class="minimap-block${filled ? " filled" : ""}${section.section_key === selectedSectionKey ? " active" : ""}"
            style="left:${(section.x_px / pageWidth) * 100}%;top:${(section.y_px / pageHeight) * 100}%;
                   width:${(section.width_px / pageWidth) * 100}%;height:${(section.height_px / pageHeight) * 100}%;"></span>`;
        })
        .join("")}
    </div>
  `;
}
