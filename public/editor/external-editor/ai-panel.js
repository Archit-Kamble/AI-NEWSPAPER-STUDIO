// Part 9: the AI workspace. Every action is a stub by instruction - no provider
// is called and no content is written. Each button builds and displays the exact
// request an integration would send, so the contract is visible and testable
// before any provider exists.

import { escapeHtml } from "../format.js";
import { buildFlowMap, flowAscii, flowFit, flowImageFromRow } from "../layout/text-flow.js";

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

// Step 6 of the flow, and the heart of it.
//
// The AI is not asked for "about 400 words". It is handed the block as a
// character grid - H for headline, S for subheading, T for copy, I for where
// the picture sits - and a character budget that already accounts for the
// picture's shape. A ragged cut-out produces ragged rows, so text runaround is
// part of the same brief rather than a separate problem.
export function fitBrief(section, view, images = []) {
  const map = buildFlowMap(section, view, images.map(flowImageFromRow));
  const fit = flowFit(map);

  return {
    sectionKey: view.sectionKey,
    blockPx: { width: Number(section?.width_px) || 0, height: Number(section?.height_px) || 0 },
    blockMm: {
      width: Math.round((Number(section?.width_px) || 0) / 2),
      height: Math.round((Number(section?.height_px) || 0) / 2),
    },
    grid: { cols: map.cols, rows: map.rows, cellWidthPx: map.cellWidth, cellHeightPx: map.cellHeight },
    // The map, exactly as a compositor would sketch it.
    map: flowAscii(map),
    legend: { H: "headline", S: "subheading", T: "body text", I: "image" },
    bodyCharBudget: map.bodyCharBudget,
    bodyWordBudget: map.bodyWordBudget,
    charsUsed: fit.used,
    charsRemaining: fit.remaining,
    overflowing: fit.overflowing,
    bodyFontPx: view.bodyFontPx,
    language: view.language || "Marathi",
  };
}

// How hard the model should think. Three tiers rather than three models,
// because the provider that writes this paper's Marathi ships exactly one chat
// model - what it has is an effort dial, and that is the thing worth exposing.
// The list is fetched from /api/ai/status so the menu describes the newsroom
// that is actually configured; this is the fallback if that has not loaded yet.
let AI_TIERS = [
  { key: "basic", name: "Basic", hint: "Quick — for fillers, captions and briefs" },
  { key: "plus", name: "Plus", hint: "Considered — for reworking a story to its measure" },
  { key: "ultra", name: "Ultra", hint: "Best — for the lead. Slower, and a few paise more" },
];
let aiStatus = null;

/** Called once when the workspace loads; keeps the menu honest about the setup. */
export async function loadAiStatus() {
  try {
    const status = await fetch("/api/ai/status").then((r) => (r.ok ? r.json() : null));
    if (!status) return null;
    aiStatus = status;
    if (Array.isArray(status.tiers) && status.tiers.length) AI_TIERS = status.tiers;
    return status;
  } catch {
    return null;
  }
}

export function getAiTier() {
  return document.getElementById("edAiTier")?.value || "basic";
}

function tierSelectMarkup() {
  // If the configured provider has no effort dial, say so rather than offering
  // three choices that quietly do the same work at the same price.
  const meaningless = aiStatus && aiStatus.configured && !aiStatus.tiersMeaningful;
  return `
    <label class="ai-tier">
      <span>Effort</span>
      <select id="edAiTier" title="${meaningless
        ? "The configured provider has no effort setting, so these behave the same"
        : "How hard the model should think about this block"}">
        ${AI_TIERS.map(
          (tier, index) =>
            `<option value="${escapeHtml(tier.key)}"${index === 0 ? " selected" : ""}>${escapeHtml(
              tier.name,
            )} — ${escapeHtml(tier.hint || "")}</option>`,
        ).join("")}
      </select>
    </label>`;
}

function aiStatusLine() {
  if (!aiStatus) return "No AI provider is connected yet - these actions are stubs.";
  if (!aiStatus.configured) {
    return aiStatus.hint || "No AI provider is configured. Add a key to .env.";
  }
  const fallback = aiStatus.fallback?.ready ? `, falling back to ${aiStatus.fallback.name}` : "";
  return `Writing with ${aiStatus.provider?.name}${fallback}.`;
}

export function aiPanelMarkup(view) {
  return `
    ${tierSelectMarkup()}
    <button type="button" class="btn-submit is-placeholder" id="aiFillRemaining">Fill remaining area with AI</button>
    <div class="form-group">
      <label for="edAiPrompt">Additional details for AI</label>
      <textarea id="edAiPrompt" rows="3" placeholder="Extra instructions - tone, angle, must-mention facts...">${escapeHtml(view.aiNotes)}</textarea>
    </div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn is-placeholder" id="aiOptimize">Optimize with these details</button>
    </div>
    <details class="ext-more">
      <summary>More AI actions</summary>
      <div class="ext-editor-toolbar">
        ${AI_ACTIONS.map(
          (a) => `<button type="button" class="ext-editor-btn is-placeholder" id="${a.id}" data-ai-intent="${a.intent}">${a.label}</button>`,
        ).join("")}
      </div>
      <label class="preview-label">Request preview</label>
      <pre class="ai-request" id="edAiRequest">Choose an action to see the request that would be sent.</pre>
    </details>
    <p class="muted ext-note" id="edAiStatus">${escapeHtml(aiStatusLine())}</p>
  `;
}

export function bindAiPanel(getView, getSection, onPatch, onNotify, getImages) {
  document.getElementById("edAiPrompt")?.addEventListener("input", (event) => {
    onPatch({ aiNotes: event.target.value }, "ai-panel");
  });

  const runStub = (label, intent) => {
    const view = getView();
    const section = getSection();
    const images = getImages ? getImages() : [];
    // The tier rides with the request, so the preview shows exactly what would
    // be sent - including how hard the model was asked to think.
    const request = {
      ...buildAiRequest(intent, view),
      tier: getAiTier(),
      fit: section ? fitBrief(section, view, images) : null,
    };
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
