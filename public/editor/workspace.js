// The workspace orchestrator.
//
// This is the only module that talks to the section API and the only one that
// subscribes to the store on behalf of the views. Views never import each other
// and never hold their own copy of a section - they are handed a view object and
// a callback, exactly as in the previous architecture, just now driven by
// store.js instead of a local `state` object (Phase 10).

import { renderCanvas, refreshSection, refreshSelection } from "./canvas/canvas.js";
import { renderPageNavigator } from "./page-navigator.js";
import { renderLayoutSidebar } from "./layout-sidebar.js";
import { renderInspector, refreshInspectorReadouts } from "./inspector.js";
import { renderStoryPicker } from "./story-picker.js";
import {
  renderToolbar,
  refreshHistoryButtons,
  refreshSaveIndicator,
  refreshToolbarSelection,
} from "./toolbar.js";
import { renderExternalEditor, refreshExternalEditor, showNotice } from "./external-editor/external-editor.js";
import { showPublicationFiles } from "./publication.js";
import * as store from "./store.js";
import * as history from "./history/history.js";
import * as autosave from "./autosave/autosave.js";
import { draftFromSection, draftFromStory, payloadFromDraft, viewOfSection } from "./section-model.js";
import { isContentEdit, isExplicit } from "./status/section-status.js";

export async function renderWorkspace(newspaperId) {
  const [newspaper, pages, reporterNews] = await Promise.all([
    fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json()),
    fetch(`/api/newspapers/${newspaperId}/pages`).then((r) => r.json()),
    fetch("/api/news").then((r) => r.json()),
  ]);

  store.setEdition({ newspaper, pages, reporterNews });
  autosave.configure({ save: persistDraft, onStateChange: onAutosaveState });
  history.configure(() => refreshHistoryButtons(history.canUndo(), history.canRedo()));
  renderShell();
}

// ------------------------------------------------------------ derived data ---

function currentView() {
  const section = store.getSelectedSection();
  const draft = store.getDraft();
  if (!section || !draft) return null;
  return { ...viewOfSection(section, draft, store.getState().selectedSectionKey), sectionKey: section.section_key };
}

function currentStory() {
  return store.findStory(store.getDraft()?.newsItemId);
}

// ----------------------------------------------------------------- actions ---

function selectSection(sectionKey) {
  const state = store.getState();
  if (state.selectedSectionKey === sectionKey) return;

  // Leaving a section with unsaved work must not lose it - the debounce timer
  // is not given the chance to expire after the draft has been swapped out.
  const leaving = state.selectedSectionKey;
  if (leaving && state.dirty) autosave.flush();

  const section = store.getSection(sectionKey);
  if (!section) return;

  const draft = draftFromSection(section);
  store.setSelectedSection(sectionKey, draft);
  history.reset(draft);

  refreshSelection(leaving, sectionKey);
  renderSidePanels();
  refreshToolbarSelection(true, store.getState().storyPickerOpen);
}

function patchDraft(patch, source) {
  const draft = store.getDraft();
  // Editing the article's words advances the lifecycle, unless an editor has
  // already made an explicit call (needs review / ready / published) or the text
  // came from AI - neither should be silently downgraded to "editing".
  const advances =
    draft &&
    isContentEdit(patch) &&
    !isExplicit(draft.status) &&
    !draft.aiGenerated &&
    draft.status !== "editing";

  store.updateDraft(advances ? { ...patch, status: "editing" } : patch, source);
  history.record(store.getDraft());
  autosave.schedule();
}

function chooseStory() {
  if (!store.getState().selectedSectionKey) return;
  store.setStoryPickerOpen(true);
}

function selectStoryForSection(story) {
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(draftFromStory(draft, story), "story-picker");
  history.record(store.getDraft(), { coalesce: false });
  autosave.schedule();
  store.setStoryPickerOpen(false);
}

function clearSection(sectionKey) {
  if (store.getState().selectedSectionKey !== sectionKey) selectSection(sectionKey);
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(
    {
      ...draft,
      newsItemId: null,
      headline: "",
      subheading: "",
      body: "",
      caption: "",
      imageUrl: "",
      aiGenerated: false,
      status: "empty",
    },
    "canvas",
  );
  history.record(store.getDraft(), { coalesce: false });
  autosave.schedule();
}

function onSectionAction(sectionKey, action) {
  if (action === "story") {
    selectSection(sectionKey);
    chooseStory();
    return;
  }
  if (action === "clear") clearSection(sectionKey);
}

function undo() {
  const draft = history.undo();
  if (!draft) return;
  store.replaceDraft(draft, "history");
  autosave.schedule();
}

function redo() {
  const draft = history.redo();
  if (!draft) return;
  store.replaceDraft(draft, "history");
  autosave.schedule();
}

function cancelEdits() {
  const section = store.getSelectedSection();
  if (!section) return;
  const draft = draftFromSection(section);
  store.replaceDraft(draft, "cancel");
  store.setSaveState("idle");
  history.reset(draft);
  autosave.cancel();
  showNotice("Reverted to the last saved version.");
}

// ------------------------------------------------------------------- save ---

async function persistDraft() {
  const state = store.getState();
  const page = store.getCurrentPage();
  const draft = store.getDraft();
  if (!page || !draft || !state.selectedSectionKey) return true;

  const response = await fetch(`/api/pages/${page.id}/sections/${state.selectedSectionKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadFromDraft(draft)),
  });
  if (!response.ok) return false;

  const updatedPage = await response.json();
  store.replacePage(updatedPage);
  return true;
}

function onAutosaveState(saveState, message) {
  store.setSaveState(saveState, message);
}

async function saveNow() {
  if (!store.getState().selectedSectionKey) return;
  await autosave.flush();
}

// ------------------------------------------------------------- page/layout ---

function selectPage(pageId) {
  if (store.getState().dirty) autosave.flush();
  store.setCurrentPage(pageId);
}

async function applyTemplate(templateKey) {
  const page = store.getCurrentPage();
  if (!page) return;
  if (store.getState().dirty) await autosave.flush();

  const response = await fetch(`/api/pages/${page.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: templateKey }),
  });
  const updatedPage = await response.json();
  store.replacePage(updatedPage);
  store.clearSelection();
  renderPageArea();
  renderSidePanels();
}

function toggleStoryPicker() {
  const state = store.getState();
  if (!state.selectedSectionKey) return;
  store.setStoryPickerOpen(!state.storyPickerOpen);
}

function openPublish() {
  const { newspaper } = store.getState();
  if (newspaper) showPublicationFiles(newspaper.id);
}

// --------------------------------------------------------------- rendering ---

function renderShell() {
  const content = document.getElementById("content");
  if (!content) return;

  content.innerHTML = `
    <div class="workspace-shell">
      <header class="workspace-toolbar" id="toolbar"></header>
      <div class="workspace-body">
        <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
        <aside class="workspace-sidebar-left" id="sidebarLeft">
          <div class="sidebar-drawer-header">
            <h3>Story Explorer</h3>
            <button class="sidebar-drawer-close" id="sidebarDrawerClose">&times;</button>
          </div>
          <div class="sidebar-panel" id="sidebarPanel"></div>
        </aside>
        <main class="workspace-canvas-host">
          <div class="canvas-toolbar">
            <div id="pageSwitcher" class="page-switcher"></div>
            <div class="canvas-toolbar-divider"></div>
            <div id="layouts" class="layout-switcher"></div>
            <div class="canvas-toolbar-spacer"></div>
            <div id="zoomToggle" class="zoom-toggle"></div>
          </div>
          <div id="canvas" class="canvas-scroll"></div>
        </main>
        <div class="workspace-right">
          <aside class="workspace-inspector" id="inspector"></aside>
          <aside class="workspace-external-editor" id="externalEditorPanel"></aside>
        </div>
      </div>
    </div>
    <div class="modal-root" id="modalRoot"></div>
  `;

  renderToolbar({
    newspaper: store.getState().newspaper,
    hasSelection: false,
    storyPickerOpen: false,
    handlers: { onSave: saveNow, onPublish: openPublish, onToggleStoryPicker: toggleStoryPicker, onUndo: undo, onRedo: redo },
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => store.setStoryPickerOpen(false));
  document.getElementById("sidebarDrawerClose").addEventListener("click", () => store.setStoryPickerOpen(false));

  renderZoomToggle();
  renderPageArea();
  renderSidePanels();
  renderStoryPickerPanel();
  subscribeViews();
}

function renderPageArea() {
  const state = store.getState();
  const page = store.getCurrentPage();
  renderCanvas(page, state.newspaper, state, { onSelectSection: selectSection, onSectionAction });
  renderPageNavigator(state.pages, page, state.newspaper, selectPage);
  renderLayoutSidebar(page, applyTemplate);
  applyZoomClass();
}

function renderSidePanels() {
  const section = store.getSelectedSection();
  const view = currentView();
  const story = currentStory();

  renderInspector(section, view, story, patchDraft);
  renderExternalEditor(section, view, story, store.getState().reporterNews, {
    onPatch: patchDraft,
    onChooseStory: chooseStory,
    onSave: saveNow,
    onCancel: cancelEdits,
    getView: currentView,
  });
}

function renderStoryPickerPanel() {
  const state = store.getState();
  renderStoryPicker(store.getCurrentPage(), state.reporterNews, state.selectedSectionKey, selectStoryForSection);
}

function renderZoomToggle() {
  const container = document.getElementById("zoomToggle");
  if (!container) return;
  const { canvasZoom } = store.getState();
  container.innerHTML = `
    <button data-zoom="fit" class="zoom-btn${canvasZoom === "fit" ? " active" : ""}">Fit</button>
    <button data-zoom="full" class="zoom-btn${canvasZoom === "full" ? " active" : ""}">100%</button>
  `;
  container.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => store.setZoom(btn.dataset.zoom));
  });
}

function applyZoomClass() {
  const { canvasZoom } = store.getState();
  document.getElementById("canvas")?.classList.toggle("zoom-full", canvasZoom === "full");
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zoom === canvasZoom);
  });
}

// ------------------------------------------------------------ subscriptions ---

function subscribeViews() {
  // Phase 3 + 11: a keystroke repaints one canvas box and the read-only parts
  // of the two side panels. Nothing else re-renders.
  store.subscribe(store.TOPICS.DRAFT, ({ source }) => {
    const section = store.getSelectedSection();
    const view = currentView();
    if (!section || !view) return;
    refreshSection(section, view, { selected: true, dirty: store.isDirty() });
    refreshInspectorReadouts(section, view, currentStory(), source);
    refreshExternalEditor(view, currentStory(), source);
  });

  store.subscribe(store.TOPICS.SAVE, () => {
    const { saveState, saveError, dirty } = store.getState();
    refreshSaveIndicator(saveState, dirty, saveError);
    const section = store.getSelectedSection();
    const view = currentView();
    if (section && view) refreshSection(section, view, { selected: true, dirty });
  });

  store.subscribe(store.TOPICS.PAGE, () => {
    renderPageArea();
    renderSidePanels();
    renderStoryPickerPanel();
    refreshToolbarSelection(Boolean(store.getState().selectedSectionKey), false);
  });

  store.subscribe(store.TOPICS.STORY_PICKER, () => {
    const open = store.getState().storyPickerOpen;
    document.getElementById("sidebarLeft")?.classList.toggle("open", open);
    document.getElementById("sidebarBackdrop")?.classList.toggle("open", open);
    document.getElementById("tbFromReporter")?.classList.toggle("active", open);
  });

  store.subscribe(store.TOPICS.ZOOM, applyZoomClass);
}
