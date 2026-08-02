import { renderStoryExplorerMarkup, bindStoryExplorer } from "./story-explorer.js";

export function renderStoryPicker(currentPage, reporterNews, selectedSectionKey, onSelectStory) {
  const panel = document.getElementById("sidebarPanel");
  if (!panel) return;

  const section = currentPage?.sections?.find((s) => s.section_key === selectedSectionKey);

  panel.innerHTML = renderStoryExplorerMarkup(reporterNews);
  bindStoryExplorer(reporterNews, onSelectStory, section?.news_item_id || null);
}
