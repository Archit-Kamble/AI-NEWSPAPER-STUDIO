// Part 6: the Typography tab.
//
// These are print composition settings, not CSS conveniences - each one maps
// onto a Scribus paragraph/frame property at export. Sizes are px in editor
// space and convert to mm at export time; the conversion stays explicit, per
// CLAUDE.md's rule about never mixing the two silently.

import { MIN_LINE_HEIGHT } from "../layout/text-flow.js";

// Exported because the writing toolbar offers the same font and the same
// alignments, and they must be the SAME list. A second copy of a catalog is how
// the template keys drifted (CLAUDE.md); these set real Scribus properties, so
// two lists would mean a font offered on screen that the press file has never
// heard of.
export const FONT_FAMILIES = [
  { value: "", label: "Theme default" },
  { value: "Georgia, 'Times New Roman', serif", label: "Georgia (serif)" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "'Noto Serif Devanagari', Georgia, serif", label: "Noto Serif Devanagari" },
  { value: "Arial, Helvetica, sans-serif", label: "Arial" },
  { value: "'Helvetica Neue', Helvetica, sans-serif", label: "Helvetica Neue" },
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
];

const LIST_STYLES = [
  { value: "none", label: "None" },
  { value: "bullet", label: "Bullets" },
  { value: "number", label: "Numbering" },
];

const NUMBER_FIELDS = [
  { id: "tyHeadlineSize", field: "headlineFontPx", label: "Headline size (px)", min: 8, max: 140, step: 1 },
  { id: "tySubheadingSize", field: "subheadingFontPx", label: "Subheadline size (px)", min: 8, max: 90, step: 1 },
  { id: "tyBodySize", field: "bodyFontPx", label: "Body size (px)", min: 6, max: 48, step: 1 },
  { id: "tyColumns", field: "columnCount", label: "Columns", min: 1, max: 6, step: 1 },
  { id: "tyMargin", field: "marginPx", label: "Margins (px)", min: 0, max: 60, step: 1 },
  // The floor, not just this control's default: below it, Devanagari vowel
  // signs crop against the next line (text-flow.js's MIN_LINE_HEIGHT). What
  // this input offers has to match what section-model.js actually stores, or
  // a desk could type 1.0 here and watch it render at 1.45 anyway.
  { id: "tyLineHeight", field: "lineHeight", label: "Line spacing", min: MIN_LINE_HEIGHT, max: 3, step: 0.05 },
  { id: "tyLetterSpacing", field: "letterSpacingPx", label: "Letter spacing (px)", min: -2, max: 10, step: 0.1 },
  { id: "tyParagraphSpacing", field: "paragraphSpacingPx", label: "Paragraph spacing (px)", min: 0, max: 60, step: 1 },
];

const TOGGLES = [
  { id: "tyItalic", field: "fontItalic", label: "Italic" },
  { id: "tyUnderline", field: "fontUnderline", label: "Underline" },
  { id: "tyDropCap", field: "dropCap", label: "Drop cap" },
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
const PART_LABEL = {
  block: "Whole block",
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
  return `<p class="ty-selection-note">Editing <strong>${PART_LABEL[part] || part}</strong> - its size is highlighted below. Family, weight, alignment and spacing are set for the whole block.</p>`;
}

export function typographyPanelMarkup(view, part = "block") {
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
          <label>Weight</label>
          <select id="tyFontWeight">${select("tyFontWeight", WEIGHTS, view.fontWeight)}</select>
        </div>
        <div class="form-group">
          <label>Alignment</label>
          ${segmented("textAlign", ALIGNMENTS, view.textAlign)}
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
        <p class="muted ext-note">Drop cap is a placeholder - it is stored and shown in the preview, but the production compositor will render it.</p>
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
    `letter-spacing:${view.letterSpacingPx}px`,
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
      ? `<p class="type-preview-body${view.dropCap ? " drop-cap" : ""}" style="${bodyStyle}">${escapeText(bodyText)}</p>`
      : `<${view.listStyle === "number" ? "ol" : "ul"} class="type-preview-body" style="${bodyStyle}">
           ${bodyText
             .split(/\n+/)
             .filter(Boolean)
             .map((line) => `<li>${escapeText(line)}</li>`)
             .join("")}
         </${view.listStyle === "number" ? "ol" : "ul"}>`;

  return `
    <div style="${style}">
      <h2 style="font-size:${view.headlineFontPx}px;margin:0 0 6px;">${escapeText(view.headline || "Headline preview")}</h2>
      ${view.subheading ? `<h3 style="font-size:${view.subheadingFontPx}px;margin:0 0 10px;font-weight:400;">${escapeText(view.subheading)}</h3>` : ""}
      ${bodyEl}
    </div>
  `;
}

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

export function bindTypographyPanel(getView, onPatch) {
  const patch = (updates) => onPatch(updates, "typography-panel");

  document.getElementById("tyFontFamily")?.addEventListener("change", (e) => patch({ fontFamily: e.target.value }));
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
      button.addEventListener("click", () => patch({ [field]: button.dataset.value }));
    });
  });
}

export function refreshTypographyPanel(view, source, part = "block") {
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
    group.querySelectorAll(".segment").forEach((button) => {
      button.classList.toggle("active", String(view[field]) === button.dataset.value);
    });
  });

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
  const weight = document.getElementById("tyFontWeight");
  if (weight) weight.value = view.fontWeight;
}
