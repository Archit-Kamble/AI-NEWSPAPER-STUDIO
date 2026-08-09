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

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

const SHAPES = [
  ["rect", "Box"],
  ["ellipse", "Oval"],
  ["cutout", "Cut-out"],
];

let state = { images: [], selectedId: null, callbacks: {} };

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

export function renderPictureControls(images, selectedId) {
  state.images = images || [];
  if (selectedId !== undefined) state.selectedId = selectedId;
  // A picture that was removed cannot stay selected.
  if (!state.images.some((image) => image.id === state.selectedId)) {
    state.selectedId = state.images.length ? state.images[state.images.length - 1].id : null;
  }

  const host = document.getElementById("edPictureControls");
  if (!host) return;

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
      <button type="button" class="ext-editor-btn" data-picture-do="forward">Bring forward</button>
      <button type="button" class="ext-editor-btn" data-picture-do="backward">Send back</button>
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
function change(image, action) {
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
    // Order is real and it is stored, so it survives a reload. It did not
    // before: the old canvas restacked its own objects and threw the order away.
    case "forward": return { zIndex: (Number(image.z_index) || 0) + 1 };
    case "backward": return { zIndex: Math.max(0, (Number(image.z_index) || 0) - 1) };
    default: return null;
  }
}

export function bindPictureControls(callbacks) {
  state.callbacks = callbacks;

  const host = document.getElementById("edPictureControls");
  host?.addEventListener("click", (event) => {
    const image = selected();
    if (!image) return;

    const shape = event.target.closest("[data-picture-shape]");
    if (shape) return callbacks.onPatchImage?.(image.id, { shape: shape.dataset.pictureShape });

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
