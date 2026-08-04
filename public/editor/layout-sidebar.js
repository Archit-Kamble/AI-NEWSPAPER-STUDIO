// The layout picker.
//
// A page's layout is chosen once, at the top of the production flow (VISION.md:
// "Choose page -> Choose layout -> Select one news block"). Once blocks are
// filled, switching layout is a deliberate act, not a one-click accident - so
// the picker stays visible but asks before it moves an editor's work.

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

  container.innerHTML = "";

  const templates = await fetchTemplates();
  const filled = filledSections(page);

  templates.forEach((tpl) => {
    const btn = document.createElement("button");
    btn.className = "layout-btn";
    btn.textContent = tpl.name;

    const isCurrent = Boolean(page && page.template_key === tpl.key);
    if (isCurrent) {
      btn.classList.add("active");
      btn.title = "This page's layout";
    } else if (filled.length) {
      // Not disabled - an editor may genuinely need to change layout - but it
      // reads as the consequential action it is.
      btn.classList.add("layout-btn-guarded");
      btn.title = `Switch to ${tpl.name} (this page has ${filled.length} filled block${filled.length === 1 ? "" : "s"})`;
    }

    btn.onclick = () => {
      if (isCurrent) return;
      if (filled.length) {
        const names = filled.map((s) => s.section_key).join(", ");
        const ok = window.confirm(
          `Switch this page to "${tpl.name}"?\n\n` +
            `${filled.length} block${filled.length === 1 ? " is" : "s are"} already filled: ${names}.\n\n` +
            `Their content is kept, but blocks that are not part of the new layout stay ` +
            `where they are and may need repositioning.`,
        );
        if (!ok) return;
      }
      onSelectTemplate(tpl.key);
    };

    container.appendChild(btn);
  });
}
