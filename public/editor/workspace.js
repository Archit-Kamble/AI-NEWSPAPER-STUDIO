// The workspace orchestrator.
//
// Layout, top to bottom:
//   Header (app chrome)  ·  Toolbar
//   Top workspace:  Canvas (left)  |  Inspector (right)
//   Bottom dock:    External Editor, full width
//
// The dock spans the entire width the way a terminal does under VS Code -
// composing a story is a horizontal job, so the editor gets the whole width and
// the canvas and Inspector stay visible above it.
//
// This is the only module that talks to the section API and the only one that
// subscribes to the store on behalf of the views. Views never import each other.

import { renderCanvas, refreshSection, refreshSelection } from "./canvas/canvas.js";
import { renderMiniMap, configure as configureCanvasView, applyTransform } from "./canvas/canvas-view.js";
import { zoomControlMarkup, bindZoomControl, syncZoomControl, pageIndicatorMarkup } from "./canvas/canvas-toolbar.js";
import { renderPageNavigator } from "./page-navigator.js";
import { renderLayoutSidebar } from "./layout-sidebar.js";
import { renderInspector, refreshInspectorReadouts, refreshInspectorSavedAt, configureInspector } from "./inspector.js";
import { renderStoryPicker } from "./story-picker.js";
import { renderToolbar, refreshHistoryButtons, refreshSaveIndicator, refreshToolbarSelection } from "./toolbar.js";
import {
  renderExternalEditor,
  refreshExternalEditor,
  refreshHistoryTab,
  showNotice,
  setActiveTab,
} from "./external-editor/external-editor.js";
import { applyStoredLayout, bindResizers, setEditorCollapsed, getSizes } from "./layout/resizer.js";
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
  history.configure(() => {
    refreshHistoryButtons(history.canUndo(), history.canRedo());
    refreshHistoryTab();
  });
  configureCanvasView(syncZoomControl);
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

  // Leaving a section with unsaved work must not lose it: the debounce timer is
  // never given the chance to expire after the draft has been swapped out.
  const leaving = state.selectedSectionKey;
  if (leaving && state.dirty) autosave.flush();

  const section = store.getSection(sectionKey);
  if (!section) return;

  const draft = draftFromSection(section);
  store.setSelectedSection(sectionKey, draft);
  history.reset(draft, `Opened ${sectionKey}`);

  refreshSelection(leaving, sectionKey, store.getCurrentPage()?.sections, draft);
  renderMiniMap(store.getCurrentPage(), state.newspaper, sectionKey);
  renderSidePanels();
  refreshToolbarSelection(true, store.getState().storyPickerOpen);
}

function patchDraft(patch, source) {
  const draft = store.getDraft();
  // Editing the article's words advances the lifecycle, unless an editor has
  // already made an explicit call or the text came from AI - neither should be
  // silently downgraded to "editing".
  const advances =
    draft && isContentEdit(patch) && !isExplicit(draft.status) && !draft.aiGenerated && draft.status !== "editing";

  store.updateDraft(advances ? { ...patch, status: "editing" } : patch, source);
  history.record(store.getDraft(), { label: describePatch(patch) });
  autosave.schedule();
}

function describePatch(patch) {
  const keys = Object.keys(patch).filter((k) => k !== "status");
  if (!keys.length) return "Edit";
  const labels = {
    headline: "Headline",
    subheading: "Subheadline",
    body: "Body",
    caption: "Caption",
    author: "Reporter",
    imageUrl: "Image",
    imageRotation: "Image rotation",
    imageZoom: "Image zoom",
    imageFit: "Image fit",
    imageFlipH: "Image flip",
    imageFlipV: "Image flip",
  };
  return labels[keys[0]] || `${keys[0]} changed`;
}

function chooseStory() {
  if (!store.getState().selectedSectionKey) return;
  store.setStoryPickerOpen(true);
}

function selectStoryForSection(story) {
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(draftFromStory(draft, story), "story-picker");
  history.record(store.getDraft(), { coalesce: false, label: `Linked "${story.title}"`, kind: "link" });
  autosave.schedule();
  store.setStoryPickerOpen(false);
}

function clearSection(sectionKey) {
  if (store.getState().selectedSectionKey !== sectionKey) selectSection(sectionKey);
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(
    { ...draft, newsItemId: null, headline: "", subheading: "", body: "", caption: "", imageUrl: "", aiGenerated: false, status: "empty" },
    "canvas",
  );
  history.record(store.getDraft(), { coalesce: false, label: "Cleared section", kind: "clear" });
  autosave.schedule();
}

function setSectionStatus(statusKey) {
  if (!store.getDraft()) return;
  patchDraft({ status: statusKey }, "canvas");
}

function onSectionAction(sectionKey, action) {
  if (action === "clear") return clearSection(sectionKey);

  selectSection(sectionKey);
  if (action === "story") return chooseStory();
  if (action === "image") return setActiveTab("images");
  if (action === "typography") return setActiveTab("typography");
  if (action === "mark-ready") return setSectionStatus("ready");
  if (action === "mark-review") return setSectionStatus("needs_review");
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

function jumpHistory(index) {
  const draft = history.jumpTo(index);
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
  history.reset(draft, "Reverted to saved");
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

  store.replacePage(await response.json());
  history.markSaved();
  return true;
}

function onAutosaveState(saveState, message) {
  store.setSaveState(saveState, message);
}

async function saveNow() {
  if (!store.getState().selectedSectionKey) return;
  await autosave.flush();
}

function scrollTo(elementId, notice) {
  document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (notice) showNotice(notice);
}

// Step 4 of the flow: the story is written, so hand off to the dock, where the
// image and the AI fit are done.
async function saveAndCompose() {
  await saveNow();
  setActiveTab("images");
  scrollTo("externalEditorPanel", "Saved. Compose the image and fit below.");
}

// Step 8: composition is done, so go back up to the page with the block filled.
async function saveAndReturn() {
  await saveNow();
  scrollTo("workspaceTop");
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
  store.replacePage(await response.json(), { structural: true });
  store.clearSelection();
  renderPageArea();
  renderSidePanels();
}

function toggleStoryPicker() {
  const state = store.getState();
  if (!state.selectedSectionKey) return;
  store.setStoryPickerOpen(!state.storyPickerOpen);
}

function toggleDock() {
  const shell = document.querySelector(".workspace-shell");
  if (!shell) return;
  setEditorCollapsed(shell, !getSizes().editorCollapsed);
  applyTransform();
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

      <div class="workspace-top" id="workspaceTop">
        <main class="workspace-canvas-host">
          <div class="canvas-toolbar">
            <div id="pageSwitcher" class="page-switcher"></div>
            <div class="canvas-toolbar-divider"></div>
            <div id="layouts" class="layout-switcher"></div>
            <div class="canvas-toolbar-spacer"></div>
            <div id="pageIndicator"></div>
            ${zoomControlMarkup()}
          </div>
          <div id="canvas" class="canvas-stage"></div>
        </main>
        <div class="splitter splitter-v" id="inspectorResizer" role="separator"
             aria-orientation="vertical" tabindex="0" title="Drag to resize the inspector"></div>
        <aside class="workspace-inspector" id="inspector"></aside>
      </div>

      <div class="splitter splitter-h" id="canvasResizer" role="separator"
           aria-orientation="horizontal" tabindex="0" title="Drag to resize the page area"></div>
      <section class="workspace-external-editor" id="externalEditorPanel"></section>

      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <aside class="workspace-sidebar-left" id="sidebarLeft">
        <div class="sidebar-drawer-header">
          <h3>Story Explorer</h3>
          <button class="sidebar-drawer-close" id="sidebarDrawerClose">&times;</button>
        </div>
        <div class="sidebar-panel" id="sidebarPanel"></div>
      </aside>
    </div>
    <div class="modal-root" id="modalRoot"></div>
  `;

  const shell = content.querySelector(".workspace-shell");
  applyStoredLayout(shell);
  bindResizers(shell);
  configureInspector({ onChooseStory: chooseStory });

  renderToolbar({
    newspaper: store.getState().newspaper,
    hasSelection: false,
    storyPickerOpen: false,
    handlers: { onSave: saveNow, onPublish: openPublish, onToggleStoryPicker: toggleStoryPicker, onUndo: undo, onRedo: redo },
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => store.setStoryPickerOpen(false));
  document.getElementById("sidebarDrawerClose").addEventListener("click", () => store.setStoryPickerOpen(false));

  bindZoomControl();
  renderPageArea();
  renderSidePanels();
  renderStoryPickerPanel();
  subscribeViews();

  // Fit mode is derived from the container, so it has to be recomputed whenever
  // the container changes size - a window resize or a splitter drag.
  window.addEventListener("resize", applyTransform);
  window.addEventListener("workspace-resized", applyTransform);
}

function renderPageArea() {
  const state = store.getState();
  const page = store.getCurrentPage();
  renderCanvas(page, state.newspaper, state, { onSelectSection: selectSection, onSectionAction });
  renderPageNavigator(state.pages, page, state.newspaper, selectPage);
  renderLayoutSidebar(page, applyTemplate);
  const indicator = document.getElementById("pageIndicator");
  if (indicator) indicator.innerHTML = pageIndicatorMarkup(page, state.pages);
  syncZoomControl();
}

function renderSidePanels() {
  const section = store.getSelectedSection();
  const view = currentView();
  const story = currentStory();

  const inspectorCallbacks = {
    onPatch: patchDraft,
    onChooseStory: chooseStory,
    onSave: saveAndCompose,
    onRevert: cancelEdits,
  };
  configureInspector(inspectorCallbacks);
  renderInspector(section, view, story, inspectorCallbacks);
  renderExternalEditor(section, view, story, store.getState().reporterNews, {
    onPatch: patchDraft,
    onChooseStory: chooseStory,
    onSave: saveAndReturn,
    onCancel: cancelEdits,
    onUndo: undo,
    onRedo: redo,
    onJumpHistory: jumpHistory,
    onToggleDock: toggleDock,
    getView: currentView,
    getSection: () => store.getSelectedSection(),
  });
}

function renderStoryPickerPanel() {
  const state = store.getState();
  renderStoryPicker(store.getCurrentPage(), state.reporterNews, state.selectedSectionKey, selectStoryForSection);
}

// ------------------------------------------------------------ subscriptions ---

function subscribeViews() {
  // Part 14: a keystroke repaints one canvas box and the read-only parts of the
  // side panels. Nothing else re-renders.
  store.subscribe(store.TOPICS.DRAFT, ({ source }) => {
    const section = store.getSelectedSection();
    const view = currentView();
    if (!section || !view) return;
    refreshSection(section, view, { selected: true, dirty: store.isDirty() });
    refreshInspectorReadouts(section, view, currentStory(), source);
    refreshExternalEditor(section, view, currentStory(), source);
  });

  store.subscribe(store.TOPICS.SAVE, () => {
    const { saveState, saveError, dirty } = store.getState();
    refreshSaveIndicator(saveState, dirty, saveError);
    const section = store.getSelectedSection();
    const view = currentView();
    if (section && view) refreshSection(section, view, { selected: true, dirty });
  });

  // A save returns the same layout with fresher rows. Only the things a save can
  // change are touched - never the panels the editor is working in.
  store.subscribe(store.TOPICS.PAGE_SYNC, () => {
    const state = store.getState();
    const page = store.getCurrentPage();
    renderPageNavigator(state.pages, page, state.newspaper, selectPage);
    renderMiniMap(page, state.newspaper, state.selectedSectionKey);
    const section = store.getSelectedSection();
    if (section) refreshInspectorSavedAt(section);
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
}
