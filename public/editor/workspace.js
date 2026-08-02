import { renderCanvas } from "./canvas.js";
import { renderPageSidebar } from "./page-sidebar.js";
import { renderLayoutSidebar } from "./layout-sidebar.js";
import { renderSectionEditor } from "./section-editor.js";

// The single source of truth for editor state. Nothing outside this module
// mutates it directly - child modules receive data and callbacks as
// arguments and never read/write shared globals.
const state = {
  newspaper: null,
  pages: [],
  currentPage: null,
  reporterNews: [],
  selectedSection: null,
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

  render();
}

function selectPage(pageId) {
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return;
  state.currentPage = page;
  state.selectedSection = null;
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

function render() {
  const content = document.getElementById("content");

  if (!content) {
    console.error("content div not found");
    return;
  }

  content.innerHTML = `
    <div class="workspace">

        <div class="workspace-left">

            <div class="panel">

                <h2>Page Preview</h2>

                <div id="canvas">
                    Loading...
                </div>

            </div>

            <div class="panel">

                <h2>Section Editor</h2>

                <div id="editorBody">
                    Select a section
                </div>

            </div>

        </div>

        <div class="workspace-right">

            <div class="panel">

                <h3>Pages</h3>

                <div id="pages"></div>

            </div>

            <div class="panel">

                <h3>Layouts</h3>

                <div id="layouts"></div>

            </div>

        </div>

    </div>
    `;

  renderPageSidebar(state.pages, state.currentPage, selectPage);
  renderLayoutSidebar(state.currentPage, applyTemplate);
  renderCanvas(state.currentPage, state.newspaper, state.selectedSection, selectSection);
  renderSectionEditor(state.currentPage, state.selectedSection, state.reporterNews, saveSection);
}
