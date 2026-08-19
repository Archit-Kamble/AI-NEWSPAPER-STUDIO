// The nameplate band, and the folio strip on inside pages.
//
// This is page furniture, not an editorial block. It is drawn by the canvas from
// the edition's own date and the paper's identity (GET /api/identity), it cannot
// be selected, typed into, dragged or deleted, and no template declares it. That
// is deliberate: a masthead that behaved like a block would sooner or later have
// a story typed into it.
//
// The arrangement is the one every Marathi broadsheet uses — a hairline strip
// carrying the paper's line and its editions, then three parts across: the date
// ear on the left, the nameplate in the centre, and the price/contact ear on the
// right.

import { escapeHtml } from "../format.js";

let identity = null;
let loadedFor = null;

/**
 * The paper's standing furniture, together with the volume and issue number
 * this edition's date works out to. Fetched once per edition - the identity
 * does not change while an edition is being made up, and the numbering is
 * fixed by the date.
 */
export function loadIdentity(isoDate, pageCount) {
  const key = `${isoDate || ""}|${pageCount || ""}`;
  if (identity && loadedFor === key) return Promise.resolve(identity);
  loadedFor = key;

  const query = new URLSearchParams();
  if (isoDate) query.set("date", String(isoDate).split("T")[0]);
  if (pageCount) query.set("pages", pageCount);

  return fetch(`/api/identity?${query}`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      identity = data;
      return data;
    })
    .catch(() => null);
}

export function getIdentity() {
  return identity;
}

const DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
const WEEKDAYS = ["रविवार", "सोमवार", "मंगळवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const MONTHS = [
  "जानेवारी", "फेब्रुवारी", "मार्च", "एप्रिल", "मे", "जून",
  "जुलै", "ऑगस्ट", "सप्टेंबर", "ऑक्टोबर", "नोव्हेंबर", "डिसेंबर",
];

const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

// Split from the ISO string rather than parsed through the local timezone: an
// edition dated the 3rd must never print as the 2nd.
function dateParts(isoDate) {
  const [year, month, day] = String(isoDate || "").split("T")[0].split("-").map(Number);
  if (!year || !month || !day) return null;
  return {
    day: devanagari(day),
    weekday: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
    monthYear: `${MONTHS[month - 1]} ${devanagari(year)}`,
  };
}

/**
 * The masthead band for page one. Returns "" until the identity has loaded, or
 * for any page other than the first — inside pages get the folio instead.
 */
export function mastheadMarkup(newspaper, page, geometry, { advertWidthPx = 0 } = {}) {
  if (!identity || !page || Number(page.page_number) !== 1) return "";

  const date = dateParts(newspaper?.publication_date);
  const matterLeft = geometry?.marginXPx ?? 20;
  const top = geometry?.marginYPx ?? 20;
  const matterWidth = geometry?.matterWidthPx ?? 620;

  // The paper MAY sell the top-left corner of page one, and the nameplate is
  // set for both answers.
  //
  // While the corner frame is on the page the corner is the page's, not the
  // block's: the reserved width comes from the region model (geometry.js's
  // regionsFor, `header.earWidthPx`), so a corner block someone made narrower
  // than the region still leaves the region alone and the name never creeps
  // into it. That much is unchanged, and it is the fix for the front page
  // whose title once stretched across a corner it did not own.
  //
  // What is new is the other answer. A paper that does not sell the corner
  // prints its nameplate across the whole measure - every broadsheet does -
  // and this could not, because the reservation was unconditional: removing
  // the corner frame left a white hole and a small name beside it. So the
  // reservation now follows the FRAME's existence rather than being assumed.
  // No frame, no ear: the plate takes the measure and is set large.
  //
  // It is the frame that decides and not the frame's contents, deliberately.
  // An unsold corner still prints blank while its frame is there (a desk fills
  // it the morning it is sold, and the page must not re-make itself under
  // them); a desk that means "this edition has no corner" removes the frame,
  // which is now allowed - see pageSection.service.js's deleteSection.
  const reserved = geometry?.regions?.front?.header;
  const pageReserve = reserved ? (reserved.earWidthPx || 0) + (reserved.earGapPx || 0) : 0;
  const ear = advertWidthPx > 0 ? Math.max(advertWidthPx, pageReserve) : 0;
  const left = matterLeft + ear;
  const width = matterWidth - ear;

  return `
    <div class="page-masthead" style="left:${left}px;top:${top}px;width:${width}px;">
      <div class="masthead-strip">
        <span>${escapeHtml(identity.strapline || "")}</span>
        <span class="masthead-strip-editions">${escapeHtml(identity.editions || "")}</span>
      </div>
      <div class="masthead-body">
        <div class="masthead-ear masthead-ear-left">
          <span class="masthead-place">${escapeHtml(identity.placeOfPublication || "")}</span>
          ${date ? `<span class="masthead-day">${escapeHtml(date.day)}</span>` : ""}
          ${date ? `<span class="masthead-weekday">${escapeHtml(date.weekday)}</span>` : ""}
          ${date ? `<span class="masthead-monthyear">${escapeHtml(date.monthYear)}</span>` : ""}
        </div>
        <div class="masthead-plate">
          <img src="${escapeHtml(identity.nameplateUrl)}" alt="${escapeHtml(identity.title || "")}" />
        </div>
        <!-- The editor's name is set ONCE, in the owner line below. It used
             to be set here as well - the same legal statement printed twice
             on one band - and, the ear being narrow, the duplicate is what
             wrapped it onto two lines. -->
        <div class="masthead-ear masthead-ear-right">
          <span class="masthead-rni">${escapeHtml(identity.rni || "")}</span>
          <span class="masthead-meta">${escapeHtml(identity.volumeLine || "")}</span>
          <span class="masthead-meta">${escapeHtml(identity.pageCountLabel || "")} । ${escapeHtml(identity.price || "")}</span>
          <span class="masthead-web">${escapeHtml(identity.epaper || "")}</span>
        </div>
      </div>
      <div class="masthead-owner">
        <span>${escapeHtml(identity.owner || "")}</span>
        <span>${escapeHtml(identity.office || "")} · ${escapeHtml(identity.phone || "")} · ${escapeHtml(identity.email || "")}</span>
      </div>
    </div>
  `;
}

/**
 * The folio strip inside pages carry: paper, page number, place and date on one
 * ruled line. Page one has the nameplate instead.
 */
export function folioMarkup(newspaper, page, geometry) {
  if (!identity || !page || Number(page.page_number) === 1) return "";

  const date = dateParts(newspaper?.publication_date);
  const left = geometry?.marginXPx ?? 20;
  const top = geometry?.marginYPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  const dateText = date ? `${date.day} ${date.monthYear}, ${date.weekday}` : "";

  // Verso and recto. A reader holding the paper open sees the OUTER edge of
  // each page - left edge on an even page, right edge on an odd one - so that
  // is where the page number and date go. Putting them in the same place on
  // both sides means the reader has to hunt for them on half the pages. Every
  // printed spread in the world does this; page one is the only exception,
  // because it has the nameplate instead.
  const verso = Number(page.page_number) % 2 === 0;
  const number = `<span class="folio-page">पृष्ठ ${escapeHtml(devanagari(page.page_number))}</span>`;
  const dateBlock = `<span class="folio-date">${escapeHtml(identity.placeOfPublication || "")} । ${escapeHtml(dateText)}</span>`;
  const title = `<span class="folio-title">${escapeHtml(identity.title || "")}</span>`;

  return `
    <div class="page-folio ${verso ? "folio-verso" : "folio-recto"}"
         style="left:${left}px;top:${top}px;width:${width}px;">
      ${verso ? `${number}${dateBlock}${title}` : `${title}${dateBlock}${number}`}
    </div>
  `;
}

// The footer band, read from the one page-region model (geometry.js's
// regionsFor, served over GET /api/geometry as geometry.regions). Front and
// inside pages reserve the identical band, so this falls back to the same
// numbers regionsFor(g, 'inside') computes when an older geometry payload
// (without .regions) is ever passed in.
const FALLBACK_FOOTER = { footTop: 1012, footHeightPx: 28, imprintTop: 968, imprintHeightPx: 40 };
function footerBand(geometry, page) {
  if (Number(page?.page_number) === 1) return geometry?.regions?.front?.footer || FALLBACK_FOOTER;
  if (Number(page?.page_number) === 2) return geometry?.regions?.insideImprint?.footer || FALLBACK_FOOTER;
  return geometry?.regions?.inside?.footer || FALLBACK_FOOTER;
}

// The band the editorial blocks live in, from the SAME page-region model the
// footer above is read from. Exported because the canvas has to know where the
// matter ENDS to decide whether a block is ruled off below it: a hairline under
// the last story in a column is a rule against the page foot, which no printed
// newspaper draws.
const FALLBACK_CONTENT = { top: 56, bottom: 1008 };
export function contentRegion(geometry, page) {
  if (Number(page?.page_number) === 1) return geometry?.regions?.front?.content || FALLBACK_CONTENT;
  if (Number(page?.page_number) === 2) return geometry?.regions?.insideImprint?.content || FALLBACK_CONTENT;
  return geometry?.regions?.inside?.content || FALLBACK_CONTENT;
}

/**
 * The foot of the page: the printline every Indian newspaper carries by law,
 * the page number and the edition's date. Standing furniture - identical in
 * every edition except for the two numbers, both of which the software already
 * knows. Nobody types this.
 *
 * Positioned and SIZED from the reserved footer band, not a hand-typed offset
 * - the explicit height plus `overflow: hidden` on `.page-foot` (styles.css)
 * is what guarantees this strip can never grow past the room templates.js
 * left for it, however long the identity strings are.
 */
export function pageFootMarkup(newspaper, page, geometry) {
  if (!identity || !page) return "";

  const date = dateParts(newspaper?.publication_date);
  const left = geometry?.marginXPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  const band = footerBand(geometry, page);
  const dateText = date ? `${date.day} ${date.monthYear}` : "";

  // The foot follows the same outer-edge rule as the folio.
  const verso = Number(page.page_number) % 2 === 0;

  // Three things and nothing else: the paper, the date, the page number.
  //
  // The printline used to be set here as well - the Press and Registration of
  // Books Act declaration, a long sentence naming the printer, the publisher
  // and the address of the press. It is a legal requirement, but it is a
  // requirement to print it ONCE, and this paper already prints it as the
  // imprint at the foot of page two (imprintMarkup below). Setting it again
  // on every page did two things: it duplicated a legal statement, and it
  // squeezed the foot into an 8px ruled strip of dense grey type that read as
  // a border under the page rather than as a folio line.
  return `
    <div class="page-foot ${verso ? "foot-verso" : "foot-recto"}"
         style="left:${left}px;top:${band.footTop}px;width:${width}px;height:${band.footHeightPx}px;">
      <span class="foot-title">${escapeHtml(identity.title || "")}</span>
      <span class="foot-date">${escapeHtml(dateText)}</span>
      <span class="foot-page">पृष्ठ ${escapeHtml(devanagari(page.page_number))}</span>
    </div>
  `;
}

/**
 * The printer's declaration, at the foot of the page the paper carries it on.
 *
 * Every Indian newspaper must print one under the Press and Registration of
 * Books Act, and this paper prints it at the foot of PAGE TWO rather than on
 * every page. It is drawn from src/layout/identity.js, so a desk can never
 * mistype the address of the press it is printed at - which is a legal
 * statement, not a caption.
 */
export function imprintMarkup(newspaper, page, geometry) {
  if (!identity || !page) return "";
  if (Number(page.page_number) !== Number(identity.imprintPage || 2)) return "";

  const left = geometry?.marginXPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  const band = footerBand(geometry, page);

  return `
    <div class="page-imprint" style="left:${left}px;width:${width}px;top:${band.imprintTop}px;height:${band.imprintHeightPx}px;">
      <span class="imprint-mr">${escapeHtml(identity.imprint || "")}</span>
      <span class="imprint-en">${escapeHtml(identity.imprintEnglish || "")}</span>
      <span class="imprint-ai">${escapeHtml(identity.aiDisclosure || "")}</span>
    </div>
  `;
}

// The strip of colour patches printed along the foot of a page so the press can
// check that the four plates are in register. Every paper on the stand has it;
// its absence is one of the things that makes a page look like a web mock-up.
export function registrationMarkup(geometry) {
  const left = geometry?.marginXPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  const pageHeight = geometry?.pageHeightPx ?? 1060;
  const inks = ["#00a0e3", "#e6007e", "#ffed00", "#111111"];
  const patches = inks
    .concat(inks)
    .map((ink) => `<span style="background:${ink}"></span>`)
    .join("");

  return `
    <div class="page-registration" style="left:${left}px;top:${pageHeight - 14}px;width:${width}px;">${patches}</div>
  `;
}
