import { escapeHtml } from "./format.js";

const TOOLBAR_BUTTONS = [
  { id: "extUploadImage", label: "Upload Image", handler: "onUploadImage" },
  { id: "extReporterImages", label: "Reporter Images", handler: "onReporterImages" },
  { id: "extRemoveBackground", label: "Remove Background", handler: "onRemoveBackground" },
  { id: "extAiInstructions", label: "Additional AI Instructions", handler: "onAdditionalAiInstructions" },
  { id: "extGenerateLayout", label: "Generate Layout", handler: "onGenerateLayout" },
  { id: "extPreview", label: "Preview", handler: "onPreview" },
  { id: "extAccept", label: "Accept", handler: "onAccept", primary: true },
  { id: "extCancel", label: "Cancel", handler: "onCancel" },
  { id: "extSaveSection", label: "Save Section", handler: "onSaveSection", primary: true },
];

export function renderExternalEditor(page, selectedSectionKey, handlers) {
  const container = document.getElementById("externalEditorPanel");
  if (!container) return;

  if (!selectedSectionKey) {
    container.innerHTML = `
      <div class="ext-editor-header"><h3>External Editor</h3></div>
      <p class="muted ext-editor-empty">Select a section on the page to open it here.</p>
    `;
    return;
  }

  const section = page?.sections?.find((s) => s.section_key === selectedSectionKey);

  container.innerHTML = `
    <div class="ext-editor-header">
      <h3>External Editor</h3>
      <span class="ext-editor-section-name">${escapeHtml(selectedSectionKey)}</span>
    </div>
    <div class="ext-editor-toolbar">
      ${TOOLBAR_BUTTONS.map(
        (btn) =>
          `<button id="${btn.id}" class="ext-editor-btn${btn.primary ? " ext-editor-btn-primary" : ""}">${btn.label}</button>`,
      ).join("")}
    </div>
    <div id="external-editor" class="ext-editor-mount">
      <p class="muted">The embedded layout editor will mount here.</p>
    </div>
  `;

  TOOLBAR_BUTTONS.forEach((btn) => {
    document.getElementById(btn.id).addEventListener("click", () => handlers[btn.handler]?.(section));
  });
}
