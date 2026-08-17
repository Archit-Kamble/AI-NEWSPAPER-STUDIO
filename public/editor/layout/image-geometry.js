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

/**
 * The crop rectangle IS the whole source - the one case picture-style.js's
 * native object-fit paints exactly (see its own header note: an arbitrary
 * crop rectangle combined with cover/stretch cannot be expressed as
 * object-fit/object-position, so it is out of scope until a crop UI ships).
 * A caller doing exact geometry off of `resolved` (alpha exclusion, print)
 * must fall back conservatively rather than compute a crop paint does not
 * yet draw - not because the arithmetic is hard, but because agreeing with
 * a picture that has not been painted that way yet would be a NEW
 * disagreement, the exact failure mode this module exists to close.
 */
export function isWholeSourceCrop(resolved) {
  const { crop, source } = resolved;
  return crop.x === 0 && crop.y === 0 && crop.width === source.width && crop.height === source.height;
}

/**
 * One point in the picture's own PRE-transform local space (localContentRect
 * coordinates - the space object-fit places content into, before any CSS
 * transform) mapped into the FRAME's coordinate space - algebraically the
 * same result as picture-style.js's CSS chain
 * (`translate(-50%,-50%) rotate(Ndeg) scaleX/Y(-1)`, all sharing the
 * default centre transform-origin) actually paints.
 *
 * Derivation once, so nobody re-derives the sign conventions by trial and
 * error against a screenshot: transform-origin is `localTarget`'s own
 * centre; CSS composes the transform list right-to-left, so flip (rightmost)
 * applies first, rotate second, and `translate(-50%,-50%)` (leftmost) last.
 * The percentage translate resolves once, to a FIXED vector of
 * (-localTarget.width/2, -localTarget.height/2) - added to a point already
 * expressed relative to that same centre, which exactly cancels the centre
 * offset back out. What survives is: rotate(flip(p - centre)), re-added to
 * the frame's OWN centre (where `left:50%;top:50%` anchored the box before
 * the transform moved it). Checked against a concrete case (a symmetric
 * square, centred content, frame 100x200, rotate 90) landing exactly on the
 * frame's own centre, not offset from it.
 */
export function localPointToFrame(resolved, x, y) {
  const { frame, localTarget, rotation, flipH, flipV } = resolved;
  const cx = localTarget.width / 2;
  const cy = localTarget.height / 2;
  let dx = x - cx;
  let dy = y - cy;
  if (flipH) dx = -dx;
  if (flipV) dy = -dy;

  const angle = (normaliseRotation(rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // CSS rotate() is clockwise in screen space (Y down) - verified against
  // rotate(90deg) sending a point directly "above" centre to "right of"
  // centre, the same direction the picture itself visibly turns.
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return {
    x: frame.x + frame.width / 2 + rx,
    y: frame.y + frame.height / 2 + ry,
  };
}

/** A point in SOURCE pixels (mask/alpha space), mapped through crop and the
 * fitted content rect, then into the frame via localPointToFrame(). */
export function sourcePointToFrame(resolved, sourceX, sourceY) {
  const { crop, localContentRect } = resolved;
  if (!crop.width || !crop.height) return null;
  const u = (sourceX - crop.x) / crop.width;
  const v = (sourceY - crop.y) / crop.height;
  const localX = localContentRect.x + u * localContentRect.width;
  const localY = localContentRect.y + v * localContentRect.height;
  return localPointToFrame(resolved, localX, localY);
}

/**
 * A source-pixel rectangle (one occupied mask cell, or a run of them) mapped
 * to its axis-aligned bounds in frame space - exact only at a quarter turn:
 * an axis-aligned rectangle rotated by any multiple of 90 degrees is still
 * axis-aligned, so the bounding box of its four transformed corners IS the
 * transformed rectangle, not merely an approximation of it. Any other
 * persisted rotation is refused (returns null) rather than silently drawing
 * a skewed shape as if it were the straight line-band intervals this feeds -
 * the caller's job is to fall back to the frame's own conservative box.
 */
export function sourceRectToFrameBounds(resolved, rect) {
  if (normaliseRotation(resolved.rotation) % 90 !== 0) return null;

  // Intersect with the crop rectangle first - a mask cell outside the crop
  // is not part of what is painted at all.
  const crop = resolved.crop;
  const left = Math.max(rect.x, crop.x);
  const top = Math.max(rect.y, crop.y);
  const right = Math.min(rect.x + rect.width, crop.x + crop.width);
  const bottom = Math.min(rect.y + rect.height, crop.y + crop.height);
  if (right <= left || bottom <= top) return null;

  const corners = [
    sourcePointToFrame(resolved, left, top),
    sourcePointToFrame(resolved, right, top),
    sourcePointToFrame(resolved, left, bottom),
    sourcePointToFrame(resolved, right, bottom),
  ];
  if (corners.some((c) => !c)) return null;

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const frame = resolved.frame;
  // Only 'cover' can place content outside the frame (contain/stretch
  // never do); object-fit never paints past the picture element's own box,
  // so this clip matches what is actually visible, not merely a tidy-up.
  return {
    left: Math.max(frame.x, Math.min(...xs)),
    top: Math.max(frame.y, Math.min(...ys)),
    right: Math.min(frame.x + frame.width, Math.max(...xs)),
    bottom: Math.min(frame.y + frame.height, Math.max(...ys)),
  };
}
