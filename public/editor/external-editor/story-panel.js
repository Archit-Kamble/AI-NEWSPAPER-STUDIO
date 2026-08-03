// Part 5: the Story tab. Owns the article text and its classification - the
// only place these fields are editable, so no draft field ever has two inputs
// bound to it.

import { escapeHtml } from "../format.js";

const TEXT_FIELDS = [
  { id: "edHeadline", field: "headline", label: "Headline", type: "input", limit: 90 },
  { id: "edSubheading", field: "subheading", label: "Subheadline", type: "input", limit: 140 },
  { id: "edBody", field: "body", label: "Body", type: "textarea", rows: 12 },
  { id: "edCaption", field: "caption", label: "Caption", type: "input", limit: 160 },
];

const META_FIELDS = [
  { id: "edAuthor", field: "author", label: "Reporter" },
  { id: "edLocation", field: "location", label: "Location" },
  { id: "edCategory", field: "category", label: "Category" },
  { id: "edTags", field: "tags", label: "Tags" },
  { id: "edLanguage", field: "language", label: "Language" },
];

const WORDS_PER_MINUTE = 200;

export function storyStats(view) {
  const body = view.body || "";
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return {
    characters: body.length,
    words,
    readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
  };
}

// Warnings are editorial, not technical - they are the things a sub-editor would
// otherwise have to catch by eye.
export function storyWarnings(view) {
  const warnings = [];
  const headline = (view.headline || "").trim();
  const body = (view.body || "").trim();

  if (!headline) warnings.push("No headline.");
  else if (headline.length > 90) warnings.push(`Headline is ${headline.length} characters - over the 90 limit.`);
  else if (headline.length < 15) warnings.push("Headline is very short.");
  if (headline && headline === headline.toUpperCase() && /[A-Z]{4,}/.test(headline)) {
    warnings.push("Headline is in all capitals.");
  }
  if (!body) warnings.push("No body text.");
  else if (body.split(/\s+/).length < 40) warnings.push("Body is under 40 words.");
  if (view.imageUrl && !(view.caption || "").trim()) warnings.push("Image has no caption.");
  if (!(view.author || "").trim()) warnings.push("No reporter credited.");
  return warnings;
}

function fieldMarkup(f, view) {
  const counter = f.limit
    ? `<span class="field-counter" id="${f.id}Counter">${(view[f.field] || "").length}/${f.limit}</span>`
    : "";
  const control =
    f.type === "textarea"
      ? `<textarea id="${f.id}" rows="${f.rows}">${escapeHtml(view[f.field])}</textarea>`
      : `<input id="${f.id}" value="${escapeHtml(view[f.field])}" />`;
  return `<div class="form-group"><label>${f.label}${counter}</label>${control}</div>`;
}

export function storyPanelMarkup(view, story) {
  const stats = storyStats(view);
  const storyBar = view.newsItemId
    ? `<div class="story-link-bar linked">
         <span>Linked to <strong>${escapeHtml(story?.title || "reporter story")}</strong></span>
         <button type="button" class="ext-editor-btn" id="edChangeStory">Change</button>
       </div>`
    : `<div class="story-link-bar">
         <span class="muted">No story attached</span>
         <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edChooseStory">Choose Reporter Story</button>
       </div>`;

  return `
    ${storyBar}
    <div class="ext-columns">
      <div class="ext-column ext-column-wide">
        ${TEXT_FIELDS.map((f) => fieldMarkup(f, view)).join("")}
      </div>
      <div class="ext-column">
        ${META_FIELDS.map(
          (f) => `<div class="form-group"><label>${f.label}</label><input id="${f.id}" value="${escapeHtml(view[f.field])}" /></div>`,
        ).join("")}
        <div class="stat-grid" id="edStoryStats">${statsMarkup(stats)}</div>
        <div class="warning-list" id="edStoryWarnings">${warningsMarkup(storyWarnings(view))}</div>
      </div>
    </div>
  `;
}

function statsMarkup(stats) {
  return `
    <div class="stat"><span>${stats.words}</span><small>words</small></div>
    <div class="stat"><span>${stats.characters}</span><small>characters</small></div>
    <div class="stat"><span>${stats.readingMinutes || "—"}</span><small>min read</small></div>
  `;
}

function warningsMarkup(warnings) {
  if (!warnings.length) return `<p class="warning-ok">No editorial warnings.</p>`;
  return warnings.map((w) => `<p class="warning-item">${escapeHtml(w)}</p>`).join("");
}

export function bindStoryPanel(onPatch, onChooseStory) {
  [...TEXT_FIELDS, ...META_FIELDS].forEach((f) => {
    document.getElementById(f.id)?.addEventListener("input", (event) => {
      onPatch({ [f.field]: event.target.value }, "story-panel");
    });
  });
  document.getElementById("edChooseStory")?.addEventListener("click", onChooseStory);
  document.getElementById("edChangeStory")?.addEventListener("click", onChooseStory);
}

export function refreshStoryPanel(view, source) {
  // Counters, stats and warnings follow every edit wherever it came from.
  TEXT_FIELDS.filter((f) => f.limit).forEach((f) => {
    const counter = document.getElementById(`${f.id}Counter`);
    if (!counter) return;
    const length = (view[f.field] || "").length;
    counter.textContent = `${length}/${f.limit}`;
    counter.classList.toggle("over", length > f.limit);
  });

  const stats = document.getElementById("edStoryStats");
  if (stats) stats.innerHTML = statsMarkup(storyStats(view));
  const warnings = document.getElementById("edStoryWarnings");
  if (warnings) warnings.innerHTML = warningsMarkup(storyWarnings(view));

  if (source === "story-panel") return;
  [...TEXT_FIELDS, ...META_FIELDS].forEach((f) => {
    const element = document.getElementById(f.id);
    if (!element || document.activeElement === element) return;
    if (element.value !== view[f.field]) element.value = view[f.field];
  });
}
