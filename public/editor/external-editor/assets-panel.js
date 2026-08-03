// Part 10: the Assets workspace.
//
// Architecture only, and honest about it. Reporter photographs are real - they
// come from stories already loaded, and clicking one places it on the section.
// Icons, logos, advertisements and saved graphics have no backend yet: the
// `media_assets` table exists in schema.sql but has no API, so those categories
// render as empty shelves rather than fake contents.
//
// Every tile is already drag-enabled and carries its payload in dataTransfer, so
// the future drop targets (canvas sections, image slots) need a drop handler and
// nothing else here has to change.

import { escapeHtml } from "../format.js";
import { buildImageLibrary } from "../image/image-manager.js";

const CATEGORIES = [
  { key: "photos", label: "Reporter photographs", backed: true },
  { key: "icons", label: "Icons", backed: false },
  { key: "logos", label: "Logos", backed: false },
  { key: "ads", label: "Advertisements", backed: false },
  { key: "graphics", label: "Saved graphics", backed: false },
];

export function assetsPanelMarkup(view, reporterNews) {
  const photos = buildImageLibrary(reporterNews, [view?.imageUrl]);

  return `
    <div class="asset-shelves">
      ${CATEGORIES.map((category) =>
        category.backed ? photoShelf(category, photos) : emptyShelf(category),
      ).join("")}
    </div>
    <p class="muted ext-note">Drag any asset onto a section once drop targets are wired. Categories without a backing store are shown empty rather than filled with placeholders.</p>
  `;
}

function photoShelf(category, photos) {
  return `
    <section class="asset-shelf">
      <h4>${category.label} <span class="asset-count">${photos.length}</span></h4>
      <div class="asset-grid">
        ${
          photos.length
            ? photos
                .map(
                  (photo) => `
          <button type="button" class="asset-tile" draggable="true"
                  data-asset-kind="image" data-asset-url="${escapeHtml(photo.url)}"
                  title="${escapeHtml(photo.storyTitle || photo.source)}">
            <img src="${escapeHtml(photo.url)}" alt="" onerror="this.style.visibility='hidden'" />
            <small>${escapeHtml(photo.source)}</small>
          </button>`,
                )
                .join("")
            : `<p class="muted">No reporter photographs in this edition yet.</p>`
        }
      </div>
    </section>
  `;
}

function emptyShelf(category) {
  return `
    <section class="asset-shelf is-empty">
      <h4>${category.label} <span class="asset-count">0</span></h4>
      <p class="muted">No asset store connected yet.</p>
    </section>
  `;
}

export function bindAssetsPanel(onPatch, onNotify) {
  document.querySelectorAll(".asset-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      onPatch({ imageUrl: tile.dataset.assetUrl, imageRotation: 0, imageZoom: 1, imageFit: "cover" }, "assets-panel");
      onNotify("Asset placed on the selected section.");
    });
    tile.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(
        "application/x-sahas-asset",
        JSON.stringify({ kind: tile.dataset.assetKind, url: tile.dataset.assetUrl }),
      );
      event.dataTransfer.effectAllowed = "copy";
    });
  });
}

export function refreshAssetsPanel(view) {
  document.querySelectorAll(".asset-tile").forEach((tile) => {
    tile.classList.toggle("active", tile.dataset.assetUrl === view?.imageUrl);
  });
}
