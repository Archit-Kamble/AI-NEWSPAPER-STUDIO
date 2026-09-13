/*
 * THE DROP-CAP NOTE THAT USED TO SIT UNDER THE TOGGLES HAS BEEN REMOVED,
 * BECAUSE IT WAS UNTRUE AND DISAGREED WITH ITSELF. In full:
 *
 *   "Drop cap is a placeholder - it is stored and shown in the preview, but
 *    the production compositor will render it."
 *
 * Both halves cannot hold at once, and the first one is the wrong one:
 * dropCapOf() contributes the cap's own rectangle to the compositor's obstacle
 * set, render.js draws it, print-model.js carries it, and the Scribus walk
 * emits its baseline. The sentence survives from when drop_cap was a BOOLEAN
 * that reached nothing but this panel's own preview paragraph; it became
 * drop_cap_lines and the note was never taken down with it.
 *
 * So a desk reading it was told that a working control does not work - the
 * only string of its kind on any visible screen. Nothing replaces it: the
 * control is named, it is in Properties, and a control that works needs no
 * apology under it.
 */
// Part 6: the Typography tab.
//
// These are print composition settings, not CSS conveniences - each one maps
// onto a Scribus paragraph/frame property at export. Sizes are px in editor
// space and convert to mm at export time; the conversion stays explicit, per
// CLAUDE.md's rule about never mixing the two silently.

import { MIN_MEASURED_LINE_HEIGHT } from "../layout/text-flow.js";
import { escapeHtml as escapeText } from "../format.js";
import { DEFAULT_DISPLAY_ALIGN } from "../compose/compose.js";

// Exported because the writing toolbar offers the same font and the same
// alignments, and they must be the SAME list. A second copy of a catalog is how
// the template keys drifted (CLAUDE.md); these set real Scribus properties, so
// two lists would mean a font offered on screen that the press file has never
// heard of.
// THE FACES THIS PAPER IS SET IN, from the one catalogue
// (layout/typefaces.js) that the compositor measures with, the shaper shapes
// with, the browser paints with and the press PDF embeds.
//
// The old list offered Georgia, Times New Roman, Arial and Helvetica Neue -
// system fonts with no Devanagari in them at all, every one of which was
// silently measured as either the serif or the sans publication face
// underneath (font-metrics.js records the bug where two of them were measured
// as the WRONG one for years). They are kept at the foot of the list because
// rows carry those exact strings and a desk who chose one should still see
// what they chose; the six real faces above them are the ones that mean
// anything.
import "../layout/typefaces.js";
const { TYPEFACES } = globalThis.SahasTypefaces;

export const FONT_FAMILIES = [
  { value: "", label: "Theme default" },
  ...TYPEFACES.map((face) => ({
    value: face.key,
    label: face.role === 'display' ? `${face.label} — display` : face.label,
    title: face.note,
  })),
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (legacy)" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman (legacy)" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial (legacy)" },
  { value: "'Helvetica Neue', Helvetica, sans-serif", label: "Helvetica Neue (legacy)" },
];

// The DISPLAY faces, for the headline, kicker and deck. Only the real
// publication faces - a system font with no Devanagari in it was always a
// fiction for the body and would be a worse one for a headline, which is the
// biggest type on the page. "" is the paper's own sans, which is what every
// block means until a desk says otherwise.
export const DISPLAY_FAMILIES = [
  { value: "", label: "Paper default (Sahas Sans)" },
  ...TYPEFACES.map((face) => ({
    value: face.key,
    label: face.role === 'display' ? `${face.label} — display` : face.label,
    title: face.note,
  })),
];

const WEIGHTS = [
  { value: "300", label: "Light" },
  { value: "normal", label: "Regular" },
  { value: "600", label: "Semibold" },
  { value: "bold", label: "Bold" },
  { value: "800", label: "Black" },
];

export const ALIGNMENTS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
  // JUSTIFY ALL LINES. `justify` closes a line with two bounded levers and
  // accepts what is left, and it stands down entirely on a column under
  // JUSTIFY_MIN_EM - which is 55% of this paper's blocks, so on most of them
  // it is indistinguishable from flush left. That is the right default and it
  // is not what the Lokmat reference block does: there every line but a
  // paragraph's last reaches BOTH edges exactly, with the word gaps visibly
  // differing from line to line to make it so. Measured on an 80 px column:
  // justify leaves 11 of 11 interior lines ragged (worst 71%), justify-all
  // leaves none (word spaces 0.21-1.34 em). See compose.js's JUSTIFY_ALL.
  { value: "justify-all", label: "Justify lines" },
];

// WHICH object's alignment a control is setting.
//
// `text_align` is the BODY's alignment and always was - the exact engine
// pours the copy with it and, until the display flows were wired up, placed
// every headline and deck line flush left whatever it said. So a desk with
// the headline selected pressing "centre" changed the copy underneath it and
// nothing on screen admitted that. The headline and the deck have their own
// persisted fields now (schema.sql's headline_align / subheading_align), and
// this map is the ONE place that says which field belongs to which selected
// object, shared by the writing toolbar and the Typography panel so the two
// cannot answer it differently.
export const ALIGN_FIELD = {
  // The kicker follows the headline deliberately (CLAUDE.md: "a control of
  // its own could only knock the two out of step") - it is the headline's
  // own overline, never independently aligned. Writing headlineAlign while
  // the kicker field has focus is correct: the kicker visually follows
  // whatever that resolves to.
  kicker: "headlineAlign",
  headline: "headlineAlign",
  subheading: "subheadingAlign",
  body: "textAlign",
  block: "textAlign",
};

export function alignFieldFor(part) {
  return ALIGN_FIELD[part] || "textAlign";
}

/** What that object's alignment currently IS, with the right default for it. */
export function alignValueOf(view, part) {
  const field = alignFieldFor(part);
  // An empty display field means the desk has never had an opinion about this
  // headline, and the engine sets it the paper's own way - so that is what
  // the control has to show, or the button lit on screen is not the one the
  // page is using.
  return String(view?.[field] || (field === "textAlign" ? "left" : DEFAULT_DISPLAY_ALIGN));
}

const LIST_STYLES = [
  { value: "none", label: "None" },
  { value: "bullet", label: "Bullets" },
  { value: "number", label: "Numbering" },
];

const NUMBER_FIELDS = [
  { id: "tyHeadlineSize", field: "headlineFontPx", label: "Headline size (px)", min: 8, max: 140, step: 1 },
  { id: "tySubheadingSize", field: "subheadingFontPx", label: "Subheadline size (px)", min: 8, max: 90, step: 1 },
  { id: "tyBodySize", field: "bodyFontPx", label: "Body size (px)", min: 6, max: 48, step: 0.1 },
  // Columns moved to Properties, and had to: a number input cannot express
  // "auto", so a desk who once touched it could never hand the decision back
  // to the engine - and after schema.sql made NULL the ordinary state, "auto"
  // is the value nearly every block carries.
  // One pixel is the physical hair of air that keeps type off its frame. Zero
  // was never honoured by the compositor (which requires a positive inset),
  // so offering it made the control read 0 while the page silently used the
  // old 12 px fallback.
  { id: "tyMargin", field: "marginPx", label: "Margins (px)", min: 1, max: 60, step: 1 },
  // The floor, not just this control's default: below it, Devanagari vowel
  // signs crop against the next line (text-flow.js's MIN_LINE_HEIGHT). What
  // this input offers has to match what section-model.js actually stores, or
  // a desk could type 1.0 here and watch it render at 1.45 anyway.
  { id: "tyLineHeight", field: "lineHeight", label: "Line spacing", min: MIN_MEASURED_LINE_HEIGHT, max: 3, step: 0.05 },
  // LETTER SPACING IS NOT OFFERED, and this is the third instance of the fault
  // that took drop_cap BOOLEAN and list_style: a control that persisted, that
  // this panel's own PREVIEW paragraph drew, and that no renderer of the real
  // block read. Measured on a 190 px block: the compositor genuinely composes
  // with the tracking (three lines become four at 1 px), and then render.js,
  // the PDF, the IDML, the .docx and the .sla all set the type untracked - so
  // every line falls (clusters - 1) x spacing short of the measure it was
  // broken against. At 2 px that is 29% of the measure, on screen and on the
  // plate alike.
  //
  // Painting it is not the fix either, and that is the substantive reason it
  // is gone rather than plumbed through: CSS letter-spacing adds a gap after
  // EVERY cluster, including the last and across word gaps, while
  // measurePieceWidth() adds it only BETWEEN the clusters of a word - so
  // emitting the number would replace one disagreement with another. And
  // tracking is wrong for this script in the first place, which compose.js
  // already says in as many words where it refuses letter-spacing as a
  // justification lever: it pulls a Devanagari word's shirorekha apart.
  //
  // The column, section-model.js and the compositor's own support all stay -
  // nothing stored changes, no migration - so this is one line to put back if
  // a desk ever needs tracking for a Latin advert. No row in the database
  // carries a non-zero value today (swept: 0 of 2527).
  { id: "tyParagraphSpacing", field: "paragraphSpacingPx", label: "Paragraph spacing (px)", min: 0, max: 60, step: 1 },
];

const TOGGLES = [
  { id: "tyItalic", field: "fontItalic", label: "Italic" },
  { id: "tyUnderline", field: "fontUnderline", label: "Underline" },
  // "Drop cap" was here as a checkbox and was inert: it persisted, and the
  // only thing it changed was a CSS class on this panel's own PREVIEW
  // paragraph. A drop cap is a property of the FRAME - how many lines deep
  // the initial letter is set and what the copy runs round - so it lives in
  // Properties, stated in lines, and the compositor now actually sets it.
];

function select(id, options, current) {
  return options
    .map((o) => `<option value="${o.value}"${String(current) === String(o.value) ? " selected" : ""}>${o.label}</option>`)
    .join("");
}

function segmented(name, options, current) {
  return `<div class="segmented" data-segmented="${name}">
    ${options
      .map(
        (o) =>
          `<button type="button" class="segment${String(current) === String(o.value) ? " active" : ""}" data-value="${o.value}">${o.label}</button>`,
      )
      .join("")}
  </div>`;
}

// Which NUMBER_FIELDS entry is "the object currently selected" - only the
// three font sizes are actually stored per-object (headline_font_px,
// subheading_font_px, body_font_px); everything else (family, weight,
// alignment, columns, margin, line height, letter/paragraph spacing) is one
// value for the whole block in page_sections, so highlighting it as
// "headline-only" would claim a precision the schema does not have. This map
// is deliberately short for that reason.
const PART_FIELD = { headline: "tyHeadlineSize", subheading: "tySubheadingSize", body: "tyBodySize" };

// Which object this panel is currently pointed at. The alignment control now
// writes a DIFFERENT field depending on it (ALIGN_FIELD), so the click handler
// has to know what the last render was told, exactly as story-editor.js
// already tracks the selected object for the size control.
let panelPart = "block";
// Exported so block-frame.js's on-frame selection label reads the same six
// words the Typography panel does - one catalog, not two that could drift.
export const PART_LABEL = {
  block: "Whole block",
  kicker: "Kicker",
  headline: "Headline",
  subheading: "Subheading",
  body: "Body",
  image: "Picture",
  smartCard: "Smart Card",
};

function selectionNote(part) {
  if (!part || part === "block") return "";
  if (part === "image") {
    return `<p class="ty-selection-note">A picture is selected. Its size, position and crop are set on the page itself, or in Story → Images - not here.</p>`;
  }
  if (part === "smartCard") {
    return `<p class="ty-selection-note">A Smart Card is selected. Its content is generated, not typed - see the Smart Cards panel.</p>`;
  }
  return `<p class="ty-selection-note">Editing <strong>${PART_LABEL[part] || part}</strong> - its size and alignment are its own, highlighted below. Family, weight and spacing are set for the whole block.</p>`;
}

export function typographyPanelMarkup(view, part = "block") {
  panelPart = part;
  return `
    <div class="ext-columns">
      <p class="ty-selection-label">Editing: <strong id="tySelectionLabel">${PART_LABEL[part] || "Whole block"}</strong></p>
      ${selectionNote(part)}
      <div class="ext-column">
        <div class="form-group">
          <label>Font family</label>
          <select id="tyFontFamily">${select("tyFontFamily", FONT_FAMILIES, view.fontFamily)}</select>
        </div>
      <div class="form-group">
        <label for="tyDisplayFamily">Headline face</label>
        <select id="tyDisplayFamily">${select("tyDisplayFamily", DISPLAY_FAMILIES, view.displayFamily || "")}</select>
        <p class="muted ext-note">The face the headline, kicker and deck are set in &mdash; a separate decision from the story's, the way a newspaper's own type system works. A condensed cut exists so a splash with too many words can be set without shrinking.</p>
      </div>
        <div class="form-group">
          <label>Weight</label>
          <select id="tyFontWeight">${select("tyFontWeight", WEIGHTS, view.fontWeight)}</select>
        </div>
        <div class="form-group">
          <label>Alignment${part === "headline" || part === "subheading" ? ` — ${PART_LABEL[part]}` : ""}</label>
          ${segmented("align", ALIGNMENTS, alignValueOf(view, part))}
        </div>
        <div class="form-group">
          <label>Lists</label>
          ${segmented("listStyle", LIST_STYLES, view.listStyle)}
        </div>
        <div class="toggle-row">
          ${TOGGLES.map(
            (t) =>
              `<label class="toggle"><input type="checkbox" id="${t.id}"${view[t.field] ? " checked" : ""} /> ${t.label}</label>`,
          ).join("")}
        </div>
      </div>
      <div class="ext-column">
        <div class="field-grid">
          ${NUMBER_FIELDS.map(
            (f) => `
            <div class="form-group${f.id === PART_FIELD[part] ? " form-group-targeted" : ""}">
              <label>${f.label}</label>
              <input type="number" id="${f.id}" min="${f.min}" max="${f.max}" step="${f.step}" value="${view[f.field]}" />
            </div>`,
          ).join("")}
        </div>
      </div>
      <div class="ext-column ext-column-wide">
        <label class="preview-label">Live preview</label>
        <div class="type-preview" id="tyPreview">${previewMarkup(view)}</div>
      </div>
    </div>
  `;
}

// The preview applies the real settings to the real text, so a compositor can
// see what they are choosing before it reaches the page.
export function previewMarkup(view) {
  const style = [
    view.fontFamily ? `font-family:${view.fontFamily}` : "",
    `font-weight:${view.fontWeight}`,
    view.fontItalic ? "font-style:italic" : "",
    view.fontUnderline ? "text-decoration:underline" : "",
    `text-align:${view.textAlign}`,
    `line-height:${view.lineHeight}`,
    `padding:${view.marginPx}px`,
  ]
    .filter(Boolean)
    .join(";");

  const bodyStyle = [
    `font-size:${view.bodyFontPx}px`,
    `margin-bottom:${view.paragraphSpacingPx}px`,
    view.columnCount > 1 ? `column-count:${view.columnCount};column-gap:14px` : "",
  ]
    .filter(Boolean)
    .join(";");

  const bodyText = view.body || "Body text preview. Set the story text in the Story tab to see it composed here.";
  const bodyEl =
    view.listStyle === "none"
      ? `<p class="type-preview-body" style="${bodyStyle}">${escapeText(bodyText)}</p>`
      : `<${view.listStyle === "number" ? "ol" : "ul"} class="type-preview-body" style="${bodyStyle}">
           ${bodyText
             .split(/\n+/)
             .filter(Boolean)
             .map((line) => `<li>${escapeText(line)}</li>`)
             .join("")}
         </${view.listStyle === "number" ? "ol" : "ul"}>`;

  return `
    <div style="${style}">
      <h2 style="font-size:${view.headlineFontPx}px;margin:0 0 6px;text-align:${alignValueOf(view, "headline")};">${escapeText(view.headline || "Headline preview")}</h2>
      ${view.subheading ? `<h3 style="font-size:${view.subheadingFontPx}px;margin:0 0 10px;font-weight:400;text-align:${alignValueOf(view, "subheading")};">${escapeText(view.subheading)}</h3>` : ""}
      ${bodyEl}
    </div>
  `;
}

export function bindTypographyPanel(getView, onPatch) {
  const patch = (updates) => onPatch(updates, "typography-panel");

  document.getElementById("tyFontFamily")?.addEventListener("change", (e) => patch({ fontFamily: e.target.value }));
  document.getElementById("tyDisplayFamily")?.addEventListener("change", (e) => patch({ displayFamily: e.target.value }));
  document.getElementById("tyFontWeight")?.addEventListener("change", (e) => patch({ fontWeight: e.target.value }));

  NUMBER_FIELDS.forEach((f) => {
    document.getElementById(f.id)?.addEventListener("input", (e) => {
      const value = Number(e.target.value);
      if (!Number.isFinite(value)) return;
      patch({ [f.field]: Math.min(f.max, Math.max(f.min, value)) });
    });
  });

  TOGGLES.forEach((t) => {
    document.getElementById(t.id)?.addEventListener("change", (e) => patch({ [t.field]: e.target.checked }));
  });

  document.querySelectorAll("[data-segmented]").forEach((group) => {
    const field = group.dataset.segmented;
    group.querySelectorAll(".segment").forEach((button) => {
      // "align" is resolved at CLICK time, not at render time: the desk can
      // select a different object on the page without this panel being
      // rebuilt, and a listener that had closed over "the headline's field"
      // would then set the headline's alignment while the body was selected.
      button.addEventListener("click", () => patch({
        [field === "align" ? alignFieldFor(panelPart) : field]: button.dataset.value,
      }));
    });
  });
}

export function refreshTypographyPanel(view, source, part = "block") {
  panelPart = part;
  const preview = document.getElementById("tyPreview");
  if (preview) preview.innerHTML = previewMarkup(view);

  const label = document.getElementById("tySelectionLabel");
  if (label) label.textContent = PART_LABEL[part] || "Whole block";
  const note = document.querySelector(".ty-selection-note");
  const wantedNote = selectionNote(part);
  if ((note?.outerHTML || "") !== wantedNote) note?.remove();
  if (wantedNote && !document.querySelector(".ty-selection-note")) {
    label?.closest("p")?.insertAdjacentHTML("afterend", wantedNote);
  }
  document.querySelectorAll(".form-group-targeted").forEach((el) => el.classList.remove("form-group-targeted"));
  const targeted = PART_FIELD[part];
  if (targeted) document.getElementById(targeted)?.closest(".form-group")?.classList.add("form-group-targeted");

  document.querySelectorAll("[data-segmented]").forEach((group) => {
    const field = group.dataset.segmented;
    const current = field === "align" ? alignValueOf(view, part) : String(view[field]);
    group.querySelectorAll(".segment").forEach((button) => {
      button.classList.toggle("active", current === button.dataset.value);
    });
  });
  const alignLabel = document.querySelector('[data-segmented="align"]')?.previousElementSibling;
  if (alignLabel) {
    alignLabel.textContent = part === "headline" || part === "subheading"
      ? `Alignment — ${PART_LABEL[part]}`
      : "Alignment";
  }

  if (source === "typography-panel") return;
  NUMBER_FIELDS.forEach((f) => {
    const input = document.getElementById(f.id);
    if (input && document.activeElement !== input && Number(input.value) !== Number(view[f.field])) {
      input.value = view[f.field];
    }
  });
  TOGGLES.forEach((t) => {
    const box = document.getElementById(t.id);
    if (box) box.checked = Boolean(view[t.field]);
  });
  const family = document.getElementById("tyFontFamily");
  if (family) family.value = view.fontFamily || "";
  const displayFamily = document.getElementById("tyDisplayFamily");
  if (displayFamily) displayFamily.value = view.displayFamily || "";
  const weight = document.getElementById("tyFontWeight");
  if (weight) weight.value = view.fontWeight;
}
