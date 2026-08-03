// Part 9: the AI workspace. Every action is a stub by instruction - no provider
// is called and no content is written. Each button builds and displays the exact
// request an integration would send, so the contract is visible and testable
// before any provider exists.

import { escapeHtml } from "../format.js";
import { computeMetrics } from "../layout/layout-metrics.js";

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

// Step 6 of the flow: measure what is left in the block, then ask AI to write
// text that fits it. The measurement is real; the generation is the stub.
export function fitBrief(section, view) {
  const m = computeMetrics(section, view);
  return {
    sectionKey: view.sectionKey,
    blockPx: { width: m.widthPx, height: m.heightPx },
    imageHeightPx: m.imageHeightPx,
    remainingHeightPx: m.remainingHeightPx,
    remainingAreaPx: m.remainingAreaPx,
    bodyFontPx: view.bodyFontPx,
    columns: view.columnCount,
    approxWordsThatFit: Math.max(0, Math.round((m.remainingAreaPx / (view.bodyFontPx * view.bodyFontPx * 0.42)) || 0)),
    overflowing: m.overflowing,
  };
}

export function aiPanelMarkup(view, section) {
  const brief = section ? fitBrief(section, view) : null;
  return `
    <div class="ext-columns">
      <div class="ext-column ext-column-wide">
        <div class="fit-brief" id="edFitBrief">${brief ? fitBriefMarkup(brief) : ""}</div>
        <button type="button" class="btn-submit is-placeholder" id="aiFillRemaining">Fill remaining area with AI</button>
        <div class="form-group">
          <label>Additional details for AI</label>
          <textarea id="edAiPrompt" rows="4" placeholder="Extra instructions - tone, angle, must-mention facts...">${escapeHtml(view.aiNotes)}</textarea>
        </div>
        <div class="ext-editor-toolbar">
          <button type="button" class="ext-editor-btn is-placeholder" id="aiOptimize">Optimize with these details</button>
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

export function fitBriefMarkup(brief) {
  return `
    <label class="preview-label">Space to fill</label>
    <div class="inspector-row"><span>Block</span><strong>${brief.blockPx.width} × ${brief.blockPx.height} px</strong></div>
    <div class="inspector-row"><span>Image takes</span><strong>${brief.imageHeightPx} px</strong></div>
    <div class="inspector-row"><span>Remaining height</span><strong>${brief.remainingHeightPx} px</strong></div>
    <div class="inspector-row"><span>Roughly fits</span><strong>~${brief.approxWordsThatFit} words</strong></div>
    ${brief.overflowing ? `<p class="warning-item level-error">Content already overflows - shorten before filling.</p>` : ""}
  `;
}

export function refreshFitBrief(section, view) {
  const box = document.getElementById("edFitBrief");
  if (box && section) box.innerHTML = fitBriefMarkup(fitBrief(section, view));
}

export function bindAiPanel(getView, getSection, onPatch, onNotify) {
  document.getElementById("edAiPrompt")?.addEventListener("input", (event) => {
    onPatch({ aiNotes: event.target.value }, "ai-panel");
  });

  const runStub = (label, intent) => {
    const view = getView();
    const section = getSection();
    const request = { ...buildAiRequest(intent, view), fit: section ? fitBrief(section, view) : null };
    const preview = document.getElementById("edAiRequest");
    if (preview) preview.textContent = JSON.stringify(request, null, 2);
    const status = document.getElementById("edAiStatus");
    if (status) status.textContent = `"${label}" is stubbed - the request below was built but not sent.`;
    onNotify(`${label}: AI is not connected yet.`);
  };

  document.getElementById("aiFillRemaining")?.addEventListener("click", () =>
    runStub("Fill remaining area", "fill-remaining"),
  );
  document.getElementById("aiOptimize")?.addEventListener("click", () => runStub("Optimize", "optimize"));

  AI_ACTIONS.forEach((action) => {
    document.getElementById(action.id)?.addEventListener("click", () => runStub(action.label, action.intent));
  });
}

export function refreshAiPanel(view, source) {
  if (source === "ai-panel") return;
  const prompt = document.getElementById("edAiPrompt");
  if (prompt && document.activeElement !== prompt && prompt.value !== view.aiNotes) {
    prompt.value = view.aiNotes;
  }
}
