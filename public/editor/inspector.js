// The Inspector is context for the selected block, not a second story form.
// The dock contains the only inputs: its Word-style surface plus the folded
// details panel. Keeping this panel read-only prevents rich text ever being
// shown as raw markup in a duplicate textarea.

import { escapeHtml } from "./format.js";
import { plainText } from "./layout/rich-text.js";
import { statusOf, statusLabel, statusClass } from "./status/section-status.js";

const WORDS_PER_MINUTE = 200;

function storyStats(view) {
  // The words a reader counts, not the tags. `<b>` is not a word.
  const text = plainText(view.body);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    words,
    characters: text.length,
    readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
  };
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

  body.innerHTML = `
    <div class="inspector-head">
      <div>
        <h3>${escapeHtml(section.section_key)}</h3>
        <small class="muted">${section.width_px} × ${section.height_px} px</small>
      </div>
      <span id="insStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>

    <div class="inspector-group">
      <h4>Selected block</h4>
      <p class="inspector-story-origin" id="insStoryOrigin">${view.newsItemId ? `From ${escapeHtml(story?.title || "reporter story")}` : "Writing directly"}</p>
      <div class="stat-grid" id="insStoryStats">${statsMarkup(view)}</div>
      <button type="button" class="btn-submit inspector-write" id="insWriteBtn">Open writer ↓</button>
    </div>

    <div class="inspector-group">
      <h4>Workflow</h4>
      <div class="inspector-row"><span>Status</span><strong id="insStatusText">${statusLabel(status)}</strong></div>
      <div class="inspector-row"><span>Language</span><strong id="insLanguageText">${escapeHtml(view.language || "Marathi")}</strong></div>
      <div class="inspector-row"><span>Last saved</span><strong id="insSavedAt">${formatSavedAt(section.updated_at)}</strong></div>
    </div>
  `;

  bindInspector(callbacks);
}

function bindInspector({ onOpenWriter }) {
  document.getElementById("insWriteBtn")?.addEventListener("click", onOpenWriter);
}

// Live update: read-outs follow every edit from anywhere, while the input being
// typed into is left alone so the caret never jumps.
export function refreshInspectorReadouts(section, view, story, source) {
  const badge = document.getElementById("insStatusBadge");
  if (!badge) return;

  const status = statusOf(view);
  badge.textContent = statusLabel(status);
  badge.className = `section-status-badge ${statusClass(status)}`;

  const stats = document.getElementById("insStoryStats");
  if (stats) stats.innerHTML = statsMarkup(view);
  const origin = document.getElementById("insStoryOrigin");
  if (origin) origin.textContent = view.newsItemId ? `From ${story?.title || "reporter story"}` : "Writing directly";
  const statusText = document.getElementById("insStatusText");
  if (statusText) statusText.textContent = statusLabel(status);
  const language = document.getElementById("insLanguageText");
  if (language) language.textContent = view.language || "Marathi";
}

let inspectorCallbacks = null;
export function configureInspector(callbacks) {
  inspectorCallbacks = callbacks;
}
