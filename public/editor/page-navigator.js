// WHICH PAGE THE DESK IS ON WAS SAID IN COLOUR AND NOTHING ELSE.
//
// The pill carried `.active` and a `title`, so the state existed only as a
// visual difference. A desk working by keyboard or screen reader had no way to
// tell which of the twelve pills is the page in front of them - and `title` is
// not the answer, for the same reason this file already records about the
// device bar: a tooltip is not something anybody reads while working.
//
// `aria-current="page"` is the exact vocabulary for "this one of a set of page
// links is the one you are on", and the pill's own label is widened from a
// bare numeral to "Page 4" so it is not read out as a loose digit. The `title`
// stays for the pointer; the class stays for the ink. Nothing about the
// control's behaviour changes.
export function renderPageNavigator(pages, currentPage, newspaper, onSelectPage) {
  const container = document.getElementById("pageSwitcher");
  if (!container) return;

  container.innerHTML = pages
    .map((page) => {
      const active = currentPage && page.id === currentPage.id;
      const filled = (page.sections || []).some((section) => section.headline);
      const carries = filled ? ", has copy" : "";
      return `<button type="button" class="page-pill${active ? " active" : ""}${filled ? " filled" : ""}"`
        + ` data-page-id="${page.id}" title="Page ${page.page_number}"`
        + `${active ? ' aria-current="page"' : ""}`
        + ` aria-label="Page ${page.page_number}${carries}">${page.page_number}</button>`;
    })
    .join("");

  container.querySelectorAll(".page-pill").forEach((btn) => {
    btn.addEventListener("click", () => onSelectPage(Number(btn.dataset.pageId)));
  });
}
