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

// ONLY A GOOD ANSWER IS CACHED.
//
// `cachedTemplates = await fetch(...).then((r) => r.json())` cached whatever
// came back, including a failure - and the catch-all answers a failure with
// `{ error: "..." }`, which is an object rather than a list. `templates.map`
// then threw, the Layout picker was not drawn, and because the failure was
// CACHED it never asked again: one blip - a restart, an expired session, a
// dropped connection - and the control was gone for the rest of the session
// with no message, until somebody reloaded the page. Measured by failing the
// route once: the picker went from present to absent and never returned,
// throwing again on every later render.
async function fetchTemplates() {
  if (cachedTemplates) return cachedTemplates;
  const response = await fetch("/api/templates");
  if (!response.ok) throw new Error(`templates: HTTP ${response.status}`);
  const templates = await response.json();
  if (!Array.isArray(templates)) throw new Error("templates: not a list");
  cachedTemplates = templates;
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

  // A control that cannot be drawn says so, rather than throwing out of the
  // render and leaving an empty rail. The next render tries again, because
  // nothing bad was cached.
  let templates;
  try {
    templates = await fetchTemplates();
  } catch (error) {
    console.error(error);
    container.innerHTML = `<label class="layout-picker">
      <span class="layout-picker-label">Layout</span>
      <span class="muted">The layouts could not be loaded. They will be tried again.</span>
    </label>`;
    return;
  }
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
