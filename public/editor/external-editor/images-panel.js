// Phase 2/8, Images section. Preview plus the transform controls; the actual
// pipeline logic lives in image/image-manager.js so this file stays markup and
// wiring only.

import { escapeHtml } from "../format.js";
import {
  FIT_MODES,
  buildImageLibrary,
  clearImage,
  imageMetadata,
  resetTransform,
  rotate,
  setFit,
  uploadImages,
  zoomIn,
  zoomOut,
} from "../image/image-manager.js";

// A dead URL falls back to the same "no image" state rather than showing a
// broken-image glyph.
function previewImgMarkup(view) {
  return `<img id="edImagePreviewImg" src="${escapeHtml(view.imageUrl)}" alt=""
    onerror="this.parentElement.innerHTML='<p class=&quot;muted&quot;>Image could not be loaded.</p>'"
    style="object-fit:${escapeHtml(view.imageFit)};transform:rotate(${view.imageRotation}deg) scale(${view.imageZoom});" />`;
}

export function imagesPanelMarkup(view) {
  const meta = imageMetadata(view);
  const preview = view.imageUrl
    ? previewImgMarkup(view)
    : `<p class="muted">No image on this section.</p>`;

  return `
    <div class="ext-image-preview" id="edImagePreview">${preview}</div>
    <div class="ext-image-meta" id="edImageMeta">
      ${
        meta
          ? `<span title="${escapeHtml(meta.url)}">${escapeHtml(meta.filename)}</span>
             <span>${meta.rotation}° &middot; ${meta.zoom.toFixed(2)}× &middot; ${escapeHtml(meta.fit)}</span>`
          : `<span class="muted">No image metadata</span>`
      }
    </div>
    <input type="file" id="edImageFile" accept="image/*" multiple hidden />
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" id="edUploadImage">Upload</button>
      <button type="button" class="ext-editor-btn" id="edReplaceImage">Replace Image</button>
      <button type="button" class="ext-editor-btn" id="edReporterImages">Reporter Images</button>
      <button type="button" class="ext-editor-btn" id="edRemoveBackground" title="Placeholder - no background removal yet">Remove Background</button>
      <button type="button" class="ext-editor-btn" id="edCrop" title="Placeholder - no cropping yet">Crop</button>
      <button type="button" class="ext-editor-btn" id="edRotate">Rotate</button>
      <button type="button" class="ext-editor-btn" id="edZoomIn">Zoom +</button>
      <button type="button" class="ext-editor-btn" id="edZoomOut">Zoom −</button>
      <button type="button" class="ext-editor-btn" id="edFit">Fit</button>
      <button type="button" class="ext-editor-btn" id="edDeleteImage">Delete</button>
    </div>
    <div class="ext-image-fit-row">
      ${FIT_MODES.map(
        (mode) =>
          `<button type="button" class="ext-chip${view.imageFit === mode ? " active" : ""}" data-fit="${mode}">${mode}</button>`,
      ).join("")}
    </div>
    <div class="ext-image-library" id="edImageLibrary" hidden></div>
  `;
}

export function bindImagesPanel(view, reporterNews, onPatch, onNotify) {
  const patch = (updates) => onPatch(updates, "images-panel");
  const fileInput = document.getElementById("edImageFile");

  const runUpload = async (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    try {
      onNotify("Uploading image...");
      const urls = await uploadImages(files);
      if (urls.length) {
        patch({ imageUrl: urls[0], ...resetTransform() });
        onNotify("Image uploaded.");
      }
    } catch (error) {
      onNotify("Image upload failed.");
    } finally {
      fileInput.value = "";
    }
  };

  fileInput?.addEventListener("change", runUpload);
  document.getElementById("edUploadImage")?.addEventListener("click", () => fileInput?.click());
  document.getElementById("edReplaceImage")?.addEventListener("click", () => fileInput?.click());

  document.getElementById("edReporterImages")?.addEventListener("click", () => {
    const library = document.getElementById("edImageLibrary");
    if (!library) return;
    if (!library.hidden) {
      library.hidden = true;
      return;
    }
    const images = buildImageLibrary(reporterNews, [view.imageUrl]);
    library.innerHTML = images.length
      ? images
          .map(
            (image) =>
              `<button type="button" class="ext-library-item${image.url === view.imageUrl ? " active" : ""}" data-url="${escapeHtml(image.url)}">
                 <img src="${escapeHtml(image.url)}" alt="" />
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

  document.getElementById("edRotate")?.addEventListener("click", () => patch(rotate(view, 90)));
  document.getElementById("edZoomIn")?.addEventListener("click", () => patch(zoomIn(view)));
  document.getElementById("edZoomOut")?.addEventListener("click", () => patch(zoomOut(view)));
  document.getElementById("edFit")?.addEventListener("click", () => patch(resetTransform()));
  document.getElementById("edDeleteImage")?.addEventListener("click", () => patch(clearImage()));

  document.querySelectorAll("[data-fit]").forEach((btn) => {
    btn.addEventListener("click", () => patch(setFit(btn.dataset.fit)));
  });

  // Explicit placeholders - they say so rather than silently doing nothing.
  document.getElementById("edRemoveBackground")?.addEventListener("click", () => {
    onNotify("Background removal is not wired up yet.");
  });
  document.getElementById("edCrop")?.addEventListener("click", () => {
    onNotify("Cropping is not wired up yet.");
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
      img.style.transform = `rotate(${view.imageRotation}deg) scale(${view.imageZoom})`;
    } else {
      preview.innerHTML = previewImgMarkup(view);
    }
  } else if (img) {
    preview.innerHTML = `<p class="muted">No image on this section.</p>`;
  }

  const meta = imageMetadata(view);
  const metaBox = document.getElementById("edImageMeta");
  if (metaBox) {
    metaBox.innerHTML = meta
      ? `<span title="${escapeHtml(meta.url)}">${escapeHtml(meta.filename)}</span>
         <span>${meta.rotation}° &middot; ${meta.zoom.toFixed(2)}× &middot; ${escapeHtml(meta.fit)}</span>`
      : `<span class="muted">No image metadata</span>`;
  }

  document.querySelectorAll("[data-fit]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.fit === view.imageFit);
  });
}
