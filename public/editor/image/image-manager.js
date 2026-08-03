// Phase 8: the image pipeline.
//
// Upload goes through the existing POST /api/uploads/images endpoint (already
// used by the reporter form) - no new backend surface. Rotate/zoom/fit are real
// and persist on the section. Crop and background removal are explicit
// placeholders: they report what they would do and change nothing, rather than
// pretending to work.

export const FIT_MODES = ["cover", "contain", "fill"];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.1;

export async function uploadImages(files) {
  const formData = new FormData();
  [...files].forEach((file) => formData.append("images", file));

  const response = await fetch("/api/uploads/images", { method: "POST", body: formData });
  if (!response.ok) throw new Error("Upload failed");
  const result = await response.json();
  return result.imageUrls || [];
}

// Every image the current edition can reach: whatever reporters attached to
// their stories, deduplicated. The section's own uploaded image is included so
// it can be re-picked after being replaced.
export function buildImageLibrary(reporterNews, extraUrls = []) {
  const seen = new Map();
  (reporterNews || []).forEach((story) => {
    (story.image_urls || []).forEach((url) => {
      if (!seen.has(url)) {
        seen.set(url, { url, source: story.reporter_name || "Reporter", storyTitle: story.title });
      }
    });
  });
  extraUrls.filter(Boolean).forEach((url) => {
    if (!seen.has(url)) seen.set(url, { url, source: "Uploaded", storyTitle: null });
  });
  return [...seen.values()];
}

export function rotate(view, degrees) {
  return { imageRotation: (((view.imageRotation || 0) + degrees) % 360 + 360) % 360 };
}

export function flip(view, axis) {
  return axis === "h" ? { imageFlipH: !view.imageFlipH } : { imageFlipV: !view.imageFlipV };
}

// One place builds the transform, so the canvas thumbnail, the editor preview
// and the eventual print export can never drift apart on what a rotation means.
export function imageTransformCss(view) {
  const scaleX = (Number(view.imageZoom) || 1) * (view.imageFlipH ? -1 : 1);
  const scaleY = (Number(view.imageZoom) || 1) * (view.imageFlipV ? -1 : 1);
  return `transform:rotate(${view.imageRotation || 0}deg) scale(${scaleX}, ${scaleY});`;
}

export function zoom(view, delta) {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (Number(view.imageZoom) || 1) + delta));
  return { imageZoom: Math.round(next * 100) / 100 };
}

export function zoomIn(view) {
  return zoom(view, ZOOM_STEP);
}

export function zoomOut(view) {
  return zoom(view, -ZOOM_STEP);
}

export function setFit(fit) {
  return { imageFit: FIT_MODES.includes(fit) ? fit : "cover" };
}

// "Fit" resets the transform so the image sits square in its box again.
export function resetTransform() {
  return { imageRotation: 0, imageZoom: 1, imageFit: "cover", imageFlipH: false, imageFlipV: false };
}

export function clearImage() {
  return { imageUrl: "", ...resetTransform() };
}

export function imageMetadata(view) {
  if (!view.imageUrl) return null;
  return {
    filename: view.imageUrl.split("/").pop(),
    url: view.imageUrl,
    rotation: view.imageRotation || 0,
    zoom: Number(view.imageZoom) || 1,
    fit: view.imageFit || "cover",
    flipH: view.imageFlipH === true,
    flipV: view.imageFlipV === true,
  };
}
