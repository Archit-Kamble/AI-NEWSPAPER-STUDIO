// The Inspector is the immediately visible section form. It remains available
// while the dock is being expanded, so an editor can always enter headline,
// subheading, body and the editorial facts without scrolling away from the
// selected block.

import { escapeHtml } from "./format.js";
import { plainText } from "./layout/rich-text.js";
import { statusOf, statusLabel, statusClass, explicitStatusOptions, isExplicit } from "./status/section-status.js";

const STORY_FIELDS = [
  { id: "insHeadline", field: "headline", label: "Headline", type: "input", limit: 90 },
  { id: "insSubheading", field: "subheading", label: "Subheading", type: "input", limit: 140 },
  { id: "insBody", field: "body", label: "Body", type: "textarea", rows: 6 },
  { id: "insCaption", field: "caption", label: "Caption", type: "input", limit: 160 },
];

const LANGUAGES = ["Marathi", "Hindi", "English"];
const META_FIELDS = [
  { id: "insAuthor", field: "author", label: "Reporter" },
  { id: "insCategory", field: "category", label: "Category" },
  { id: "insLocation", field: "location", label: "Location" },
  { id: "insTags", field: "tags", label: "Tags" },
  { id: "insLanguage", field: "language", label: "Language", type: "select", options: LANGUAGES },
];
const WORDS_PER_MINUTE = 200;

function storyStats(view) {
  const text = plainText(view.body);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, characters: text.length, readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0 };
}

function fieldMarkup(field, view) {
  const counter = field.limit ? `<span class="field-counter" id="${field.id}Counter">${(view[field.field] || "").length}/${field.limit}</span>` : "";
  const control = field.type === "select"
    ? `<select id="${field.id}">${field.options.map((option) => `<option value="${option}"${view[field.field] === option ? " selected" : ""}>${option}</option>`).join("")}</select>`
    : field.type === "textarea"
      ? `<textarea id="${field.id}" rows="${field.rows}">${escapeHtml(view[field.field])}</textarea>`
      : `<input id="${field.id}" value="${escapeHtml(view[field.field])}" />`;
  return `<div class="form-group"><label>${field.label}${counter}</label>${control}</div>`;
}

function formatSavedAt(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function refreshInspectorSavedAt(section) {
  const element = document.getElementById("insSavedAt");
  if (element) element.textContent = formatSavedAt(section?.updated_at);
}

function statsMarkup(view) {
  const stats = storyStats(view);
  return `<div class="stat"><span>${stats.words}</span><small>words</small></div><div class="stat"><span>${stats.characters}</span><small>characters</small></div><div class="stat"><span>${stats.readingMinutes || "—"}</span><small>min read</small></div>`;
}

export function renderInspector(section, view, story, callbacks) {
  const body = document.getElementById("inspector");
  if (!body) return;
  if (!section || !view) {
    body.innerHTML = `<p class="muted">Select a section on the page to write its story.</p>`;
    return;
  }

  const status = statusOf(view);
  body.innerHTML = `
    <div class="inspector-head">
      <div><h3>${escapeHtml(section.section_key)}</h3><small class="muted">${section.width_px} × ${section.height_px} px</small></div>
      <span id="insStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>
    <div class="story-link-bar${view.newsItemId ? " linked" : ""}" id="insStoryBar">
      ${view.newsItemId
        ? `<span>From <strong>${escapeHtml(story?.title || "reporter story")}</strong></span><button type="button" class="ext-editor-btn" id="insChangeStory">Change</button>`
        : `<span class="muted">Writing directly</span><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="insChooseStory">Take from Reporter</button>`}
    </div>
    <div class="inspector-group"><h4>Story</h4>${STORY_FIELDS.map((field) => fieldMarkup(field, view)).join("")}<div class="stat-grid" id="insStoryStats">${statsMarkup(view)}</div></div>
    <div class="inspector-group"><h4>Details</h4>${META_FIELDS.map((field) => fieldMarkup(field, view)).join("")}
      <div class="form-group"><label>Editorial status</label><select id="insStatusSelect"><option value="">Automatic (${statusLabel(status)})</option>${explicitStatusOptions().map((option) => `<option value="${option.key}"${view.status === option.key ? " selected" : ""}>${option.label}</option>`).join("")}</select></div>
      <div class="inspector-row"><span>Last saved</span><strong id="insSavedAt">${formatSavedAt(section.updated_at)}</strong></div>
    </div>
    <div class="inspector-actions"><button type="button" class="btn-submit" id="insSaveBtn">Save &amp; compose below ↓</button><button type="button" class="ext-editor-btn" id="insRevertBtn">Revert</button></div>`;
  bindInspector(callbacks);
}

function bindInspector({ onPatch, onChooseStory, onSave, onRevert }) {
  [...STORY_FIELDS, ...META_FIELDS].forEach((field) => {
    const element = document.getElementById(field.id);
    element?.addEventListener(field.type === "select" ? "change" : "input", (event) => onPatch({ [field.field]: event.target.value }, "inspector"));
  });
  document.getElementById("insStatusSelect")?.addEventListener("change", (event) => onPatch({ status: event.target.value || "editing" }, "inspector"));
  document.getElementById("insChooseStory")?.addEventListener("click", onChooseStory);
  document.getElementById("insChangeStory")?.addEventListener("click", onChooseStory);
  document.getElementById("insSaveBtn")?.addEventListener("click", onSave);
  document.getElementById("insRevertBtn")?.addEventListener("click", onRevert);
}

export function refreshInspectorReadouts(section, view, story, source) {
  const badge = document.getElementById("insStatusBadge");
  if (!badge) return;
  const status = statusOf(view);
  badge.textContent = statusLabel(status);
  badge.className = `section-status-badge ${statusClass(status)}`;
  const automatic = document.querySelector('#insStatusSelect option[value=""]');
  if (automatic) automatic.textContent = `Automatic (${statusLabel(status)})`;
  STORY_FIELDS.filter((field) => field.limit).forEach((field) => {
    const counter = document.getElementById(`${field.id}Counter`);
    if (!counter) return;
    const length = (view[field.field] || "").length;
    counter.textContent = `${length}/${field.limit}`;
    counter.classList.toggle("over", length > field.limit);
  });
  const stats = document.getElementById("insStoryStats");
  if (stats) stats.innerHTML = statsMarkup(view);
  refreshStoryBar(view, story);
  if (source !== "inspector") repaintInputs(view);
}

function refreshStoryBar(view, story) {
  const bar = document.getElementById("insStoryBar");
  if (!bar) return;
  const linked = Boolean(view.newsItemId);
  if (linked === bar.classList.contains("linked")) {
    if (linked) {
      const label = bar.querySelector("strong");
      if (label) label.textContent = story?.title || "reporter story";
    }
    return;
  }
  bar.classList.toggle("linked", linked);
  bar.innerHTML = linked
    ? `<span>From <strong>${escapeHtml(story?.title || "reporter story")}</strong></span><button type="button" class="ext-editor-btn" id="insChangeStory">Change</button>`
    : `<span class="muted">Writing directly</span><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="insChooseStory">Take from Reporter</button>`;
  document.getElementById("insChooseStory")?.addEventListener("click", inspectorCallbacks?.onChooseStory);
  document.getElementById("insChangeStory")?.addEventListener("click", inspectorCallbacks?.onChooseStory);
}

let inspectorCallbacks = null;
export function configureInspector(callbacks) {
  inspectorCallbacks = callbacks;
}

function repaintInputs(view) {
  [...STORY_FIELDS, ...META_FIELDS].forEach((field) => {
    const input = document.getElementById(field.id);
    if (input && document.activeElement !== input && input.value !== view[field.field]) input.value = view[field.field];
  });
  const status = document.getElementById("insStatusSelect");
  if (status) status.value = isExplicit(view.status) ? view.status : "";
}
