export function renderPageNavigator(pages, currentPage, newspaper, onSelectPage) {
  const container = document.getElementById("pageSwitcher");
  if (!container) return;

  container.innerHTML = pages
    .map((page) => {
      const active = currentPage && page.id === currentPage.id;
      const filled = (page.sections || []).some((section) => section.headline);
      return `<button class="page-pill${active ? " active" : ""}${filled ? " filled" : ""}" data-page-id="${page.id}" title="Page ${page.page_number}">${page.page_number}</button>`;
    })
    .join("");

  container.querySelectorAll(".page-pill").forEach((btn) => {
    btn.addEventListener("click", () => onSelectPage(Number(btn.dataset.pageId)));
  });
}
