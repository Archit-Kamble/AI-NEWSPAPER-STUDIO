// What you can do to the picture you have selected in the story.
//
// This is what is left of the composition canvas, and the part that was worth
// keeping. The canvas itself was a second surface you could write and drag on -
// the desk read it as a second editor for two days, and it was right. The
// picture is placed in the writing sheet, where the copy it displaces is
// visible; these are the things about it that cannot be done by dragging.
//
// Every one of them writes a placement in block pixels through the same
// endpoint the drag does, so there is one way a picture changes and one thing
// that reads it: the character grid.

import { escapeHtml as escapeText } from "../format.js";

const SHAPES = [
  ["rect", "Box"],
  ["ellipse", "Oval"],
  ["cutout", "Cut-out"],
];

// How the picture (after crop) resolves into its placement frame - one
// shared resolver (image-geometry.js) is the only place fit math actually
// happens; this only renders the choice and forwards it. Distinct from
// "Fit to block"/"Fit inside block" below, which move/resize the FRAME
// itself - frame geometry and how the source fills that frame are different
// axes, and conflating them was exactly Problem #10 (paint always drew
// `contain` no matter what a desk chose here).
const FIT_MODES = [
  ["contain", "Contain"],
  ["cover", "Cover"],
  ["stretch", "Stretch"],
];

const ALIGN_BUTTONS = [
  ["left", "Align left"], ["center", "Align center"], ["right", "Align right"],
  ["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"],
];

let state = { images: [], selectedId: null, selectedIds: new Set(), callbacks: {}, block: null };

export function pictureControlsMarkup() {
  return `
    <div class="picture-controls" id="edPictureControls"></div>
    <input type="file" accept="image/*" id="cmpFileInput" hidden />
  `;
}

/** The picture the desk is working on, or nothing. */
function selected() {
  return state.images.find((image) => image.id === state.selectedId) || null;
}

// Stage 7: two or more pictures shift-clicked at once - align them against
// each other's shared bounding box, or take them all off the block together.
// Nothing here computes a placement itself; align.js does that (and is
// unit-tested on its own), this only renders the buttons and forwards which
// one was pressed.
function multiSelectMarkup(count) {
  return `
    <div class="picture-controls-head">
      <strong>${count} pictures selected</strong>
      <button type="button" class="ext-editor-btn danger" data-picture-do="remove-selected">Remove all</button>
    </div>
    <label class="preview-label">Align</label>
    <div class="ext-editor-toolbar">
      ${ALIGN_BUTTONS.map(([key, label]) => `<button type="button" class="ext-editor-btn" data-picture-align="${key}">${label}</button>`).join("")}
    </div>
    <p class="muted ext-note">Shift+click a picture to add or remove it from the selection; click one alone to go back to editing just it.</p>
  `;
}

export function renderPictureControls(images, selectedId, block, selectedIds = []) {
  state.images = images || [];
  if (block) state.block = block;
  if (selectedId !== undefined) state.selectedId = selectedId;
  state.selectedIds = new Set(selectedIds);
  // The multi-selection is authoritative once it names exactly one picture -
  // Shift+click only ever updates the Set, never this separate "primary"
  // field, so after Shift+clicking down to one picture this field could
  // otherwise still be naming whichever was clicked first (the same drift
  // that made a dropped picture keep showing selected on the canvas - see
  // block-frame.js's own note on that bug).
  if (state.selectedIds.size === 1) state.selectedId = [...state.selectedIds][0];
  // A picture that was removed cannot stay selected.
  if (!state.images.some((image) => image.id === state.selectedId)) {
    state.selectedId = state.images.length ? state.images[state.images.length - 1].id : null;
  }

  const host = document.getElementById("edPictureControls");
  if (!host) return;

  if (state.selectedIds.size >= 2) {
    host.innerHTML = multiSelectMarkup(state.selectedIds.size);
    return;
  }

  const image = selected();
  if (!image) {
    // Never blank. A panel that is empty until something is selected reads as
    // a panel that does nothing - the desk added a picture and could not see
    // that it could be shaped, turned or cut out at all. Say what is here.
    host.innerHTML = state.images.length
      ? `<p class="muted">Click a picture in the story to shape it, turn it, or take its background out.</p>`
      : `<p class="muted">Add a picture and the copy will run around it. You can then choose how it
           wraps — box, oval or cut-out — set the gap around it, rotate or flip it, size it, order it,
           or take its background out.</p>`;
    return;
  }

  host.innerHTML = `
    <div class="picture-controls-head">
      <strong>${escapeText(image.original_filename || "picture")}</strong>
      <span class="muted">${image.width_px} × ${image.height_px} px</span>
      <button type="button" class="ext-editor-btn danger" data-picture-do="remove">Remove picture</button>
    </div>

    <label class="preview-label">Copy wraps as</label>
    <div class="segmented">
      ${SHAPES.map(
        ([key, label]) =>
          `<button type="button" class="segment${(image.shape || "rect") === key ? " active" : ""}" data-picture-shape="${key}">${label}</button>`,
      ).join("")}
    </div>

    <label class="preview-label">Fit</label>
    <div class="segmented">
      ${FIT_MODES.map(
        ([key, label]) =>
          `<button type="button" class="segment${(image.fit_mode || "contain") === key ? " active" : ""}" data-picture-fit="${key}">${label}</button>`,
      ).join("")}
    </div>

    <label class="preview-label" for="edStandOff">Gap around the picture</label>
    <input type="range" id="edStandOff" min="0" max="24" value="${Number(image.stand_off_px) || 0}" />

    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" data-picture-do="rotate">Rotate 90°</button>
      <button type="button" class="ext-editor-btn" data-picture-do="flip-h">Flip H</button>
      <button type="button" class="ext-editor-btn" data-picture-do="flip-v">Flip V</button>
      <button type="button" class="ext-editor-btn" data-picture-do="bigger">Bigger</button>
      <button type="button" class="ext-editor-btn" data-picture-do="smaller">Smaller</button>
    </div>
    <div class="ext-editor-toolbar">
      <!-- An advert is supplied at the size of the space it bought, and the
           desk should not have to drag it there by eye. -->
      <button type="button" class="ext-editor-btn" data-picture-do="fill">Fit to block</button>
      <button type="button" class="ext-editor-btn" data-picture-do="fit">Fit inside block</button>
    </div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" data-picture-do="front">Bring to front</button>
      <button type="button" class="ext-editor-btn" data-picture-do="forward">Bring forward</button>
      <button type="button" class="ext-editor-btn" data-picture-do="backward">Send back</button>
      <button type="button" class="ext-editor-btn" data-picture-do="back">Send to back</button>
    </div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" data-picture-do="cutout">Remove background</button>
    </div>
    <p class="muted ext-note">Drag it in the story to move it, and its corner to size it.</p>
  `;
}

/** Which picture the controls are pointed at. Called when one is clicked. */
export function selectPicture(id) {
  state.selectedId = id;
  renderPictureControls(state.images);
}

export function selectedPictureId() {
  return state.selectedId;
}

// Rotation, flipping and scaling are arithmetic on the placement, not a canvas
// operation - the picture is drawn by the browser now, and the grid reads the
// stored numbers either way.
//
// Exported so the Properties inspector's Layer control (properties-panel.js)
// can reuse the exact same forward/backward arithmetic rather than a second
// copy of "z-index plus or minus one, floored at zero".
export function change(image, action) {
  const width = Number(image.width_px) || 0;
  const height = Number(image.height_px) || 0;

  switch (action) {
    // A quarter turn about the picture's own centre: the box changes shape, so
    // the corner it is anchored by has to move or the picture walks across the
    // block every time it is turned.
    case "rotate": return {
      rotation: (((Number(image.rotation) || 0) + 90) % 360),
      x: Math.round(Number(image.x_px) + (width - height) / 2),
      y: Math.round(Number(image.y_px) + (height - width) / 2),
      width: height,
      height: width,
    };
    case "flip-h": return { flipH: !image.flip_h };
    case "flip-v": return { flipV: !image.flip_v };
    case "bigger": return { width: Math.round(width * 1.1), height: Math.round(height * 1.1) };
    case "smaller": return { width: Math.round(width * 0.9), height: Math.round(height * 0.9) };
    // Fill the block exactly - what an advert wants, because it was supplied
    // at the size of the space it bought.
    case "fill": {
      const block = state.block;
      if (!block) return null;
      const margin = Number(block.margin_px) || 12;
      return {
        x: margin, y: margin,
        width: Math.round(Number(block.width_px) - margin * 2),
        height: Math.round(Number(block.height_px) - margin * 2),
      };
    }
    // Fit inside it, keeping the picture's own proportions - a photograph
    // stretched to a box it does not share the shape of is a printing error.
    case "fit": {
      const block = state.block;
      if (!block || !width || !height) return null;
      const margin = Number(block.margin_px) || 12;
      const room = { w: Number(block.width_px) - margin * 2, h: Number(block.height_px) - margin * 2 };
      const factor = Math.min(room.w / width, room.h / height);
      return {
        x: margin, y: margin,
        width: Math.max(20, Math.round(width * factor)),
        height: Math.max(20, Math.round(height * factor)),
      };
    }
    // Order is real and it is stored, so it survives a reload. It did not
    // before: the old canvas restacked its own objects and threw the order away.
    case "forward": return { zIndex: (Number(image.z_index) || 0) + 1 };
    case "backward": return { zIndex: Math.max(0, (Number(image.z_index) || 0) - 1) };
    // Jump straight to either end, rather than clicking "forward"/"backward"
    // once per picture in between. Floored at 0 like "backward" already is -
    // never negative, because placedPictureStyle() reads z-index with
    // `Number(row.z_index) || 1`, where a literal 0 already falls through to
    // 1; a negative number would instead survive as itself and could put the
    // picture behind page content with no z-index of its own. Not this
    // stage's bug to fix (see PROJECT_STATUS.md), just one not to walk into.
    case "front": return { zIndex: Math.max(0, ...state.images.map((i) => Number(i.z_index) || 0)) + 1 };
    case "back": return { zIndex: 0 };
    default: return null;
  }
}

export function bindPictureControls(callbacks) {
  state.callbacks = callbacks;

  const host = document.getElementById("edPictureControls");
  host?.addEventListener("click", (event) => {
    // The multi-select panel's own buttons - checked first, since they act
    // on the whole selection, not the single "primary" picture below. A
    // distinct attribute from the story toolbar's own [data-align] (text
    // alignment, story-editor.js) - the two are unrelated concepts that
    // happened to want the same obvious name.
    const align = event.target.closest("[data-picture-align]");
    if (align) return callbacks.onAlignImages?.(align.dataset.pictureAlign);
    if (event.target.closest('[data-picture-do="remove-selected"]')) return callbacks.onRemoveSelectedImages?.();

    const image = selected();
    if (!image) return;

    const shape = event.target.closest("[data-picture-shape]");
    if (shape) return callbacks.onPatchImage?.(image.id, { shape: shape.dataset.pictureShape });

    const fit = event.target.closest("[data-picture-fit]");
    if (fit) return callbacks.onPatchImage?.(image.id, { fitMode: fit.dataset.pictureFit });

    const action = event.target.closest("[data-picture-do]")?.dataset.pictureDo;
    if (!action) return;
    if (action === "remove") return callbacks.onRemoveImage?.(image.id);
    if (action === "cutout") return callbacks.onRemoveBackground?.(image.id);

    const patch = change(image, action);
    if (patch) callbacks.onPatchImage?.(image.id, patch);
  });

  host?.addEventListener("change", (event) => {
    if (event.target.id !== "edStandOff") return;
    const image = selected();
    if (image) callbacks.onPatchImage?.(image.id, { standOffPx: Number(event.target.value) });
  });

  // One upload path: the toolbar's Picture button and the list's Add a picture
  // both open the same file input.
  document.getElementById("cmpAddImage")?.addEventListener("click", () => {
    document.getElementById("cmpFileInput")?.click();
  });
  document.getElementById("cmpFileInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await callbacks.onAddImage?.(file);
    event.target.value = "";
  });
}
