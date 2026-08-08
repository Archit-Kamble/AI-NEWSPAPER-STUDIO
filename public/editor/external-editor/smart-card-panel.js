// A Smart Card is generated for the selected block's real capacity. It is a
// proposal, never an automatic overwrite: the desk accepts it into the same
// editable draft as ordinary copy.

import { escapeHtml } from "../format.js";

const CARDS = [
  { key: "panchang", icon: "☀", label: "पंचांग", detail: "सूर्योदय, सूर्यास्त, राहुकाळ", source: "Calculated" },
  { key: "rashi", icon: "♈", label: "राशीभविष्य", detail: "दैनिक राशी — editorial review", source: "AI draft" },
  { key: "suvichar", icon: "✦", label: "सुविचार", detail: "आजचा विचार आणि श्रेय", source: "AI draft" },
  { key: "dinvishesh", icon: "◷", label: "दिनविशेष", detail: "तपासलेली ऐतिहासिक नोंद", source: "Curated" },
  { key: "sudoku", icon: "▦", label: "सुडोकू", detail: "आजचे निर्धारक कोडे", source: "Calculated" },
  { key: "havaman", icon: "☁", label: "हवामान", detail: "विश्वसनीय स्रोत जोडणे बाकी", source: "Source needed", unavailable: true },
];

function choice(card, selected) {
  return `<button type="button" class="smart-card-choice${selected ? " is-selected" : ""}${card.unavailable ? " is-unavailable" : ""}"
    data-smart-card="${card.key}" aria-pressed="${selected}"${card.unavailable ? " disabled" : ""}>
    <span class="smart-card-icon">${card.icon}</span><span class="smart-card-choice-copy"><strong>${card.label}</strong><small>${card.detail}</small></span>
    <span class="smart-card-source">${card.source}</span></button>`;
}

export function smartCardMarkup() {
  return `<div class="smart-card-panel">
    <p class="smart-card-intro">Generate a recurring daily feature for this exact block. You review it before it changes the story.</p>
    <div class="smart-card-grid" role="group" aria-label="Smart Card type">${CARDS.map((card, i) => choice(card, i === 0)).join("")}</div>
    <fieldset class="smart-card-rashi-options" id="smartCardRashiOptions" hidden>
      <legend>राशींचा समावेश</legend><p>Automatic uses the available space. Override only for this edition.</p>
      <div class="smart-card-pills"><button type="button" class="is-selected" data-rashi-variant="auto">Automatic</button><button type="button" data-rashi-variant="one">1 sign</button><button type="button" data-rashi-variant="three">3 signs</button><button type="button" data-rashi-variant="all">All 12</button></div>
    </fieldset>
    <div class="smart-card-footer"><span class="smart-card-fit-note" id="smartCardFitNote">Measured against this block</span><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="smartCardGenerate">Prepare card for review</button></div>
  </div><section id="smartCardProposal" class="ai-proposal smart-card-proposal" hidden></section>`;
}

function proposalMarkup(result) {
  const proposal = result.proposal;
  const source = result.source === "written" ? "AI draft — review required" : result.source === "curated" ? "Checked desk data" : "Calculated in SAHAS";
  return `<h4>${escapeHtml(proposal.headline)} <span class="muted">${source}</span></h4>
    ${proposal.subheading ? `<p class="smart-card-subtitle">${escapeHtml(proposal.subheading)}</p>` : ""}
    <p class="ai-proposal-fit">${result.fit.charsUsed} of ${result.fit.bodyCharBudget} characters · ${result.fit.charsRemaining} left</p>
    <p>${escapeHtml(proposal.body).replace(/\n/g, "<br>")}</p>
    <div class="ext-editor-toolbar"><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="smartCardAccept">Accept card</button><button type="button" class="ext-editor-btn" id="smartCardDismiss">Discard</button></div>`;
}

export function bindSmartCard(requestCard, onPatch, onNotify) {
  let key = "panchang";
  let variant = "auto";
  const options = document.getElementById("smartCardRashiOptions");
  const generate = document.getElementById("smartCardGenerate");
  const selectCard = (next) => {
    key = next;
    document.querySelectorAll("[data-smart-card]").forEach((button) => {
      const selected = button.dataset.smartCard === key;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    options.hidden = key !== "rashi";
  };
  document.querySelectorAll("[data-smart-card]").forEach((button) => button.addEventListener("click", () => selectCard(button.dataset.smartCard)));
  document.querySelectorAll("[data-rashi-variant]").forEach((button) => button.addEventListener("click", () => {
    variant = button.dataset.rashiVariant;
    document.querySelectorAll("[data-rashi-variant]").forEach((choiceButton) => choiceButton.classList.toggle("is-selected", choiceButton === button));
  }));
  generate?.addEventListener("click", async () => {
    generate.disabled = true;
    const label = generate.textContent;
    generate.textContent = "Measuring this block…";
    try {
      const result = await requestCard?.({ key, variant: key === "rashi" ? variant : "auto" });
      if (result?.error) return onNotify(result.error);
      if (!result?.proposal) return onNotify("No verified content is available for this card on this date.");
      const host = document.getElementById("smartCardProposal");
      host.hidden = false;
      host.innerHTML = proposalMarkup(result);
      document.getElementById("smartCardAccept")?.addEventListener("click", () => {
        onPatch({ ...result.proposal, aiGenerated: result.source === "written", status: "needs_review" }, "smart-card");
        host.hidden = true;
        onNotify("Smart Card added to the editable draft.");
      });
      document.getElementById("smartCardDismiss")?.addEventListener("click", () => { host.hidden = true; });
    } finally {
      generate.disabled = false;
      generate.textContent = label;
    }
  });
}
