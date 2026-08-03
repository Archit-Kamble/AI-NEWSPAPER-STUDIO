// Part 7: the Image workspace. Large preview plus the transform controls; the
// pipeline itself lives in image/image-manager.js so this file stays markup and
// wiring. Crop, brightness, contrast and background removal are placeholders by
// instruction and say so rather than silently doing nothing.

import { escapeHtml } from "../format.js";
import {
  FIT_MODES,
  buildImageLibrary,
  clearImage,
  flip,
  imageMetadata,
  imageTransformCss,
  resetTransform,
  rotate,
  setFit,
  uploadImages,
  zoomIn,
  zoomOut,
} from "../image/image-manager.js";

const PLACEHOLDER_TOOLS = [
  { id: "edCrop", label: "Crop", message: "Cropping is not wired up yet." },
  { id: "edBrightness", label: "Brightness", message: "Brightness is not wired up yet." },
  { id: "edContrast", label: "Contrast", message: "Contrast is not wired up yet." },
  { id: "edRemoveBackground", label: "Remove Background", message: "Background removal is not wired up yet." },
];

function previewImgMarkup(view) {
  return `<img id="edImagePreviewImg" src="${escapeHtml(view.imageUrl)}" alt=""
    onerror="this.parentElement.innerHTML='<p class=&quot;muted&quot;>Image could not be loaded.</p>'"
    style="object-fit:${escapeHtml(view.imageFit)};${imageTransformCss(view)}" />`;
}

export function imagesPanelMarkup(view) {
  return `
    <div class="ext-columns">
      <div class="ext-column ext-column-wide">
        <div class="ext-image-preview large" id="edImagePreview">
          ${view.imageUrl ? previewImgMarkup(view) : `<p class="muted">No image on this section.</p>`}
        </div>
        <div class="ext-image-meta" id="edImageMeta">${metaMarkup(view)}</div>
      </div>
      <div class="ext-column">
        <input type="file" id="edImageFile" accept="image/*" multiple hidden />
        <label class="preview-label">Source</label>
        <div class="ext-editor-toolbar">
          <button type="button" class="ext-editor-btn" id="edUploadImage">Upload</button>
          <button type="button" class="ext-editor-btn" id="edReplaceImage">Replace</button>
          <button type="button" class="ext-editor-btn" id="edReporterImages">Reporter Images</button>
          <button type="button" class="ext-editor-btn" id="edDeleteImage">Delete</button>
        </div>
        <label class="preview-label">Transform</label>
        <div class="ext-editor-toolbar">
          <button type="button" class="ext-editor-btn" id="edRotate">Rotate 90°</button>
          <button type="button" class="ext-editor-btn" id="edFlipH">Flip H</button>
          <button type="button" class="ext-editor-btn" id="edFlipV">Flip V</button>
          <button type="button" class="ext-editor-btn" id="edZoomIn">Zoom +</button>
          <button type="button" class="ext-editor-btn" id="edZoomOut">Zoom −</button>
          <button type="button" class="ext-editor-btn" id="edFit">Reset</button>
        </div>
        <label class="preview-label">Fit</label>
        <div class="ext-image-fit-row">
          ${FIT_MODES.map(
            (mode) => `<button type="button" class="ext-chip${view.imageFit === mode ? " active" : ""}" data-fit="${mode}">${mode}</button>`,
          ).join("")}
        </div>
        <label class="preview-label">Not wired up yet</label>
        <div class="ext-editor-toolbar">
          ${PLACEHOLDER_TOOLS.map(
            (t) => `<button type="button" class="ext-editor-btn is-placeholder" id="${t.id}" title="${t.message}">${t.label}</button>`,
          ).join("")}
        </div>
      </div>
    </div>
    <div class="ext-image-library" id="edImageLibrary" hidden></div>
  `;
}

function metaMarkup(view) {
  const meta = imageMetadata(view);
  if (!meta) return `<span class="muted">No image metadata</span>`;
  return `
    <span title="${escapeHtml(meta.url)}">${escapeHtml(meta.filename)}</span>
    <span>${meta.rotation}° &middot; ${meta.zoom.toFixed(2)}× &middot; ${escapeHtml(meta.fit)}${meta.flipH ? " &middot; flip-h" : ""}${meta.flipV ? " &middot; flip-v" : ""}</span>
  `;
}

export function bindImagesPanel(getView, reporterNews, onPatch, onNotify) {
  const patch = (updates) => onPatch(updates, "images-panel");
  const fileInput = document.getElementById("edImageFile");

  fileInput?.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      onNotify("Uploading image...");
      const urls = await uploadImages(files);
      if (urls.length) {
        patch({ imageUrl: urls[0], ...resetTransform() });
        onNotify("Image uploaded.");
      }
    } catch {
      onNotify("Image upload failed.");
    } finally {
      fileInput.value = "";
    }
  });

  document.getElementById("edUploadImage")?.addEventListener("click", () => fileInput?.click());
  document.getElementById("edReplaceImage")?.addEventListener("click", () => fileInput?.click());

  document.getElementById("edReporterImages")?.addEventListener("click", () => {
    const library = document.getElementById("edImageLibrary");
    if (!library) return;
    if (!library.hidden) {
      library.hidden = true;
      return;
    }
    const view = getView();
    const images = buildImageLibrary(reporterNews, [view.imageUrl]);
    library.innerHTML = images.length
      ? images
          .map(
            (image) => `
        <button type="button" class="ext-library-item${image.url === view.imageUrl ? " active" : ""}" data-url="${escapeHtml(image.url)}">
          <img src="${escapeHtml(image.url)}" alt="" onerror="this.style.visibility='hidden'" />
          <small>${escapeHtml(image.source)}</small>
        </button>`,
          )
          .join("")
      : `<p class="muted">No reporter images available.</p>`;
    library.hidden = false;
    library.querySelectorAll(".ext-library-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        patch({ imageUrl: btn.dataset.url, ...resetTransform() });
        library.hidden = true;
      });
    });
  });

  document.getElementById("edRotate")?.addEventListener("click", () => patch(rotate(getView(), 90)));
  document.getElementById("edFlipH")?.addEventListener("click", () => patch(flip(getView(), "h")));
  document.getElementById("edFlipV")?.addEventListener("click", () => patch(flip(getView(), "v")));
  document.getElementById("edZoomIn")?.addEventListener("click", () => patch(zoomIn(getView())));
  document.getElementById("edZoomOut")?.addEventListener("click", () => patch(zoomOut(getView())));
  document.getElementById("edFit")?.addEventListener("click", () => patch(resetTransform()));
  document.getElementById("edDeleteImage")?.addEventListener("click", () => patch(clearImage()));

  document.querySelectorAll("[data-fit]").forEach((btn) => {
    btn.addEventListener("click", () => patch(setFit(btn.dataset.fit)));
  });

  PLACEHOLDER_TOOLS.forEach((tool) => {
    document.getElementById(tool.id)?.addEventListener("click", () => onNotify(tool.message));
  });
}

export function refreshImagesPanel(view) {
  const preview = document.getElementById("edImagePreview");
  if (!preview) return;

  const img = document.getElementById("edImagePreviewImg");
  if (view.imageUrl) {
    if (img) {
      if (img.getAttribute("src") !== view.imageUrl) img.setAttribute("src", view.imageUrl);
      img.style.objectFit = view.imageFit;
      img.style.transform = imageTransformCss(view).replace("transform:", "").replace(";", "");
    } else {
      preview.innerHTML = previewImgMarkup(view);
    }
  } else if (img) {
    preview.innerHTML = `<p class="muted">No image on this section.</p>`;
  }

  const metaBox = document.getElementById("edImageMeta");
  if (metaBox) metaBox.innerHTML = metaMarkup(view);

  document.querySelectorAll("[data-fit]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.fit === view.imageFit);
  });
}
