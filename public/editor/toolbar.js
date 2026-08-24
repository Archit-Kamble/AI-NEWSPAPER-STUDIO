import { formatDate } from "./format.js";

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>',
  preview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></svg>',
  publish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg>',
};

const SAVE_LABELS = {
  idle: "",
  dirty: "Unsaved changes",
  saving: "Saving...",
  saved: "Saved",
  error: "Save failed",
};

function button(id, icon, label, { disabled = false, primary = false, active = false, title = "" } = {}) {
  const classes = `toolbar-btn${primary ? " toolbar-btn-primary" : ""}${active ? " active" : ""}`;
  return `<button id="${id}" class="${classes}" ${disabled ? "disabled" : ""} ${title ? `title="${title}"` : ""}>${ICONS[icon]}<span>${label}</span></button>`;
}

export function renderToolbar({ newspaper, hasSelection, storyPickerOpen, handlers }) {
  const container = document.getElementById("toolbar");
  if (!container) return;

  container.innerHTML = `
    <div class="toolbar-left">
      <div class="toolbar-brand">
        ${newspaper?.name || "Newspaper Workspace"}
        <small>${formatDate(newspaper?.publication_date)}</small>
      </div>
      <span class="save-indicator" id="saveIndicator"></span>
    </div>
    <div class="toolbar-actions">
      ${button("tbFromReporter", "search", "From Reporter", {
        disabled: !hasSelection,
        active: storyPickerOpen,
        title: hasSelection ? "Attach a reporter story to the selected section" : "Select a section first",
      })}
      ${button("tbSave", "save", "Save", { disabled: !hasSelection })}
      ${button("tbUndo", "undo", "Undo", { disabled: true })}
      ${button("tbRedo", "redo", "Redo", { disabled: true })}
      ${button("tbPreflight", "preview", "Preflight", {
        title: "Check the edition before it goes to the plate",
      })}
      ${button("tbExport", "export", "Press file", {
        title: "The Scribus document and its photographs, packaged for the plate",
      })}
      <!-- FOUR DESTINATIONS, ONE COMPOSITION. The press package above is the
           file that goes to the plate and is gated on press readiness; these
           are the working exports, and they are not - a designer needs the
           InDesign document while the page is still being made up, and a
           reporter wants the copy in Word before anybody has signed anything.
           A <details> rather than a fifth button: the toolbar is already the
           one constant on this screen and four more buttons would crowd out
           the ones a desk presses all day. -->
      <details class="toolbar-menu" id="tbDownloadMenu">
        <summary class="toolbar-btn" title="Download this edition in another format">
          <span class="toolbar-btn-label">Download</span>
        </summary>
        <div class="toolbar-menu-panel">
          <button type="button" data-export="pdf">
            <b>CMYK print PDF</b><small>Ready for the press — four-plate colour, type embedded</small>
          </button>
          <button type="button" data-export="indesign">
            <b>Adobe InDesign</b><small>An .idml the designer opens directly</small>
          </button>
          <button type="button" data-export="scribus">
            <b>Scribus</b><small>The .sla on its own, without the photographs</small>
          </button>
          <button type="button" data-export="word">
            <b>Word</b><small>The edition’s copy as a manuscript, not the page</small>
          </button>
        </div>
      </details>
      ${button("tbAI", "ai", "AI Compose", { title: "Plan AI composition from approved newsroom copy" })}
      ${button("tbPublish", "publish", "Publish", { primary: true })}
    </div>
  `;

  document.getElementById("tbSave").addEventListener("click", handlers.onSave);
  document.getElementById("tbPublish").addEventListener("click", handlers.onPublish);
  document.getElementById("tbFromReporter").addEventListener("click", handlers.onToggleStoryPicker);
  document.getElementById("tbUndo").addEventListener("click", handlers.onUndo);
  document.getElementById("tbRedo").addEventListener("click", handlers.onRedo);
  document.getElementById("tbPreflight").addEventListener("click", handlers.onPreflight);
  document.getElementById("tbExport").addEventListener("click", handlers.onPressFile);
  // Delegated on the menu, which survives - and the menu closes itself, or it
  // would stand open over the page after the download starts.
  document.getElementById("tbDownloadMenu")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-export]");
    if (!choice) return;
    document.getElementById("tbDownloadMenu").open = false;
    handlers.onExport?.(choice.dataset.export);
  });
  document.getElementById("tbAI").addEventListener("click", handlers.onCompose);
}

export function refreshHistoryButtons(canUndo, canRedo) {
  const undoBtn = document.getElementById("tbUndo");
  const redoBtn = document.getElementById("tbRedo");
  if (undoBtn) undoBtn.disabled = !canUndo;
  if (redoBtn) redoBtn.disabled = !canRedo;
}

// Phase 7's visible half: the editor always knows whether their work is safe.
export function refreshSaveIndicator(saveState, dirty, message) {
  const indicator = document.getElementById("saveIndicator");
  if (!indicator) return;

  const key = saveState === "idle" && dirty ? "dirty" : saveState;
  indicator.textContent = message || SAVE_LABELS[key] || "";
  indicator.className = `save-indicator state-${key}`;
}

export function refreshToolbarSelection(hasSelection, storyPickerOpen) {
  const fromReporter = document.getElementById("tbFromReporter");
  const save = document.getElementById("tbSave");
  if (fromReporter) {
    fromReporter.disabled = !hasSelection;
    fromReporter.classList.toggle("active", storyPickerOpen);
    fromReporter.title = hasSelection
      ? "Attach a reporter story to the selected section"
      : "Select a section first";
  }
  if (save) save.disabled = !hasSelection;
}
