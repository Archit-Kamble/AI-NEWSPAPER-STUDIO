export function renderPageSidebar(pages, currentPage, onSelectPage) {
  const container = document.getElementById("pages");
  if (!container) return;

  container.innerHTML = "";

  pages.forEach((page) => {
    const btn = document.createElement("button");
    btn.className = "page-btn";

    if (currentPage && page.id === currentPage.id) {
      btn.classList.add("active");
    }

    btn.textContent = page.pageNumber;
    btn.onclick = () => onSelectPage(page.id);

    container.appendChild(btn);
  });
}
