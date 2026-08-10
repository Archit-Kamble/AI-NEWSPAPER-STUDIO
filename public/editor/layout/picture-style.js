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

/**
 * The frame and the picture inside it, as inline styles.
 *
 * `scale` is block pixels per screen pixel — 1 on the page canvas, which draws
 * in block pixels already, and the page's magnification in the editor.
 */
export function placedPictureStyle(row, scale = 1) {
  const width = Number(row.width_px) / scale;
  const height = Number(row.height_px) / scale;
  const turn = (((Number(row.rotation) || 0) % 360) + 360) % 360;
  // A quarter turn swaps the box, so the picture inside is set to the box's
  // other way round and then turned into place. Without this a portrait turned
  // on its side was squeezed into a landscape box instead of lying down in it.
  const quarter = turn % 180 !== 0;

  const frame = [
    `left:${Number(row.x_px) / scale}px`,
    `top:${Number(row.y_px) / scale}px`,
    `width:${width}px`,
    `height:${height}px`,
    `z-index:${Number(row.z_index) || 1}`,
  ].join(";");

  const image = [
    "position:absolute",
    "left:50%",
    "top:50%",
    `width:${quarter ? height : width}px`,
    `height:${quarter ? width : height}px`,
    // Never `cover`. A placement carries the picture's own proportions, so
    // there is nothing to crop - and where it does not, cropping silently
    // throws away the top of somebody's head rather than showing the desk that
    // the box is wrong.
    "object-fit:contain",
    `transform:translate(-50%, -50%) rotate(${turn}deg)`
      + (row.flip_h ? " scaleX(-1)" : "")
      + (row.flip_v ? " scaleY(-1)" : ""),
    row.shape === "ellipse" ? "border-radius:50%" : "",
  ].filter(Boolean).join(";");

  return { frame, image, shape: row.shape || "rect" };
}
