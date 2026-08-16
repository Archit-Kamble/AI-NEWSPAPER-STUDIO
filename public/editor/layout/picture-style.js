// How a placed picture is drawn — once, for everywhere that draws one.
//
// There were two rules and they disagreed. The page canvas set `object-fit:
// cover` and turned the picture inside the box it was given; the editor set
// `contain` and turned it about its own centre in a box that had swapped sides.
// So the same photograph, with the same row behind it, looked like two
// different pictures depending on which half of the screen you were looking at
// - and the one that matters, the page, was the one cropping it.
//
// This is the same rule the template catalog learned (CLAUDE.md): one
// definition, read by everyone, or the copies drift.
//
// Fit itself now reads image-geometry.js's one resolver rather than
// hardcoding `contain` - the desk's actual Contain/Cover/Stretch choice
// (section_images.fit_mode) finally has an effect on the page, not only on
// its own isolated preview.
//
// The frame/box math (size, rotation axis-swap, translate+rotate+flip) is
// unchanged from before this - image-geometry.js computes the SAME
// rotation-aware local target this file already turned a quarter-turned
// picture into. What changed is which native `object-fit` value fills that
// box, driven by fitMode instead of always `contain`.
//
// This paints correctly for the crop-is-the-whole-source case, which is
// every row today - nothing in the UI sets a non-default crop yet (D1 only
// makes the COLUMNS real; a crop UI is explicitly out of scope for this
// phase). object-fit/object-position cannot represent an arbitrary crop
// RECTANGLE combined with cover/stretch on its own; when a crop UI exists,
// this needs to move to explicit background-image sizing instead of relying
// on the browser's own fit math. Documented here rather than silently
// getting it wrong the day a crop control ships.
import { resolvePlacedImage } from "./image-geometry.js";

const OBJECT_FIT = { contain: "contain", cover: "cover", stretch: "fill" };

/**
 * The frame and the picture inside it, as inline styles.
 *
 * `scale` is block pixels per screen pixel — 1 on the page canvas, which draws
 * in block pixels already, and the page's magnification in the editor.
 */
export function placedPictureStyle(row, scale = 1) {
  const resolved = resolvePlacedImage(row);
  const { frame: frameBox, localTarget, rotation, flipH, flipV } = resolved;

  const width = frameBox.width / scale;
  const height = frameBox.height / scale;

  const frame = [
    `left:${frameBox.x / scale}px`,
    `top:${frameBox.y / scale}px`,
    `width:${width}px`,
    `height:${height}px`,
    `z-index:${Number(row.z_index) || 1}`,
  ].join(";");

  const image = [
    "position:absolute",
    "left:50%",
    "top:50%",
    `width:${localTarget.width / scale}px`,
    `height:${localTarget.height / scale}px`,
    `object-fit:${OBJECT_FIT[resolved.fitMode]}`,
    `transform:translate(-50%, -50%) rotate(${rotation}deg)`
      + (flipH ? " scaleX(-1)" : "")
      + (flipV ? " scaleY(-1)" : ""),
    row.shape === "ellipse" ? "border-radius:50%" : "",
  ].filter(Boolean).join(";");

  return { frame, image, shape: row.shape || "rect" };
}
