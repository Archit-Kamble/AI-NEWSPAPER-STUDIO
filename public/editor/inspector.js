// The Inspector: where a section's story is written.
//
// This is step 3 of the production flow - the admin either types the story here
// or pulls it from a reporter - and it ends with Save, which hands off to the
// External Editor below for image work and AI composition. The story text lives
// here and nowhere else, so no field has two inputs bound to it.

import { escapeHtml } from "./format.js";
import { statusOf, statusLabel, statusClass, explicitStatusOptions, isExplicit } from "./status/section-status.js";
import { computeMetrics } from "./layout/layout-metrics.js";

const STORY_FIELDS = [
  { id: "insHeadline", field: "headline", label: "Headline", type: "input", limit: 90 },
  { id: "insSubheading", field: "subheading", label: "Subheading", type: "input", limit: 140 },
  { id: "insBody", field: "body", label: "Body", type: "textarea", rows: 8 },
  { id: "insCaption", field: "caption", label: "Caption", type: "input", limit: 160 },
];

const META_FIELDS = [
  { id: "insAuthor", field: "author", label: "Reporter" },
  { id: "insCategory", field: "category", label: "Category" },
  { id: "insLocation", field: "location", label: "Location" },
  { id: "insTags", field: "tags", label: "Tags" },
  { id: "insLanguage", field: "language", label: "Language" },
];

const WORDS_PER_MINUTE = 200;

function storyStats(view) {
  const words = (view.body || "").trim() ? view.body.trim().split(/\s+/).length : 0;
  return {
    words,
    characters: (view.body || "").length,
    readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
  };
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

function formatSavedAt(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function refreshInspectorSavedAt(section) {
  const element = document.getElementById("insSavedAt");
  if (element) element.textContent = formatSavedAt(section?.updated_at);
}

function statsMarkup(view) {
  const s = storyStats(view);
  return `
    <div class="stat"><span>${s.words}</span><small>words</small></div>
    <div class="stat"><span>${s.characters}</span><small>characters</small></div>
    <div class="stat"><span>${s.readingMinutes || "—"}</span><small>min read</small></div>
  `;
}

export function renderInspector(section, view, story, callbacks) {
  const body = document.getElementById("inspector");
  if (!body) return;

  if (!section || !view) {
    body.innerHTML = `<p class="muted">Select a section on the page to write its story.</p>`;
    return;
  }

  const status = statusOf(view);
  const metrics = computeMetrics(section, view);

  body.innerHTML = `
    <div class="inspector-head">
      <div>
        <h3>${escapeHtml(section.section_key)}</h3>
        <small class="muted">${section.width_px} × ${section.height_px} px</small>
      </div>
      <span id="insStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>

    <div class="story-link-bar${view.newsItemId ? " linked" : ""}" id="insStoryBar">
      ${
        view.newsItemId
          ? `<span>From <strong>${escapeHtml(story?.title || "reporter story")}</strong></span>
             <button type="button" class="ext-editor-btn" id="insChangeStory">Change</button>`
          : `<span class="muted">Writing directly</span>
             <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="insChooseStory">Take from Reporter</button>`
      }
    </div>

    <div class="inspector-group">
      <h4>Story</h4>
      ${STORY_FIELDS.map((f) => fieldMarkup(f, view)).join("")}
      <div class="stat-grid" id="insStoryStats">${statsMarkup(view)}</div>
    </div>

    <div class="inspector-group">
      <h4>Details</h4>
      ${META_FIELDS.map(
        (f) => `<div class="form-group"><label>${f.label}</label><input id="${f.id}" value="${escapeHtml(view[f.field])}" /></div>`,
      ).join("")}
      <div class="form-group">
        <label>Editorial status</label>
        <select id="insStatusSelect">
          <option value="">Automatic (${statusLabel(status)})</option>
          ${explicitStatusOptions()
            .map((o) => `<option value="${o.key}"${view.status === o.key ? " selected" : ""}>${o.label}</option>`)
            .join("")}
        </select>
      </div>
      <div class="inspector-row"><span>Last saved</span><strong id="insSavedAt">${formatSavedAt(section.updated_at)}</strong></div>
      <div class="inspector-row"><span>Image</span><strong id="insImageName">${view.imageUrl ? escapeHtml(view.imageUrl.split("/").pop()) : "None"}</strong></div>
      <div class="inspector-row"><span>Rotation</span><strong id="insImageRotation">${view.imageRotation}°</strong></div>
      <div class="inspector-row"><span>Zoom</span><strong id="insImageZoom">${Number(view.imageZoom).toFixed(2)}×</strong></div>
      <div class="inspector-row"><span>Fit</span><strong id="insImageFit">${escapeHtml(view.imageFit)}</strong></div>
    </div>

    <div class="inspector-group" id="insMetrics">
      <h4>Space</h4>
      ${spaceMarkup(metrics)}
    </div>

    <div class="inspector-actions">
      <button type="button" class="btn-submit" id="insSaveBtn">Save &amp; compose below ↓</button>
      <button type="button" class="ext-editor-btn" id="insRevertBtn">Revert</button>
    </div>
  `;

  bindInspector(callbacks);
}

function spaceMarkup(metrics) {
  return `
    <div class="inspector-row"><span>Available</span><strong>${Math.round(metrics.availableAreaPx / 1000)}k px²</strong></div>
    <div class="inspector-row"><span>Remaining</span><strong>${Math.round(metrics.remainingAreaPx / 1000)}k px²</strong></div>
    <div class="fill-meter${metrics.overflowing ? " overflowing" : ""}">
      <span style="width:${Math.min(100, Math.round(metrics.fillRatio * 100))}%"></span>
    </div>
    <p class="muted metrics-note">${metrics.overflowing ? "Content overflows this block." : `${Math.round(metrics.fillRatio * 100)}% filled`}</p>
  `;
}

function bindInspector({ onPatch, onChooseStory, onSave, onRevert }) {
  [...STORY_FIELDS, ...META_FIELDS].forEach((f) => {
    document.getElementById(f.id)?.addEventListener("input", (event) => {
      onPatch({ [f.field]: event.target.value }, "inspector");
    });
  });

  document.getElementById("insStatusSelect")?.addEventListener("change", (event) => {
    onPatch({ status: event.target.value || "editing" }, "inspector");
  });

  document.getElementById("insChooseStory")?.addEventListener("click", onChooseStory);
  document.getElementById("insChangeStory")?.addEventListener("click", onChooseStory);
  document.getElementById("insSaveBtn")?.addEventListener("click", onSave);
  document.getElementById("insRevertBtn")?.addEventListener("click", onRevert);
}

// Live update: read-outs follow every edit from anywhere, while the input being
// typed into is left alone so the caret never jumps.
export function refreshInspectorReadouts(section, view, story, source) {
  const badge = document.getElementById("insStatusBadge");
  if (!badge) return;

  const status = statusOf(view);
  badge.textContent = statusLabel(status);
  badge.className = `section-status-badge ${statusClass(status)}`;

  const automatic = document.querySelector('#insStatusSelect option[value=""]');
  if (automatic) automatic.textContent = `Automatic (${statusLabel(status)})`;

  STORY_FIELDS.filter((f) => f.limit).forEach((f) => {
    const counter = document.getElementById(`${f.id}Counter`);
    if (!counter) return;
    const length = (view[f.field] || "").length;
    counter.textContent = `${length}/${f.limit}`;
    counter.classList.toggle("over", length > f.limit);
  });

  const stats = document.getElementById("insStoryStats");
  if (stats) stats.innerHTML = statsMarkup(view);

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  };
  setText("insImageName", view.imageUrl ? view.imageUrl.split("/").pop() : "None");
  setText("insImageRotation", `${view.imageRotation}°`);
  setText("insImageZoom", `${Number(view.imageZoom).toFixed(2)}×`);
  setText("insImageFit", view.imageFit);

  const metricsGroup = document.getElementById("insMetrics");
  if (metricsGroup) metricsGroup.innerHTML = `<h4>Space</h4>${spaceMarkup(computeMetrics(section, view))}`;

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
    ? `<span>From <strong>${escapeHtml(story?.title || "reporter story")}</strong></span>
       <button type="button" class="ext-editor-btn" id="insChangeStory">Change</button>`
    : `<span class="muted">Writing directly</span>
       <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="insChooseStory">Take from Reporter</button>`;
  // The old button went with the old markup, so the new one is rebound.
  const handler = inspectorCallbacks?.onChooseStory;
  if (handler) {
    document.getElementById("insChooseStory")?.addEventListener("click", handler);
    document.getElementById("insChangeStory")?.addEventListener("click", handler);
  }
}

let inspectorCallbacks = null;
export function configureInspector(callbacks) {
  inspectorCallbacks = callbacks;
}

function repaintInputs(view) {
  [...STORY_FIELDS, ...META_FIELDS].forEach((f) => {
    const input = document.getElementById(f.id);
    if (input && document.activeElement !== input && input.value !== view[f.field]) {
      input.value = view[f.field];
    }
  });
  const statusSelect = document.getElementById("insStatusSelect");
  if (statusSelect) statusSelect.value = isExplicit(view.status) ? view.status : "";
}
