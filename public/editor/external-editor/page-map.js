// The small layout, beside the block being composed.
//
// The External Editor is a full-width dock at the foot of the workspace, and
// when it is open the page above is often scrolled out of sight. That is the
// right trade for composing - a story wants width - but it costs the one thing
// a page designer needs constantly: WHERE ON THE PAGE AM I?
//
// Composing a lead is a different job from composing a filler at the foot of
// page four, and the block on its own does not say which it is. So the whole
// page is drawn here at a few centimetres across, with the open block picked
// out and every other block shown filled or empty. It answers "where am I,
// what is left, and what is next" without scrolling back up.
//
// It is also the fastest way through a page: every block is clickable, so an
// editor can work down a page from inside the dock rather than scrolling up,
// clicking, and scrolling down again for each one.

import { escapeHtml } from "../format.js";

const isFilled = (section) =>
  Boolean(
    (section.headline && section.headline.trim()) ||
      (section.body && section.body.trim()) ||
      section.image_url,
  );

export function pageMapMarkup(page, newspaper, selectedSectionKey) {
  if (!page?.sections?.length) return "";

  const pageWidth = newspaper?.page_width_px || 660;
  const pageHeight = newspaper?.page_height_px || 1060;
  const filled = page.sections.filter(isFilled).length;

  const blocks = page.sections
    .map((section) => {
      const selected = section.section_key === selectedSectionKey;
      const classes = [
        "page-map-block",
        isFilled(section) ? "filled" : "empty",
        selected ? "active" : "",
        section.block_type && section.block_type !== "article" ? `is-${section.block_type}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<button type="button" class="${classes}"
          data-section-key="${escapeHtml(section.section_key)}"
          title="${escapeHtml(section.section_key)}${section.headline ? " — " + escapeHtml(section.headline) : " — empty"}"
          style="left:${(section.x_px / pageWidth) * 100}%;top:${(section.y_px / pageHeight) * 100}%;
                 width:${(section.width_px / pageWidth) * 100}%;height:${(section.height_px / pageHeight) * 100}%;"
        ></button>`;
    })
    .join("");

  return `
    <div class="page-map">
      <div class="page-map-head">
        <strong>Page ${page.page_number}</strong>
        <span>${filled} of ${page.sections.length} filled</span>
      </div>
      <div class="page-map-sheet" id="edPageMap" style="aspect-ratio:${pageWidth}/${pageHeight};">
        ${blocks}
      </div>
      <p class="page-map-hint">Click a block to open it here.</p>
    </div>`;
}

/** Clicking a block on the small layout opens it in the dock. */
export function bindPageMap(onSelect) {
  document.querySelectorAll("#edPageMap .page-map-block").forEach((element) => {
    element.addEventListener("click", () => onSelect?.(element.dataset.sectionKey));
  });
}
