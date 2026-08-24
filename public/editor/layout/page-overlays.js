// A PICTURE THAT CROSSES BLOCK BOUNDARIES - placed on the PAGE, not in a story.
//
// WHY IT CANNOT BE A BLOCK'S PICTURE. `.newspaper-section` is `overflow:
// hidden` and must stay that way: overset copy may not spill onto the next
// story, and CLAUDE.md records that as the reason a column rule cannot be a
// pseudo-element on a block either. So a picture belonging to one block can
// never be seen outside it, whatever coordinates it is given. A photograph
// that spans two stories is a fact about the PAGE, exactly as a column rule is
// a fact about a pair of blocks.
//
// WHAT IT DOES TO THE STORIES UNDER IT. It excludes them, and this is the
// whole point - a picture laid over a column of type without the type moving
// is a picture printed on top of the news. Every block the overlay's rectangle
// touches gains it as one more obstacle, translated into that block's own
// coordinates. Blocks it does not touch are not affected at all, which is the
// requirement's own condition: one overlapping image must not reach a block it
// does not overlap.
//
// It is stored as JSONB on the PAGE for the same reason inset panels are
// stored on the section: an overlay has no life of its own, cannot move
// between pages, and dies with the page.
(function installPageOverlays(root) {
  const MIN_PX = 16;
  // One line of the caption face at its own leading, plus its padding -
  // caption-geometry.js's METRICS, which is what actually draws it.
  const CAPTION_BAND_PX = Math.ceil(5.6 * 1.45 + 2);
  const DEFAULT_STAND_OFF_PX = 6;

  /** One stored overlay, sanitised. Null for anything unusable. */
  function overlayOf(raw, page = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const url = String(raw.url || '').trim();
    if (!url || /^(javascript|data):/i.test(url)) return null;
    const width = Math.max(MIN_PX, Number(raw.width) || 0);
    const height = Math.max(MIN_PX, Number(raw.height) || 0);
    const pageWidth = Number(page.width) || 0;
    const pageHeight = Number(page.height) || 0;
    const clamp = (value, span, limit) => (limit
      ? Math.min(Math.max(0, Number(value) || 0), Math.max(0, limit - span))
      : Math.max(0, Number(value) || 0));
    return {
      id: String(raw.id || `overlay-${Math.random().toString(36).slice(2, 9)}`),
      url,
      x: clamp(raw.x, width, pageWidth),
      y: clamp(raw.y, height, pageHeight),
      width, height,
      z: Number.isFinite(Number(raw.z)) ? Number(raw.z) : 20,
      standOffPx: Math.max(0, Number(raw.standOffPx ?? DEFAULT_STAND_OFF_PX)),
      caption: String(raw.caption || '').replace(/<[^>]*>/g, '').trim(),
      fitMode: ['contain', 'cover', 'stretch'].includes(raw.fitMode) ? raw.fitMode : 'cover',
    };
  }

  /** Every legal overlay on a page, in PAGE pixels. */
  function overlaysOf(page = {}) {
    const raw = page.overlay_images ?? page.overlayImages;
    const list = Array.isArray(raw) ? raw : [];
    const frame = { width: Number(page.page_width_px) || Number(page.width) || 0,
      height: Number(page.page_height_px) || Number(page.height) || 0 };
    return list.map((entry) => overlayOf(entry, frame)).filter(Boolean)
      .sort((a, b) => a.z - b.z);
  }

  /** Does this overlay's rectangle touch this block's? */
  function touches(overlay, section) {
    const bx = Number(section.x_px) || 0;
    const by = Number(section.y_px) || 0;
    const bw = Number(section.width_px) || 0;
    const bh = Number(section.height_px) || 0;
    return overlay.x < bx + bw && overlay.x + overlay.width > bx
      && overlay.y < by + bh && overlay.y + overlay.height > by;
  }

  /**
   * The overlays this block has to set its type around, in the BLOCK's own
   * coordinates - which is the only space the compositor knows.
   *
   * A rectangle, like everything else in the obstacle set. The overlay may
   * hang outside the block on any side and that is fine: an obstacle partly
   * off the frame simply excludes the part that is on it.
   */
  function overlayObstaclesFor(section, overlays) {
    const bx = Number(section.x_px) || 0;
    const by = Number(section.y_px) || 0;
    return (overlays || []).filter((overlay) => touches(overlay, section)).map((overlay) => ({
      x: overlay.x - bx, y: overlay.y - by,
      width: overlay.width,
      // THE CAPTION IS PART OF THE OBSTACLE, not something drawn after it.
      // It is set under the picture, so it occupies room the story cannot
      // have - and counting the photograph but not its caption is exactly how
      // copy ends up printed underneath a caption. section-adapter.js's
      // obstaclesOf() says the same thing about a placed picture's caption in
      // its own comment; this is the page-level twin of it, and it was found
      // the same way: by rendering a page with one and looking at the words
      // running through it.
      height: overlay.height + (overlay.caption ? CAPTION_BAND_PX : 0),
      shape: 'rect', rotation: 0, standOffPx: overlay.standOffPx, mask: null,
    }));
  }

  const api = Object.freeze({
    PAGE_OVERLAY_MIN_PX: MIN_PX, overlayOf, overlaysOf, touches, overlayObstaclesFor,
  });
  root.SahasPageOverlays = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
