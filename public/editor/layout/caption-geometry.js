// Universal, dependency-free caption geometry. This file is both a browser
// side-effect module and a CommonJS module so the canvas and Scribus consume
// precisely the same metrics and wrapping calculation.
(function installCaptionGeometry(root) {
  const METRICS = Object.freeze({ fontPx: 7.5, lineHeight: 1.45, paddingX: 2, paddingY: 1, standOffPx: 1 });
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
