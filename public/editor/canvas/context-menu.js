// Part 4: the section right-click menu.
//
// Every item here maps to an action the workspace already exposes elsewhere -
// this is a faster route to them, not a second implementation.

const ITEMS = [
  { action: "story", label: "Attach reporter story…" },
  { action: "image", label: "Open image workspace" },
  { action: "typography", label: "Open typography" },
  { separator: true },
  { action: "duplicate-story", label: "Copy story to another section…", disabled: true },
  { action: "mark-ready", label: "Mark ready" },
  { action: "mark-review", label: "Mark needs review" },
  { separator: true },
  { action: "clear", label: "Clear section", danger: true },
];

let handler = null;

function menuElement() {
  return document.getElementById("sectionContextMenu");
}

export function menuMarkup() {
  return `<div class="context-menu" id="sectionContextMenu" hidden role="menu">
    ${ITEMS.map((item) =>
      item.separator
        ? `<div class="context-separator"></div>`
        : `<button type="button" role="menuitem" class="context-item${item.danger ? " danger" : ""}"
             data-context-action="${item.action}"${item.disabled ? " disabled" : ""}>${item.label}</button>`,
    ).join("")}
  </div>`;
}

export function bindContextMenu(onAction) {
  handler = onAction;
  const menu = menuElement();
  if (!menu || menu.dataset.bound === "true") return;
  menu.dataset.bound = "true";

  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-context-action]");
    if (!button || button.disabled) return;
    hideContextMenu();
    handler?.(menu.dataset.sectionKey, button.dataset.contextAction);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#sectionContextMenu")) hideContextMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideContextMenu();
  });
  window.addEventListener("resize", hideContextMenu);
}

export function showContextMenu(sectionKey, x, y) {
  const menu = menuElement();
  if (!menu) return;
  menu.dataset.sectionKey = sectionKey;
  menu.hidden = false;

  // Flip near the viewport edges so the menu is never clipped.
  const { offsetWidth: width, offsetHeight: height } = menu;
  menu.style.left = `${x + width > window.innerWidth ? Math.max(4, x - width) : x}px`;
  menu.style.top = `${y + height > window.innerHeight ? Math.max(4, y - height) : y}px`;
}

export function hideContextMenu() {
  const menu = menuElement();
  if (menu) menu.hidden = true;
}
