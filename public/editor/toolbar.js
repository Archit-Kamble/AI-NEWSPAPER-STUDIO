import { formatDate } from "./format.js";

export function renderToolbar({ newspaper, hasSelection, onSave, onPublish }) {
  const container = document.getElementById("toolbar");
  if (!container) return;

  container.innerHTML = `
    <div class="toolbar-brand">
      ${newspaper?.name || "Newspaper Workspace"}
      <small>${formatDate(newspaper?.publication_date)}</small>
    </div>
    <div class="toolbar-actions">
      <button id="tbSave" class="toolbar-btn" ${hasSelection ? "" : "disabled"}>Save</button>
      <button id="tbUndo" class="toolbar-btn" disabled title="Coming soon">Undo</button>
      <button id="tbRedo" class="toolbar-btn" disabled title="Coming soon">Redo</button>
      <button id="tbPreview" class="toolbar-btn" disabled title="Coming soon">Preview</button>
      <button id="tbExport" class="toolbar-btn" disabled title="Coming soon">Export</button>
      <button id="tbAI" class="toolbar-btn" disabled title="Coming soon">AI</button>
      <button id="tbPublish" class="toolbar-btn toolbar-btn-primary">Publish</button>
    </div>
  `;

  document.getElementById("tbSave").addEventListener("click", onSave);
  document.getElementById("tbPublish").addEventListener("click", onPublish);
}
