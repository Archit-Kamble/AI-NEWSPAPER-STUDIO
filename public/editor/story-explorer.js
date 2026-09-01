import { emptyStateMarkup } from "../ui/empty.js";
import { formatDate, escapeHtml } from "./format.js";

function uniqueValues(items, key) {
  return [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
}

function optionList(values) {
  return values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

export function renderStoryExplorerMarkup(reporterNews) {
  return `
    <div class="story-explorer">
      <label>Attach a reporter story</label>
      <input id="storySearch" type="text" placeholder="Search by title..." />
      <div class="story-explorer-filters">
        <select id="storyFilterReporter"><option value="">All reporters</option>${optionList(uniqueValues(reporterNews, "reporter_name"))}</select>
        <select id="storyFilterCategory"><option value="">All categories</option>${optionList(uniqueValues(reporterNews, "category"))}</select>
        <select id="storyFilterLocation"><option value="">All locations</option>${optionList(uniqueValues(reporterNews, "location"))}</select>
        <select id="storyFilterStatus"><option value="">All statuses</option>${optionList(uniqueValues(reporterNews, "status"))}</select>
      </div>
      <div id="storyExplorerResults" class="story-explorer-results"></div>
    </div>
  `;
}

function matchesFilters(story, filters) {
  const title = (story.title || "").toLowerCase();
  if (filters.search && !title.includes(filters.search)) return false;
  if (filters.reporter && story.reporter_name !== filters.reporter) return false;
  if (filters.category && story.category !== filters.category) return false;
  if (filters.location && story.location !== filters.location) return false;
  if (filters.status && story.status !== filters.status) return false;
  return true;
}

function renderCards(reporterNews, filters, selectedId, onSelectCard) {
  const results = document.getElementById("storyExplorerResults");
  if (!results) return;

  const matches = reporterNews.filter((story) => matchesFilters(story, filters));

  if (!matches.length) {
    results.innerHTML = emptyStateMarkup({
      title: 'No filed story matches these filters.',
      body: 'Widen the search, or clear the status and category filters above.',
    });
    return;
  }

  results.innerHTML = matches
    .map((story) => {
      const thumb = story.image_urls?.[0];
      // Most of this archive's uploads no longer exist on disk, so a thumbnail
      // that fails to load falls back to the empty style instead of showing a
      // broken-image glyph. The 1x1 transparent GIF keeps the box its size.
      const onError =
        "this.classList.add('story-card-thumb-empty');" +
        "this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';" +
        "this.onerror=null";
      return `
        <div class="story-card${story.id === selectedId ? " active" : ""}" data-story-id="${story.id}">
          ${thumb ? `<img class="story-card-thumb" src="${escapeHtml(thumb)}" alt="" onerror="${onError}" />` : `<div class="story-card-thumb story-card-thumb-empty"></div>`}
          <div class="story-card-body">
            <strong>${escapeHtml(story.title)}</strong>
            <small>${escapeHtml(story.reporter_name || "Unknown reporter")} &middot; ${escapeHtml(story.category || "Uncategorised")}</small>
            <small class="muted">${formatDate(story.created_at)}</small>
          </div>
        </div>
      `;
    })
    .join("");

  results.querySelectorAll(".story-card").forEach((card) => {
    card.addEventListener("click", () => {
      const story = reporterNews.find((item) => item.id === Number(card.dataset.storyId));
      if (story) onSelectCard(story);
    });
  });
}

export function bindStoryExplorer(reporterNews, onSelectStory, initialSelectedId = null) {
  const searchInput = document.getElementById("storySearch");
  const reporterSelect = document.getElementById("storyFilterReporter");
  const categorySelect = document.getElementById("storyFilterCategory");
  const locationSelect = document.getElementById("storyFilterLocation");
  const statusSelect = document.getElementById("storyFilterStatus");
  if (!searchInput) return;

  const filters = { search: "", reporter: "", category: "", location: "", status: "" };
  let selectedId = initialSelectedId;

  const update = () => renderCards(reporterNews, filters, selectedId, (story) => {
    selectedId = story.id;
    onSelectStory(story);
    update();
  });

  searchInput.addEventListener("input", (event) => {
    filters.search = event.target.value.trim().toLowerCase();
    update();
  });
  reporterSelect.addEventListener("change", (event) => {
    filters.reporter = event.target.value;
    update();
  });
  categorySelect.addEventListener("change", (event) => {
    filters.category = event.target.value;
    update();
  });
  locationSelect.addEventListener("change", (event) => {
    filters.location = event.target.value;
    update();
  });
  statusSelect.addEventListener("change", (event) => {
    filters.status = event.target.value;
    update();
  });

  update();

  // The explorer keeps its own `selectedId`, its own filters and its own
  // cards, so a caller that only needs to move the highlight must be able to
  // say so WITHOUT the panel being rebuilt around it. Rebuilding is a
  // megabyte of markup and a card per story; moving the highlight is two
  // class changes.
  //
  // `selectedId` stays the closure's, so the next filter change still renders
  // the right card active - there is no second copy of which story is picked.
  return {
    setSelected(id) {
      if (selectedId === id) return;
      selectedId = id;
      const results = document.getElementById("storyExplorerResults");
      if (!results) return;
      results.querySelectorAll(".story-card.active").forEach((card) => card.classList.remove("active"));
      if (id != null) {
        results.querySelector(`.story-card[data-story-id="${id}"]`)?.classList.add("active");
      }
    },
  };
}
