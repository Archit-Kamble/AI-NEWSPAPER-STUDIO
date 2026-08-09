// The composition surface, backed by Fabric.js.
//
// Fabric is vendored under public/vendor/fabric (MIT, no CDN). It gives the
// page designer everything a real object editor does - drag, resize from any
// corner, rotate by handle, flip, scale, layer, multi-select - without any of
// it being hand-rolled here. What this module adds is the newspaper part: the
// block is a fixed printable rectangle, pictures may not leave it, and every
// change writes back a placement that the character grid can read.
//
// Text is drawn on the same canvas, but locked. Headlines and copy are set by
// typography and by the AI fit, not dragged around by hand - so they are
// visible for judgement and not selectable.

const FABRIC_JS = "/vendor/fabric/fabric.min.js";

let loading = null;
let canvas = null;
let listeners = {};
let blockSize = { width: 0, height: 0 };

function loadFabric() {
  if (window.fabric) return Promise.resolve(window.fabric);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = FABRIC_JS;
    script.onload = () => resolve(window.fabric);
    script.onerror = () => reject(new Error("Fabric failed to load"));
    document.head.appendChild(script);
  });
  return loading;
}

export function isReady() {
  return Boolean(canvas);
}

export async function initSurface(canvasEl, { width, height }, callbacks = {}) {
  const fabric = await loadFabric();
  listeners = callbacks;
  blockSize = { width, height };

  if (canvas) {
    canvas.dispose();
    canvas = null;
  }

  canvas = new fabric.Canvas(canvasEl, {
    width,
    height,
    backgroundColor: "#ffffff",
    preserveObjectStacking: true,
    selection: true,
  });

  // Newspaper handles: square, red, and big enough to grab at any zoom.
  fabric.Object.prototype.set({
    transparentCorners: false,
    cornerColor: "#ffffff",
    cornerStrokeColor: "#c8102e",
    borderColor: "#c8102e",
    cornerSize: 10,
    cornerStyle: "rect",
    padding: 2,
  });

  // A picture that leaves the block would be off the page in print.
  canvas.on("object:moving", (event) => clampToBlock(event.target));
  canvas.on("object:scaling", (event) => clampToBlock(event.target));

  canvas.on("object:modified", (event) => {
    const target = event.target;
    if (!target || target.data?.kind !== "image") return;
    listeners.onPlacementChanged?.(target.data.id, placementOf(target));
  });

  canvas.on("selection:created", emitSelection);
  canvas.on("selection:updated", emitSelection);
  canvas.on("selection:cleared", () => listeners.onSelect?.(null));

  return canvas;
}

function emitSelection() {
  const active = canvas?.getActiveObject();
  listeners.onSelect?.(active?.data?.kind === "image" ? active.data.id : null);
}

// Shrinks an object until its bounding box fits the block, then moves it back
// inside. Used after a rotation, where a clamp alone cannot help because the
// box may now be larger than the block in one direction.
function fitInsideBlock(object) {
  if (!object) return;
  object.setCoords();
  let box = boxOf(object);

  // A turn can make the box larger than the block in one direction - a wide
  // picture stood upright. Shrink until it fits, then put it back inside.
  const excess = Math.max(box.width / blockSize.width, box.height / blockSize.height);
  if (excess > 1) {
    object.scaleX /= excess;
    object.scaleY /= excess;
    object.setCoords();
    box = boxOf(object);
  }
  clampToBlock(object);
}

// The true upright box of an object, rotation included.
//
// `getBoundingRect` cannot be trusted here: with a top-left origin it reports
// the object's *unrotated* size, so a picture turned 90 degrees measured as
// though it were still lying flat and every clamp worked from a wrong box -
// which is how rotating pushed pictures off the block. The four corners always
// tell the truth.
function boxOf(object) {
  const corners = object.getCoords(true);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function clampToBlock(object) {
  if (!object) return;
  object.setCoords();
  const box = boxOf(object);
  if (box.left < 0) object.left -= box.left;
  if (box.top < 0) object.top -= box.top;
  if (box.left + box.width > blockSize.width) {
    object.left -= box.left + box.width - blockSize.width;
  }
  if (box.top + box.height > blockSize.height) {
    object.top -= box.top + box.height - blockSize.height;
  }
  object.setCoords();
}

// A Fabric object as the database stores it.
//
// The picture's OWN size is stored, not its rotated bounding box, together with
// the angle. Storing the rotated box and re-applying the angle on reload
// double-counts the rotation: a picture turned 90 degrees came back with its
// width and height already swapped, was turned again, and walked off the block
// a little further every time it was opened.
//
// The character grid works out the occupied area from size plus angle - see
// layout/text-flow.js.
function placementOf(object) {
  return {
    x: Math.round(object.left),
    y: Math.round(object.top),
    width: Math.round(object.getScaledWidth()),
    height: Math.round(object.getScaledHeight()),
    rotation: Math.round(object.angle || 0),
    flipH: Boolean(object.flipX),
    flipV: Boolean(object.flipY),
  };
}

// --------------------------------------------------------------- contents ---

export function clearSurface() {
  canvas?.clear();
  if (canvas) canvas.backgroundColor = "#ffffff";
}

export async function addImageObject(row) {
  if (!canvas) return null;
  const fabric = window.fabric;

  return new Promise((resolve) => {
    fabric.Image.fromURL(
      row.url,
      (image) => {
        if (!image || !canvas) return resolve(null);
        const width = Number(row.width_px) || 120;
        const height = Number(row.height_px) || 90;

        image.set({
          left: Number(row.x_px) || 0,
          top: Number(row.y_px) || 0,
          angle: Number(row.rotation) || 0,
          flipX: Boolean(row.flip_h),
          flipY: Boolean(row.flip_v),
          scaleX: width / (image.width || width),
          scaleY: height / (image.height || height),
          data: { kind: "image", id: row.id, shape: row.shape || "rect" },
        });

        // An oval picture is clipped to its own ellipse, so what the designer
        // sees matches the cells the grid marks as occupied.
        if (row.shape === "ellipse") {
          image.clipPath = new fabric.Ellipse({
            rx: (image.width || width) / 2,
            ry: (image.height || height) / 2,
            originX: "center",
            originY: "center",
          });
        }

        canvas.add(image);
        canvas.requestRenderAll();
        resolve(image);
      },
      { crossOrigin: "anonymous" },
    );
  });
}

// Copy is drawn on the canvas and can be edited there: double-click a piece and
// type. It is not draggable - where copy sits is decided by the character grid,
// not by hand - but the words themselves are the editor's to change, and the
// change goes straight back into the draft.
export function addTextObject({ text, left = 0, top, fontSize, weight, width, align = "left", field }) {
  if (!canvas || !text) return null;
  const object = new window.fabric.Textbox(text, {
    left,
    top,
    width,
    fontSize,
    fontWeight: weight,
    fontFamily: "Noto Sans Devanagari, Arial, sans-serif",
    textAlign: align,
    fill: "#111111",
    // Editable, but pinned: moving and scaling are off, so copy cannot be
    // dragged out of the cells the grid assigned it.
    selectable: true,
    evented: true,
    editable: true,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hasControls: false,
    hasBorders: false,
    hoverCursor: "text",
    data: { kind: "text", field },
  });

  object.on("editing:exited", () => {
    // A field is drawn in several pieces when it flows round a picture, so the
    // whole field is reassembled from its pieces before it is saved.
    const pieces = canvas
      .getObjects()
      .filter((o) => o.data?.kind === "text" && o.data.field === field)
      .map((o) => o.text.trim())
      .filter(Boolean);
    listeners.onTextEdited?.(field, pieces.join(" "));
  });

  canvas.add(object);
  canvas.sendToBack(object);
  return object;
}

export function selectImage(id) {
  if (!canvas) return;
  const target = canvas.getObjects().find((o) => o.data?.kind === "image" && o.data.id === id);
  if (target) {
    canvas.setActiveObject(target);
    canvas.requestRenderAll();
  }
}

export function activeImageId() {
  const active = canvas?.getActiveObject();
  return active?.data?.kind === "image" ? active.data.id : null;
}

// ---------------------------------------------------------------- actions ---
//
// These are the things Fabric already does well; the module exposes them so the
// toolbar is one line each rather than a re-implementation.

function withActive(run) {
  const active = canvas?.getActiveObject();
  if (!active || active.data?.kind !== "image") return null;
  run(active);
  active.setCoords();
  canvas.requestRenderAll();
  return { id: active.data.id, placement: placementOf(active) };
}

export const rotateActive = (degrees = 90) =>
  withActive((o) => {
    // Turn about the picture's own centre so it stays where it was, rather
    // than swinging away from its top-left corner. The box changes shape - a
    // wide picture stood upright becomes tall - so it is refitted afterwards.
    const before = boxOf(o);
    const centre = { x: before.left + before.width / 2, y: before.top + before.height / 2 };

    o.rotate(((o.angle || 0) + degrees) % 360);
    o.setCoords();

    const after = boxOf(o);
    o.left += centre.x - (after.left + after.width / 2);
    o.top += centre.y - (after.top + after.height / 2);
    o.setCoords();

    fitInsideBlock(o);
  });
export const flipActiveH = () => withActive((o) => o.set("flipX", !o.flipX));
export const flipActiveV = () => withActive((o) => o.set("flipY", !o.flipY));
export const bringActiveForward = () => withActive((o) => canvas.bringForward(o));
export const sendActiveBackward = () => withActive((o) => canvas.sendBackwards(o));
export const scaleActive = (factor) =>
  withActive((o) => {
    o.scaleX *= factor;
    o.scaleY *= factor;
  });

export function removeActive() {
  const active = canvas?.getActiveObject();
  if (!active || active.data?.kind !== "image") return null;
  const id = active.data.id;
  canvas.remove(active);
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  return id;
}

// The upright rectangles the character grid is built from - read straight off
// the canvas, so what is drawn and what is counted can never drift apart.
export function currentPlacements() {
  if (!canvas) return [];
  return canvas
    .getObjects()
    .filter((o) => o.data?.kind === "image")
    .map((o) => ({ id: o.data.id, shape: o.data.shape, ...placementOf(o) }));
}

// Fitting the block to the column uses Fabric's own zoom, NOT a CSS transform.
// A transform on an ancestor moves the canvas visually but not as far as
// Fabric's pointer maths is concerned, so clicks land in the wrong place and
// nothing can be selected or dragged. Zooming inside Fabric keeps object
// coordinates in block pixels - which is what gets stored and printed - while
// hit-testing stays correct.
export function scaleSurface(frame, wrapper) {
  if (!canvas || !frame || !wrapper || !blockSize.width) return 1;

  // Fitted to the frame's width AND to a share of the window's height. Width
  // alone let a small block fill half a screen: a 268 x 248px block in a 640px
  // column came out 536px tall, so the proof of the block was the biggest thing
  // in the dock and the story was squeezed beside it.
  const available = frame.clientWidth - 24;
  const roomToShow = Math.max(220, Math.min(420, window.innerHeight * 0.45));
  const scale = Math.min(2, available / blockSize.width, roomToShow / blockSize.height);

  canvas.setZoom(scale);
  canvas.setDimensions({
    width: Math.round(blockSize.width * scale),
    height: Math.round(blockSize.height * scale),
  });
  canvas.calcOffset();

  wrapper.style.width = `${Math.round(blockSize.width * scale)}px`;
  wrapper.style.height = `${Math.round(blockSize.height * scale)}px`;
  frame.style.height = `${Math.round(blockSize.height * scale) + 24}px`;

  // The grid overlay is drawn in block pixels, so it follows the same zoom.
  const grid = document.getElementById("cmpGrid");
  if (grid) {
    grid.style.transform = `scale(${scale})`;
    grid.style.transformOrigin = "top left";
  }
  return scale;
}

export function disposeSurface() {
  canvas?.dispose();
  canvas = null;
}

// All the copy currently drawn on the surface. Used to check that what an
// editor typed reached the composition, which is not otherwise inspectable -
// Fabric draws to a bitmap, so there is no DOM text to read.
export function canvasText() {
  if (!canvas) return "";
  return canvas
    .getObjects()
    .filter((o) => o.data?.kind === "text")
    .map((o) => o.text)
    .join("\n");
}

// Whether copy on the canvas can be typed into, and whether it is still pinned
// where the grid put it. Both matter: editable but draggable would let a
// compositor pull a headline out of its cells.
export function textEditability() {
  if (!canvas) return { editable: 0, locked: 0 };
  const texts = canvas.getObjects().filter((o) => o.data?.kind === "text");
  return {
    editable: texts.filter((o) => o.editable && o.selectable).length,
    locked: texts.filter((o) => o.lockMovementX && o.lockMovementY).length,
  };
}


