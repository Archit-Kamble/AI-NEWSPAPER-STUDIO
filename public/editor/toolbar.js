import { formatDate } from "./format.js";

const ICONS = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>',
  preview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>',
  publish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>',
};

function button(id, icon, label, { disabled = false, primary = false, title = "" } = {}) {
  const classes = `toolbar-btn${primary ? " toolbar-btn-primary" : ""}`;
  return `<button id="${id}" class="${classes}" ${disabled ? "disabled" : ""} ${title ? `title="${title}"` : ""}>${ICONS[icon]}<span>${label}</span></button>`;
}

export function renderToolbar({ newspaper, hasSelection, sidebarOpen, onSave, onPublish, onToggleSidebar }) {
  const container = document.getElementById("toolbar");
  if (!container) return;

  container.innerHTML = `
    <div class="toolbar-left">
      <button id="tbSidebarToggle" class="toolbar-btn toolbar-btn-icon${sidebarOpen ? " active" : ""}" title="Editions & Story Explorer">${ICONS.menu}</button>
      <div class="toolbar-brand">
        ${newspaper?.name || "Newspaper Workspace"}
        <small>${formatDate(newspaper?.publication_date)}</small>
      </div>
    </div>
    <div class="toolbar-actions">
      ${button("tbSave", "save", "Save", { disabled: !hasSelection })}
      ${button("tbUndo", "undo", "Undo", { disabled: true, title: "Coming soon" })}
      ${button("tbRedo", "redo", "Redo", { disabled: true, title: "Coming soon" })}
      ${button("tbPreview", "preview", "Preview", { disabled: true, title: "Coming soon" })}
      ${button("tbExport", "export", "Export", { disabled: true, title: "Coming soon" })}
      ${button("tbAI", "ai", "AI", { disabled: true, title: "Coming soon" })}
      ${button("tbPublish", "publish", "Publish", { primary: true })}
    </div>
  `;

  document.getElementById("tbSave").addEventListener("click", onSave);
  document.getElementById("tbPublish").addEventListener("click", onPublish);
  document.getElementById("tbSidebarToggle").addEventListener("click", onToggleSidebar);
}
