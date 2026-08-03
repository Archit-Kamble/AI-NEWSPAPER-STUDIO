// Parts 4 + 12: one section's thumbnail, including its selection chrome.
//
// Split out from canvas.js so a single section can be repainted on its own while
// the editor is being typed into - the canvas never rebuilds every box for one
// keystroke (Part 14).

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { computeMetrics } from "../layout/layout-metrics.js";
import { imageTransformCss } from "../image/image-manager.js";

const ICONS = {
  article:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  lead: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5L12 2Z"/></svg>',
  photo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  briefs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h10"/></svg>',
  opinion:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>',
  banner:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="6" rx="1"/><path d="M3 16h12M3 20h8"/></svg>',
  reporter:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 4.9L18.6 8l-4.9 1.7L12 14.6l-1.7-4.9L5.4 8l4.9-1.1L12 2Z"/><path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z"/></svg>',
  overflow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9 2.4 18a1.8 1.8 0 0 0 1.6 2.7h16a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>',
  placeholder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5.5-5.5a2 2 0 0 1 2.8 0L18 18"/></svg>',
};

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Section type comes from the template's own section key - src/layout/templates.js
// stays the only catalog of those keys.
export function sectionType(sectionKey = "") {
  const key = sectionKey.toLowerCase();
  if (key.includes("photo")) return "photo";
  if (key.includes("brief")) return "briefs";
  if (key.includes("opinion") || key.includes("editorial")) return "opinion";
  if (key.includes("banner")) return "banner";
  if (key === "lead") return "lead";
  return "article";
}

// An empty block shows nothing but its name and status - the split between
// image and text is decided later, in the editor and by the AI fit, not
// pre-drawn here. Once content exists the block shows what is actually there,
// in normal flow, with no reserved areas.
function contentMarkup(view) {
  const hasImage = Boolean(view.imageUrl);
  const hasText = Boolean(view.headline || view.body);
  if (!hasImage && !hasText) return "";

  return `
    <div class="section-content">
      ${
        hasImage
          ? `<span class="section-image-box"><img class="section-image" src="${escapeHtml(view.imageUrl)}" alt=""
               onerror="this.closest('.section-image-box').remove()"
               style="object-fit:${escapeHtml(view.imageFit || "cover")};${imageTransformCss(view)}" /></span>`
          : ""
      }
      ${view.headline ? `<div class="section-headline">${escapeHtml(view.headline)}</div>` : ""}
      ${view.body ? `<p class="section-body">${escapeHtml(view.body)}</p>` : ""}
    </div>
  `;
}

export function sectionInnerHtml(section, view, { dirty = false, selected = false } = {}) {
  const status = statusOf(view);
  const type = sectionType(section.section_key);
  const metrics = computeMetrics(section, view);

  return `
    <div class="section-chrome">
      <span class="section-type-icon" title="${type}">${ICONS[type]}</span>
      <span class="section-label">${escapeHtml(section.section_key)}</span>
      <span class="section-flags">
        ${view.newsItemId ? `<span class="section-flag flag-reporter" title="Linked to a reporter story">${ICONS.reporter}</span>` : ""}
        ${view.aiGenerated ? `<span class="section-flag flag-ai" title="AI generated">${ICONS.ai}</span>` : ""}
        ${metrics.overflowing ? `<span class="section-flag flag-overflow" title="Content overflows this section">${ICONS.overflow}</span>` : ""}
        ${dirty ? `<span class="section-flag flag-unsaved" title="Unsaved changes"></span>` : ""}
      </span>
      <span class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>
    ${contentMarkup(view)}
    <div class="section-hover-toolbar">
      <button type="button" class="section-hover-btn" data-section-action="story" title="Attach a reporter story">Story</button>
      <button type="button" class="section-hover-btn" data-section-action="image" title="Open the image workspace">Image</button>
      <button type="button" class="section-hover-btn" data-section-action="clear" title="Clear this section">Clear</button>
    </div>
    ${selected ? HANDLES.map((h) => `<span class="section-handle handle-${h}" data-handle="${h}"></span>`).join("") : ""}
    ${selected ? `<span class="section-selected-label">${escapeHtml(section.section_key)}</span>` : ""}
  `;
}

export function sectionClassName(view, { selected = false, dirty = false, overflowing = false } = {}) {
  const filled = Boolean(view.headline || view.body || view.imageUrl);
  return ["newspaper-section", filled ? "filled" : "", selected ? "active" : "", dirty ? "unsaved" : "", overflowing ? "overflowing" : ""]
    .filter(Boolean)
    .join(" ");
}
