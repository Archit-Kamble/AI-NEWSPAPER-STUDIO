// Phase 4: one section's thumbnail. Split out from canvas.js so a single
// section can be repainted on its own while the editor is being typed into
// (Phase 11) - the canvas never rebuilds all six boxes for one keystroke.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";

const ICONS = {
  article:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  lead: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5L12 2Z"/></svg>',
  photo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  briefs:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h10"/></svg>',
  opinion:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>',
  banner:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="6" rx="1"/><path d="M3 16h12M3 20h8"/></svg>',
  reporter:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 4.9L18.6 8l-4.9 1.7L12 14.6l-1.7-4.9L5.4 8l4.9-1.1L12 2Z"/><path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z"/></svg>',
  placeholder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5.5-5.5a2 2 0 0 1 2.8 0L18 18"/></svg>',
};

// Section type is inferred from the template's own section key - the layout
// catalog in src/layout/templates.js is the only place those keys are defined,
// so this stays a presentation detail rather than a second catalog.
export function sectionType(sectionKey = "") {
  const key = sectionKey.toLowerCase();
  if (key.includes("photo")) return "photo";
  if (key.includes("brief")) return "briefs";
  if (key.includes("opinion") || key.includes("editorial")) return "opinion";
  if (key.includes("banner")) return "banner";
  if (key === "lead") return "lead";
  return "article";
}

// The placeholder is always in the markup, underneath the image. A URL that
// fails to load removes its own <img>, so a missing or dead image degrades to
// the newspaper placeholder instead of a broken-image glyph (Phase 4).
function imageMarkup(view) {
  const placeholder = `<span class="thumb-image-placeholder">${ICONS.placeholder}</span>`;
  if (!view.imageUrl) return placeholder;

  const transform = `transform:rotate(${view.imageRotation || 0}deg) scale(${view.imageZoom || 1});`;
  return `${placeholder}<img src="${escapeHtml(view.imageUrl)}" alt="" onerror="this.remove()"
    style="object-fit:${escapeHtml(view.imageFit || "cover")};${transform}" />`;
}

function bodyMarkup(view) {
  if (view.body) return `<p class="thumb-body-preview">${escapeHtml(view.body)}</p>`;
  return `
    <div class="thumb-body-lines">
      <span class="thumb-line w-80"></span>
      <span class="thumb-line w-60"></span>
      <span class="thumb-line w-40"></span>
    </div>
  `;
}

export function sectionInnerHtml(section, view, { dirty = false } = {}) {
  const status = statusOf(view);
  const type = sectionType(section.section_key);

  return `
    <div class="section-chrome">
      <span class="section-type-icon" title="${type}">${ICONS[type]}</span>
      <span class="section-label">${escapeHtml(section.section_key)}</span>
      <span class="section-flags">
        ${view.newsItemId ? `<span class="section-flag flag-reporter" title="Linked to a reporter story">${ICONS.reporter}</span>` : ""}
        ${view.aiGenerated ? `<span class="section-flag flag-ai" title="AI generated">${ICONS.ai}</span>` : ""}
        ${dirty ? `<span class="section-flag flag-unsaved" title="Unsaved changes"></span>` : ""}
      </span>
      <span class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>
    <div class="section-thumb">
      <div class="thumb-image">${imageMarkup(view)}</div>
      <div class="thumb-text">
        <div class="thumb-headline">${escapeHtml(view.headline)}</div>
        ${bodyMarkup(view)}
      </div>
    </div>
    <div class="section-hover-controls">
      <button type="button" class="section-hover-btn" data-section-action="story" title="Attach a reporter story">Story</button>
      <button type="button" class="section-hover-btn" data-section-action="clear" title="Clear this section">Clear</button>
    </div>
  `;
}

export function sectionClassName(view, { selected = false, dirty = false } = {}) {
  const filled = Boolean(view.headline || view.body || view.imageUrl);
  return [
    "newspaper-section",
    filled ? "filled" : "",
    selected ? "active" : "",
    dirty ? "unsaved" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
