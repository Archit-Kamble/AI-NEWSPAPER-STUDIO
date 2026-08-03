// Part 9: the AI workspace. Every action is a stub by instruction - no provider
// is called and no content is written. Each button builds and displays the exact
// request an integration would send, so the contract is visible and testable
// before any provider exists.

import { escapeHtml } from "../format.js";

export const AI_ACTIONS = [
  { id: "aiGenerateLayout", label: "Generate Layout", intent: "layout" },
  { id: "aiRewrite", label: "Rewrite", intent: "rewrite" },
  { id: "aiImproveHeadline", label: "Improve Headline", intent: "headline" },
  { id: "aiGenerateCaption", label: "Generate Caption", intent: "caption" },
  { id: "aiSummarize", label: "Summarize", intent: "summarize" },
  { id: "aiTranslate", label: "Translate", intent: "translate" },
  { id: "aiExpand", label: "Expand", intent: "expand" },
  { id: "aiShorten", label: "Shorten", intent: "shorten" },
  { id: "aiSeo", label: "SEO", intent: "seo" },
  { id: "aiPullQuote", label: "Pull Quote", intent: "pull-quote" },
  { id: "aiImagePrompt", label: "Image Prompt", intent: "image-prompt" },
];

export function buildAiRequest(intent, view) {
  return {
    intent,
    sectionKey: view.sectionKey,
    prompt: view.aiNotes || "",
    language: view.language || null,
    story: {
      headline: view.headline,
      subheading: view.subheading,
      body: view.body,
      caption: view.caption,
    },
  };
}

export function aiPanelMarkup(view) {
  return `
    <div class="ext-columns">
      <div class="ext-column ext-column-wide">
        <div class="form-group">
          <label>Prompt</label>
          <textarea id="edAiPrompt" rows="5" placeholder="Additional instructions for this section...">${escapeHtml(view.aiNotes)}</textarea>
        </div>
        <div class="ext-editor-toolbar">
          ${AI_ACTIONS.map(
            (a) => `<button type="button" class="ext-editor-btn is-placeholder" id="${a.id}" data-ai-intent="${a.intent}">${a.label}</button>`,
          ).join("")}
        </div>
        <p class="muted ext-note" id="edAiStatus">No AI provider is connected yet - these actions are stubs.</p>
      </div>
      <div class="ext-column ext-column-wide">
        <label class="preview-label">Request preview</label>
        <pre class="ai-request" id="edAiRequest">Choose an action to see the request that would be sent.</pre>
      </div>
    </div>
  `;
}

export function bindAiPanel(getView, onPatch, onNotify) {
  document.getElementById("edAiPrompt")?.addEventListener("input", (event) => {
    onPatch({ aiNotes: event.target.value }, "ai-panel");
  });

  AI_ACTIONS.forEach((action) => {
    document.getElementById(action.id)?.addEventListener("click", () => {
      const request = buildAiRequest(action.intent, getView());
      const preview = document.getElementById("edAiRequest");
      if (preview) preview.textContent = JSON.stringify(request, null, 2);
      const status = document.getElementById("edAiStatus");
      if (status) status.textContent = `"${action.label}" is stubbed - the request below was built but not sent.`;
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
