import { renderStoryExplorerMarkup, bindStoryExplorer } from "./story-explorer.js";
import { formatDate } from "./format.js";

let activeTab = "editions";

async function fetchEditions() {
  return fetch("/api/newspapers").then((r) => r.json());
}

async function renderEditionsPanel(panel, newspaper, onSwitchEdition) {
  panel.innerHTML = `<p class="muted">Loading editions...</p>`;
  const editions = await fetchEditions();

  panel.innerHTML = editions
    .map(
      (edition) => `
        <button class="edition-item${newspaper && edition.id === newspaper.id ? " active" : ""}" data-edition-id="${edition.id}">
          <strong>${edition.name}</strong>
          <small>
            <span>${formatDate(edition.publication_date)}</span>
            <span class="status-pill ${edition.status}">${edition.status}</span>
          </small>
        </button>
      `,
    )
    .join("");

  panel.querySelectorAll(".edition-item").forEach((btn) => {
    btn.addEventListener("click", () => onSwitchEdition(Number(btn.dataset.editionId)));
  });
}

function renderExplorerPanel(panel, currentPage, reporterNews, selectedSectionKey, onSelectStory) {
  const section = currentPage?.sections?.find((s) => s.section_key === selectedSectionKey);

  panel.innerHTML = `
    ${!selectedSectionKey ? `<p class="muted">Select a section on the page to attach a story.</p>` : ""}
    ${renderStoryExplorerMarkup(reporterNews)}
  `;

  bindStoryExplorer(
    reporterNews,
    (story) => {
      if (!selectedSectionKey) {
        alert("Select a section on the page first.");
        return;
      }
      onSelectStory(story);
    },
    section?.news_item_id || null,
  );
}

export function renderSidebarLeft(newspaper, currentPage, reporterNews, selectedSectionKey, onSwitchEdition, onSelectStory) {
  const container = document.getElementById("sidebarLeft");
  if (!container) return;

  container.innerHTML = `
    <div class="sidebar-tabs">
      <button class="sidebar-tab${activeTab === "editions" ? " active" : ""}" data-tab="editions">Editions</button>
      <button class="sidebar-tab${activeTab === "explorer" ? " active" : ""}" data-tab="explorer">Story Explorer</button>
    </div>
    <div class="sidebar-panel" id="sidebarPanel"></div>
  `;

  container.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      renderSidebarLeft(newspaper, currentPage, reporterNews, selectedSectionKey, onSwitchEdition, onSelectStory);
    });
  });

  const panel = document.getElementById("sidebarPanel");
  if (activeTab === "editions") {
    renderEditionsPanel(panel, newspaper, onSwitchEdition);
  } else {
    renderExplorerPanel(panel, currentPage, reporterNews, selectedSectionKey, onSelectStory);
  }
}
