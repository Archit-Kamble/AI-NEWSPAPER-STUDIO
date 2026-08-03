// Phase 2, AI section. Every action here is a stub by instruction - no model is
// called and no content is written. Each button reports the request it *would*
// make so the wiring is visible and testable before any provider exists.

import { escapeHtml } from "../format.js";

export const AI_ACTIONS = [
  { id: "aiGenerateLayout", label: "Generate Layout", intent: "layout" },
  { id: "aiRewrite", label: "Rewrite", intent: "rewrite" },
  { id: "aiExpand", label: "Expand", intent: "expand" },
  { id: "aiShorten", label: "Shorten", intent: "shorten" },
  { id: "aiTranslate", label: "Translate", intent: "translate" },
  { id: "aiSummarize", label: "Summarize", intent: "summarize" },
  { id: "aiImproveHeadline", label: "Improve Headline", intent: "headline" },
  { id: "aiGenerateCaption", label: "Generate Caption", intent: "caption" },
  { id: "aiPullQuote", label: "Generate Pull Quote", intent: "pull-quote" },
  { id: "aiImagePrompt", label: "Generate Image Prompt", intent: "image-prompt" },
];

export function aiPanelMarkup(view) {
  return `
    <div class="form-group">
      <label>Prompt</label>
      <textarea id="edAiPrompt" rows="3" placeholder="Additional AI instructions for this section...">${escapeHtml(view.aiNotes)}</textarea>
    </div>
    <div class="ext-editor-toolbar">
      ${AI_ACTIONS.map(
        (action) =>
          `<button type="button" class="ext-editor-btn" id="${action.id}" data-ai-intent="${action.intent}">${action.label}</button>`,
      ).join("")}
    </div>
    <p class="muted ext-ai-note" id="edAiStatus">No AI provider is connected yet - these actions are stubs.</p>
  `;
}

export function bindAiPanel(getView, onPatch, onNotify) {
  document.getElementById("edAiPrompt")?.addEventListener("input", (event) => {
    onPatch({ aiNotes: event.target.value }, "ai-panel");
  });

  AI_ACTIONS.forEach((action) => {
    document.getElementById(action.id)?.addEventListener("click", () => {
      const view = getView();
      // The request an integration would send. Logged rather than issued.
      const request = {
        intent: action.intent,
        sectionKey: view.sectionKey,
        prompt: view.aiNotes || "",
        headline: view.headline,
        body: view.body,
        language: view.language || null,
      };
      console.log("[AI stub] would request", request);
      const status = document.getElementById("edAiStatus");
      if (status) status.textContent = `"${action.label}" is stubbed - no request was sent.`;
      onNotify(`${action.label}: not connected yet.`);
    });
  });
}

export function refreshAiPanel(view, source) {
  if (source === "ai-panel") return;
  const prompt = document.getElementById("edAiPrompt");
  if (prompt && document.activeElement !== prompt && prompt.value !== view.aiNotes) {
    prompt.value = view.aiNotes;
  }
}
