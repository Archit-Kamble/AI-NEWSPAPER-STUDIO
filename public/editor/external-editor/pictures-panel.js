// The pictures placed in this block, and what each one SAYS.
//
// A list, not a second editor: everything you do to a picture - move, size,
// shape, rotate - happens on the composition canvas to its left, where you can
// see the result. Repeating those controls here is exactly the duplicate input
// VISION.md rules out. This says what is on the block and lets you add another.
//
// The one exception is the caption, and it is here because there is nowhere
// else it could be. `section_images.caption` has existed since the schema was
// written; `caption-geometry.js` reserves its box so type runs round it; the
// page canvas draws it, preflight measures it, and all four exports print it.
// Every part of that chain was built and none of it could be reached - there
// was no field anywhere in the product that could put a word into the column.
// A photograph in a newspaper is captioned; that is not a preference.
//
// Story details' Caption field is a DIFFERENT thing and stays where it is:
// that is `page_sections.caption`, the block's own, for a block whose picture
// is the story. This is the caption under one placed photograph.

import { escapeHtml as escapeText } from "../format.js";

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
            <label class="picture-caption-label">
              <span class="muted">Caption</span>
              <textarea class="picture-caption" rows="2"
                        data-image-id="${image.id}"
                        placeholder="Photo credit, or what is happening in it"
                        >${escapeText(image.caption || "")}</textarea>
            </label>
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
    // A press INSIDE the caption box is not a request to select the picture -
    // it is the desk putting the caret where they want to type.
    if (event.target.closest(".picture-caption")) return;
    const item = event.target.closest(".picture-item");
    if (item) callbacks.onSelectImage?.(Number(item.dataset.imageId));
  });

  // Committed on blur, not on every keystroke: this is a PATCH per call and
  // the response carries the whole image list, so a save per character would
  // have every letter racing the one before it.
  //
  // Bound at the list rather than to the fields, because refreshPicturesPanel()
  // rewrites its own innerHTML - a field-bound listener is on a detached node
  // from the next repaint, which is the #edSpaceGroup trap CLAUDE.md records.
  document.getElementById("edPicturesList")?.addEventListener("change", (event) => {
    const field = event.target.closest(".picture-caption");
    if (!field) return;
    // Sent as an empty STRING and never as null, so a caption can be taken
    // off again: the repository writes this column with COALESCE, under which
    // null means "leave it alone" and only '' can clear it.
    callbacks.onPatchImage?.(Number(field.dataset.imageId), { caption: field.value.trim() });
  });
}
