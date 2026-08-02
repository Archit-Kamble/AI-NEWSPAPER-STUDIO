export function renderStoryExplorerMarkup(reporterNews) {
  return `
    <div class="form-group">
      <label>Auto-fill from reporter</label>
      <select id="reporterStory">
        <option value="">Write manually</option>
        ${reporterNews.map((story) => `<option value="${story.id}">${story.title} (${story.status})</option>`).join("")}
      </select>
    </div>
  `;
}

export function bindStoryExplorer(reporterNews, onSelectStory) {
  const select = document.getElementById("reporterStory");
  if (!select) return;

  select.addEventListener("change", (event) => {
    const story = reporterNews.find((item) => item.id === Number(event.target.value));
    if (story) onSelectStory(story);
  });
}
