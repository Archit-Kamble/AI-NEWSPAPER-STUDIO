// Draggable splitters for the two sizes a desk cares about: how much room the
// page gets, and how wide the editor beside it is. Sizes live in CSS custom
// properties and are remembered in localStorage, so a desk keeps its layout
// between sessions.

// v3: the second draggable width changed meaning. It used to be the editor,
// when the editor was a column beside the page; the editor is the full width of
// the window below the page now, and the column beside the page is the block
// settings rail. A stored 520px from v2 would have made that rail half the
// screen on the first load after the change.
const STORAGE_KEY = "sahas.workspace.layout.v3";

const LIMITS = {
  // The page is the reference above the editor, not the work surface, so it
  // starts small and the editor below it gets the rest of the screen.
  // 380, not 300: the settings rail beside the page is capped to this height
  // (it must not push the writing surface below the fold), so the number is now
  // the height of BOTH columns. At 300 the sheet was a 24% thumbnail and the
  // rail showed four fields of eight. 380 keeps the headline field on a 950px
  // screen with room to spare, and a desk that wants more drags the handle -
  // which is remembered.
  canvasHeight: { min: 200, max: 1200, fallback: 380, prop: "--canvas-height" },
  // ^ that 380 is the FLOOR now, not the answer - see defaultCanvasHeight().
  // The block settings rail, left of the page. Narrow on purpose - it holds
  // read-outs and small fields, not a writing surface - but draggable, because
  // a desk setting type all morning wants it wider than one reading a proof.
  // 340 is the width at which the eight type fields sit two across instead of
  // eight down; below that the rail is twice as long as the page beside it.
  toolsWidth: { min: 240, max: 560, fallback: 340, prop: "--tools-width" },
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

/**
 * HOW TALL THE SHEET STARTS, ON THIS SCREEN.
 *
 * It was a flat 380px on every monitor, and 380 was chosen against a 950px
 * screen where it is 40% of the height. A newspaper page is 660x1060, so a
 * fixed height decides the zoom: measured at 1512x950 on a real front page,
 * the page area is 1166x380, the sheet fits it at 29%, and the sheet is then
 * 191px wide - 975px of the 1166 standing empty. The waste LOOKS like width
 * and is really height, because a page has one aspect and the only thing that
 * can make it bigger is a taller box.
 *
 * A fraction of the viewport with both ends pinned:
 *
 *   - the floor is the old 380, so no screen gets a smaller sheet than it had;
 *   - the ceiling stops a tall monitor pushing the Block Editor off the bottom,
 *     which is the one failure this layout exists to prevent.
 *
 * Only consulted when NOTHING IS STORED. A desk who has dragged the splitter
 * has made a decision, and a decision is not a default - the same rule the
 * house-style backfill and the placement repair already follow.
 */
function defaultCanvasHeight() {
  const viewport = Number(window.innerHeight) || 0;
  if (!viewport) return LIMITS.canvasHeight.fallback;
  return Math.round(Math.min(820, Math.max(LIMITS.canvasHeight.fallback, viewport * 0.58)));
}

let sizes = {};

export function applyStoredLayout(shell) {
  const stored = readStored();
  sizes = {
    canvasHeight: clamp("canvasHeight", stored.canvasHeight || defaultCanvasHeight()),
    toolsWidth: clamp("toolsWidth", stored.toolsWidth || LIMITS.toolsWidth.fallback),
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
  // Not inverted: the settings rail is the LEFT column, so it grows as the
  // pointer moves right.
  bindSplitter(shell, document.getElementById("toolsResizer"), "toolsWidth", "x", false);
}
