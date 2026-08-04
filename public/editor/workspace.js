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
import { loadGeometry, findFreeRect, getGeometry } from "./canvas/grid.js";
import { loadIdentity } from "./canvas/masthead.js";
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
  focusGroup,
  scaleComposeCanvas,
} from "./external-editor/external-editor.js";
import { applyStoredLayout, bindResizers, setEditorCollapsed, getSizes } from "./layout/resizer.js";
import { showPublicationFiles } from "./publication.js";
import { loadAiStatus, getAiTier } from "./external-editor/ai-panel.js";
import { renderWorklist } from "./worklist-panel.js";
import * as store from "./store.js";
import * as history from "./history/history.js";
import * as autosave from "./autosave/autosave.js";
import { draftFromSection, draftFromStory, payloadFromDraft, viewOfSection } from "./section-model.js";
import { isContentEdit, isExplicit } from "./status/section-status.js";
import { buildFlowMap, flowImageFromRow } from "./layout/text-flow.js";

export async function renderWorkspace(newspaperId) {
  const [newspaper, pages, reporterNews] = await Promise.all([
    fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json()),
    fetch(`/api/newspapers/${newspaperId}/pages`).then((r) => r.json()),
    fetch("/api/news").then((r) => r.json()),
    // The column grid and the px-per-mm scale come from the server; nothing is
    // laid out until they are known.
    loadGeometry(),
  ]);

  // The paper's standing furniture, and this edition's volume and issue number
  // worked out from its date. Fetched before the first paint so page one is
  // drawn complete rather than popping its nameplate in a moment later.
  await loadIdentity(newspaper?.publication_date, pages?.length);

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

// ------------------------------------------------------- pictures in a block ---
//
// A block can hold several pictures, placed where the designer wants them. That
// placement is layout data: it decides which cells of the character grid are
// occupied, and therefore how much copy the AI is asked for.

let sectionImages = [];

async function loadSectionImages() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) {
    sectionImages = [];
    return;
  }
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`);
  sectionImages = response.ok ? await response.json() : [];
  redrawCompose();
}

function redrawCompose() {
  const section = store.getSelectedSection();
  const view = currentView();
  if (section && view) refreshExternalEditor(section, view, currentStory(), "images");
}

async function addSectionImage(file) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;

  const form = new FormData();
  form.append("images", file);
  const uploaded = await fetch("/api/uploads/images", { method: "POST", body: form }).then((r) => r.json());
  const url = uploaded?.imageUrls?.[0];
  if (!url) return showNotice("The picture could not be uploaded.");

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, filename: file.name, mimeType: file.type }),
  });
  if (!response.ok) return showNotice("The picture could not be placed.");

  sectionImages = await response.json();
  redrawCompose();
  showNotice("Picture placed. Drag it where the story wants it.");
}

async function patchSectionImage(imageId, patch) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;

  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
  );
  if (!response.ok) return showNotice("The picture could not be moved.");
  sectionImages = await response.json();
  redrawCompose();
}

// Background removal runs on our own BiRefNet service - see
// src/services/backgroundRemoval.service.js for why not remove.bg or @imgly.
// The returned cut-out becomes the picture, and its alpha mask feeds the
// character grid so copy wraps the subject rather than its box.
async function removeImageBackground(imageId) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;

  showNotice("Removing the background…");
  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}/cutout`,
    { method: "POST" },
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return showNotice(result.error || "Background removal is not available.");
  }
  sectionImages = result;
  redrawCompose();
  showNotice("Background removed. Copy now wraps the subject.");
}

async function removeSectionImage(imageId) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;
  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}`,
    { method: "DELETE" },
  );
  if (!response.ok) return;
  sectionImages = await response.json();
  redrawCompose();
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
  loadSectionImages();
  syncRemoveBlockButton();
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

async function selectStoryForSection(story) {
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(draftFromStory(draft, story), "story-picker");
  history.record(store.getDraft(), { coalesce: false, label: `Linked "${story.title}"`, kind: "link" });
  autosave.schedule();
  store.setStoryPickerOpen(false);

  // A reporter files pictures with the story. Taking the story has to bring
  // them into the editor - otherwise the desk has to hunt down and re-upload
  // photographs the newsroom already has.
  await placeStoryImages(story);
}

async function placeStoryImages(story) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  const urls = Array.isArray(story?.image_urls) ? story.image_urls.filter(Boolean) : [];
  if (!page || !key || !urls.length) return;

  const already = new Set(sectionImages.map((image) => image.url));
  const fresh = urls.filter((url) => !already.has(url));
  if (!fresh.length) return;

  for (const url of fresh) {
    const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: url.split("/").pop() }),
    });
    if (response.ok) sectionImages = await response.json();
  }
  redrawCompose();
  showNotice(
    fresh.length === 1
      ? "The reporter's picture is on the block. Drag it where you want it."
      : `${fresh.length} of the reporter's pictures are on the block.`,
  );
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
  if (action === "add-block") return addBlock();
  if (action === "delete-block") return deleteBlock(sectionKey);

  selectSection(sectionKey);
  if (action === "story") return chooseStory();
  if (action === "image") return focusGroup("image");
  if (action === "mark-ready") return setSectionStatus("ready");
  if (action === "mark-review") return setSectionStatus("needs_review");
}

// ------------------------------------------------------------ page layout ---
//
// A page is no longer whatever its template declared. An editor adds the blocks
// the day's file needs - a dense inside page runs to fifteen or twenty - and
// drags them onto the column grid.

async function addBlock() {
  const page = store.getCurrentPage();
  const geometry = getGeometry();
  if (!page || !geometry) return;
  if (store.getState().dirty) await autosave.flush();

  // A new block defaults to two columns and roughly a quarter page, dropped in
  // the first free space so it never lands on top of finished work.
  const width = Math.round(geometry.columnPx * 2 + geometry.gutterPx);
  const height = geometry.baselinePx * 24;
  const rect = findFreeRect(page.sections || [], width, height);

  const response = await fetch(`/api/pages/${page.id}/sections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rect),
  });
  if (!response.ok) return showNotice("Could not add the block.");

  const updated = await response.json();
  store.replacePage(updated, { structural: true });
  const added = updated.sections[updated.sections.length - 1];
  renderPageArea();
  if (added) selectSection(added.section_key);
  showNotice("Block added. Drag it where the page needs it.");
}

async function deleteBlock(sectionKey) {
  const page = store.getCurrentPage();
  const section = store.getSection(sectionKey);
  if (!page || !section) return;

  const filled = section.headline || section.body || section.image_url || section.news_item_id;
  if (filled && !window.confirm(`Delete "${sectionKey}"? Its story and image go with it.`)) return;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(sectionKey)}`, {
    method: "DELETE",
  });
  if (!response.ok) return showNotice("Could not delete the block.");

  autosave.cancel();
  store.clearSelection();
  store.replacePage(await response.json(), { structural: true });
  renderPageArea();
  renderSidePanels();
  showNotice(`Deleted ${sectionKey}.`);
}

// Committed once, when a drag ends - not on every frame.
async function moveSection(sectionKey, rect) {
  const page = store.getCurrentPage();
  if (!page) return;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(sectionKey)}/geometry`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rect),
  });
  if (!response.ok) return showNotice("Could not move the block.");

  // Structural: the block's rectangle changed, so the canvas and every
  // measurement derived from it have to be redrawn.
  store.replacePage(await response.json(), { structural: true });
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

// Step 4 of the flow (VISION.md: "Save -> Automatically open External Editor"):
// the story is written, so the dock opens by itself at step 1, the image.
async function saveAndCompose() {
  await saveNow();
  if (getSizes().editorCollapsed) {
    setEditorCollapsed(document.querySelector(".workspace-shell"), false);
  }
  scrollTo("externalEditorPanel", "Saved. Compose the image and fit below.");
  focusGroup("image");
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
            <button type="button" class="layout-btn" id="addBlockBtn" title="Add a block to this page">+ Block</button>
            <button type="button" class="layout-btn danger" id="removeBlockBtn" title="Remove the selected block">− Block</button>
            <div class="canvas-toolbar-spacer"></div>
            <button type="button" class="layout-btn" id="worklistBtn"
                    title="Every block on this edition that is not finished, and how much copy each one holds">What's left</button>
            <button type="button" class="layout-btn" id="fitBtn"
                    title="Set the selected block a notch tighter so its copy fits">Make it fit</button>
            <button type="button" class="layout-btn" id="carryOverBtn"
                    title="Carry what does not fit onto a later page, with a jump line">Carry over</button>
            <button type="button" class="layout-btn" id="fillFeaturesBtn"
                    title="Fill राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष and सुविचार for this edition's date">Fill features</button>
            <button type="button" class="layout-btn" id="printViewBtn"
                    title="See the page as it prints - no block chrome, no grid">Print view</button>
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
    handlers: { onSave: saveNow, onPublish: openPublish, onToggleStoryPicker: toggleStoryPicker, onUndo: undo, onRedo: redo,
      onPreflight: runPreflight, onPressFile: downloadPressFile },
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => store.setStoryPickerOpen(false));
  document.getElementById("sidebarDrawerClose").addEventListener("click", () => store.setStoryPickerOpen(false));

  document.getElementById("addBlockBtn").addEventListener("click", addBlock);
  document.getElementById("removeBlockBtn").addEventListener("click", () => {
    const key = store.getState().selectedSectionKey;
    if (!key) return showNotice("Select a block on the page first.");
    deleteBlock(key);
  });

  // Print view. Not a mode with its own screen and not a tab - one toggle that
  // takes the editing chrome off the page the editor is already looking at, so
  // the desk can see what will come off the press without leaving the
  // workspace (VISION.md: everything happens on the one screen).
  document.getElementById("printViewBtn").addEventListener("click", (event) => {
    const on = document.body.classList.toggle("print-view");
    event.currentTarget.classList.toggle("active", on);
    event.currentTarget.textContent = on ? "Editing view" : "Print view";
  });

  // The day's standing features. One press fills every block the layout marked
  // as one - the horoscope, the almanac box, दिनविशेष, the thought for the day -
  // for this edition's own date. What lands in them is ordinary copy the desk
  // can rewrite (VISION.md: AI assists, never owns).
  document.getElementById("fillFeaturesBtn").addEventListener("click", fillFeatures);

  // Jump lines. The character grid already knows exactly how much of the story
  // will not fit; this turns that measurement into the move a sub-editor
  // actually makes - put what fits here, the rest on a later page, and set both
  // lines. One press, and it says where the story went.
  document.getElementById("carryOverBtn").addEventListener("click", carryOver);

  // What is left. The whole edition's unfinished work on one list, each block
  // with the number of characters it holds - which is the number a sub-editor
  // needs BEFORE writing, not after the copy has already run over.
  document.getElementById("worklistBtn").addEventListener("click", showWorklist);

  // Making a story fit. The third of the three moves a sub-editor has, beside
  // cutting and carrying over: set it a notch tighter. The software knows every
  // number involved, so it can find the smallest change that works - and say so
  // before it does it.
  document.getElementById("fitBtn").addEventListener("click", makeItFit);

  bindZoomControl();
  // Who writes this paper's copy is configuration, so the editor asks rather
  // than assuming - the AI panel's menu then describes the real newsroom.
  loadAiStatus();
  renderPageArea();
  renderSidePanels();
  renderStoryPickerPanel();
  subscribeViews();
  selectFirstSection();

  // Fit mode is derived from the container, so it has to be recomputed whenever
  // the container changes size - a window resize or a splitter drag.
  window.addEventListener("resize", onWorkspaceResized);
  window.addEventListener("workspace-resized", onWorkspaceResized);
}

// Both the page canvas and the live preview are scaled to their containers, so
// both have to be re-fitted whenever those containers change size.
function onWorkspaceResized() {
  applyTransform();
  scaleComposeCanvas();
}

// Preflight, and passing a page for press.
//
// The checks a print shop runs before the plate: pictures with the resolution
// for the size they are used at, copy that fits, nothing outside the matter,
// nothing overlapping, no jump that leads nowhere. Findings are listed against
// the block they are on, and clicking one opens that block - the point is to
// fix it, not to read a report.
async function runPreflight() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Checking the edition…");
  const report = await fetch(`/api/newspapers/${newspaper.id}/preflight`).then((r) => r.json());
  if (report.error) return showNotice(report.error);

  renderPreflight(report);
  showNotice(
    report.passed
      ? `Preflight clean. ${report.counts.warning} warning${report.counts.warning === 1 ? "" : "s"} to look at.`
      : `${report.counts.error} error${report.counts.error === 1 ? "" : "s"} must be fixed before this goes to press.`,
  );
}

function renderPreflight(report) {
  document.getElementById("preflightPanel")?.remove();
  if (!report.findings.length) return;

  const order = { error: 0, warning: 1, note: 2 };
  const rows = [...report.findings]
    .sort((a, b) => order[a.level] - order[b.level] || a.pageNumber - b.pageNumber)
    .map(
      (finding) => `
        <li class="preflight-row preflight-${finding.level}"
            data-page="${finding.pageNumber}" data-section="${escapeAttribute(finding.sectionKey)}">
          <span class="preflight-where">p${finding.pageNumber} · ${escapeAttribute(finding.sectionKey)}</span>
          <span class="preflight-what">${escapeAttribute(finding.message)}</span>
        </li>`,
    )
    .join("");

  const panel = document.createElement("aside");
  panel.id = "preflightPanel";
  panel.className = "preflight-panel";
  panel.innerHTML = `
    <header>
      <strong>Preflight — ${report.passed ? "clean" : `${report.counts.error} to fix`}</strong>
      <button type="button" id="preflightClose" aria-label="Close">×</button>
    </header>
    <ul>${rows}</ul>`;
  document.body.appendChild(panel);

  document.getElementById("preflightClose").addEventListener("click", () => panel.remove());
  panel.querySelectorAll(".preflight-row").forEach((row) => {
    row.addEventListener("click", () => {
      const page = store.getState().pages.find((p) => Number(p.page_number) === Number(row.dataset.page));
      if (page) store.setCurrentPage(page.id);
      const key = row.dataset.section.split(" / ")[0];
      if (store.getSection(key)) selectSection(key);
    });
  });
}

const escapeAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// What is left on this edition.
async function showWorklist() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  // Whatever is being typed counts as work done, so it is saved before the
  // edition is measured - otherwise the list reports the block the desk is
  // looking at as empty.
  if (store.getState().dirty) await autosave.flush();

  const list = await fetch(`/api/newspapers/${newspaper.id}/worklist`).then((r) => r.json());
  if (list.error) return showNotice(list.error);

  renderWorklist(list, {
    onGoTo: (pageNumber, sectionKey) => {
      const page = store.getState().pages.find((p) => Number(p.page_number) === Number(pageNumber));
      if (page) store.setCurrentPage(page.id);
      if (store.getSection(sectionKey)) selectSection(sectionKey);
    },
  });
}

// Make the selected block's copy fit.
//
// It asks first and applies second, in two presses, because changing the type
// size of a block is a design decision: the desk sees exactly what the change
// would be, and can carry the story over or cut it instead.
async function makeItFit() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block that will not fit first.");

  await saveNow();
  const path = `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/fit`;
  const proposal = await fetch(path).then((r) => r.json()).catch(() => ({}));

  if (proposal.error) return showNotice(proposal.error);
  // Already fits, or nothing legible would make it fit - either way there is
  // nothing to apply, and the message says which.
  if (!proposal.fits || proposal.to === undefined) return showNotice(proposal.message);

  if (!window.confirm(`${proposal.message}\n\nApply it?`)) return;

  const applied = await fetch(path, { method: "POST" }).then((r) => r.json()).catch(() => ({}));
  if (applied.error) return showNotice(applied.error);

  const pages = await fetch(`/api/newspapers/${store.getState().newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((updated) => store.replacePage(updated, { structural: true }));
  showNotice(applied.message);
}

// The press file. Scribus opens it, the designer adjusts, and the CMYK PDF
// comes out of Scribus - the pipeline CLAUDE.md describes.
async function downloadPressFile() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Generating the press package…");
  // The package, not the bare .sla: a Scribus document alone points at pictures
  // by path, and those paths mean nothing on the machine that opens it.
  const response = await fetch(`/api/newspapers/${newspaper.id}/press-package`);
  if (!response.ok) return showNotice("The press package could not be generated.");

  const pictures = response.headers.get("X-Pictures-Included") || "0";
  const missing = Number(response.headers.get("X-Pictures-Missing") || 0);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `sahas-${String(newspaper.publication_date).slice(0, 10)}-press.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showNotice(
    `Press package downloaded — the document and ${pictures} photograph${pictures === "1" ? "" : "s"}.` +
      (missing ? ` ${missing} picture file${missing === 1 ? "" : "s"} could not be found on the server.` : "") +
      " Unzip it and open the .sla in Scribus.",
  );
}

async function carryOver() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block that will not fit first.");

  await saveNow();
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/carry-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "This story could not be carried over.");

  const pages = await fetch(`/api/newspapers/${store.getState().newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((updated) => store.replacePage(updated, { structural: true }));
  showNotice(`Carried on to page ${result.to.pageNumber}, block "${result.to.sectionKey}". ${result.carryLine}`);
}

async function fillFeatures() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Filling today's features…");
  // The effort tier chosen in the AI panel rides along, so "Fill features" and
  // the per-block actions obey the same dial.
  const response = await fetch(`/api/newspapers/${newspaper.id}/features`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: getAiTier() }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "The features could not be filled.");

  // Reload the pages so the filled blocks appear, then say plainly what did and
  // did not run. A box that could not be filled is reported, never left looking
  // finished.
  const pages = await fetch(`/api/newspapers/${newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((page) => store.replacePage(page, { structural: true }));

  const filled = result.filled?.length || 0;
  const blocked = result.notes?.length || 0;
  showNotice(
    filled
      ? `Filled ${filled} feature${filled === 1 ? "" : "s"}${blocked ? `. ${result.notes[result.notes.length - 1]}` : "."}`
      : result.notes?.[result.notes.length - 1] || "Nothing to fill.",
  );
}

// A page with no block selected leaves the Inspector and the dock empty, which
// reads as "nothing here". Opening a page opens its first block, so there is
// always something loaded to work on (VISION.md: the software guides the flow).
function selectFirstSection() {
  const page = store.getCurrentPage();
  const first = page?.sections?.[0];
  if (!first) return;
  if (store.getState().selectedSectionKey) return;
  selectSection(first.section_key);
}

function syncRemoveBlockButton() {
  const button = document.getElementById("removeBlockBtn");
  if (button) button.disabled = !store.getState().selectedSectionKey;
}

function renderPageArea() {
  const state = store.getState();
  const page = store.getCurrentPage();
  renderCanvas(page, state.newspaper, state, { onSelectSection: selectSection, onSectionAction, onMoveSection: moveSection });
  renderPageNavigator(state.pages, page, state.newspaper, selectPage);
  renderLayoutSidebar(page, applyTemplate);
  const indicator = document.getElementById("pageIndicator");
  if (indicator) indicator.innerHTML = pageIndicatorMarkup(page, state.pages);
  syncZoomControl();
  syncRemoveBlockButton();
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
    getImages: () => sectionImages,
    // The story editor shows the block's real character budget under the box.
    getBudget: () => {
      const section = store.getSelectedSection();
      const view = currentView();
      if (!section || !view) return 0;
      // The same character grid the Space panel and preflight use - never a
      // second measurement that could quietly disagree with them.
      return buildFlowMap(section, view, sectionImages.map(flowImageFromRow)).bodyCharBudget;
    },
    // The small layout in the dock needs the whole page, not just this block.
    getPage: () => store.getCurrentPage(),
    getNewspaper: () => store.getState().newspaper,
    onSelectSection: selectSection,
    onAddImage: addSectionImage,
    onPatchImage: patchSectionImage,
    onRemoveImage: removeSectionImage,
    onRemoveBackground: removeImageBackground,
    onPickBlock: () => {
      selectFirstSection();
      scrollTo("workspaceTop");
    },
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
    // The layout picker guards against overwriting filled blocks, so it has to
    // see the blocks a save just filled - otherwise the guard is stale from the
    // moment the first block is written.
    renderLayoutSidebar(page, applyTemplate);
    const section = store.getSelectedSection();
    if (section) refreshInspectorSavedAt(section);
  });

  store.subscribe(store.TOPICS.PAGE, () => {
    renderPageArea();
    renderSidePanels();
    renderStoryPickerPanel();
    refreshToolbarSelection(Boolean(store.getState().selectedSectionKey), false);
    selectFirstSection();
  });

  store.subscribe(store.TOPICS.STORY_PICKER, () => {
    const open = store.getState().storyPickerOpen;
    document.getElementById("sidebarLeft")?.classList.toggle("open", open);
    document.getElementById("sidebarBackdrop")?.classList.toggle("open", open);
    document.getElementById("tbFromReporter")?.classList.toggle("active", open);
  });
}
