// The composition canvas: the left half of the External Editor.
//
// This is not a preview. It is a real object editor - Fabric.js, vendored under
// public/vendor/fabric - so the page designer gets drag, rotate-by-handle,
// scale from any corner, flip, layering and multi-select for free rather than
// hand-rolled. See fabric-surface.js for the engine wrapper.
//
// What is newspaper-specific lives here: the block is a fixed printable
// rectangle, copy is drawn but locked, and every move writes back a placement
// that layout/text-flow.js turns into the character grid the AI is briefed with.

import { buildFlowMap, CELL, flowImageFromRow, flowRuns, pourIntoRuns } from "../layout/text-flow.js";
import { plainText } from "../layout/rich-text.js";
import * as surface from "./fabric-surface.js";

let state = {
  section: null,
  view: null,
  images: [],
  selectedId: null,
  showGrid: false,
  callbacks: {},
};

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

export function composeCanvasMarkup() {
  return `
    <div class="compose">
      <div class="compose-head">
        <span class="preview-label">Composition</span>
        <div class="compose-tools">
          <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="cmpAddImage">+ Add image</button>
          <button type="button" class="ext-editor-btn" id="cmpToggleGrid"
                  title="Show the character grid the AI is briefed with">Show grid</button>
          <span class="muted compose-size" id="cmpSize"></span>
        </div>
      </div>
      <div class="compose-selected" id="cmpSelected"></div>
      <div class="compose-frame" id="cmpFrame">
        <div class="compose-surface" id="cmpSurface">
          <div class="compose-grid" id="cmpGrid" aria-hidden="true"></div>
          <canvas id="cmpCanvas"></canvas>
        </div>
      </div>
      <input type="file" accept="image/*" id="cmpFileInput" hidden />
    </div>
  `;
}

// ------------------------------------------------------------------ grid ---

function gridMarkup(map, view) {
  if (!map.cols || !map.rows) return "";
  const cells = [];
  for (let row = 0; row < map.rows; row += 1) {
    for (let col = 0; col < map.cols; col += 1) {
      const kind = map.grid[row][col];
      if (kind === CELL.IMAGE) continue;
      cells.push(
        `<span class="flow-cell flow-${kind}" style="left:${col * map.cellWidth}px;top:${row * map.cellHeight}px;width:${map.cellWidth}px;height:${map.cellHeight}px"></span>`,
      );
    }
  }
  return `<div class="compose-flow" style="inset:${view.marginPx}px">${cells.join("")}</div>`;
}

// The grid is computed from where the pictures actually are on the canvas, not
// from the last saved rows - so it follows a drag as it happens.
function liveFlowImages() {
  const live = surface.currentPlacements();
  if (!live.length) return state.images.map(flowImageFromRow);

  return live.map((placement) => {
    const row = state.images.find((image) => image.id === placement.id);
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      shape: placement.shape || row?.shape || "rect",
      rotation: placement.rotation || 0,
      standOffPx: Number(row?.stand_off_px) || 0,
      mask: row?.mask || null,
    };
  });
}

function currentMap() {
  if (!state.section || !state.view) return null;
  return buildFlowMap(state.section, state.view, liveFlowImages());
}

function paintGrid() {
  const host = document.getElementById("cmpGrid");
  const map = currentMap();
  if (!host || !map) return map;
  host.innerHTML = state.showGrid ? gridMarkup(map, state.view) : "";

  const size = document.getElementById("cmpSize");
  if (size && state.section) {
    const w = Number(state.section.width_px);
    const h = Number(state.section.height_px);
    size.textContent = `${w} × ${h} px · ${(w / 2).toFixed(0)} × ${(h / 2).toFixed(0)} mm · room for ${map.bodyCharBudget} characters`;
  }
  return map;
}

// --------------------------------------------------------------- rendering ---

export async function renderComposeCanvas(section, view, images, callbacks) {
  if (callbacks) state.callbacks = callbacks;
  state = { ...state, section, view, images: images || [] };

  const canvasEl = document.getElementById("cmpCanvas");
  if (!canvasEl || !section || !view) return null;

  const width = Number(section.width_px) || 0;
  const height = Number(section.height_px) || 0;

  await surface.initSurface(canvasEl, { width, height }, {
    onPlacementChanged: (id, placement) => {
      paintGrid();
      state.callbacks.onPatchImage?.(id, placement);
    },
    onSelect: (id) => {
      state.selectedId = id;
      renderSelectedBar();
    },
    // Typing on the canvas writes back to the same draft the Inspector edits,
    // so the two never hold different versions of the story.
    onTextEdited: (field, text) => {
      if (!field) return;
      state.callbacks.onPatch?.({ [field]: text }, "compose-canvas");
    },
  });

  // Pictures first: where they sit decides which cells the copy may use.
  for (const row of state.images) await surface.addImageObject(row);
  drawText(view, currentMap(), width, height);

  // Selecting the picture is what reveals its handles and its controls. A
  // picture that lands unselected looks inert - the editor sees it appear and
  // has nothing to do to it.
  const stillThere = state.images.some((i) => i.id === state.selectedId);
  const target = stillThere ? state.selectedId : state.images[state.images.length - 1]?.id;
  if (target != null) {
    state.selectedId = target;
    surface.selectImage(target);
  }

  renderSelectedBar();
  scaleComposeCanvas();
  return paintGrid();
}

// Text is drawn into the cells the grid says are free, run by run - so it
// really does flow around the picture instead of disappearing behind it. The
// runs the copy is poured into are the same runs the AI is asked to fill.
function drawText(view, map, width, height) {
  if (!map) return;
  const pad = Number(view.marginPx) || 12;

  const pour = (kind, text, fontSize, weight, field) => {
    if (!text) return;
    const runs = flowRuns(map, kind);
    if (!runs.length) return;
    pourIntoRuns(runs, text).forEach((piece) => {
      surface.addTextObject({
        text: piece.text,
        left: pad + piece.col * map.cellWidth,
        top: pad + piece.row * map.cellHeight,
        width: piece.length * map.cellWidth + 2,
        fontSize,
        weight,
        align: view.textAlign,
        field,
      });
    });
  };

  pour(CELL.HEADLINE, plainText(view.headline), Number(view.headlineFontPx) || 34, "700", "headline");
  pour(CELL.SUBHEADING, plainText(view.subheading), Number(view.subheadingFontPx) || 20, "400", "subheading");
  // The plain text: this canvas draws with Fabric, which sets characters, not
  // markup. Handing it the stored HTML printed "<b>" on the composition preview
  // as if it were part of the story.
  pour(CELL.TEXT, plainText(view.body), Number(view.bodyFontPx) || 16, "400", "body");

  if (!view.headline && !view.subheading && !view.body && !state.images.length) {
    const hint = surface.addTextObject({
      text: `Add a picture, then let the AI fill the ${map.bodyCharBudget} characters around it.`,
      left: pad,
      top: height / 2 - 20,
      width: width - pad * 2,
      fontSize: 13,
      weight: "400",
      align: "center",
    });
    hint?.set({ fill: "#9a9aa2" });
  }
}

// --------------------------------------------------------- selected picture ---

function renderSelectedBar() {
  const bar = document.getElementById("cmpSelected");
  if (!bar) return;

  const image = state.images.find((i) => i.id === state.selectedId);
  if (!image) {
    bar.innerHTML = state.images.length
      ? `<p class="muted">Click a picture on the block to shape it.</p>`
      : `<p class="muted">No picture on this block yet — use <strong>+ Add image</strong> above.</p>`;
    return;
  }

  const shapes = [
    ["rect", "Box"],
    ["ellipse", "Oval"],
    ["cutout", "Cut-out"],
  ];

  bar.innerHTML = `
    <div class="compose-selected-row">
      <strong>${escapeText(image.original_filename || "picture")}</strong>
      <button type="button" class="ext-editor-btn danger" id="cmpRemoveImage">Remove picture</button>
    </div>

    <label class="preview-label">Copy wraps as</label>
    <div class="segmented">
      ${shapes
        .map(
          ([key, label]) =>
            `<button type="button" class="segment${(image.shape || "rect") === key ? " active" : ""}" data-shape="${key}">${label}</button>`,
        )
        .join("")}
    </div>

    <label class="preview-label">Gap around the picture</label>
    <input type="range" id="cmpStandOff" min="0" max="24" value="${Number(image.stand_off_px) || 0}" />

    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" data-image-action="rotate">Rotate 90°</button>
      <button type="button" class="ext-editor-btn" data-image-action="flip-h">Flip H</button>
      <button type="button" class="ext-editor-btn" data-image-action="flip-v">Flip V</button>
      <button type="button" class="ext-editor-btn" data-image-action="bigger">Bigger</button>
      <button type="button" class="ext-editor-btn" data-image-action="smaller">Smaller</button>
    </div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" data-image-action="forward">Bring forward</button>
      <button type="button" class="ext-editor-btn" data-image-action="backward">Send back</button>
      <button type="button" class="ext-editor-btn" data-image-action="cutout">Remove background</button>
    </div>
    <p class="muted ext-note">Drag the picture to move it, the corners to size it, and the handle above it to rotate.</p>
  `;

  bar.querySelectorAll("[data-shape]").forEach((btn) =>
    btn.addEventListener("click", () => state.callbacks.onPatchImage?.(image.id, { shape: btn.dataset.shape })),
  );
  document.getElementById("cmpStandOff")?.addEventListener("change", (event) =>
    state.callbacks.onPatchImage?.(image.id, { standOffPx: Number(event.target.value) }),
  );
  document.getElementById("cmpRemoveImage")?.addEventListener("click", () => removeSelected());
  bar.querySelectorAll("[data-image-action]").forEach((btn) =>
    btn.addEventListener("click", () => onImageAction(image, btn.dataset.imageAction)),
  );
}

function removeSelected() {
  const id = surface.removeActive() ?? state.selectedId;
  if (id == null) return;
  state.selectedId = null;
  paintGrid();
  state.callbacks.onRemoveImage?.(id);
}

function onImageAction(image, action) {
  const run = {
    rotate: () => surface.rotateActive(90),
    "flip-h": () => surface.flipActiveH(),
    "flip-v": () => surface.flipActiveV(),
    bigger: () => surface.scaleActive(1.1),
    smaller: () => surface.scaleActive(0.9),
    forward: () => surface.bringActiveForward(),
    backward: () => surface.sendActiveBackward(),
  }[action];

  if (run) {
    const result = run();
    paintGrid();
    if (result) state.callbacks.onPatchImage?.(result.id, result.placement);
    return;
  }

  if (action === "cutout") return state.callbacks.onRemoveBackground?.(image.id);
}

// ----------------------------------------------------------------- scaling ---

export function scaleComposeCanvas() {
  surface.scaleSurface(document.getElementById("cmpFrame"), document.getElementById("cmpSurface"));
}

// ----------------------------------------------------------------- binding ---

export function bindComposeCanvas(callbacks) {
  state.callbacks = callbacks;

  const fileInput = document.getElementById("cmpFileInput");
  document.getElementById("cmpAddImage")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await callbacks.onAddImage?.(file);
    event.target.value = "";
  });

  document.getElementById("cmpToggleGrid")?.addEventListener("click", (event) => {
    state.showGrid = !state.showGrid;
    event.target.textContent = state.showGrid ? "Hide grid" : "Show grid";
    paintGrid();
  });

  // Delete removes the selected picture, the way every editor does.
  document.addEventListener("keydown", onDeleteKey);
}

function onDeleteKey(event) {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
  if (!surface.activeImageId()) return;
  event.preventDefault();
  removeSelected();
}

export function selectedImageId() {
  return state.selectedId;
}

// Clicking a picture in the list on the right selects it on the canvas.
export function selectImageById(id) {
  state.selectedId = id;
  surface.selectImage(id);
  renderSelectedBar();
}
