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

  // The paper sells the top-left corner of page one. That is an ADVERT BLOCK on
  // the page, not furniture, so the nameplate begins where the advert ends -
  // exactly as it does in the printed edition.
  const left = matterLeft + advertWidthPx;
  const width = matterWidth - advertWidthPx;

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
        <div class="masthead-ear masthead-ear-right">
          <span class="masthead-rni">${escapeHtml(identity.rni || "")}</span>
          <span class="masthead-meta">${escapeHtml(identity.volumeLine || "")}</span>
          <span class="masthead-meta">${escapeHtml(identity.pageCountLabel || "")} । ${escapeHtml(identity.price || "")}</span>
          <span class="masthead-editor">${escapeHtml(identity.editor || "")}</span>
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
const FALLBACK_FOOTER = { footTop: 1016, footHeightPx: 24, imprintTop: 980, imprintHeightPx: 32 };
function footerBand(geometry, page) {
  if (Number(page?.page_number) === 1) return geometry?.regions?.front?.footer || FALLBACK_FOOTER;
  if (Number(page?.page_number) === 2) return geometry?.regions?.insideImprint?.footer || FALLBACK_FOOTER;
  return geometry?.regions?.inside?.footer || FALLBACK_FOOTER;
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

  return `
    <div class="page-foot ${verso ? "foot-verso" : "foot-recto"}"
         style="left:${left}px;top:${band.footTop}px;width:${width}px;height:${band.footHeightPx}px;">
      <span class="foot-printline">${escapeHtml(identity.printline || "")}</span>
      <span class="foot-page">${escapeHtml(identity.title || "")} । ${escapeHtml(dateText)} । पृष्ठ ${escapeHtml(devanagari(page.page_number))}</span>
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
