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
    <!-- A few words in, a whole block out.
         The seed is the point: a sub-editor types "जंतरमंतर आंदोलन" and gets a
         headline, a subheading and body copy measured to the space this block
         actually has. Everything below it is refinement. -->
    <div class="ai-seed">
      <label for="edAiSeed">What is this story about?</label>
      <input id="edAiSeed" class="ai-seed-input" maxlength="240"
             placeholder="जंतरमंतर आंदोलन · Jantar Mantar protest · a few words is enough"
             value="">
      <button type="button" class="btn-submit" id="aiWriteStory">Write this block</button>
      <p class="ai-seed-note" id="edAiSeedNote">It is written to fit — the character grid says how much room this block has.</p>
    </div>

    <section class="ai-proposal" id="aiStoryProposal" hidden></section>

    ${tierSelectMarkup()}
    <div class="form-group">
      <label for="edAiPrompt">Additional details for AI</label>
      <textarea id="edAiPrompt" rows="3" placeholder="Extra instructions - tone, angle, must-mention facts...">${escapeHtml(view.aiNotes)}</textarea>
    </div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn" id="aiFillRemaining"
              title="Carry the copy on into the space this block has left, without changing a word of what is there">Fill remaining area with AI</button>
      <button type="button" class="ext-editor-btn is-placeholder" id="aiOptimize">Optimize with these details</button>
    </div>
    <section class="ai-proposal" id="aiFillProposal" hidden></section>
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

/** The proposal, with what it costs the block stated before it is accepted. */
function proposalMarkup(result) {
  const { proposal, fit } = result;
  const over = fit.overflowing;
  return `
    <h4>Written by ${escapeHtml(result.provider || "AI")}${result.fellBackTo ? " (fallback)" : ""}
      <span class="muted">review before accepting</span></h4>
    <p class="ai-proposal-headline">${escapeHtml(proposal.headline)}</p>
    ${proposal.subheading ? `<p class="ai-proposal-sub">${escapeHtml(proposal.subheading)}</p>` : ""}
    <p class="ai-proposal-fit${over ? " over" : ""}">
      ${fit.charsUsed} of ${fit.bodyCharBudget} characters${over ? ` — ${fit.charsUsed - fit.bodyCharBudget} too many, this will not fit` : ` · ${fit.charsRemaining} left`}
    </p>
    <div class="ai-proposal-body">${escapeHtml(proposal.body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="aiAcceptStory">Accept into the block</button>
      <button type="button" class="ext-editor-btn" id="aiDiscardStory">Discard</button>
    </div>
    <p class="ai-proposal-warn">The desk must check every fact before this is printed. It enters the block as
       <strong>needs review</strong>.</p>`;
}

/**
 * The filled copy, with what it did to the block stated before it is accepted.
 *
 * Shows the whole body as it would stand, not just the addition: the desk is
 * accepting the whole thing, and the point of the action is that the copy
 * already there is unchanged - which is only checkable if it is shown.
 */
function fillProposalMarkup(result) {
  const { proposal, fit } = result;
  const added = fit.charsUsed - fit.charsBefore;
  return `
    <h4>Filled by ${escapeHtml(result.provider || "AI")}${result.fellBackTo ? " (fallback)" : ""}
      <span class="muted">review before accepting</span></h4>
    <p class="ai-proposal-fit${fit.overflowing ? " over" : ""}">
      ${fit.charsBefore} → ${fit.charsUsed} of ${fit.bodyCharBudget} characters${
        fit.overflowing
          ? ` — ${fit.charsUsed - fit.bodyCharBudget} too many, this will not fit`
          : ` · added ${added}, ${fit.charsRemaining} left`
      }
    </p>
    ${result.retriedAt ? `<p class="muted ext-note">Written at the ${escapeHtml(result.retriedAt)} tier — the tier you asked for could not finish inside its output limit.</p>` : ""}
    <div class="ai-proposal-body">${escapeHtml(proposal.body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="aiAcceptFill">Accept into the block</button>
      <button type="button" class="ext-editor-btn" id="aiDiscardFill">Discard</button>
    </div>
    <p class="ai-proposal-warn">The desk must check every fact before this is printed. It enters the block as
       <strong>needs review</strong>.</p>`;
}

export function bindAiPanel(getView, getSection, onPatch, onNotify, getImages, getPage) {
  const seed = document.getElementById("edAiSeed");
  const write = document.getElementById("aiWriteStory");
  const host = document.getElementById("aiStoryProposal");

  // The seed is deliberately NOT patched into the draft. It is a note to the
  // model, not part of the story, and putting an unknown field on the draft
  // would mark the block dirty and set autosave running for something that is
  // never stored.

  write?.addEventListener("click", async () => {
    const page = getPage?.();
    const section = getSection();
    const view = getView();
    if (!page || !section) return onNotify("Choose a block first.");
    if (!seed?.value.trim()) {
      seed?.focus();
      return onNotify("Say what the story is about first — a few words is enough.");
    }

    const label = write.textContent;
    write.disabled = true;
    write.textContent = "Writing to the measure…";
    try {
      const response = await fetch(
        `/api/pages/${page.id}/sections/${encodeURIComponent(section.section_key)}/write`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seed: seed.value.trim(),
            notes: document.getElementById("edAiPrompt")?.value || "",
            tier: getAiTier(),
            language: view?.language,
          }),
        },
      );
      const result = await response.json().catch(() => ({ error: "The AI did not answer." }));
      if (!response.ok || result.error) return onNotify(result.error || "The AI could not write this block.");

      host.hidden = false;
      host.innerHTML = proposalMarkup(result);
      document.getElementById("aiAcceptStory")?.addEventListener("click", () => {
        // A proposal becomes a draft, never a saved story: it lands in the same
        // editable draft as typed copy and is marked for review.
        onPatch({ ...result.proposal, aiGenerated: true, status: "needs_review" }, "ai-panel");
        host.hidden = true;
        onNotify("Written into the block. Check every fact before it prints.");
      });
      document.getElementById("aiDiscardStory")?.addEventListener("click", () => { host.hidden = true; });
    } finally {
      write.disabled = false;
      write.textContent = label;
    }
  });

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

  // Fill remaining area. The first of these that is real: it goes to the same
  // server-side story writer "Write this block" uses, briefed with the block's
  // measured room, and comes back as a proposal the desk accepts.
  const fill = document.getElementById("aiFillRemaining");
  const fillHost = document.getElementById("aiFillProposal");
  fill?.addEventListener("click", async () => {
    const page = getPage?.();
    const section = getSection();
    const view = getView();
    if (!page || !section) return onNotify("Choose a block first.");

    const label = fill.textContent;
    fill.disabled = true;
    fill.textContent = "Measuring, then writing…";
    try {
      const response = await fetch(
        `/api/pages/${page.id}/sections/${encodeURIComponent(section.section_key)}/fill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: document.getElementById("edAiPrompt")?.value || "",
            tier: getAiTier(),
            language: view?.language,
          }),
        },
      );
      const result = await response.json().catch(() => ({ error: "The AI did not answer." }));
      if (!response.ok || result.error) return onNotify(result.error || "The AI could not fill this block.");

      fillHost.hidden = false;
      fillHost.innerHTML = fillProposalMarkup(result);
      document.getElementById("aiAcceptFill")?.addEventListener("click", () => {
        // Only the body. The headline and the deck the desk wrote are not
        // touched, and nothing is saved until autosave carries the draft - the
        // reporter's copy is still in the block's history either way.
        onPatch({ body: result.proposal.body, aiGenerated: true, status: "needs_review" }, "ai-panel");
        fillHost.hidden = true;
        onNotify("Filled. Check every fact before it prints.");
      });
      document.getElementById("aiDiscardFill")?.addEventListener("click", () => {
        fillHost.hidden = true;
        fillHost.innerHTML = "";
      });
    } finally {
      fill.disabled = false;
      fill.textContent = label;
    }
  });

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
