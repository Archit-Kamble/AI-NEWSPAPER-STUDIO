// The pictures placed in this block.
//
// A list, not a second editor: everything you do to a picture - move, size,
// shape, rotate - happens on the composition canvas to its left, where you can
// see the result. Repeating those controls here is exactly the duplicate input
// VISION.md rules out. This says what is on the block and lets you add another.

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

export function picturesPanelMarkup(images = []) {
  return `
    <div id="edPicturesList">${listMarkup(images)}</div>
    <button type="button" class="btn-submit" id="edAddPicture">+ Add a picture</button>
  `;
}

function listMarkup(images) {
  if (!images.length) {
    return `<p class="muted">No pictures on this block yet. Add one, then drag it where the story wants it.</p>`;
  }
  return `
    <ul class="picture-list">
      ${images
        .map(
          (image) => `
        <li class="picture-item" data-image-id="${image.id}">
          <img src="${escapeText(image.url)}" alt="" onerror="this.classList.add('broken')" />
          <div class="picture-item-body">
            <strong>${escapeText(image.original_filename || "picture")}</strong>
            <small class="muted">${image.width_px} × ${image.height_px} px · wraps as ${escapeText(image.shape || "rect")}</small>
          </div>
        </li>`,
        )
        .join("")}
    </ul>
  `;
}

export function refreshPicturesPanel(images = []) {
  const list = document.getElementById("edPicturesList");
  if (list) list.innerHTML = listMarkup(images);
}

export function bindPicturesPanel(callbacks) {
  // Adding goes through the same file picker the canvas uses, so there is one
  // upload path rather than two.
  document.getElementById("edAddPicture")?.addEventListener("click", () => {
    document.getElementById("cmpFileInput")?.click();
  });
  document.getElementById("edPicturesList")?.addEventListener("click", (event) => {
    const item = event.target.closest(".picture-item");
    if (item) callbacks.onSelectImage?.(Number(item.dataset.imageId));
  });
}
