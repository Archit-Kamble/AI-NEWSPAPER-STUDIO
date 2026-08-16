// ONE resolved image transform - the shared truth #9, #10 and #11 collapse
// into, instead of three separate patches (a paint-only fit rule, resize
// handles that only ever changed width, and an exclusion mask that ignored
// crop/fit/flip entirely).
//
//   persisted placement row
//   + source dimensions
//   + crop
//   + fit mode
//   + rotation
//   + flip
//   = one resolved transform
//
// Pure: no DOM, no fetch, no DB, no editor state. A plain object in (a
// section_images row, or an equivalent draft), one deterministic geometry
// object out - the same in Node and in the browser, exactly like
// public/editor/compose/. Paint (picture-style.js), resize preview and,
// eventually, alpha exclusion and print all read this ONE answer rather
// than each recomputing fit/rotation for themselves.

const FIT_MODES = new Set(['contain', 'cover', 'stretch']);

/** A recognised fit mode, or the safe default. */
export function normaliseFitMode(value) {
  return FIT_MODES.has(value) ? value : 'contain';
}

// Normalised into 0-359 but NOT forced onto a 90 degree step. The editor
// only ever asks for a quarter turn, but an arbitrary value from the
// database is still measured honestly rather than silently snapped - a
// caller that needs EXACT alpha wrapping for a non-90 degree rotation does
// not exist yet (see resolvePlacedImage()'s own note).
export function normaliseRotation(value) {
  return (((Number(value) || 0) % 360) + 360) % 360;
}

/** The crop rectangle, in source pixels - defaults to the whole source, and
 * is clamped to stay inside it however it was persisted. */
function sanitiseCrop(row, sourceWidth, sourceHeight) {
  const rawX = Number(row.crop_x_px ?? row.cropX);
  const rawY = Number(row.crop_y_px ?? row.cropY);
  const rawWidth = Number(row.crop_width_px ?? row.cropWidth);
  const rawHeight = Number(row.crop_height_px ?? row.cropHeight);

  const x = Number.isFinite(rawX) && rawX >= 0 ? Math.min(rawX, sourceWidth - 1) : 0;
  const y = Number.isFinite(rawY) && rawY >= 0 ? Math.min(rawY, sourceHeight - 1) : 0;
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? Math.min(rawWidth, sourceWidth - x) : sourceWidth - x;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? Math.min(rawHeight, sourceHeight - y) : sourceHeight - y;

  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * One placement row (persisted `section_images` + its joined `media_assets`
 * columns, or an equivalent draft object), normalised.
 *
 * Reads both snake_case (persisted) and camelCase (a live editor draft)
 * field names, exactly like section-adapter.js's `pick()` - one adapter, so
 * the page canvas, the editor and a server-side caller never each invent
 * their own idea of which name wins.
 */
export function imageInput(row = {}) {
  const frame = {
    x: Number(row.x_px ?? row.x) || 0,
    y: Number(row.y_px ?? row.y) || 0,
    width: Math.max(0, Number(row.width_px ?? row.width) || 0),
    height: Math.max(0, Number(row.height_px ?? row.height) || 0),
  };

  // A source with no known natural size falls back to the placement's own
  // shape - the deterministic fallback for an old asset whose dimensions
  // were never recorded: it preserves whatever the picture currently looks
  // like rather than inventing a size that would suddenly reflow it.
  const sourceWidth = Math.max(1, Number(row.source_width_px ?? row.sourceWidth) || frame.width || 1);
  const sourceHeight = Math.max(1, Number(row.source_height_px ?? row.sourceHeight) || frame.height || 1);

  return {
    frame,
    sourceWidth,
    sourceHeight,
    crop: sanitiseCrop(row, sourceWidth, sourceHeight),
    fitMode: normaliseFitMode(row.fit_mode ?? row.fitMode),
    rotation: normaliseRotation(row.rotation),
    flipH: Boolean(row.flip_h ?? row.flipH),
    flipV: Boolean(row.flip_v ?? row.flipV),
  };
}

/**
 * The cropped source (`sw` x `sh`) resolved into a local target (`tw` x
 * `th`), before any rotation - rotation is applied afterward, as a whole-
 * content transform around the frame centre (see resolvePlacedImage()),
 * never baked into this math, so contain/cover/stretch mean the same thing
 * whatever the rotation is.
 */
function fitRect(sw, sh, tw, th, fitMode) {
  if (fitMode === 'stretch') {
    // Independent X/Y fill, distortion intended - this is the one mode
    // that does not preserve the source's aspect ratio, deliberately.
    return { x: 0, y: 0, width: tw, height: th, scaleX: tw / sw, scaleY: th / sh };
  }
  const scale = fitMode === 'cover' ? Math.max(tw / sw, th / sh) : Math.min(tw / sw, th / sh);
  const width = sw * scale;
  const height = sh * scale;
  // Centred in both modes: contain leaves equal blank margins on the two
  // shorter sides, cover overflows equally on the two longer ones (which is
  // what the caller's clipRect exists to cut off).
  return { x: (tw - width) / 2, y: (th - height) / 2, width, height, scaleX: scale, scaleY: scale };
}

/**
 * The one resolved transform for a placed picture.
 *
 * `localTarget`/`localContentRect` are in the frame's PRE-rotation
 * coordinate space (axes swapped for a quarter turn, matching the same
 * "swap the box, then turn the whole thing" technique picture-style.js
 * already used for its one fit mode) - a caller applies rotation/flip as
 * its own transform on top, exactly as before; this only ever decides
 * where the content sits before that transform.
 */
export function resolvePlacedImage(row) {
  const input = imageInput(row);
  const { frame, sourceWidth, sourceHeight, crop, fitMode, rotation, flipH, flipV } = input;

  const quarter = rotation % 180 !== 0;
  const localTarget = {
    width: quarter ? frame.height : frame.width,
    height: quarter ? frame.width : frame.height,
  };

  const content = fitRect(crop.width, crop.height, localTarget.width, localTarget.height, fitMode);

  return {
    frame,
    source: { width: sourceWidth, height: sourceHeight },
    crop,
    fitMode,
    rotation,
    flipH,
    flipV,
    localTarget,
    localContentRect: { x: content.x, y: content.y, width: content.width, height: content.height },
    // Only `cover` can ever place content outside the frame; contain and
    // stretch never do. Declared uniformly anyway - a no-op clip for the
    // other two - so a caller can always apply `overflow:hidden` to the
    // frame without asking which mode is active.
    clipRect: { x: 0, y: 0, width: frame.width, height: frame.height },
    scaleX: content.scaleX,
    scaleY: content.scaleY,
  };
}
