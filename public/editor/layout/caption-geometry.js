// Universal, dependency-free caption geometry. This file is both a browser
// side-effect module and a CommonJS module so the canvas and Scribus consume
// precisely the same metrics and wrapping calculation.
(function installCaptionGeometry(root) {
  // A CAPTION IS SET SMALLER THAN THE STORY, AND IN THE OTHER FACE.
  //
  // fontPx was 7.5 against a 6.4 px body - 10.5 pt under 9 pt copy - so the
  // caption was the LARGEST small type on the block and read as a second
  // deck. Photographed in the Block Editor over a real placed photograph.
  // Every printed daily sets a caption under its body size; 8 pt is the
  // ordinary choice and is what publication-type.js's ladder calls 8.
  //
  // `family` is stated here as well because three renderers had three
  // opinions: the page canvas set the sans face (styles.css), the export set
  // serif (print-model.js), and the Block Editor had no caption at all. The
  // sans face is right - it is what separates a caption from the story above
  // it - and now there is one place that says so.
  //
  // Shrinking the box can only ever GIVE the block room, so no stored row can
  // overset on this: 26 rows carry a caption today and every one of them gains
  // space rather than losing it.
  const METRICS = Object.freeze({
    fontPx: 5.6, lineHeight: 1.45, paddingX: 2, paddingY: 1, standOffPx: 1,
    family: 'sans', weight: 700,
  });
  const plain = (value) => String(value || '').replace(/<[^>]*>/g, '').replace(/\*+/g, '').trim();
  function captionBox(image = {}) {
    const caption = plain(image.caption);
    if (!caption) return null;
    const width = Math.max(0, Number(image.width ?? image.width_px) || 0);
    const contentWidth = Math.max(1, width - METRICS.paddingX * 2);
    const perLine = Math.max(1, Math.floor(contentWidth / (METRICS.fontPx * 0.4)));
    const lines = Math.ceil(caption.length / perLine);
    return {
      x: Number(image.x ?? image.x_px) || 0,
      y: (Number(image.y ?? image.y_px) || 0) + (Number(image.height ?? image.height_px) || 0),
      width,
      height: Math.ceil(lines * METRICS.fontPx * METRICS.lineHeight + METRICS.paddingY * 2),
      ...METRICS,
    };
  }
  const api = Object.freeze({ PLACED_CAPTION_METRICS: METRICS, captionBox });
  root.SahasCaptionGeometry = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
