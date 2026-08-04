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
export function mastheadMarkup(newspaper, page, geometry) {
  if (!identity || !page || Number(page.page_number) !== 1) return "";

  const date = dateParts(newspaper?.publication_date);
  const left = geometry?.marginXPx ?? 20;
  const top = geometry?.marginYPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;

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

/**
 * The foot of the page: the printline every Indian newspaper carries by law,
 * the page number and the edition's date. Standing furniture - identical in
 * every edition except for the two numbers, both of which the software already
 * knows. Nobody types this.
 */
export function pageFootMarkup(newspaper, page, geometry) {
  if (!identity || !page) return "";

  const date = dateParts(newspaper?.publication_date);
  const left = geometry?.marginXPx ?? 20;
  const width = geometry?.matterWidthPx ?? 620;
  const top = (geometry?.marginYPx ?? 20) + (geometry?.matterHeightPx ?? 1020) - 16;
  const dateText = date ? `${date.day} ${date.monthYear}` : "";

  // The foot follows the same outer-edge rule as the folio.
  const verso = Number(page.page_number) % 2 === 0;

  return `
    <div class="page-foot ${verso ? "foot-verso" : "foot-recto"}" style="left:${left}px;top:${top}px;width:${width}px;">
      <span class="foot-printline">${escapeHtml(identity.printline || "")}</span>
      <span class="foot-page">${escapeHtml(identity.title || "")} । ${escapeHtml(dateText)} । पृष्ठ ${escapeHtml(devanagari(page.page_number))}</span>
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
