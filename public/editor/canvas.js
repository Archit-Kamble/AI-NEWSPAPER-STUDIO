import { sectionRect } from "./canvas-geometry.js";
import { escapeHtml } from "./format.js";

const IMAGE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5.5-5.5a2 2 0 0 1 2.8 0L18 18"/></svg>';

function sectionStatus(section, linkedStory) {
  if (!section.headline) return { label: "Empty", slug: "empty" };
  if (linkedStory?.status) return { label: linkedStory.status, slug: linkedStory.status.toLowerCase() };
  return { label: "Filled", slug: "filled" };
}

function thumbImage(imageUrl) {
  return imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" />`
    : IMAGE_ICON;
}

function thumbHeadline(headline) {
  return headline ? escapeHtml(headline) : "";
}

function thumbBody(body) {
  if (body) {
    return `<p class="thumb-body-preview">${escapeHtml(body)}</p>`;
  }
  return `
    <div class="thumb-body-lines">
      <span class="thumb-line w-80"></span>
      <span class="thumb-line w-60"></span>
      <span class="thumb-line w-40"></span>
    </div>
  `;
}

export function renderCanvas(page, newspaper, selectedSectionKey, reporterNews, onSelectSection) {
  const canvas = document.getElementById("canvas");
  if (!canvas) {
    console.error("canvas div not found");
    return;
  }

  if (!page) {
    canvas.innerHTML = "No page selected";
    return;
  }

  if (!page.sections || !page.sections.length) {
    canvas.innerHTML = "<h3>This page has no layout yet. Pick a layout above.</h3>";
    return;
  }

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;

  canvas.innerHTML = `
    <div class="newspaper-canvas" style="position:relative;aspect-ratio:${pageWidth}/${pageHeight};border:1px solid #aaa;">
      ${page.sections
        .map((section) => {
          const rect = sectionRect(section, pageWidth, pageHeight);
          const linkedStory = (reporterNews || []).find((item) => item.id === section.news_item_id);
          const status = sectionStatus(section, linkedStory);
          const imageUrl = linkedStory?.image_urls?.[0] || null;

          return `
        <div
          class="newspaper-section${section.headline ? " filled" : ""}${selectedSectionKey === section.section_key ? " active" : ""}"
          data-section-key="${section.section_key}"
          style="position:absolute;left:${rect.leftPct}%;top:${rect.topPct}%;width:${rect.widthPct}%;height:${rect.heightPct}%;"
        >
          <div class="section-header-row">
            <span class="section-label">${section.section_key}</span>
            <span class="section-status-badge status-${status.slug}">${status.label}</span>
          </div>
          <div class="section-thumb">
            <div class="thumb-image">${thumbImage(imageUrl)}</div>
            <div class="thumb-text">
              <div class="thumb-headline">${thumbHeadline(section.headline)}</div>
              ${thumbBody(section.body)}
            </div>
          </div>
        </div>
      `;
        })
        .join("")}
    </div>
  `;

  canvas.querySelectorAll(".newspaper-section").forEach((element) => {
    element.onclick = () => onSelectSection(element.dataset.sectionKey);
  });
}
