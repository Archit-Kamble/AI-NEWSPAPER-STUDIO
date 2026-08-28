// A Smart Card is generated for the selected block's real capacity. It is a
// proposal, never an automatic overwrite: the desk sees the card AS A CARD,
// then accepts it into the same editable draft as ordinary copy.
//
// The preview draws with the same renderer the page canvas draws with
// (public/editor/smart-cards/smart-cards.js), so what is reviewed here is what
// prints. It used to show the flattened body text - nine lines of "७ · · ३" -
// which meant the desk approved a wall of dots and found out what it looked
// like on the page.

import { escapeHtml } from "../format.js";
import { smartCardMarkup, canRenderSmartCard, smartCardFitState, SMART_CARD_OVERSET_NOTE } from "../smart-cards/smart-cards.js";
import { ADVERT_STYLES, ADVERT_SAMPLE, DEFAULT_ADVERT_STYLE } from "../smart-cards/advert-styles.js";

const CARDS = [
  { key: "panchang", icon: "☀", label: "पंचांग", detail: "सूर्योदय, सूर्यास्त, राहुकाळ", source: "Calculated" },
  { key: "rashi", icon: "♈", label: "राशीभविष्य", detail: "दैनिक राशी — editorial review", source: "AI draft" },
  { key: "suvichar", icon: "✦", label: "सुविचार", detail: "आजचा विचार आणि श्रेय", source: "AI draft" },
  { key: "dinvishesh", icon: "◷", label: "दिनविशेष", detail: "तपासलेली ऐतिहासिक नोंद", source: "Curated" },
  { key: "sudoku", icon: "▦", label: "सुडोकू", detail: "आजचे निर्धारक कोडे", source: "Calculated" },
  { key: "havaman", icon: "☁", label: "सातारा हवामान", detail: "कमाल, किमान आणि पावसाचा अंदाज", source: "Open-Meteo live" },
  { key: "market", icon: "↗", label: "शेअर / सोने बाजार", detail: "बंद भाव आणि मागील सत्राचा आढावा", source: "Live market API" },
  { key: "tender", icon: "§", label: "निविदा / प्रकटपत्र", detail: "कोणत्याही मजकुरापासून छापील सूचना", source: "AI structures copy" },
  { key: "advert", icon: "▣", label: "जाहिरात", detail: "जाहिरातदाराचा मजकूर व चित्र", source: "AI structures copy" },
];

// Which cards are built from text the OPERATOR pastes rather than from a date
// or a feed. Both open the same box; only the advert also offers artwork.
const MANUAL_CARDS = new Set(["tender", "advert"]);

const MANUAL_PLACEHOLDERS = Object.freeze({
  tender: "उदा. ईमेल किंवा साधा परिच्छेद थेट पेस्ट करा:\n\nसातारा जिल्हाधिकारी कार्यालयाला 15 सप्टेंबरपर्यंत 100 रीम A4 कागदासाठी बंद लिफाफ्यात दरपत्रके हवी आहेत. संपर्क 02162-222222. — जिल्हाधिकारी, सातारा",
  advert: "उदा. जाहिरातदाराचा संदेश जसाच्या तसा पेस्ट करा:\n\nश्री गणेश ट्रेडर्स, सातारा — शेती अवजारे, ठिबक संच व पंप विक्री व दुरुस्ती. गणेश चतुर्थीनिमित्त सर्व पंपांवर 10% सवलत, 20 सप्टेंबरपर्यंत. संपर्क 9822012345. पत्ता: पोवई नाका, सातारा.",
});

// A DESK CHOOSES A SHAPE BY LOOKING AT ONE.
//
// Each demo is drawn with the REAL renderer, at the block that shape asks for,
// then scaled down - so the picker cannot show a shape the page would not
// print, and a style added to the catalogue appears here with no second piece
// of work. One advertiser's copy across all five, because the point is to
// compare shapes and different copy in each would compare the copy.
const DEMO_PICTURE = "data:image/svg+xml;utf8,"
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 5">'
    + '<rect width="8" height="5" fill="#d8d2cc"/><circle cx="5.7" cy="1.5" r="0.7" fill="#efeae5"/>'
    + '<path d="M0 5 L2.6 1.9 L4.6 5 Z" fill="#b7ada4"/><path d="M3.6 5 L5.9 2.7 L8 5 Z" fill="#c7bfb7"/></svg>');

const DEMO_WIDTH_PX = 132;

function advertStyleChoice(style, selected) {
  const block = style.block;
  const drawn = smartCardMarkup("advert", { ...ADVERT_SAMPLE, style: style.key, imageUrl: DEMO_PICTURE },
    { width: block.width, height: block.height, padding: 1 }) || "";
  const scale = DEMO_WIDTH_PX / block.width;
  return `<button type="button" class="advert-style${selected ? " is-selected" : ""}" data-advert-style="${style.key}" aria-pressed="${selected}">
    <span class="advert-style-demo" style="width:${DEMO_WIDTH_PX}px;height:${Math.ceil(block.height * scale)}px">
      <span class="advert-style-sheet" style="width:${block.width}px;height:${block.height}px;transform:scale(${scale})">${drawn}</span>
    </span>
    <strong>${escapeHtml(style.label)}</strong>
    <small>${escapeHtml(style.detail)}</small>
    <em>${block.width} × ${block.height}</em>
  </button>`;
}

function choice(card, selected) {
  return `<button type="button" class="smart-card-choice${selected ? " is-selected" : ""}${card.unavailable ? " is-unavailable" : ""}"
    data-smart-card="${card.key}" aria-pressed="${selected}"${card.unavailable ? " disabled" : ""}>
    <span class="smart-card-icon">${card.icon}</span><span class="smart-card-choice-copy"><strong>${card.label}</strong><small>${card.detail}</small></span>
    <span class="smart-card-source">${card.source}</span></button>`;
}

/**
 * What card this block is holding right now, if any.
 *
 * Shown at the top of the panel because otherwise the only way to find out is
 * to look at the page - and the block that a card was put into by mistake is
 * exactly the one a desk needs to be able to clear.
 */
function placedMarkup(view) {
  if (!view?.smartCardKey || !view?.smartCardData) return "";
  const card = CARDS.find((c) => c.key === view.smartCardKey);
  return `<div class="smart-card-placed" id="smartCardPlaced">
    <span>This block holds <strong>${escapeHtml(card?.label || view.smartCardKey)}</strong></span>
    <button type="button" class="ext-editor-btn" id="smartCardRemove">Remove card</button>
  </div>`;
}

export function smartCardMarkupPanel(view) {
  return `<div class="smart-card-panel">
    ${placedMarkup(view)}
    <p class="smart-card-intro">Generate a recurring daily feature for this exact block. You review it before it changes the story.</p>
    <div class="smart-card-grid" role="group" aria-label="Smart Card type">${CARDS.map((card, i) => choice(card, i === 0)).join("")}</div>
    <fieldset class="smart-card-rashi-options" id="smartCardRashiOptions" hidden>
      <legend>राशींचा समावेश</legend><p>Automatic uses the available space. Override only for this edition.</p>
      <div class="smart-card-pills"><button type="button" class="is-selected" data-rashi-variant="auto">Automatic</button><button type="button" data-rashi-variant="one">1 sign</button><button type="button" data-rashi-variant="three">3 signs</button><button type="button" data-rashi-variant="all">All 12</button></div>
    </fieldset>
    <fieldset class="smart-card-manual-input" id="smartCardManualInput" hidden>
      <legend id="smartCardManualLegend">Paste any source text</legend>
      <p>Paste an email, paragraph or ordinary note, or load a TXT, CSV or JSON file. The newsroom AI turns it into the formal layout; you review every fact before accepting it.</p>
      <textarea id="smartCardManualText" rows="10"></textarea>
      <label class="smart-card-file-label">Load data/text file <input id="smartCardManualFile" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json"></label>
    </fieldset>
    <!-- An advertisement's artwork. Supplied wins over generated: a desk that
         has the advertiser's own picture is not asking a model to imagine it.
         A generated illustration is briefed WITHOUT text - generated
         Devanagari is unreadable, and the advertiser's words are the
         compositor's to set - and is marked AI on the card itself. -->
    <!-- WHICH SHAPE OF ADVERT. A district daily prints several, and until this
         existed the product could only set one of them. The demos are drawn by
         the real renderer at the block each shape asks for. -->
    <fieldset class="advert-style-field" id="smartCardAdvertStyle" hidden>
      <legend>What kind of advertisement</legend>
      <p>Pick the shape first — it decides how the copy is set and the block the advert brings with it.</p>
      <div class="advert-style-grid" role="group" aria-label="Advertisement style"></div>
    </fieldset>
    <fieldset class="smart-card-artwork-field" id="smartCardArtwork" hidden>
      <legend>Artwork</legend>
      <label class="smart-card-file-label">The advertiser's own picture
        <input id="smartCardAdvertImage" type="file" accept="image/*"></label>
      <label class="smart-card-check"><input type="checkbox" id="smartCardWantsArtwork">
        Generate an illustration sized for this block, if none is supplied</label>
    </fieldset>
    <!-- WHERE THE CARD LANDS. A desk should not have to find, size and empty a
         frame before they can see what a card looks like - so the default is
         that the card brings its own block, at the size a printed paper gives
         that card (layout.js's SMART_CARD_BLOCK_SIZE). Putting it into the
         block already open stays available, because replacing a card that is
         already on the page is an ordinary thing to do. -->
    <fieldset class="smart-card-destination" id="smartCardDestination">
      <legend>Where it goes</legend>
      <div class="smart-card-pills">
        <button type="button" class="is-selected" data-card-destination="new">A new block, sized for this card</button>
        <button type="button" data-card-destination="selected">The block that is open</button>
      </div>
    </fieldset>
    <div class="smart-card-footer"><span class="smart-card-fit-note" id="smartCardFitNote">Measured against this block</span><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="smartCardGenerate">Prepare card for review</button></div>
  </div><section id="smartCardProposal" class="ai-proposal smart-card-proposal" hidden></section>`;
}

// Kept under the old name as well, because external-editor.js imports it and
// there is no value in a rename that touches a working caller.
export { smartCardMarkupPanel as smartCardMarkup };

function proposalMarkup(result) {
  const proposal = result.proposal;
  const source = result.source === "written" ? "AI draft — review required"
    : result.source === "curated" ? "Checked desk data"
      : result.source === "feed" ? "Live source data"
        : result.source === "transformed" ? "AI-structured copy — verify every fact"
        : "Calculated in SAHAS";

  // The card, drawn as it will print - solved against the SAME logical
  // frame (result.frame, from workspace.js's requestSmartCard()) the real
  // block will use once accepted, then the WHOLE drawn object is scaled up
  // here for comfortable reading. Never re-solved at a different width -
  // that would hand rashi a different column count, or every card a
  // different font size, than what the block will actually get once
  // accepted, so a desk would be approving a card that isn't quite the one
  // that prints. Only falls back to the text when there is no renderer for
  // this key - and a new card must never need that.
  const frame = result.frame || { width: 260, height: 260, padding: 8 };
  const drawn = result.smartCardKey && canRenderSmartCard(result.smartCardKey)
    ? smartCardMarkup(result.smartCardKey, result.smartCardData, frame)
    : null;

  // Enlarged for reading, capped so a small block's card is not blown up to
  // something absurd - the point here is legibility, not a magnifying glass.
  const PREVIEW_WIDTH_PX = 280;
  const scale = drawn && frame.width > 0 ? Math.min(2.6, Math.max(1, PREVIEW_WIDTH_PX / frame.width)) : 1;
  const previewInner = drawn
    ? `<div style="width:${frame.width}px;height:${frame.height}px;transform:scale(${scale});transform-origin:top left">${drawn}</div>`
    : `<p>${escapeHtml(proposal.body).replace(/\n/g, "<br>")}</p>`;
  const previewHeightPx = drawn ? Math.ceil(frame.height * scale) : null;

  // The overset warning is desk chrome around the preview, never inside the
  // drawn card itself (smartCardMarkup() no longer carries it - a diagnostic
  // must not become printable newspaper content). Checked here, before
  // acceptance, so a sub-editor sees it while the choice to accept or
  // discard is still open.
  const overset = result.smartCardKey && result.smartCardData
    && smartCardFitState(result.smartCardKey, result.smartCardData, frame) === "OVERSET";

  return `<h4>${escapeHtml(proposal.headline)} <span class="muted">${source}</span></h4>
    ${proposal.subheading ? `<p class="smart-card-subtitle">${escapeHtml(proposal.subheading)}</p>` : ""}
    <p class="ai-proposal-fit">${result.fit.charsUsed} of ${result.fit.bodyCharBudget} characters · ${result.fit.charsRemaining} left</p>
    ${overset ? `<p class="smart-card-overset-note">${escapeHtml(SMART_CARD_OVERSET_NOTE)}</p>` : ""}
    <div class="smart-card-preview" id="smartCardPreview"${previewHeightPx ? ` style="height:${previewHeightPx}px"` : ""}>${previewInner}</div>
    <div class="ext-editor-toolbar"><button type="button" class="ext-editor-btn ext-editor-btn-primary" id="smartCardAccept">Accept card</button><button type="button" class="ext-editor-btn" id="smartCardDismiss">Discard</button></div>`;
}

export function bindSmartCard(requestCard, onPatch, onNotify, onPlaceInNewBlock) {
  let key = "panchang";
  let variant = "auto";
  let advertStyle = DEFAULT_ADVERT_STYLE;
  // "new" means the card brings its own block; "selected" writes into the one
  // already open. New is the default - see the fieldset's own comment.
  let destination = "new";
  const options = document.getElementById("smartCardRashiOptions");
  const manual = document.getElementById("smartCardManualInput");
  const manualText = document.getElementById("smartCardManualText");
  const manualLegend = document.getElementById("smartCardManualLegend");
  const manualFile = document.getElementById("smartCardManualFile");
  const generate = document.getElementById("smartCardGenerate");
  const selectCard = (next) => {
    key = next;
    document.querySelectorAll("[data-smart-card]").forEach((button) => {
      const selected = button.dataset.smartCard === key;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    options.hidden = key !== "rashi";
    const isManual = MANUAL_CARDS.has(key);
    manual.hidden = !isManual;
    if (isManual) {
      manualLegend.textContent = key === "advert"
        ? "Paste the advertiser's own copy"
        : "Paste any email, paragraph or normal text";
      manualText.placeholder = MANUAL_PLACEHOLDERS[key];
    }
    // Artwork is the advert's alone: a picture belongs on an advertisement,
    // and asking a model to illustrate a horoscope is not a feature.
    const artwork = document.getElementById("smartCardArtwork");
    if (artwork) artwork.hidden = key !== "advert";
    const styleField = document.getElementById("smartCardAdvertStyle");
    if (styleField) {
      styleField.hidden = key !== "advert";
      // Drawn on first sight rather than on every render: each demo is a real
      // composition, and five of them is work no other card's panel does.
      if (key === "advert" && !styleField.dataset.drawn) {
        styleField.dataset.drawn = "1";
        const grid = styleField.querySelector(".advert-style-grid");
        grid.innerHTML = Object.values(ADVERT_STYLES)
          .map((style) => advertStyleChoice(style, style.key === advertStyle)).join("");
        grid.querySelectorAll("[data-advert-style]").forEach((button) => button.addEventListener("click", () => {
          advertStyle = button.dataset.advertStyle;
          grid.querySelectorAll("[data-advert-style]").forEach((other) => {
            const on = other === button;
            other.classList.toggle("is-selected", on);
            other.setAttribute("aria-pressed", String(on));
          });
        }));
      }
    }
  };
  document.querySelectorAll("[data-smart-card]").forEach((button) => button.addEventListener("click", () => selectCard(button.dataset.smartCard)));
  document.querySelectorAll("[data-card-destination]").forEach((button) => button.addEventListener("click", () => {
    destination = button.dataset.cardDestination;
    document.querySelectorAll("[data-card-destination]").forEach((other) => other.classList.toggle("is-selected", other === button));
    const note = document.getElementById("smartCardFitNote");
    if (note) {
      note.textContent = destination === "new"
        ? "Sized for this card, placed on this page"
        : "Measured against this block";
    }
  }));
  document.querySelectorAll("[data-rashi-variant]").forEach((button) => button.addEventListener("click", () => {
    variant = button.dataset.rashiVariant;
    document.querySelectorAll("[data-rashi-variant]").forEach((choiceButton) => choiceButton.classList.toggle("is-selected", choiceButton === button));
  }));
  // The advertiser's own picture, uploaded through the ordinary image route so
  // it lands in the same place every other block picture does.
  let advertImageUrl = "";
  document.getElementById("smartCardAdvertImage")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("images", file);
    try {
      const response = await fetch("/api/uploads/images", { method: "POST", body: form });
      if (!response.ok) throw new Error(String(response.status));
      const uploaded = await response.json();
      advertImageUrl = uploaded?.[0]?.url || uploaded?.urls?.[0] || "";
      onNotify(advertImageUrl ? "Artwork attached to this advert." : "That picture could not be read.");
    } catch {
      onNotify("That picture could not be uploaded.");
    }
  });
  manualFile?.addEventListener("change", async () => {
    const file = manualFile.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      manualFile.value = "";
      return onNotify("That text file is larger than 1 MB.");
    }
    manualText.value = await file.text();
  });

  // Taking a card back off a block. Both halves go together: a key with no
  // payload is a block that says it holds a sudoku and cannot draw one.
  document.getElementById("smartCardRemove")?.addEventListener("click", () => {
    onPatch({ smartCardKey: null, smartCardData: null }, "smart-card");
    onNotify("Card removed. The block's copy is editable again.");
  });

  generate?.addEventListener("click", async () => {
    generate.disabled = true;
    const label = generate.textContent;
    generate.textContent = "Measuring this block…";
    try {
      const result = await requestCard?.({
        key,
        variant: key === "rashi" ? variant : "auto",
        manualText: MANUAL_CARDS.has(key) ? manualText.value : "",
        imageUrl: advertImageUrl,
        wantsArtwork: key === "advert" && Boolean(document.getElementById("smartCardWantsArtwork")?.checked),
        advertStyle: key === "advert" ? advertStyle : "",
        // The card is measured against the frame it will actually get: the
        // block it is going into, or the one it is about to bring with it.
        destination,
      });
      if (result?.error) return onNotify(result.error);
      if (!result?.proposal) return onNotify("No verified content is available for this card on this date.");
      const host = document.getElementById("smartCardProposal");
      host.hidden = false;
      host.innerHTML = proposalMarkup(result);
      document.getElementById("smartCardAccept")?.addEventListener("click", async () => {
        const payload = {
          ...result.proposal,
          headline: "",
          subheading: "",
          smartCardKey: result.smartCardKey || null,
          smartCardData: result.smartCardData || null,
          aiGenerated: result.source === "written" || result.source === "transformed",
          status: "needs_review",
        };
        host.hidden = true;
        // A NEW BLOCK, ALREADY FILLED - which is what the desk asked for. The
        // block is created at the size this card wants, then the card's data
        // is written straight into it, so nothing has to be laid out first.
        if (destination === "new" && onPlaceInNewBlock) {
          const placed = await onPlaceInNewBlock(result.smartCardKey || key, payload);
          if (placed?.error) return onNotify(placed.error);
          return onNotify(`${placed?.sectionKey || "Block"} added with the card already in it. Drag it where the page needs it.`);
        }
        // The DATA goes into the draft, not a picture of it. The body text goes
        // with it because everything that measures a block reads body text -
        // the character grid, the worklist, preflight, the fit action - but the
        // card is what the page and the editor both draw.
        onPatch(payload, "smart-card");
        return onNotify("Smart Card added to the editable draft.");
      });
      document.getElementById("smartCardDismiss")?.addEventListener("click", () => {
        // Discard leaves the block exactly as it was. Nothing was written.
        host.hidden = true;
        host.innerHTML = "";
      });
    } finally {
      generate.disabled = false;
      generate.textContent = label;
    }
  });
}
