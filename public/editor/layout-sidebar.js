let cachedTemplates = null;

async function fetchTemplates() {
  if (!cachedTemplates) {
    cachedTemplates = await fetch("/api/templates").then((r) => r.json());
  }
  return cachedTemplates;
}

export async function renderLayoutSidebar(page, onSelectTemplate) {
  const container = document.getElementById("layouts");
  if (!container) return;

  container.innerHTML = "";

  const templates = await fetchTemplates();

  templates.forEach((tpl) => {
    const btn = document.createElement("button");
    btn.className = "layout-btn";
    btn.textContent = tpl.name;

    if (page && page.template_key === tpl.key) {
      btn.classList.add("active");
    }

    btn.onclick = () => onSelectTemplate(tpl.key);

    container.appendChild(btn);
  });
}
