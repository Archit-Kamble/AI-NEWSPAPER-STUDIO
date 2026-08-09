// The layout picker.
//
// A page's layout is chosen once, at the top of the production flow (VISION.md:
// "Choose page -> Choose layout -> Select one news block"). Once blocks are
// filled, switching layout is a deliberate act, not a one-click accident - so
// the picker asks before it moves an editor's work.
//
// It is a dropdown rather than a row of buttons, and the reason is honest
// bookkeeping of screen space: six templates with real names ("Dense Inside
// Page", "Daily Features") took a whole line of the toolbar and wrapped it to
// three or four, which cost 186px of chrome at a 1129px viewport - taken
// straight out of the room the page itself had to be drawn in. A page's layout
// is a property of the page, set rarely; the actions beside it are used every
// minute. The control that is used rarely is the one that gives up the room.

import { escapeHtml } from "./format.js";

let cachedTemplates = null;

async function fetchTemplates() {
  if (!cachedTemplates) {
    cachedTemplates = await fetch("/api/templates").then((r) => r.json());
  }
  return cachedTemplates;
}

function filledSections(page) {
  return (page?.sections || []).filter(
    (s) => s.news_item_id || s.headline || s.subheading || s.body || s.caption || s.image_url,
  );
}

export async function renderLayoutSidebar(page, onSelectTemplate) {
  const container = document.getElementById("layouts");
  if (!container) return;

  const templates = await fetchTemplates();
  const filled = filledSections(page);
  const current = page?.template_key || "";

  container.innerHTML = `
    <label class="layout-picker" for="layoutSelect">
      <span class="layout-picker-label">Layout</span>
      <select id="layoutSelect" class="layout-picker-select"
              title="${filled.length
                ? `This page has ${filled.length} filled block${filled.length === 1 ? "" : "s"} — changing layout asks first`
                : "The shape of this page"}">
        ${templates
          .map((tpl) => `<option value="${escapeHtml(tpl.key)}"${tpl.key === current ? " selected" : ""}>${escapeHtml(tpl.name)}</option>`)
          .join("")}
      </select>
    </label>`;

  const select = container.querySelector("#layoutSelect");
  // The picker is guarded, not disabled: an editor may genuinely need to change
  // a page that already has work on it, and the software's job is to say what
  // that costs rather than to refuse.
  select.addEventListener("change", () => {
    const key = select.value;
    if (key === current) return;

    if (filled.length) {
      const name = templates.find((tpl) => tpl.key === key)?.name || key;
      const names = filled.map((s) => s.section_key).join(", ");
      const ok = window.confirm(
        `Switch this page to "${name}"?\n\n` +
          `${filled.length} block${filled.length === 1 ? " is" : "s are"} already filled: ${names}.\n\n` +
          `Their content is kept, but blocks that are not part of the new layout stay ` +
          `where they are and may need repositioning.`,
      );
      // Put the control back on refusal, or it shows a layout the page is not on.
      if (!ok) {
        select.value = current;
        return;
      }
    }
    onSelectTemplate(key);
  });
}
