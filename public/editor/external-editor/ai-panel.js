// The AI panel. AI ASSISTS - it never owns, and it never writes.
//
// Two actions are real and go to the server-side story writer: "Write this
// block" and "Fill remaining area with AI". Both return a PROPOSAL, both land
// in the same editable draft as typed copy, marked needs_review, and neither
// touches the database - the desk accepts, autosave carries it.
//
// Everything under "More AI actions", and Optimize, are still stubs: they build
// and display the exact request an integration would send. They are marked
// `is-placeholder` in the markup so nothing here pretends to work.
//
// Replacing copy somebody has already written asks first (confirmReplacement).

import { escapeHtml } from "../format.js";
import { buildFlowMap, flowAscii, flowFit, flowImageFromRow } from "../layout/text-flow.js";
import { plainText } from "../layout/rich-text.js";
import { composeSection } from "../compose/section-adapter.js";

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
// This preview is for the unfinished, explicitly marked "More AI actions"
// only. It remains a helpful schematic for a person reading a future request,
// but it is never a fit decision: Write and Fill go to the server's exact
// compositor, which measures real shaped lines, columns and picture runaround.
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
    paintAiStatus();
    return status;
  } catch {
    return null;
  }
}

/**
 * Puts the answer on screen when it arrives.
 *
 * workspace.js calls loadAiStatus() WITHOUT awaiting it and renders the panels
 * on the next line, so the first paint always happens with `aiStatus` still
 * null - and nothing re-rendered the panel afterwards. The desk was therefore
 * shown "Checking which provider is configured…" for as long as they left the
 * selection alone, on the one line whose whole job is to say who writes this
 * paper's copy. Selecting a block happened to fix it, which is why it survived:
 * the fault is invisible to anyone who clicks something.
 *
 * Awaiting the fetch before the first paint would fix it too, and would hold
 * the whole editor behind a network call to say one sentence. So the line is
 * repainted in place instead - and the effort dial with it, because whether
 * the tiers mean anything is part of the same answer (a provider with no
 * effort setting must not be offered three choices that cost the same).
 */
function paintAiStatus() {
  const line = document.getElementById("edAiStatus");
  if (line) line.textContent = aiStatusLine();

  // Rebuilt rather than patched: the option list itself comes from the server
  // when the server has one. getAiTier() reads the value by id at press time,
  // so replacing the options cannot leave a stale handler behind - the
  // #edSpaceGroup trap, avoided by not binding to this element at all.
  const tier = document.getElementById("edAiTier");
  if (!tier) return;
  const chosen = tier.value;
  const holder = document.createElement("div");
  holder.innerHTML = tierSelectMarkup();
  const fresh = holder.querySelector("select");
  if (!fresh) return;
  tier.title = fresh.title;
  tier.innerHTML = fresh.innerHTML;
  if ([...tier.options].some((option) => option.value === chosen)) tier.value = chosen;
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
  // Before /api/ai/status has answered. Not "these actions are stubs" - two of
  // them are real, and a line that is wrong in the other direction is worse.
  if (!aiStatus) return "Checking which provider is configured…";
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
      <!-- A block is not always a story with a headline over it: a sidebar, a
           box-out, a second leg under a headline that is already set. Both on
           by default, so the ordinary block is unchanged - and turning one off
           does not merely hide the field, it changes what the block is
           MEASURED as, so the copy is written for the room it will really
           have (storyWriter.js's planningFit). -->
      <div class="ai-parts">
        <label class="toggle"><input type="checkbox" id="edAiWriteHeadline" checked> Write a headline</label>
        <label class="toggle"><input type="checkbox" id="edAiWriteSubheading" checked> Write a subheading</label>
      </div>
      <p class="ai-seed-note" id="edAiSeedNote">It is written to fit — the exact compositor measures this block's real lines, columns and picture room.</p>
    </div>

    <section class="ai-retrieval" id="aiRetrievalStatus" hidden></section>
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
/**
 * Why the understudy wrote this, when it did.
 *
 * The desk does not need a status code; it needs to know whether to press the
 * button again in a minute (busy) or not to bother until tomorrow (quota).
 */
function handoverNote(result) {
  if (!result.handover?.note) return "";
  return `<p class="muted ext-note">${escapeHtml(result.handover.note)}</p>`;
}

// What "Write this block" checked before it asked a model anything, for a
// current-event seed. `result.retrieval` is only ever present when the seed
// was classified as needing today's facts (see storyWriter.service.js) - an
// evergreen or reporter-copy request never sets it, and this stays hidden.
const RETRIEVAL_ICON = { verified: "✓", conflicting: "⚠", insufficient: "⚠", unavailable: "○" };
const RETRIEVAL_LABEL = {
  verified: "Verified from current sources",
  conflicting: "Sources disagree",
  insufficient: "Not enough current information",
  unavailable: "No source configured",
};

function sourceListMarkup(sources) {
  if (!sources?.length) return "";
  const rows = sources.map((s) => {
    const when = s.publishedAt ? new Date(s.publishedAt).toLocaleString() : "no date";
    const link = s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">source</a>` : "";
    return `<li><strong>${escapeHtml(s.publisher || "Unknown")}</strong>
      <span class="muted">${escapeHtml(s.trust || "UNKNOWN")} · ${escapeHtml(when)}</span> ${link}</li>`;
  }).join("");
  // An internal audit trail for the desk - never printed. The article body
  // itself never carries a citation; this is the only place a source is named.
  return `<details class="ai-retrieval-sources">
    <summary>${sources.length} source${sources.length === 1 ? "" : "s"} checked</summary>
    <ul>${rows}</ul>
  </details>`;
}

export function retrievalStatusMarkup(retrieval) {
  if (!retrieval) return "";
  const icon = RETRIEVAL_ICON[retrieval.status] || "○";
  const label = RETRIEVAL_LABEL[retrieval.status] || retrieval.status;
  return `<p class="ai-retrieval-line ai-retrieval-${escapeHtml(retrieval.status)}">${icon} ${escapeHtml(label)}</p>
    ${sourceListMarkup(retrieval.sources)}`;
}

function proposalMarkup(result) {
  const { proposal, fit } = result;
  const over = fit.overflowing;
  const blocked = proposalCannotPrint(fit);
  return `
    <h4>Written by ${escapeHtml(result.provider || "AI")}${result.fellBackTo ? " (fallback)" : ""}
      <span class="muted">review before accepting</span></h4>
    ${handoverNote(result)}
    <p class="ai-proposal-headline">${escapeHtml(proposal.headline)}</p>
    ${proposal.subheading ? `<p class="ai-proposal-sub">${escapeHtml(proposal.subheading)}</p>` : ""}
    <p class="ai-proposal-fit${over ? " over" : ""}">
      ${fitLine(fit)}
    </p>
    ${underfillNote(fit)}
    <div class="ai-proposal-body">${escapeHtml(proposal.body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="aiAcceptStory"${blocked ? " disabled" : ""}>${blocked ? "Cannot accept — does not fit" : "Accept into the block"}</button>
      <button type="button" class="ext-editor-btn" id="aiDiscardStory">Discard</button>
    </div>
    ${blocked ? '<p class="ai-proposal-underfill">This proposal cannot be accepted because exact composition still oversets or its headline remains underfilled. Discard it and write again.</p>' : ""}
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
// How the proposal sits in the block, in the one unit that has no range in
// it. This line used to read "124 of 203 characters · 79 left" on a block the
// Space panel called 95% full one click later - two surfaces quoting two
// different points of a character range 1.7x wide, and the desk correctly
// called it wrong. Lines are exact and are what the eye is already reading;
// the character count stays as a secondary figure for the writer.
function fitLine(fit) {
  const fill = fit && fit.fill;
  if (!fill) {
    const over = fit.overflowing;
    return `${fit.charsUsed} of ${fit.bodyCharBudget} characters${over ? ` — ${fit.charsUsed - fit.bodyCharBudget} too many, this will not fit` : ""}`;
  }
  if (fit.overflowing) return `${fill.linesUsed} lines set — this runs past the foot of the block and will not fit`;
  const hole = fill.holeLines;
  // Fractional on purpose. A row a cut-out halves really is half a line of
  // room, and rounding it to a whole one is how a block with a silhouette
  // beside its copy reported itself fuller than it was.
  const room = hole >= 1 ? ` · ${hole} line${hole >= 2 ? "s" : ""} still free` : " · full to the foot";
  return `${fill.linesUsed} of ${fill.linesAvailable} lines${room} (${fit.charsUsed} characters)`;
}

// A block the material could not fill. Not an error and not a failure of the
// AI - the honest third outcome, and the desk is the only one who can act on
// it. Saying "it fits" here is what puts a half-empty block on a printed page.
function underfillNote(fit) {
  if (!fit || fit.state !== "SOURCE_LIMITED_UNDERFILL") return "";
  const hole = fit.fill ? fit.fill.holeLines : 0;
  return `<p class="ai-proposal-underfill">Still ${hole} line${hole >= 2 ? "s" : ""} short of the foot.
    There was not enough material to say more without inventing it — add source material,
    make a picture larger, or move this story to a smaller block.</p>`;
}

function fillProposalMarkup(result) {
  const { proposal, fit } = result;
  const added = fit.charsUsed - fit.charsBefore;
  const blocked = proposalCannotPrint(fit);
  return `
    <h4>Filled by ${escapeHtml(result.provider || "AI")}${result.fellBackTo ? " (fallback)" : ""}
      <span class="muted">review before accepting</span></h4>
    ${handoverNote(result)}
    <p class="ai-proposal-fit${fit.overflowing ? " over" : ""}">
      ${added >= 0 ? `+${added} characters` : `${added} characters`} · ${fitLine(fit)}
    </p>
    ${underfillNote(fit)}
    ${result.retriedAt ? `<p class="muted ext-note">Written at the ${escapeHtml(result.retriedAt)} tier — the tier you asked for could not finish inside its output limit.</p>` : ""}
    <div class="ai-proposal-body">${escapeHtml(proposal.body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</div>
    <div class="ext-editor-toolbar">
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="aiAcceptFill"${blocked ? " disabled" : ""}>${blocked ? "Cannot accept — does not fit" : "Accept into the block"}</button>
      <button type="button" class="ext-editor-btn" id="aiDiscardFill">Discard</button>
    </div>
    <p class="ai-proposal-warn">The desk must check every fact before this is printed. It enters the block as
       <strong>needs review</strong>.</p>`;
}

// A proposal was measured on the persisted block. Typography, columns or a
// picture can change while the provider is answering; accepting that stale
// answer is how copy measured at 10px was allowed into a live 14px body and
// immediately overset. The composition fingerprint covers the words, type,
// columns and complete image geometry. Re-compose at click time and require
// the identical fingerprint—no second fit formula and no API call.
export function proposalSnapshotMatches(section, view, images, proposal, expectedFingerprint) {
  if (!expectedFingerprint || !section || !view) return false;
  try {
    const composed = composeSection(
      { ...section, images: images || [] },
      { ...view, ...proposal },
    );
    const notReady = composed.fontReady === false
      || (composed.warnings || []).some((warning) => /^(FONT|SHAPING)_NOT_READY$/.test(warning.code || ""));
    return !notReady && composed.fingerprint === expectedFingerprint;
  } catch {
    return false;
  }
}

export function proposalCannotPrint(fit = {}) {
  return Boolean(
    fit.overflowing
    || fit.displayOverflowing
    || fit.engineState === "OVERSET"
    || fit.state === "HEADLINE_UNDERFILLED",
  );
}

/**
 * Asks before written copy is thrown away.
 *
 * VISION.md: AI assists, it never owns, and it never overwrites user content
 * without confirmation. An empty block is not a question - nothing is being
 * lost - so this only speaks when there is something to lose, which is what
 * keeps it worth reading when it does.
 */
function confirmReplacement(view) {
  const has = (value) => Boolean(plainText(value || "").trim());
  if (!view || (!has(view.body) && !has(view.headline))) return true;

  const what = view.newsItemId
    ? "This block holds a reporter's story."
    : "This block already has copy in it.";
  return window.confirm(`${what}\n\nReplace the headline, subheading and body with the AI's version?`);
}

export function bindAiPanel(getView, getSection, onPatch, onNotify, getImages, getPage, onSave) {
  const seed = document.getElementById("edAiSeed");
  const write = document.getElementById("aiWriteStory");
  const host = document.getElementById("aiStoryProposal");
  const retrievalHost = document.getElementById("aiRetrievalStatus");

  // The seed is deliberately NOT patched into the draft. It is a note to the
  // model, not part of the story, and putting an unknown field on the draft
  // would mark the block dirty and set autosave running for something that is
  // never stored.

  write?.addEventListener("click", async () => {
    if (!seed?.value.trim()) {
      seed?.focus();
      return onNotify("Say what the story is about first — a few words is enough.");
    }

    const label = write.textContent;
    write.disabled = true;
    write.textContent = "Writing to the measure…";
    if (retrievalHost) { retrievalHost.hidden = true; retrievalHost.innerHTML = ""; }
    try {
      // The server measures the persisted row. Flush live typography/column
      // edits first, then resolve fresh objects after PAGE_SYNC replaces them.
      await onSave?.();
      const page = getPage?.();
      const section = getSection();
      const view = getView();
      if (!page || !section) return onNotify("Choose a block first.");
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
            writeHeadline: document.getElementById("edAiWriteHeadline")?.checked !== false,
            writeSubheading: document.getElementById("edAiWriteSubheading")?.checked !== false,
          }),
        },
      );
      const result = await response.json().catch(() => ({ error: "The AI did not answer." }));

      // Shown whenever the seed was checked against current sources at all -
      // whether the write went on to succeed or was refused. A current-event
      // seed that was refused still gets a status line, not just a toast: the
      // desk should see WHY (insufficient/conflicting/unavailable) without
      // having to re-read the notification.
      if (retrievalHost && result.retrieval) {
        retrievalHost.hidden = false;
        retrievalHost.innerHTML = retrievalStatusMarkup(result.retrieval);
      }

      if (!response.ok || result.error) return onNotify(result.error || "The AI could not write this block.");

      host.hidden = false;
      host.innerHTML = proposalMarkup(result);
      document.getElementById("aiAcceptStory")?.addEventListener("click", () => {
        if (proposalCannotPrint(result.fit)) {
          return onNotify("This proposal does not meet the block's exact print fit. Discard it and write again.");
        }
        if (!proposalSnapshotMatches(
          getSection(), getView(), getImages?.() || [], result.proposal,
          result.fit.compositionFingerprint,
        )) {
          return onNotify("The block's type, columns or pictures changed while this was being written. Save, then write it again for the current shape.");
        }
        // "Write this block" replaces the headline, the deck AND the body. On an
        // empty block that is the whole point; on a block somebody has already
        // written - or a reporter has filed - it is destruction, and one click
        // away from it is not enough. Accepting is explicit; replacing written
        // copy is explicit twice.
        if (!confirmReplacement(getView())) return;
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
    const label = fill.textContent;
    fill.disabled = true;
    fill.textContent = "Measuring, then writing…";
    try {
      await onSave?.();
      const page = getPage?.();
      const section = getSection();
      const view = getView();
      if (!page || !section) return onNotify("Choose a block first.");
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
        if (proposalCannotPrint(result.fit)) {
          return onNotify("This proposal does not meet the block's exact print fit. Discard it and fill again.");
        }
        if (!proposalSnapshotMatches(
          getSection(), getView(), getImages?.() || [], result.proposal,
          result.fit.compositionFingerprint,
        )) {
          return onNotify("The block's type, columns or pictures changed while this was being written. Save, then fill it again for the current shape.");
        }
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
