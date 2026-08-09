// The External Editor: the second stage of newspaper production, a full-width
// dock below the page and the Inspector. The page scrolls naturally; this panel
// is not squeezed into a viewport (VISION.md, "External Editor").
//
// No tabs. VISION.md is explicit that tabs must not be added just because they
// look organised, and the section lifecycle it defines runs in one direction:
//
//     work on image -> AI measures the space left -> AI fills it -> review -> save
//
// So the dock is two columns. Left is the live newspaper preview, exactly as it
// will print. Right is one continuous control column in that same order, with
// typography and history folded away underneath - present when wanted, never in
// the path. An editor arriving here never has to choose a tab before starting.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { composeCanvasMarkup, renderComposeCanvas, scaleComposeCanvas, bindComposeCanvas, selectImageById } from "./compose-canvas.js";
import { picturesPanelMarkup, bindPicturesPanel, refreshPicturesPanel } from "./pictures-panel.js";
import { typographyPanelMarkup, bindTypographyPanel, refreshTypographyPanel } from "./typography-panel.js";
import { spacePanelMarkup, refreshSpacePanel } from "./layout-panel.js";
import { aiPanelMarkup, bindAiPanel, refreshAiPanel } from "./ai-panel.js";
import { assetsPanelMarkup, bindAssetsPanel, refreshAssetsPanel } from "./assets-panel.js";
import { historyPanelMarkup, bindHistoryPanel, refreshHistoryPanel } from "./history-panel.js";
import { pageMapMarkup, bindPageMap } from "./page-map.js";
import { storyEditorMarkup, bindStoryEditor, refreshStoryEditor, refreshStoryCount, refreshStoryStats } from "./story-editor.js";
import { smartCardMarkup, bindSmartCard } from "./smart-card-panel.js";
import { storyDetailsMarkup, bindStoryDetails, refreshStoryDetails } from "./story-details-panel.js";

// The three steps of the lifecycle, in order. Anything not on this path lives
// in a collapsed <details> below them.
export const GROUPS = [
  { key: "image", label: "1 · Pictures" },
  { key: "space", label: "2 · Space" },
  { key: "ai", label: "3 · Write with AI" },
];

let notifyTimer = null;
let activeCallbacks = null;

function group(key, label, body) {
  return `
    <section class="ext-group" data-group="${key}" id="edGroup-${key}">
      <h4 class="ext-group-title">${label}</h4>
      <div class="ext-group-body" id="edGroupBody-${key}">${body}</div>
    </section>
  `;
}

function storySourceMarkup(view, story) {
  return `<div class="story-link-bar${view.newsItemId ? " linked" : ""}" id="edStoryBar">${view.newsItemId
    ? `<span>From <strong>${escapeHtml(story?.title || "reporter story")}</strong></span><button type="button" class="ext-editor-btn" id="edChangeStory">Change</button>`
    : `<span class="muted">Writing directly</span><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edChooseStory">Take from Reporter</button>`
  }</div>`;
}

function bindStorySource(callbacks) {
  document.getElementById("edChooseStory")?.addEventListener("click", callbacks.onChooseStory);
  document.getElementById("edChangeStory")?.addEventListener("click", callbacks.onChooseStory);
}

function refreshStorySource(view, story) {
  const bar = document.getElementById("edStoryBar");
  if (!bar || !activeCallbacks) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = storySourceMarkup(view, story);
  bar.replaceWith(wrapper.firstElementChild);
  bindStorySource(activeCallbacks);
}

export function renderExternalEditor(section, view, story, reporterNews, callbacks) {
  const container = document.getElementById("externalEditorPanel");
  if (!container) return;

  activeCallbacks = callbacks;

  if (!section || !view) {
    // Never a bare strip of white. If an editor scrolls down here before
    // picking a block, the dock says what this stage is for and how to start -
    // VISION.md: the editor should never wonder where to go next.
    container.innerHTML = `
      <div class="ext-editor-header">
        <h3>External Editor</h3>
        <span class="muted">Nothing open yet</span>
        <div class="ext-editor-header-actions">
          <button type="button" class="ext-icon-btn" id="edToggleDock" title="Collapse editor">▾</button>
        </div>
      </div>
      <div class="ext-editor-idle">
        <h4>This is where a story is composed.</h4>
        <p>Pick a block on the page above and it opens here: place its pictures, see how many
           characters are left around them, and let the AI fill exactly that.</p>
        <ol class="ext-idle-steps">
          <li><strong>Pictures</strong> — place, size and shape them on the block</li>
          <li><strong>Space</strong> — how many characters the copy has room for</li>
          <li><strong>Write with AI</strong> — fill exactly those characters</li>
        </ol>
        <button type="button" class="btn-submit" id="edPickBlock">Choose a block ↑</button>
      </div>
    `;
    bindDockToggle(callbacks);
    document.getElementById("edPickBlock")?.addEventListener("click", () => callbacks.onPickBlock?.());
    return;
  }

  const status = statusOf(view);

  container.innerHTML = `
    <div class="ext-editor-header">
      <h3>External Editor</h3>
      <span class="ext-editor-section-name">${escapeHtml(section.section_key)}</span>
      <!-- The block's own size. It was in the Inspector's heading; a desk
           reads it constantly, because it is what the copy has to fit. -->
      <span class="ext-editor-section-size" id="edSectionSize">${section.width_px} × ${section.height_px} px</span>
      <span id="edStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
      <span class="ext-editor-notice" id="edNotice"></span>
      <div class="ext-editor-header-actions">
        <!-- When the last save happened, and an explicit Save. Both were in the
             Inspector. Autosave is real, but a desk sending a page to the press
             wants to be told, not to trust. -->
        <span class="ext-editor-saved">Saved <strong id="edSavedAt">${formatSavedAt(section.updated_at)}</strong></span>
        <button type="button" class="ext-editor-btn" id="edCancel">Revert</button>
        <button type="button" class="ext-editor-btn" id="edSaveNow">Save</button>
        <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edReturnToPage">Back to page ↑</button>
        <button type="button" class="ext-icon-btn" id="edToggleDock" title="Collapse editor">▾</button>
      </div>
    </div>

    <div class="ext-editor-stage">
      <div class="ext-controls-col">
        <!-- ONE editor: the words and the pictures of a story are the story,
             and they were in two panels a screen apart, so placing a picture
             meant losing sight of the copy it has to run around. The writing
             surface is first and nothing may go above it - selecting a block
             has to put a cursor within reach - and the pictures follow it
             inside the same panel. -->
        ${group("story", "Write the story", `
          ${storySourceMarkup(view, story)}
          ${storyEditorMarkup(view, { budget: callbacks.getBudget ? callbacks.getBudget() : 0 })}
          <div class="story-pictures">
            <h5 class="story-pictures-title">Pictures on this block</h5>
            ${composeCanvasMarkup()}
            ${picturesPanelMarkup(callbacks.getImages?.() || [])}
            <details class="ext-more">
              <summary>Choose from the reporter's pictures</summary>
              ${assetsPanelMarkup(view, reporterNews)}
            </details>
          </div>
        `)}

        ${group("card", "Smart Cards", smartCardMarkup())}

        ${group("space", "Space left", `<div id="edSpaceGroup">${spacePanelMarkup(section, view, callbacks.getImages?.() || [])}</div>`)}

        ${group("ai", "Help from AI", aiPanelMarkup(view))}

        <details class="ext-aside">
          <summary>Typography</summary>
          ${typographyPanelMarkup(view)}
        </details>

        <details class="ext-aside">
          <summary>Story details</summary>
          ${storyDetailsMarkup(view)}
        </details>

        <details class="ext-aside">
          <summary>History</summary>
          <div id="edHistoryAside">${historyPanelMarkup()}</div>
        </details>

        <!-- Where on the page this block is. It travelled with the old Pictures
             panel; it is small and it is a way THROUGH the page, so it stays. -->
        ${pageMapMarkup(callbacks.getPage?.(), callbacks.getNewspaper?.(), section.section_key)}

        <div class="ext-mount-strip">
          <div id="external-editor" class="ext-editor-mount"></div>
        </div>
      </div>
    </div>
  `;

  const notify = showNotice;

  bindComposeCanvas({
    onPatch: callbacks.onPatch,
    onAddImage: callbacks.onAddImage,
    onPatchImage: callbacks.onPatchImage,
    onRemoveImage: callbacks.onRemoveImage,
    onRemoveBackground: callbacks.onRemoveBackground,
    onNotify: notify,
  });
  bindPicturesPanel({ ...callbacks, onSelectImage: selectImageById });
  bindSmartCard(callbacks.onRequestSmartCard, callbacks.onPatch, notify);
  bindStorySource(callbacks);
  // The writing surface. Every keystroke goes down the same channel as the
  // Inspector's fields always did - draft, live canvas repaint, autosave.
  bindStoryEditor({ onPatch: callbacks.onPatch, getBudget: callbacks.getBudget });
  // The small layout is a way through the page, not only a picture of it.
  bindPageMap((sectionKey) => callbacks.onSelectSection?.(sectionKey));
  bindTypographyPanel(callbacks.getView, callbacks.onPatch);
  bindStoryDetails(callbacks.onPatch);
  bindAiPanel(callbacks.getView, callbacks.getSection, callbacks.onPatch, notify, callbacks.getImages, callbacks.getPage);
  bindAssetsPanel(callbacks.onPatch, notify);
  bindHistoryPanel(historyHandlers(callbacks));
  bindDockToggle(callbacks);

  document.getElementById("edCancel").addEventListener("click", callbacks.onCancel);
  document.getElementById("edSaveNow")?.addEventListener("click", callbacks.onSave);
  document.getElementById("edReturnToPage").addEventListener("click", callbacks.onReturnToPage);

  renderComposeCanvas(section, view, callbacks.getImages?.() || [], null);
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

// Brings one step of the lifecycle into view. Replaces the old tab switch - the
// group is always rendered, so this only scrolls, and nothing is hidden.
export function focusGroup(groupKey) {
  document.getElementById(`edGroup-${groupKey}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Live sync. Panels update themselves in place - nothing is rebuilt, so scroll
// positions and the caret survive every keystroke.
export function refreshExternalEditor(section, view, story, source) {
  const badge = document.getElementById("edStatusBadge");
  if (badge) {
    const status = statusOf(view);
    badge.textContent = statusLabel(status);
    badge.className = `section-status-badge ${statusClass(status)}`;
  }

  const images = activeCallbacks?.getImages?.() || [];
  renderComposeCanvas(section, view, images);
  refreshPicturesPanel(images);
  refreshSpacePanel(section, view, activeCallbacks?.getImages?.() || []);
  refreshTypographyPanel(view, source);
  refreshStoryDetails(view, source);
  refreshAssetsPanel(view);
  refreshAiPanel(view, source);
  refreshStorySource(view, story);
  // Not when the change came from the editor itself - rewriting the box a
  // person has a cursor in throws the cursor back to the start, which is the
  // classic way a rich editor becomes unusable.
  if (source !== "story-editor") refreshStoryEditor(view);
  else {
    refreshStoryCount();
    // The read-outs still follow every keystroke - only the boxes are left
    // alone, so the caret never jumps.
    refreshStoryStats(view);
  }
}

/**
 * When this block was last saved.
 *
 * The Inspector carried this; autosave is real, but a desk sending a page to
 * the press wants to be told rather than to trust.
 */
export function refreshDockSavedAt(section) {
  const element = document.getElementById("edSavedAt");
  if (element) element.textContent = formatSavedAt(section?.updated_at);
}

function formatSavedAt(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function refreshHistoryTab() {
  if (document.getElementById("edHistoryAside") && activeCallbacks) {
    refreshHistoryPanel(historyHandlers(activeCallbacks));
  }
}

export { showNotice, scaleComposeCanvas };
