export function renderCanvas(page, newspaper, selectedSectionKey, onSelectSection) {
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
    canvas.innerHTML = "<h3>This page has no layout yet. Pick a layout on the right.</h3>";
    return;
  }

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;

  canvas.innerHTML = `
    <div class="newspaper-canvas" style="position:relative;aspect-ratio:${pageWidth}/${pageHeight};border:1px solid #aaa;">
      ${page.sections
        .map(
          (section) => `
        <div
          class="newspaper-section${section.headline ? " filled" : ""}${selectedSectionKey === section.section_key ? " active" : ""}"
          data-section-key="${section.section_key}"
          style="position:absolute;left:${(section.x_px / pageWidth) * 100}%;top:${(section.y_px / pageHeight) * 100}%;width:${(section.width_px / pageWidth) * 100}%;height:${(section.height_px / pageHeight) * 100}%;"
        >
          <span class="section-label">${section.section_key}</span>
          <strong>${section.headline || "Blank section"}</strong>
          <small>${section.headline ? "Click to edit" : "Click to add a story"}</small>
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  canvas.querySelectorAll(".newspaper-section").forEach((element) => {
    element.onclick = () => onSelectSection(element.dataset.sectionKey);
  });
}
