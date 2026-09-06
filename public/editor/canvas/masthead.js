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
import { folioStyleForTheme, footerStyleForTheme, furnitureInkForTheme, furnitureTintForTheme, sectionNameFor } from "../layout/furniture-styles.js";
import { stripLine } from "../layout/almanac.js";

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
          ${date ? `<span class="masthead-monthyear">${escapeHtml(date.monthYear)}</span>` : ""}
          ${date ? `<span class="masthead-weekday">${escapeHtml(date.weekday)}</span>` : ""}
        </div>
        <div class="masthead-plate">
          <img src="${escapeHtml(identity.nameplateUrl)}" alt="${escapeHtml(identity.title || "")}" />
        </div>
        <!-- The editor's name is set ONCE, in the owner line below. It used
             to be set here as well - the same legal statement printed twice
             on one band - and, the ear being narrow, the duplicate is what
             wrapped it onto two lines. -->
        <!-- The RNI is NOT set here either. The registered artwork carries
             it inside the mark itself (open sahas-nameplate.png and look: top
             right, beside the last letter), so a line of type saying it again
             is the same duplicate the editor's name was, one span along - and
             the ear is the narrow column the width-bound plate can least
             afford. Found while giving the export the full band: the export
             had always withheld it and the canvas had always repeated it, and
             only one of them could be right. -->
        <div class="masthead-ear masthead-ear-right">
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
// The chip row the folio actually draws in, inside the 32 px band geometry.js
// reserves for it. 19 px is the reference paper's own 16 px measured at its
// page scale and converted to this page's 2 px/mm - see folioMarkup below.
const FOLIO_CHIP_PX = 19;
// The foot's own strip, inside the 28 px band reserved for it - the same
// measured clearance the folio keeps, at the other end of the page.
const FOOT_STRIP_PX = 20;

// FIVE FOLIO STYLES, resolved from the page's own theme - the same
// style_theme column page-styles.js writes when a page is dressed. No new
// storage, no new API: a page nobody has dressed reads "plain"/"front" and
// draws exactly the folio it always has.
//
// The rule, tint and title ink all come from furniture-styles.js, never
// invented here - the same catalogue print-model.js reads for the exported
// plate, so the folio a desk sees is the folio that prints.
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

  const theme = page.style_theme;
  const style = folioStyleForTheme(theme);
  const ink = style.title !== "plain" ? furnitureInkForTheme(theme) : null;
  const tint = style.band ? furnitureTintForTheme(theme) : null;
  const reversed = style.band === "reverse";

  // THE FOLIO PAINTS A CHIP ROW, NOT THE WHOLE BAND IT IS GIVEN.
  //
  // The desk's report was that the header and footer were "touching borders",
  // and they were: a themed folio filled its entire reserved 32 px band with
  // solid colour, so the ink ran straight into the first block's own rule
  // with only the 4 px content gap between them.
  //
  // The reference paper does not do that. Measured off its own page: a 16 px
  // chip row, then FIVE ROWS OF CLEAR WHITE, then the first block - and the
  // chips are small solid boxes (a red brand box, a yellow page-number box,
  // a dark section box) on an otherwise white strip, never a band across the
  // measure. At this page's 2 px/mm that chip row is 19 px.
  //
  // The reserved REGION is untouched - geometry.js still leaves the same 32 px
  // plus its gap, and templates.js still starts the blocks in the same place.
  // Only what the folio DRAWS inside it shrinks, which is what turns the
  // remaining 13 px into the white the reference has.
  const css = [
    `left:${left}px`, `top:${top}px`, `width:${width}px`,
    `height:${FOLIO_CHIP_PX}px`,
    style.rule.weight === 0 ? "border-bottom-width:0" : `border-bottom-width:${style.rule.weight}px`,
    style.rule.double ? "border-bottom-style:double" : "",
    ink && !reversed ? `border-bottom-color:${ink}` : "",
    // A tinted strip is the chip row's own ground; a reversed banner does NOT
    // paint the row at all - it paints the chips, below.
    style.band === true && tint ? `background:${tint}` : "",
  ].filter(Boolean).join(";");

  // A CHIP: a small solid box with reversed type, the device the reference
  // sets its brand and its page number in. Only a reversed style uses them -
  // the quieter styles keep plain type, which is what those pages do too.
  const chip = (cls, text, colour) => `<span class="${cls} folio-chip" style="background:${escapeHtml(colour)};color:#ffffff">${text}</span>`;
  const titleInk = reversed ? null : ink;
  const titleSpan = reversed && ink
    ? chip("folio-title", escapeHtml(identity.title || ""), ink)
    : `<span class="folio-title"${titleInk ? ` style="color:${escapeHtml(titleInk)}"` : ""}>${escapeHtml(identity.title || "")}</span>`;
  const numberSpan = reversed && ink
    ? chip("folio-page", `पृष्ठ ${escapeHtml(devanagari(page.page_number))}`, ink)
    : number;
  // The date stays plain on white in every style - the reference sets it that
  // way on every page, and a date reversed out of a chip reads as a label.
  //
  // THE SECTION NAMEPLATE OPENS THE CENTRE COLUMN. The reference's folio row
  // carries three boxes, not two - a brand box, a page-number box, and a dark
  // box naming the page's own section - and this is the third. It runs BEFORE
  // the date on the same line rather than replacing it: a folio's job includes
  // saying what day the paper is, and the centre column is `auto`, so it
  // simply grows by the width of the name.
  //
  // It is drawn in every themed style, not only the reversed one, because
  // unlike the brand and the page number it has no plain form to fall back
  // to - a section name set as ordinary grey type beside the date is not a
  // nameplate, it is a word.
  //
  // ITS INK IS THE THEME'S OWN, NOT `ink`. `ink` is null whenever the folio
  // STYLE sets its title plain - the understated `double-rule`, which is what
  // the business page resolves to - and that style says how the folio is
  // RULED, not whether the page may say which section it is. Gated on it, the
  // business page alone carried no nameplate while every other themed page
  // did, which reads as a bug rather than as a choice. `sectionNameFor` is
  // already the gate: it answers null for exactly the two themes that have no
  // section to name.
  const sectionName = sectionNameFor(theme);
  const sectionInk = sectionName ? furnitureInkForTheme(theme) : null;
  const sectionSpan = sectionInk
    ? chip("folio-section", escapeHtml(sectionName), sectionInk)
    : "";
  // ONE grid child, not two. `.page-folio` is `1fr auto 1fr` and the date is
  // the middle item in both the verso and the recto order - a second child
  // here would make four columns and put the date off the page's centre line,
  // which is the very fault that grid was written to fix.
  const dateSpan = sectionSpan
    ? `<span class="folio-centre">${sectionSpan}${dateBlock}</span>`
    : dateBlock;

  // SUNRISE, SUNSET, DAY LENGTH - drawn in the white the chip row already
  // leaves below it (masthead.js's own comment above says why the chip row
  // is 19 of the reserved 32px, not the whole band: the reference paper
  // leaves five rows of white there rather than filling the band edge to
  // edge). This costs no new geometry - it is the same reserved band,
  // painted a little further, exactly as the chip row already is one draw
  // inside a taller reservation.
  //
  // Computed from the paper's own place of publication, never Mumbai's
  // default - a Satara folio naming Satara next to Mumbai's sunrise would be
  // a new, avoidable mistake this feature would have introduced by itself.
  const place = { name: identity.placeOfPublication, ...identity.placeCoordinates };
  const almanac = stripLine(newspaper?.publication_date, place);
  const almanacBand = almanac
    ? `<div class="page-folio-almanac" style="left:${left}px;top:${top + FOLIO_CHIP_PX}px;width:${width}px">${escapeHtml(almanac)}</div>`
    : "";

  return `
    <div class="page-folio ${verso ? "folio-verso" : "folio-recto"} folio-style-${style.key}"
         style="${css}">
      ${verso ? `${numberSpan}${dateSpan}${titleSpan}` : `${titleSpan}${dateSpan}${numberSpan}`}
    </div>
    ${almanacBand}
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
  // FIVE FOOTER STYLES, resolved from the same theme the folio above reads -
  // one page, one look, top to bottom. The band's HEIGHT never changes; only
  // the rule (if any), the tint and the title's ink do.
  const theme = page.style_theme;
  const style = footerStyleForTheme(theme);
  const ink = style.title !== "plain" ? furnitureInkForTheme(theme) : null;
  const tint = style.band ? furnitureTintForTheme(theme) : null;
  const ruleCss = style.rule
    ? `border-${style.rule.edge}-width:${style.rule.weight}px;border-${style.rule.edge}-style:${style.rule.double ? "double" : "solid"};border-${style.rule.edge}-color:${ink || "#111"}`
    : "";
  // THE FOOT KEEPS ITS CLEARANCE TOO. Same report, same cause, same fix as
  // the folio above: a themed foot filled its whole reserved band with solid
  // colour and met the last block's rule. Measured on the reference, its own
  // foot furniture sits below FIVE ROWS OF CLEAR WHITE - so the paint is
  // pushed to the bottom of the reserved band and the top of that band is
  // left white, rather than the band being filled edge to edge.
  const footInset = Math.max(0, band.footHeightPx - FOOT_STRIP_PX);
  const css = [
    `left:${left}px`, `top:${band.footTop + footInset}px`, `width:${width}px`,
    `height:${Math.min(band.footHeightPx, FOOT_STRIP_PX)}px`,
    ruleCss, tint ? `background:${tint}` : "",
  ].filter(Boolean).join(";");

  return `
    <div class="page-foot ${verso ? "foot-verso" : "foot-recto"} foot-style-${style.key}"
         style="${css}">
      <span class="foot-title"${ink ? ` style="color:${escapeHtml(ink)}"` : ""}>${escapeHtml(identity.title || "")}</span>
      <span class="foot-date">${escapeHtml(dateText)}</span>
      <span class="foot-page"${ink ? ` style="color:${escapeHtml(ink)}"` : ""}>पृष्ठ ${escapeHtml(devanagari(page.page_number))}</span>
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

  // TWO BOXES, ONE PER LANGUAGE, and the standing disclosure closes each of
  // them rather than standing under both.
  //
  // The band used to be three stacked spans - Marathi, English, and the
  // disclosure centred and bold under a hairline - so page two carried three
  // separate notices where a reader expects one imprint. The disclosure is
  // about this newspaper exactly as the declaration is, and it belongs in the
  // paragraph that already names the editor responsible for it.
  return `
    <div class="page-imprint" style="left:${left}px;width:${width}px;top:${band.imprintTop}px;height:${band.imprintHeightPx}px;">
      <div class="imprint-box">
        <span class="imprint-mr">${escapeHtml(identity.imprint || "")}</span>
        <span class="imprint-ai">${escapeHtml(identity.aiDisclosure || "")}</span>
      </div>
      <div class="imprint-box imprint-box-en">
        <span class="imprint-en">${escapeHtml(identity.imprintEnglish || "")}</span>
        <span class="imprint-ai">${escapeHtml(identity.aiDisclosureEnglish || "")}</span>
      </div>
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
