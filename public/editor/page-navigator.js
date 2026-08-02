import { sectionRect } from "./canvas-geometry.js";

export function renderPageNavigator(pages, currentPage, newspaper, onSelectPage) {
  const container = document.getElementById("pageNavigator");
  if (!container) return;

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;

  container.innerHTML = pages
    .map((page) => {
      const active = currentPage && page.id === currentPage.id;
      const sections = page.sections || [];
      return `
        <button class="page-thumb${active ? " active" : ""}" data-page-id="${page.id}" title="Page ${page.page_number}">
          <span class="page-thumb-canvas" style="aspect-ratio:${pageWidth}/${pageHeight};">
            ${sections
              .map((section) => {
                const rect = sectionRect(section, pageWidth, pageHeight);
                return `<span class="page-thumb-section${section.headline ? " filled" : ""}" style="left:${rect.leftPct}%;top:${rect.topPct}%;width:${rect.widthPct}%;height:${rect.heightPct}%;"></span>`;
              })
              .join("")}
          </span>
          <span class="page-thumb-label">${page.page_number}</span>
        </button>
      `;
    })
    .join("");

  container.querySelectorAll(".page-thumb").forEach((btn) => {
    btn.addEventListener("click", () => onSelectPage(Number(btn.dataset.pageId)));
  });
}
