import { renderCanvas } from "./canvas.js";
import { renderPageNavigator } from "./page-navigator.js";
import { renderLayoutSidebar } from "./layout-sidebar.js";
import { renderInspector, applyStoryToInspector } from "./inspector.js";
import { renderStoryPicker } from "./story-picker.js";
import { renderToolbar } from "./toolbar.js";
import { showPublicationFiles } from "./publication.js";

// The single source of truth for editor state. Nothing outside this module
// mutates it directly - child modules receive data and callbacks as
// arguments and never read/write shared globals.
const state = {
  newspaper: null,
  pages: [],
  currentPage: null,
  reporterNews: [],
  selectedSection: null,
  storyPickerOpen: false,
  canvasZoom: "fit",
};

function pickPage(pages, current) {
  if (current) {
    const match = pages.find((page) => page.id === current.id);
    if (match) return match;
  }
  return pages[0] || null;
}

export async function renderWorkspace(newspaperId) {
  const [newspaper, pages, reporterNews] = await Promise.all([
    fetch(`/api/newspapers/${newspaperId}`).then((r) => r.json()),
    fetch(`/api/newspapers/${newspaperId}/pages`).then((r) => r.json()),
    fetch("/api/news").then((r) => r.json()),
  ]);

  state.newspaper = newspaper;
  state.pages = pages;
  state.reporterNews = reporterNews;
  state.currentPage = pickPage(pages, state.currentPage);
  state.selectedSection = null;
  state.storyPickerOpen = false;

  render();
}

function selectPage(pageId) {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return;
  state.currentPage = page;
  state.selectedSection = null;
  state.storyPickerOpen = false;
  render();
}

function selectSection(sectionKey) {
  state.selectedSection = sectionKey;
  render();
}

async function applyTemplate(templateKey) {
  const page = state.currentPage;
  if (!page) return;

  const response = await fetch(`/api/pages/${page.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: templateKey }),
  });
  const updatedPage = await response.json();

  state.pages = state.pages.map((p) => (p.id === updatedPage.id ? updatedPage : p));
  state.currentPage = updatedPage;
  render();
}

async function saveSection(sectionKey, payload) {
  const page = state.currentPage;
  if (!page) return false;

  const response = await fetch(`/api/pages/${page.id}/sections/${sectionKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return false;

  const updatedPage = await response.json();
  state.pages = state.pages.map((p) => (p.id === updatedPage.id ? updatedPage : p));
  state.currentPage = updatedPage;
  render();
  return true;
}

function applyStoryPickerVisibility() {
  document.getElementById("sidebarLeft")?.classList.toggle("open", state.storyPickerOpen);
  document.getElementById("sidebarBackdrop")?.classList.toggle("open", state.storyPickerOpen);
  document.getElementById("tbFromReporter")?.classList.toggle("active", state.storyPickerOpen);
}

function toggleStoryPicker() {
  if (!state.selectedSection) return;
  state.storyPickerOpen = !state.storyPickerOpen;
  applyStoryPickerVisibility();
}

function closeStoryPicker() {
  if (!state.storyPickerOpen) return;
  state.storyPickerOpen = false;
  applyStoryPickerVisibility();
}

function selectStoryForSection(story) {
  applyStoryToInspector(story);
  closeStoryPicker();
}

function triggerSave() {
  document.getElementById("saveSectionBtn")?.click();
}

function setZoom(mode) {
  state.canvasZoom = mode;
  document.getElementById("canvas")?.classList.toggle("zoom-full", mode === "full");
  document.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.zoom === mode);
  });
}

function renderZoomToggle() {
  const container = document.getElementById("zoomToggle");
  if (!container) return;
  container.innerHTML = `
    <button data-zoom="fit" class="zoom-btn${state.canvasZoom === "fit" ? " active" : ""}">Fit</button>
    <button data-zoom="full" class="zoom-btn${state.canvasZoom === "full" ? " active" : ""}">100%</button>
  `;
  container.querySelectorAll(".zoom-btn").forEach((btn) => {
    btn.addEventListener("click", () => setZoom(btn.dataset.zoom));
  });
}

function openPublish() {
  if (!state.newspaper) return;
  showPublicationFiles(state.newspaper.id);
}

function render() {
  const content = document.getElementById("content");

  if (!content) {
    console.error("content div not found");
    return;
  }

  content.innerHTML = `
    <div class="workspace-shell">
      <header class="workspace-toolbar" id="toolbar"></header>
      <div class="workspace-body">
        <div class="sidebar-backdrop${state.storyPickerOpen ? " open" : ""}" id="sidebarBackdrop"></div>
        <aside class="workspace-sidebar-left${state.storyPickerOpen ? " open" : ""}" id="sidebarLeft">
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
          <div id="canvas" class="canvas-scroll${state.canvasZoom === "full" ? " zoom-full" : ""}"></div>
        </main>
        <aside class="workspace-inspector" id="inspector"></aside>
      </div>
    </div>
    <div class="modal-root" id="modalRoot"></div>
  `;

  renderToolbar({
    newspaper: state.newspaper,
    hasSelection: Boolean(state.selectedSection),
    storyPickerOpen: state.storyPickerOpen,
    onSave: triggerSave,
    onPublish: openPublish,
    onToggleStoryPicker: toggleStoryPicker,
  });
  document.getElementById("sidebarBackdrop").addEventListener("click", closeStoryPicker);
  document.getElementById("sidebarDrawerClose").addEventListener("click", closeStoryPicker);
  renderStoryPicker(state.currentPage, state.reporterNews, state.selectedSection, selectStoryForSection);
  renderPageNavigator(state.pages, state.currentPage, state.newspaper, selectPage);
  renderLayoutSidebar(state.currentPage, applyTemplate);
  renderZoomToggle();
  renderCanvas(state.currentPage, state.newspaper, state.selectedSection, selectSection);
  renderInspector(state.currentPage, state.selectedSection, state.reporterNews, saveSection);
}
