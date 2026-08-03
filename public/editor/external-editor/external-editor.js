// The External Editor shell. Hosts three collapsible panels (Story, Images, AI)
// and the mount point a real layout editor will eventually take over.
//
// This is still the GrapesJS host from the previous milestone - #external-editor
// remains an untouched empty div, and nothing here assumes what will live in it.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { storyPanelMarkup, bindStoryPanel, refreshStoryPanel } from "./story-panel.js";
import { imagesPanelMarkup, bindImagesPanel, refreshImagesPanel } from "./images-panel.js";
import { aiPanelMarkup, bindAiPanel, refreshAiPanel } from "./ai-panel.js";

let notifyTimer = null;
// Held so the story-link bar can rebind its button after being swapped out on a
// live update (linking a story replaces that bar's markup).
let activeCallbacks = null;

export function renderExternalEditor(section, view, story, reporterNews, callbacks) {
  const container = document.getElementById("externalEditorPanel");
  if (!container) return;

  if (!section || !view) {
    container.innerHTML = `
      <div class="ext-editor-header"><h3>External Editor</h3></div>
      <p class="muted ext-editor-empty">Select a section on the page to open it here.</p>
    `;
    return;
  }

  activeCallbacks = callbacks;
  const status = statusOf(view);

  container.innerHTML = `
    <div class="ext-editor-header">
      <h3>External Editor</h3>
      <span class="ext-editor-section-name">${escapeHtml(section.section_key)}</span>
      <span id="edStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
      <span class="ext-editor-notice" id="edNotice"></span>
    </div>
    <div class="ext-editor-scroll">
      <details class="ext-editor-section" data-panel="story" open>
        <summary>Story</summary>
        <div class="ext-editor-section-body">${storyPanelMarkup(view, story)}</div>
      </details>
      <details class="ext-editor-section" data-panel="images">
        <summary>Images</summary>
        <div class="ext-editor-section-body">${imagesPanelMarkup(view)}</div>
      </details>
      <details class="ext-editor-section" data-panel="ai">
        <summary>AI</summary>
        <div class="ext-editor-section-body">${aiPanelMarkup(view)}</div>
      </details>
      <details class="ext-editor-section" data-panel="layout">
        <summary>Layout editor</summary>
        <div class="ext-editor-section-body">
          <div id="external-editor" class="ext-editor-mount">
            <p class="muted">The embedded layout editor will mount here.</p>
          </div>
        </div>
      </details>
    </div>
    <div class="ext-editor-footer">
      <button type="button" class="ext-editor-btn" id="edPreview">Preview</button>
      <button type="button" class="ext-editor-btn" id="edCancel">Cancel</button>
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edSaveSection">Save Section</button>
    </div>
  `;

  const notify = (message) => showNotice(message);

  bindStoryPanel(callbacks.onPatch, callbacks.onChooseStory);
  bindImagesPanel(view, reporterNews, callbacks.onPatch, notify);
  bindAiPanel(callbacks.getView, callbacks.onPatch, notify);

  document.getElementById("edPreview").addEventListener("click", () => {
    notify("The canvas thumbnail is already a live preview of this section.");
  });
  document.getElementById("edCancel").addEventListener("click", callbacks.onCancel);
  document.getElementById("edSaveSection").addEventListener("click", callbacks.onSave);
}

function showNotice(message) {
  const notice = document.getElementById("edNotice");
  if (!notice) return;
  notice.textContent = message;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    if (notice.textContent === message) notice.textContent = "";
  }, 4000);
}

// Live sync (Phase 3). Panels update themselves in place; nothing is rebuilt,
// so open/closed panel state and caret position both survive.
export function refreshExternalEditor(view, story, source) {
  const badge = document.getElementById("edStatusBadge");
  if (badge) {
    const status = statusOf(view);
    badge.textContent = statusLabel(status);
    badge.className = `section-status-badge ${statusClass(status)}`;
  }

  refreshStoryPanel(view, source);
  refreshImagesPanel(view);
  refreshAiPanel(view, source);

  // The story-link bar is markup, not an input, so it is safe to replace - but
  // its button must be rebound afterwards, since the old node (and its listener)
  // is gone.
  const bar = document.querySelector(".story-link-bar");
  if (!bar) return;

  const linked = Boolean(view.newsItemId);
  const wasLinked = bar.classList.contains("linked");

  if (linked === wasLinked) {
    if (linked) {
      const label = bar.querySelector("strong");
      if (label) label.textContent = story?.title || "reporter story";
    }
    return;
  }

  bar.outerHTML = linked
    ? `<div class="story-link-bar linked">
         <span>Linked to <strong>${escapeHtml(story?.title || "reporter story")}</strong></span>
         <button type="button" class="ext-editor-btn" id="edChangeStory">Change</button>
       </div>`
    : `<div class="story-link-bar">
         <span class="muted">No story attached</span>
         <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edChooseStory">Choose Reporter Story</button>
       </div>`;

  const chooseStory = activeCallbacks?.onChooseStory;
  if (chooseStory) {
    document.getElementById("edChooseStory")?.addEventListener("click", chooseStory);
    document.getElementById("edChangeStory")?.addEventListener("click", chooseStory);
  }
}

export { showNotice };
