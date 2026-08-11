// Phase 9: layout-engine preparation.
//
// Every section carries the measurements an automatic layout pass will need:
// how much vertical space each element wants, the image's aspect ratio, and how
// much of the section's box is still free. Nothing consumes these yet beyond
// the Inspector's read-out - they exist so a future AI layout step has real
// numbers to fit against instead of guessing.
//
// These are ESTIMATES computed from character counts and font sizes, in the
// editor's pixel space (`page_sections.x_px/y_px/width_px/height_px`). They are
// deliberately NOT persisted: they are derived from content that changes on
// every keystroke, so a stored copy would be stale immediately. Print output
// will need real text measurement in millimetres - see CLAUDE.md on never
// mixing px and mm silently.

// The one height estimate text-flow.js's character grid already uses for the
// headline and subheading rows it reserves - reused here rather than
// reimplemented, so this module's "how full is the block" answer and the
// grid's "how much fits" answer can never drift onto two different line
// heights the way they used to (layout-metrics.js's own copy was 1.25;
// text-flow.js's was the Devanagari-safe 1.45).
import { estimateHeight } from "./text-flow.js";

const PADDING_PX = 12;

export function computeMetrics(section, view) {
  const widthPx = Number(section?.width_px) || 0;
  const heightPx = Number(section?.height_px) || 0;
  const contentWidthPx = Math.max(0, widthPx - PADDING_PX * 2);
  const availableAreaPx = Math.max(0, contentWidthPx * Math.max(0, heightPx - PADDING_PX * 2));

  const headlineHeightPx = estimateHeight(view?.headline, view?.headlineFontPx, contentWidthPx);
  const subheadingHeightPx = estimateHeight(view?.subheading, view?.subheadingFontPx, contentWidthPx);
  const bodyHeightPx = estimateHeight(view?.body, view?.bodyFontPx, contentWidthPx);
  const captionHeightPx = estimateHeight(view?.caption, 12, contentWidthPx);

  // An image with no explicit crop is laid out at a newspaper-standard 3:2 and
  // scaled by the editor's zoom, capped so it can never claim the whole box.
  const imageRatio = view?.imageUrl ? 3 / 2 : 0;
  const imageHeightPx = view?.imageUrl
    ? Math.min(
        Math.round((contentWidthPx / imageRatio) * (Number(view.imageZoom) || 1)),
        Math.round(heightPx * 0.6),
      )
    : 0;

  const usedHeightPx =
    headlineHeightPx + subheadingHeightPx + bodyHeightPx + captionHeightPx + imageHeightPx;
  const remainingHeightPx = Math.max(0, heightPx - PADDING_PX * 2 - usedHeightPx);
  const usedAreaPx = Math.min(availableAreaPx, contentWidthPx * usedHeightPx);

  return {
    widthPx,
    heightPx,
    contentWidthPx,
    headlineHeightPx,
    subheadingHeightPx,
    bodyHeightPx,
    captionHeightPx,
    imageHeightPx,
    imageRatio,
    usedHeightPx,
    remainingHeightPx,
    availableAreaPx,
    usedAreaPx,
    remainingAreaPx: Math.max(0, availableAreaPx - usedAreaPx),
    fillRatio: availableAreaPx ? Math.min(1, usedAreaPx / availableAreaPx) : 0,
    overflowing: usedHeightPx > heightPx - PADDING_PX * 2,
  };
}
