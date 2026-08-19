// The BLOCK EDITOR: the lower half of the SAHAS Layout Desk.
//
// It was called the External Editor, and the name was wrong in a way that
// mattered. There is no external editor. This is not a second application
// inside the application, not an embedded product, not something a page hands
// off to - it is the other half of the same editor, showing the block the
// newspaper canvas above has selected. One store, one selected block, one
// draft, two views of it. (The module path still says external-editor/ because
// renaming a working folder buys nothing but risk; the name a desk reads is
// what had to change.)
//
// No tabs. VISION.md is explicit that tabs must not be added just because they
// look organised, and the section lifecycle it defines runs in one direction:
//
//     work on image -> AI measures the space left -> AI fills it -> review -> save
//
// The screen is three places, and a panel belongs to one of them by what it is
// FOR rather than by when it was written:
//
//   beside the page (#workspaceToolsPanel)   how the block is SET - typography,
//                                            the story's particulars, its
//                                            history, the small layout. All of
//                                            it changes what the sheet next to
//                                            it looks like, so it sits next to
//                                            the sheet.
//   the desk, left (.ext-write-col)          where the story is WRITTEN - the
//                                            copy and the pictures, one panel,
//                                            most of the width.
//   the desk, right (.ext-assist-col)        what HELPS write it - the AI, the
//                                            space read-out it is briefed with,
//                                            the smart cards. Beside the copy,
//                                            because a proposal is read against
//                                            the story, not underneath it.
//
// Everything is always rendered. Nothing here is behind a tab, and nothing was
// dropped when it moved - the three folded panels that used to sit at the foot
// of the rail are the same panels, opened beside the page instead of below the
// fold where nobody found them.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { blockKind, blockNote } from "../layout/block-kinds.js";
import { pictureControlsMarkup, renderPictureControls, bindPictureControls, selectPicture } from "./picture-controls.js";
import { picturesPanelMarkup, bindPicturesPanel, refreshPicturesPanel } from "./pictures-panel.js";
import { typographyPanelMarkup, bindTypographyPanel, refreshTypographyPanel } from "./typography-panel.js";
import { propertiesPanelMarkup, bindPropertiesPanel, refreshPropertiesPanel } from "./properties-panel.js";
import { spacePanelMarkup, refreshSpacePanel } from "./layout-panel.js";
import { aiPanelMarkup, bindAiPanel, refreshAiPanel } from "./ai-panel.js";
import { historyPanelMarkup, bindHistoryPanel, refreshHistoryPanel } from "./history-panel.js";
import { pageMapMarkup, bindPageMap } from "./page-map.js";
import { storyEditorMarkup, bindStoryEditor, refreshStoryEditor, refreshStoryCount, refreshStoryStats, selectPictureFrame } from "./story-editor.js";
import { smartCardMarkup, bindSmartCard } from "./smart-card-panel.js";
import { storyDetailsMarkup, bindStoryDetails, refreshStoryDetails } from "./story-details-panel.js";

// The panels of the desk, in the order they are read: write on the left, the
// help beside it on the right.
export const GROUPS = [
  { key: "story", label: "Story" },
  { key: "ai", label: "AI" },
  { key: "space", label: "Layout" },
  { key: "card", label: "Smart cards" },
];

let notifyTimer = null;
let activeCallbacks = null;

function group(key, label, body, note = "") {
  return `
    <section class="ext-group" data-group="${key}" id="edGroup-${key}">
      <h4 class="ext-group-title">${label}${note ? `<span class="ext-group-note">${note}</span>` : ""}</h4>
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

/**
 * The rail beside the page: everything that describes how the block is set.
 *
 * A separate host, written at the same moment as the dock, because the two are
 * one screen for one block - and the rail must never be left showing the
 * settings of a block that is no longer open.
 */
function renderToolsRail(section, view, callbacks) {
  const host = document.getElementById("workspaceToolsPanel");
  const name = document.getElementById("toolsBlockName");
  if (!host) return;

  if (name) name.textContent = section ? section.section_key : "No block open";

  if (!section || !view) {
    host.innerHTML = `
      <p class="tools-idle muted">Click a block on the page and its type, its
         particulars and its history appear here.</p>`;
    return;
  }

  host.innerHTML = `
    <!-- Properties is open and comes first: what this panel is FOR is "what
         is true about the object currently selected", and that answer is
         different for a block, a picture, a Smart Card, or flow-based text -
         Typography (below) is one part of that answer, the part that is the
         same three-field shape for every text object. -->
    <details class="ext-aside" open>
      <summary>Properties</summary>
      <div id="edPropertiesGroup">${propertiesPanelMarkup(section, view, callbacks.getSelectedImage?.(), "block", callbacks.getPage?.())}</div>
    </details>

    <!-- Typography is open. It is the one a desk reaches for every day, and a
         fold that is always opened is a click charged for nothing. -->
    <details class="ext-aside" open>
      <summary>Typography</summary>
      ${typographyPanelMarkup(view)}
    </details>

    <details class="ext-aside">
      <summary>Story details</summary>
      ${storyDetailsMarkup(view, Boolean((section.images || []).length))}
    </details>

    <details class="ext-aside">
      <summary>History</summary>
      <div id="edHistoryAside">${historyPanelMarkup()}</div>
    </details>

    <!-- Where on the page this block is, and a way through to the next one. -->
    ${pageMapMarkup(callbacks.getPage?.(), callbacks.getNewspaper?.(), section.section_key)}
  `;

  bindPropertiesPanel({ getSelectedImage: callbacks.getSelectedImage, onPatchImage: callbacks.onPatchImage, onPatch: callbacks.onPatch });
  bindTypographyPanel(callbacks.getView, callbacks.onPatch);
  bindStoryDetails(callbacks.onPatch);
  bindHistoryPanel(historyHandlers(callbacks));
  bindPageMap((sectionKey) => callbacks.onSelectSection?.(sectionKey));
}

// "Move it clear of the column" on the Layout panel's unprintable-block
// warning. The rectangle was already worked out to draw the button
// (layout-panel.js's placementRepair), so pressing it is an ordinary picture
// patch - the same one a drag makes. Delegated on the group, which is
// re-rendered wholesale on every refresh.
function bindPlacementRepair(onPatchImage) {
  const group = document.getElementById("edSpaceGroup");
  if (!group || group.dataset.repairBound === "1") return;
  group.dataset.repairBound = "1";
  group.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-fix-placement]");
    if (!button) return;
    event.preventDefault();
    const [x, y, width, height] = String(button.dataset.fixRect).split(",").map(Number);
    if (![x, y, width, height].every(Number.isFinite)) return;
    onPatchImage?.(Number(button.dataset.fixPlacement), { x, y, width, height });
  });
}

export function renderExternalEditor(section, view, story, reporterNews, callbacks) {
  const container = document.getElementById("externalEditorPanel");
  if (!container) return;

  activeCallbacks = callbacks;
  renderToolsRail(section, view, callbacks);

  if (!section || !view) {
    // Never a bare strip of white. If an editor scrolls down here before
    // picking a block, the dock says what this stage is for and how to start -
    // VISION.md: the editor should never wonder where to go next.
    container.innerHTML = `
      <div class="ext-editor-header">
        <h3>Block Editor</h3>
        <span class="muted">No block selected</span>
        <div class="ext-editor-header-actions">
          <button type="button" class="ext-icon-btn" id="edToggleDock" title="Collapse editor">▾</button>
        </div>
      </div>
      <div class="ext-editor-idle">
        <h4>This is where a story is composed.</h4>
        <p>Pick a block on the page above and it opens here, at the block's own shape:
           write the copy, drag its pictures onto it, and let the AI fill exactly the
           space that is left.</p>
        <ol class="ext-idle-steps">
          <li><strong>Left of the page</strong> — how the block is set: type, particulars, history</li>
          <li><strong>Story</strong> — the headline, the subheading, the copy and its pictures</li>
          <li><strong>AI and Layout</strong> — what helps write it, and how much room is left</li>
        </ol>
        <button type="button" class="btn-submit" id="edPickBlock">Choose a block ↑</button>
      </div>
    `;
    bindDockToggle(callbacks);
    document.getElementById("edPickBlock")?.addEventListener("click", () => callbacks.onPickBlock?.());
    return;
  }

  const status = statusOf(view, Boolean((section.images || []).length));

  container.innerHTML = `
    <div class="ext-editor-header">
      <h3>Block Editor</h3>
      <!-- WHICH block. The heading used to name the panel and then the block,
           with nothing joining the two, so a desk looking at a page of forty
           boxes had to work out which one it was about to edit. -->
      <span class="ext-editor-selected">Selected:</span>
      <span class="ext-editor-section-name">${escapeHtml(section.section_key)}</span>
      <!-- What KIND of block this is, and the work it wants - the same words the
           night desk's worklist uses, from the same catalog (block-kinds.js).
           A page is not forty of the same box: an advert slot is space that was
           sold, a photo block wants a photograph and a caption, a feature
           carries the day's standing furniture. The software has always known
           this and only ever said it on the worklist, so the one screen where
           the work happens was the one screen that did not say what it was. -->
      <span class="ext-editor-kind is-${escapeHtml(section.block_type || "article")}"
            title="${escapeHtml(blockKind(section.block_type).work)}">${escapeHtml(blockKind(section.block_type).label)}${
        section.feature_key ? ` · ${escapeHtml(section.feature_key)}` : ""
      }</span>
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
      <!-- LEFT, and most of the width: the story. The words and the pictures of
           a story ARE the story, and they were once two panels a screen apart,
           so placing a photograph meant losing sight of the copy it has to run
           around. One panel, and nothing above it - selecting a block has to put
           a cursor within reach. -->
      <div class="ext-write-col">
        ${group("story", escapeHtml(blockKind(section.block_type).panel), `
          ${storySourceMarkup(view, story)}
          ${storyEditorMarkup(view, {
            budget: callbacks.getBudget ? callbacks.getBudget() : 0,
            tools: `<button type="button" class="rt-btn rt-picture" id="cmpAddImage"
                       title="Put a picture on this block">▣ Picture</button>`,
            pictures: `
              <h5 class="story-block-title" id="edImagesHeading">Images</h5>
              ${picturesPanelMarkup(callbacks.getImages?.() || [])}
              ${pictureControlsMarkup()}`,
          })}
        `, escapeHtml(blockNote(section.block_type)))}

        <div class="ext-mount-strip">
          <div id="external-editor" class="ext-editor-mount"></div>
        </div>
      </div>

      <!-- RIGHT: the machine that helps. The AI first, then the measurement it
           is briefed with - the two are one thought, and a proposal is judged
           against the copy beside it rather than a screen below it. -->
      <aside class="ext-assist-col">
        ${group("ai", "AI", aiPanelMarkup(view), "assists — you accept every change")}

        ${group("space", "Layout", `<div id="edSpaceGroup">${spacePanelMarkup(section, view, callbacks.getImages?.() || [])}</div>`)}

        ${group("card", "Smart cards", smartCardMarkup(view))}
      </aside>
    </div>
  `;

  const notify = showNotice;

  // #edSpaceGroup belongs to the DOCK, not the settings rail - binding it in
  // renderToolsRail() bound a listener to an element that render had not
  // written yet, and the button drew correctly and did nothing.
  bindPlacementRepair(callbacks.onPatchImage);

  bindPictureControls({
    onAddImage: callbacks.onAddImage,
    onPatchImage: callbacks.onPatchImage,
    onRemoveImage: callbacks.onRemoveImage,
    onRemoveBackground: callbacks.onRemoveBackground,
    onAlignImages: callbacks.onAlignImages,
    onRemoveSelectedImages: callbacks.onRemoveSelectedImages,
  });
  renderPictureControls(callbacks.getImages?.() || [], undefined, section);
  bindPicturesPanel({ ...callbacks, onSelectImage: (id) => { selectPicture(id); selectPictureFrame(id); } });
  bindSmartCard(callbacks.onRequestSmartCard, callbacks.onPatch, notify);
  bindStorySource(callbacks);
  // The writing surface. Every keystroke goes down the same channel as the
  // Inspector's fields always did - draft, live canvas repaint, autosave.
  // The pictures are part of the writing surface, so it is given what it needs
  // to turn a drag on the sheet into a placement on the block.
  bindStoryEditor({
    onPatch: callbacks.onPatch,
    getBudget: callbacks.getBudget,
    getSection: callbacks.getSection,
    getView: callbacks.getView,
    getImages: callbacks.getImages,
    onPatchImage: callbacks.onPatchImage,
    onRemoveImage: callbacks.onRemoveImage,
    onSelectImage: (id) => { selectPicture(id); selectPictureFrame(id); },
    onSelectPart: callbacks.onSelectPart,
    onToggleImageSelection: callbacks.onToggleImageSelection,
  });
  bindAiPanel(callbacks.getView, callbacks.getSection, callbacks.onPatch, notify, callbacks.getImages, callbacks.getPage);
  bindDockToggle(callbacks);
  // Typography, Story details, History and the small layout are bound by
  // renderToolsRail - they live beside the page now, not in this dock.

  document.getElementById("edCancel").addEventListener("click", callbacks.onCancel);
  document.getElementById("edSaveNow")?.addEventListener("click", callbacks.onSave);
  document.getElementById("edReturnToPage").addEventListener("click", callbacks.onReturnToPage);

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
export function refreshExternalEditor(section, view, story, source, selectedPart, selectedImageIds = []) {
  const images = activeCallbacks?.getImages?.() || [];

  const badge = document.getElementById("edStatusBadge");
  if (badge) {
    const status = statusOf(view, Boolean(images.length));
    badge.textContent = statusLabel(status);
    badge.className = `section-status-badge ${statusClass(status)}`;
  }

  renderPictureControls(images, undefined, section, selectedImageIds);
  refreshPicturesPanel(images);
  refreshSpacePanel(section, view, activeCallbacks?.getImages?.() || []);
  refreshPropertiesPanel(section, view, activeCallbacks?.getSelectedImage?.(), source, selectedPart, activeCallbacks?.getPage?.());
  refreshTypographyPanel(view, source, selectedPart);
  refreshStoryDetails(view, source);
  refreshAiPanel(view, source);
  refreshStorySource(view, story);
  // Not when the change came from the editor itself - rewriting the box a
  // person has a cursor in throws the cursor back to the start, which is the
  // classic way a rich editor becomes unusable.
  // The page and everything on it: the frames follow every change to the block
  // - one picture added, one dragged, one taken off, a type size changed.
  refreshStoryEditor(view, section, images, source, selectedPart, selectedImageIds);
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

export { showNotice };
