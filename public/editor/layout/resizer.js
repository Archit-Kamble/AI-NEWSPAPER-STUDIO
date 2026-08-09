// Draggable splitters for the two sizes an editor cares about: how wide the
// Inspector is, and how much room the page preview gets. The dock below grows
// with its own content and the whole page scrolls, so it needs no fixed height.
// Sizes live in CSS custom properties and are remembered in localStorage, so a
// desk keeps its layout between sessions.

const STORAGE_KEY = "sahas.workspace.layout";

const LIMITS = {
  // The dock now grows with its content and the page scrolls, so what is worth
  // resizing is how much room the page preview gets.
  canvasHeight: { min: 320, max: 1200, fallback: 620, prop: "--canvas-height" },
};

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeStored(sizes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // A full or blocked storage quota must never break the editor.
  }
}

function clamp(key, value) {
  const { min, max } = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

let sizes = {};

export function applyStoredLayout(shell) {
  const stored = readStored();
  sizes = {
    canvasHeight: clamp("canvasHeight", stored.canvasHeight || LIMITS.canvasHeight.fallback),
    editorCollapsed: stored.editorCollapsed === true,
  };
  Object.entries(LIMITS).forEach(([key, { prop }]) => {
    shell.style.setProperty(prop, `${sizes[key]}px`);
  });
  shell.classList.toggle("editor-collapsed", sizes.editorCollapsed);
  return sizes;
}

export function getSizes() {
  return { ...sizes };
}

export function setEditorCollapsed(shell, collapsed) {
  sizes.editorCollapsed = collapsed;
  shell.classList.toggle("editor-collapsed", collapsed);
  writeStored(sizes);
}

// A splitter drags one CSS variable. `invert` is for handles that grow the
// tracked region as the pointer moves in the negative direction (the inspector
// grows as the pointer moves left; the dock grows as it moves up).
function bindSplitter(shell, handle, key, axis, invert) {
  if (!handle) return;
  const { prop } = LIMITS[key];

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");

    const start = axis === "x" ? event.clientX : event.clientY;
    const startSize = sizes[key];

    const onMove = (moveEvent) => {
      const current = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      const delta = (current - start) * (invert ? -1 : 1);
      sizes[key] = clamp(key, startSize + delta);
      shell.style.setProperty(prop, `${sizes[key]}px`);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-x", "resizing-y");
      writeStored(sizes);
      window.dispatchEvent(new CustomEvent("workspace-resized", { detail: { ...sizes } }));
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });

  // Keyboard access - a splitter that only responds to a mouse is not usable
  // by everyone on the desk.
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 10;
    const decrease = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const increase = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    const direction = (event.key === increase ? 1 : -1) * (invert ? -1 : 1);
    sizes[key] = clamp(key, sizes[key] + direction * step);
    shell.style.setProperty(prop, `${sizes[key]}px`);
    writeStored(sizes);
    window.dispatchEvent(new CustomEvent("workspace-resized", { detail: { ...sizes } }));
  });
}

export function bindResizers(shell) {
  bindSplitter(shell, document.getElementById("canvasResizer"), "canvasHeight", "y", false);
}
