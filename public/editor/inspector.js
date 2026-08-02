let activeStoryId = null;

function renderImagePreview(imageUrls = []) {
  const container = document.getElementById("secImages");
  if (!container) return;
  container.innerHTML = imageUrls.length
    ? imageUrls.map((url) => `<img class="story-card-thumb" src="${url}" alt="" />`).join("")
    : `<p class="muted">No images attached.</p>`;
}

export function renderInspector(page, selectedSectionKey, reporterNews, onSaveSection) {
  const body = document.getElementById("inspector");
  if (!body) return;

  if (!selectedSectionKey) {
    activeStoryId = null;
    body.innerHTML = `<p class="muted">Select a section on the page to inspect it.</p>`;
    return;
  }

  const section = page?.sections?.find((s) => s.section_key === selectedSectionKey);
  activeStoryId = section?.news_item_id || null;
  const linkedStory = reporterNews.find((item) => item.id === activeStoryId);

  body.innerHTML = `
    <div class="inspector-group">
      <h4>Metadata</h4>
      <div class="inspector-row"><span>Section</span><strong>${selectedSectionKey}</strong></div>
      <div class="inspector-row"><span>Linked story</span><strong>${linkedStory ? linkedStory.title : "None"}</strong></div>
      <div class="inspector-row"><span>Last updated</span><strong>${section?.updated_at ? new Date(section.updated_at).toLocaleString() : "—"}</strong></div>
    </div>

    <div class="inspector-group">
      <h4>Article information</h4>
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
    </div>

    <div class="inspector-group">
      <h4>Typography</h4>
      <div class="form-row">
        <div class="form-group"><label>Headline size (px)</label><input id="secHeadlineFontPx" type="number" min="8" value="${section?.headline_font_px || 34}" /></div>
        <div class="form-group"><label>Subheading size (px)</label><input id="secSubheadingFontPx" type="number" min="8" value="${section?.subheading_font_px || 20}" /></div>
      </div>
      <div class="form-group"><label>Body size (px)</label><input id="secBodyFontPx" type="number" min="8" value="${section?.body_font_px || 16}" /></div>
    </div>

    <div class="inspector-group">
      <h4>Image information</h4>
      <div id="secImages" class="story-image-preview"></div>
    </div>

    <div class="inspector-group">
      <h4>Section properties</h4>
      <div class="inspector-row"><span>Block type</span><strong>${section?.block_type || "article"}</strong></div>
      <div class="inspector-row"><span>Position</span><strong>${section?.x_px ?? "—"}, ${section?.y_px ?? "—"} px</strong></div>
      <div class="inspector-row"><span>Size</span><strong>${section?.width_px ?? "—"} &times; ${section?.height_px ?? "—"} px</strong></div>
    </div>

    <div class="inspector-group">
      <h4>AI notes</h4>
      <div class="form-group"><textarea id="secAiNotes" placeholder="Notes for future AI assist...">${section?.ai_notes || ""}</textarea></div>
    </div>

    <button class="btn-submit" id="saveSectionBtn">Save section</button>
  `;

  renderImagePreview(linkedStory?.image_urls || []);

  document.getElementById("saveSectionBtn").addEventListener("click", async () => {
    const headline = document.getElementById("secHeadline").value.trim();
    if (!headline) return alert("Add a headline before saving this section.");

    const payload = {
      newsItemId: activeStoryId,
      headline,
      subheading: document.getElementById("secSubheading").value.trim(),
      body: document.getElementById("secBody").value.trim(),
      category: document.getElementById("secCategory").value.trim(),
      location: document.getElementById("secLocation").value.trim(),
      tags: document.getElementById("secTags").value.trim(),
      reporterName: document.getElementById("secReporter").value.trim(),
      headlineFontPx: Number(document.getElementById("secHeadlineFontPx").value) || undefined,
      subheadingFontPx: Number(document.getElementById("secSubheadingFontPx").value) || undefined,
      bodyFontPx: Number(document.getElementById("secBodyFontPx").value) || undefined,
      aiNotes: document.getElementById("secAiNotes").value.trim(),
    };

    const ok = await onSaveSection(selectedSectionKey, payload);
    if (!ok) alert("Could not save this section.");
  });
}

export function applyStoryToInspector(story) {
  const headlineInput = document.getElementById("secHeadline");
  if (!headlineInput) return false;

  activeStoryId = story.id;
  headlineInput.value = story.title || "";
  document.getElementById("secSubheading").value = story.subheading || story.subtitle || "";
  document.getElementById("secBody").value = story.description || "";
  document.getElementById("secCategory").value = story.category || "";
  document.getElementById("secLocation").value = story.location || "";
  document.getElementById("secTags").value = story.tags || "";
  document.getElementById("secReporter").value = story.reporter_name || story.reporterName || "";
  renderImagePreview(story.image_urls || []);
  return true;
}
