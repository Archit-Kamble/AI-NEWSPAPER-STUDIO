// Part 3: the canvas viewport - zoom, pan and the minimap.
//
// Zoom is a real scale factor on the page element, not a CSS width trick, so a
// section's proportions are identical at every level - what a page designer
// checks at 300% is the same geometry that prints. "Fit" is recomputed from the
// container, so it survives a window or dock resize.
//
// A zoomed page has to be REACHABLE, and this used to be the bug that made zoom
// unusable: the page was scaled about its own centre inside a viewport with
// `overflow: hidden`, so the moment the scale went past Fit the top and bottom
// of the page were clipped away with no scrollbar - at 132% on a normal screen,
// 388px of the page off the top and 388px off the bottom, and the wheel did
// nothing. The only way to reach the rest of the page was a middle-mouse drag
// nobody knew about.
//
// A transform does not affect layout, so scaling alone can never produce a
// scrollbar. The fix is the standard one: the page is scaled from its TOP-LEFT
// inside a "sizer" element whose ordinary width and height are the scaled size.
// That sizer is what the browser lays out, so the viewport scrolls exactly as
// far as the zoomed page actually extends. `margin: auto` centres it while it
// is smaller than the viewport and - unlike flex centring - still lets you
// scroll to the top edge once it is bigger.
//
// Position is then scrollLeft/scrollTop, one source of truth: the wheel, the
// scrollbars, space-drag, middle-drag and zoom-at-the-cursor all move the same
// thing.

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const FIT_PADDING = 48;

const state = { mode: "fit", scale: 1, spaceHeld: false, panning: false };
let onChange = null;
let resizeObserver = null;

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

function sizer() {
  return document.getElementById("canvasSizer");
}

// The page's own pixel size, read off the element rather than the transform -
// offsetWidth is the untransformed layout box, which is what we want.
function pageSize() {
  const page = surface();
  return { width: page?.offsetWidth || 660, height: page?.offsetHeight || 1060 };
}

export function fitScale() {
  const host = viewport();
  if (!host || !surface()) return 1;
  const { width, height } = pageSize();
  return Math.min(
    (host.clientWidth - FIT_PADDING) / width,
    (host.clientHeight - FIT_PADDING) / height,
  );
}

export function applyTransform() {
  const page = surface();
  const box = sizer();
  if (!page) return;

  const scale = effectiveScale();
  page.style.transform = `scale(${scale})`;

  // The scaled footprint, so the viewport knows how far there is to scroll.
  if (box) {
    const { width, height } = pageSize();
    box.style.width = `${Math.round(width * scale)}px`;
    box.style.height = `${Math.round(height * scale)}px`;
  }
  onChange?.(scale);
}

export function effectiveScale() {
  return state.mode === "fit" ? fitScale() : state.scale;
}

export function setZoom(value) {
  if (value === "fit") {
    state.mode = "fit";
    applyTransform();
    centreView();
  } else {
    state.mode = "manual";
    state.scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    applyTransform();
    centreView();
  }
}

export function zoomBy(factor, anchor) {
  const host = viewport();
  const previous = effectiveScale();
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previous * factor));
  if (next === previous) return;

  // Keep the point under the cursor fixed while zooming, the way every design
  // tool behaves - otherwise the page slides away from what you are inspecting.
  // With no cursor (the toolbar's + and −) the centre of the viewport is the
  // anchor, which is what a person pressing a zoom button expects.
  const point = anchor || (host ? { x: host.clientWidth / 2, y: host.clientHeight / 2 } : null);
  const before = host && point
    ? { x: host.scrollLeft + point.x, y: host.scrollTop + point.y }
    : null;

  state.mode = "manual";
  state.scale = next;
  applyTransform();

  if (host && before) {
    const ratio = next / previous;
    // The sizer's offset inside the viewport changes as `margin:auto` stops
    // centring, so the anchor is corrected against the new offsets too.
    host.scrollLeft = before.x * ratio - point.x;
    host.scrollTop = before.y * ratio - point.y;
  }
}

/** Centre the page in the viewport - what the ⤾ button does. */
export function resetPan() {
  centreView();
}

function centreView() {
  const host = viewport();
  if (!host) return;
  host.scrollLeft = Math.max(0, (host.scrollWidth - host.clientWidth) / 2);
  host.scrollTop = Math.max(0, (host.scrollHeight - host.clientHeight) / 2);
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
  // Panning now moves the scroll position, so it agrees with the scrollbars and
  // the wheel instead of fighting them.
  host.addEventListener("pointerdown", (event) => {
    const isMiddle = event.button === 1;
    const isSpaceDrag = event.button === 0 && state.spaceHeld;
    if (!isMiddle && !isSpaceDrag) return;

    event.preventDefault();
    state.panning = true;
    host.setPointerCapture(event.pointerId);
    host.classList.add("panning");

    const startX = event.clientX + host.scrollLeft;
    const startY = event.clientY + host.scrollTop;

    const onMove = (moveEvent) => {
      host.scrollLeft = startX - moveEvent.clientX;
      host.scrollTop = startY - moveEvent.clientY;
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

  // Fit is derived from the container, so it has to be recomputed whenever the
  // container changes size - a splitter drag, the Block Editor opening, the
  // inspector collapsing. Listening for a window resize misses all three, which
  // is how a fitted page ended up larger than the area left for it.
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (state.mode === "fit") applyTransform();
  });
  resizeObserver.observe(host);
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
