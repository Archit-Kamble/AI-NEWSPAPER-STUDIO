// The External Editor: a full-width dock across the bottom of the workspace,
// the way a terminal sits under VS Code or a timeline under Premiere. The canvas
// and Inspector stay visible above it; this panel gets the full width because
// composing a story is a horizontal job.
//
// It is still the GrapesJS host - the Layout tab keeps the untouched empty
// #external-editor div, and nothing here assumes what will live in it.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { TABS, tabStripMarkup, tabPanelsMarkup, bindTabs, getActiveTab, setActiveTab } from "./tabs.js";
import { storyPanelMarkup, bindStoryPanel, refreshStoryPanel } from "./story-panel.js";
import { imagesPanelMarkup, bindImagesPanel, refreshImagesPanel } from "./images-panel.js";
import { typographyPanelMarkup, bindTypographyPanel, refreshTypographyPanel } from "./typography-panel.js";
import { layoutPanelMarkup, refreshLayoutPanel } from "./layout-panel.js";
import { aiPanelMarkup, bindAiPanel, refreshAiPanel } from "./ai-panel.js";
import { assetsPanelMarkup, bindAssetsPanel, refreshAssetsPanel } from "./assets-panel.js";
import { historyPanelMarkup, bindHistoryPanel, refreshHistoryPanel } from "./history-panel.js";

let notifyTimer = null;
let activeCallbacks = null;

export function renderExternalEditor(section, view, story, reporterNews, callbacks) {
  const container = document.getElementById("externalEditorPanel");
  if (!container) return;

  activeCallbacks = callbacks;

  if (!section || !view) {
    container.innerHTML = `
      <div class="ext-editor-header">
        <h3>External Editor</h3>
        <span class="muted">Select a section on the page to open it here.</span>
        <div class="ext-editor-header-actions">
          <button type="button" class="ext-icon-btn" id="edToggleDock" title="Collapse editor">▾</button>
        </div>
      </div>
    `;
    bindDockToggle(callbacks);
    return;
  }

  const status = statusOf(view);

  container.innerHTML = `
    <div class="ext-editor-header">
      <h3>External Editor</h3>
      <span class="ext-editor-section-name">${escapeHtml(section.section_key)}</span>
      <span id="edStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
      ${tabStripMarkup()}
      <span class="ext-editor-notice" id="edNotice"></span>
      <div class="ext-editor-header-actions">
        <button type="button" class="ext-editor-btn" id="edCancel">Revert</button>
        <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edSaveSection">Save Section</button>
        <button type="button" class="ext-icon-btn" id="edToggleDock" title="Collapse editor">▾</button>
      </div>
    </div>
    <div class="ext-editor-body">
      ${tabPanelsMarkup({
        story: storyPanelMarkup(view, story),
        images: imagesPanelMarkup(view),
        typography: typographyPanelMarkup(view),
        layout: layoutPanelMarkup(section, view),
        ai: aiPanelMarkup(view),
        assets: assetsPanelMarkup(view, reporterNews),
        history: historyPanelMarkup(),
      })}
      <div class="ext-mount-strip">
        <div id="external-editor" class="ext-editor-mount">
          <p class="muted">The embedded layout editor will mount here.</p>
        </div>
      </div>
    </div>
  `;

  const notify = showNotice;

  bindTabs(() => refreshVolatileTabs(section, currentViewFrom(callbacks), callbacks));
  bindStoryPanel(callbacks.onPatch, callbacks.onChooseStory);
  bindImagesPanel(callbacks.getView, reporterNews, callbacks.onPatch, notify);
  bindTypographyPanel(callbacks.getView, callbacks.onPatch);
  bindAiPanel(callbacks.getView, callbacks.onPatch, notify);
  bindAssetsPanel(callbacks.onPatch, notify);
  bindHistoryPanel(historyHandlers(callbacks));
  bindDockToggle(callbacks);

  document.getElementById("edCancel").addEventListener("click", callbacks.onCancel);
  document.getElementById("edSaveSection").addEventListener("click", callbacks.onSave);
}

function currentViewFrom(callbacks) {
  return callbacks?.getView?.() || null;
}

function historyHandlers(callbacks) {
  return { onUndo: callbacks.onUndo, onRedo: callbacks.onRedo, onJump: callbacks.onJumpHistory };
}

function bindDockToggle(callbacks) {
  document.getElementById("edToggleDock")?.addEventListener("click", callbacks.onToggleDock);
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

// Live sync. Panels update themselves in place - nothing is rebuilt, so the
// active tab, scroll positions and caret all survive every keystroke.
export function refreshExternalEditor(section, view, story, source) {
  const badge = document.getElementById("edStatusBadge");
  if (badge) {
    const status = statusOf(view);
    badge.textContent = statusLabel(status);
    badge.className = `section-status-badge ${statusClass(status)}`;
  }

  refreshStoryPanel(view, source);
  refreshImagesPanel(view);
  refreshTypographyPanel(view, source);
  refreshAssetsPanel(view);
  refreshAiPanel(view, source);
  refreshVolatileTabs(section, view, activeCallbacks);
  refreshStoryLinkBar(view, story);
}

// Layout and History are pure read-outs, so they are rebuilt wholesale - but
// only when their own tab is on screen, which keeps typing cheap (Part 14).
function refreshVolatileTabs(section, view, callbacks) {
  const active = getActiveTab();
  if (active === "layout" && section && view) refreshLayoutPanel(section, view);
  if (active === "history" && callbacks) refreshHistoryPanel(historyHandlers(callbacks));
}

export function refreshHistoryTab() {
  if (getActiveTab() === "history" && activeCallbacks) {
    refreshHistoryPanel(historyHandlers(activeCallbacks));
  }
}

function refreshStoryLinkBar(view, story) {
  const bar = document.querySelector(".story-link-bar");
  if (!bar) return;

  const linked = Boolean(view.newsItemId);
  if (linked === bar.classList.contains("linked")) {
    if (linked) {
      const label = bar.querySelector("strong");
      if (label) label.textContent = story?.title || "reporter story";
    }
    return;
  }

  // Replacing the bar drops its listener with the old node, so it is rebound.
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

export { showNotice, setActiveTab, TABS };
