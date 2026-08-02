import { renderStoryExplorerMarkup, bindStoryExplorer } from "./story-explorer.js";

export function renderSectionEditor(page, selectedSectionKey, reporterNews, onSaveSection) {
  const body = document.getElementById("editorBody");
  if (!body) return;

  if (!selectedSectionKey) {
    body.innerHTML = "<p>Select a section on the page.</p>";
    return;
  }

  const section = page?.sections?.find((s) => s.section_key === selectedSectionKey);

  body.innerHTML = `
    <h3>${selectedSectionKey.toUpperCase()}</h3>
    ${renderStoryExplorerMarkup(reporterNews)}
    <div class="form-group"><label>Headline</label><input id="secHeadline" value="${section?.headline || ""}" /></div>
    <div class="form-group"><label>Subheading</label><input id="secSubheading" value="${section?.subheading || ""}" /></div>
    <div class="form-group"><label>Body</label><textarea id="secBody">${section?.body || ""}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Category</label><input id="secCategory" value="${section?.category || ""}" /></div>
      <div class="form-group"><label>Location</label><input id="secLocation" value="${section?.location || ""}" /></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Tags</label><input id="secTags" value="${section?.tags || ""}" /></div>
      <div class="form-group"><label>Reporter name</label><input id="secReporter" value="${section?.reporter_name || ""}" /></div>
    </div>
    <button class="btn-submit" id="saveSectionBtn">Save section</button>
  `;

  bindStoryExplorer(reporterNews, (story) => {
    document.getElementById("secHeadline").value = story.title || "";
    document.getElementById("secSubheading").value = story.subheading || story.subtitle || "";
    document.getElementById("secBody").value = story.description || "";
    document.getElementById("secCategory").value = story.category || "";
    document.getElementById("secLocation").value = story.location || "";
    document.getElementById("secTags").value = story.tags || "";
    document.getElementById("secReporter").value = story.reporter_name || story.reporterName || "";
  });

  document.getElementById("saveSectionBtn").addEventListener("click", async () => {
    const headline = document.getElementById("secHeadline").value.trim();
    if (!headline) return alert("Add a headline before saving this section.");

    const reporterSelect = document.getElementById("reporterStory");
    const reporterId = Number(reporterSelect.value) || null;

    const payload = {
      newsItemId: reporterId,
      headline,
      subheading: document.getElementById("secSubheading").value.trim(),
      body: document.getElementById("secBody").value.trim(),
      category: document.getElementById("secCategory").value.trim(),
      location: document.getElementById("secLocation").value.trim(),
      tags: document.getElementById("secTags").value.trim(),
      reporterName: document.getElementById("secReporter").value.trim(),
    };

    const ok = await onSaveSection(selectedSectionKey, payload);
    if (!ok) alert("Could not save this section.");
  });
}
