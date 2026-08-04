// Part 11: the History workspace - undo list, redo list, timeline, and which
// states actually reached the database.

import { escapeHtml } from "../format.js";
import { timeline, canUndo, canRedo } from "../history/history.js";

function time(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function historyPanelMarkup() {
  const entries = timeline();
  const undoable = entries.filter((e) => e.state === "past");
  const redoable = entries.filter((e) => e.state === "future");

  return `
    <div class="ext-columns">
      <div class="ext-column ext-column-wide">
        <label class="preview-label">Timeline</label>
        <ol class="history-timeline" id="edHistoryTimeline">
          ${entries
            .map(
              (entry) => `
            <li class="history-entry state-${entry.state}${entry.saved ? " saved" : ""}">
              <button type="button" class="history-jump" data-history-index="${entry.index}">
                <span class="history-dot"></span>
                <span class="history-label">${escapeHtml(entry.label)}</span>
                <span class="history-time">${time(entry.at)}</span>
                ${entry.saved ? `<span class="history-saved-tag">saved</span>` : ""}
              </button>
            </li>`,
            )
            .join("")}
        </ol>
      </div>
      <div class="ext-column">
        <label class="preview-label">Undo stack (${undoable.length})</label>
        <div class="ext-editor-toolbar">
          <button type="button" class="ext-editor-btn" id="edHistoryUndo"${canUndo() ? "" : " disabled"}>Undo</button>
          <button type="button" class="ext-editor-btn" id="edHistoryRedo"${canRedo() ? "" : " disabled"}>Redo</button>
        </div>
        <label class="preview-label">Redo stack (${redoable.length})</label>
        <p class="muted ext-note">
          History is per section and resets when the selection moves, so Undo can never rewrite a section you have navigated away from.
          Entries marked <em>saved</em> are states that reached the database.
        </p>
      </div>
    </div>
  `;
}

export function bindHistoryPanel({ onUndo, onRedo, onJump }) {
  document.getElementById("edHistoryUndo")?.addEventListener("click", onUndo);
  document.getElementById("edHistoryRedo")?.addEventListener("click", onRedo);
  document.querySelectorAll("[data-history-index]").forEach((button) => {
    button.addEventListener("click", () => onJump(Number(button.dataset.historyIndex)));
  });
}

export function refreshHistoryPanel(handlers) {
  const panel = document.getElementById("edHistoryAside");
  if (!panel) return;
  panel.innerHTML = historyPanelMarkup();
  bindHistoryPanel(handlers);
}
