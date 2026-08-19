// Stage 3: a real properties inspector for whatever object selectedPart
// (store.js) currently names - block, headline, subheading, body, image or
// smartCard.
//
// "Real" means: every field shown here is a column that is actually
// persisted AND actually rendered somewhere a desk can see it. Two things
// were deliberately left out of the image panel for exactly that reason -
// section_images has crop_x_px/crop_y_px/crop_width_px/crop_height_px
// columns, but nothing in picture-style.js reads them, so a crop control
// here would change a number with no visible effect; there is no `opacity`
// column at all. Headline/subheading/body get no X/Y/W/H, because their
// position is a row count from the character grid (text-flow.js), not a
// stored coordinate - see textPropertiesMarkup()'s own note, which is the
// content of this panel for those three, not an apology for missing one.

import { escapeHtml } from "../format.js";
import { TINTS } from "../layout/inks.js";
import { measureColumns } from "../compose/section-adapter.js";
import { PART_LABEL } from "./typography-panel.js";
// The Layer control reuses the EXACT arithmetic the Story panel's "Bring
// forward"/"Send back" buttons already use - not a second copy of
// "z-index plus or minus one, floored at zero".
import { change as pictureAction } from "./picture-controls.js";

const SHAPES = [
  ["rect", "Box"],
  ["ellipse", "Oval"],
  ["cutout", "Cut-out"],
];

// How this block is ruled, and the only place in the product that says so.
//
// Every advert, every briefs block and all four standing features used to be
// born boxed, from the layout template, with no control anywhere to take the
// box off - so a page came out of the press view ruled into panels nobody had
// chosen. The template's job is to say where a frame is and what it is for;
// how it is ruled is a design decision and belongs to the desk, per block.
//
// A box costs the block room (section-adapter.js's BOX_INSET_PX: a printed
// panel sets its type 3-4 mm inside its own rule, so the copy comes in), and
// the column rules skip a boxed block entirely (column-rules.js) - its box IS
// the separator, and a hairline 3 px outside it would be two rules where a
// printer draws one. Both follow from this one field.
const BORDERS = [
  ["none", "None"],
  ["box", "Box"],
  ["rule", "Rule below"],
];

// The tints come from the ONE colour catalogue (layout/inks.js), the same one
// the ink marks and the press file read. A palette written out a second time
// here is the drift this codebase has already been bitten by twice.

// How many columns the copy is set in. "Auto" is NULL - the honest default,
// and now the ordinary state (schema.sql): the engine works the count out from
// the block's own width and type size, targeting the 59 mm column measured off
// the customer's printed page and never producing one too narrow to set in
// (section-adapter.js's measureColumns).
//
// This is the ONE control for the field. It used to be a number input in the
// Typography panel, which could not express "auto" at all - so a desk who once
// touched it could never hand the decision back.
const COLUMN_COUNTS = [
  [null, "Auto"],
  [1, "1"],
  [2, "2"],
  [3, "3"],
  [4, "4"],
];

// What the headline does with its own band. `accent` colours the last word;
// `reverse` sets the whole headline in white out of a solid panel - the
// treatment a Marathi daily gives a lead. Both are drawn, never composed, so
// neither moves a line (compose/render.js).
const HEADLINE_STYLES = [
  ["plain", "Plain"],
  ["accent", "Accent word"],
  ["reverse", "Reversed"],
];

let boundHandlers = null;

function normDeg(value) {
  return ((Math.round(Number(value) || 0) % 360) + 360) % 360;
}

function numberField(id, label, value, { min, max, step = 1, unit = "" } = {}) {
  return `
    <div class="form-group">
      <label>${label}${unit ? ` (${unit})` : ""}</label>
      <input type="number" id="${id}"
        ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} step="${step}"
        value="${Math.round(Number(value) || 0)}" />
    </div>`;
}

// -------------------------------------------------------------- markup ---

// What Auto would actually do, said in the block's own numbers rather than
// left as a promise - a desk choosing between "auto" and "2" should be able to
// see that they are the same answer here.
function columnsNote(section, view) {
  const width = Number(section.width_px) || 0;
  const auto = measureColumns(section, view, width);
  return auto === 1
    ? "Auto sets this block in one column - it is not wide enough for two that could still be read."
    : `Auto sets this block in ${auto} columns. A column is aimed at the 59 mm a printed page uses, and never made too narrow to set a word in.`;
}

function blockPropertiesMarkup(section, view, page) {
  const border = String(view.borderStyle || section.border_style || "none");
  const tint = view.backgroundColor ?? section.background_color ?? null;
  const headlineStyle = String(view.headlineStyle || section.headline_style || "plain");
  const rawColumns = view.columnCount ?? section.column_count ?? null;
  const columns = Number.isInteger(Number(rawColumns)) && Number(rawColumns) >= 1 ? Number(rawColumns) : null;
  return `
    <div class="field-grid">
      <div class="form-group"><label>Block type</label><p class="prop-readout">${escapeHtml(section.block_type || "article")}</p></div>
      <div class="form-group"><label>Status</label><p class="prop-readout">${escapeHtml(view.status || "empty")}</p></div>
      <div class="form-group"><label>Size</label><p class="prop-readout">${section.width_px} × ${section.height_px} px</p></div>
      ${page?.template_key ? `<div class="form-group"><label>Layout</label><p class="prop-readout">${escapeHtml(page.template_key)}</p></div>` : ""}
    </div>
    <p class="muted ext-note">A block's position and size come from the page's layout template, not from this panel - see the small page map below for where it sits.</p>

    <div class="prop-section">
      <h5 class="prop-heading">Border</h5>
      <div class="form-group">
        <div class="segmented" data-prop-border>
          ${BORDERS.map(
            ([key, label]) => `<button type="button" class="segment${border === key ? " active" : ""}" data-border="${key}">${label}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">Nothing is ruled unless you rule it. A box sets the copy in a little way from its own line, the way a printed panel does, and the page draws no hairline in the gutter beside a block that already has a box.</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Ground</h5>
      <div class="form-group">
        <div class="tint-swatches" data-prop-tint>
          ${TINTS.map(
            (entry) => `<button type="button" class="tint-swatch${(tint || null) === entry.hex ? " active" : ""}"
              data-tint="${entry.hex || ""}" title="${escapeHtml(entry.label)}"
              style="--tint:${entry.hex || "#ffffff"}"><i></i></button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">A few per cent of one ink, which is what a printed side-bar carries. Heavier than that and the copy loses its contrast on newsprint.</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Columns</h5>
      <div class="form-group">
        <div class="segmented" data-prop-columns>
          ${COLUMN_COUNTS.map(
            ([value, label]) => `<button type="button" class="segment${columns === value ? " active" : ""}" data-columns="${value ?? ""}">${label}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">${escapeHtml(columnsNote(section, view))}</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Headline treatment</h5>
      <div class="form-group">
        <div class="segmented" data-prop-headline-style>
          ${HEADLINE_STYLES.map(
            ([key, label]) => `<button type="button" class="segment${headlineStyle === key ? " active" : ""}" data-headline-style="${key}">${label}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">Reversed sets the headline in white out of a solid band, in the block's accent colour. The band is drawn behind type that has already been placed, so it never changes where a line breaks.</p>
    </div>
  `;
}

// Headline, subheading and body have no independent x/y/width/height in the
// data model - they are whole rows taken off the top of the block by the
// character grid (text-flow.js), the same measurement the Typography
// panel's own selection note already makes. Showing coordinate fields for
// them would be the exact kind of fake control the task this panel was
// built for explicitly forbids.
function textPropertiesMarkup() {
  return `<p class="muted ext-note">Position and width are set by the newspaper's text-flow grid, not a coordinate - changing the type below changes how many rows this object takes, which is what moves it. See Typography for what is actually editable here.</p>`;
}

function imagePropertiesMarkup(image) {
  if (!image) return `<p class="muted">No picture selected.</p>`;
  const rotation = normDeg(image.rotation);
  return `
    <div class="prop-section">
      <h5 class="prop-heading">Transform</h5>
      <div class="field-grid">
        ${numberField("propImgX", "X", image.x_px, { unit: "px" })}
        ${numberField("propImgY", "Y", image.y_px, { unit: "px" })}
        ${numberField("propImgWidth", "Width", image.width_px, { min: 1, unit: "px" })}
        ${numberField("propImgHeight", "Height", image.height_px, { min: 1, unit: "px" })}
      </div>
      <label class="toggle"><input type="checkbox" id="propImgLock" /> Lock width/height together</label>
      ${numberField("propImgRotation", "Rotation", rotation, { min: 0, max: 359, unit: "deg" })}
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Appearance</h5>
      <div class="form-group">
        <label>Copy wraps as</label>
        <div class="segmented" data-prop-shape>
          ${SHAPES.map(
            ([key, label]) => `<button type="button" class="segment${(image.shape || "rect") === key ? " active" : ""}" data-shape="${key}">${label}</button>`,
          ).join("")}
        </div>
      </div>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Text wrap</h5>
      ${numberField("propImgStandOff", "Gap around the picture", image.stand_off_px, { min: 0, max: 60, unit: "px" })}
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Layer</h5>
      <p class="prop-readout" id="propImgZIndex">z-index ${Number(image.z_index) || 0}</p>
      <div class="ext-editor-toolbar">
        <button type="button" class="ext-editor-btn" data-prop-layer="forward">Move up</button>
        <button type="button" class="ext-editor-btn" data-prop-layer="backward">Move down</button>
      </div>
    </div>
  `;
}

// Smart Card content is generated data (see CLAUDE.md's "structured, never
// flattened"), not something this panel edits - a fake geometry section
// here would claim a card is a positioned box the way a picture is, and it
// is not; its size is exactly the space the layout gave the block.
function smartCardPropertiesMarkup(view) {
  return `
    <div class="form-group"><label>Type</label><p class="prop-readout">${escapeHtml(view.smartCardKey || "-")}</p></div>
    <p class="muted ext-note">A Smart Card's content is generated, not typed - see the Smart Cards panel to change or regenerate it.</p>
  `;
}

function bodyMarkupFor(section, view, image, part, page) {
  if (part === "image") return imagePropertiesMarkup(image);
  if (part === "smartCard") return smartCardPropertiesMarkup(view);
  if (part === "block") return blockPropertiesMarkup(section, view, page);
  return textPropertiesMarkup();
}

export function propertiesPanelMarkup(section, view, image, part = "block", page = null) {
  return `
    <p class="ty-selection-label">Properties: <strong id="propSelectionLabel">${PART_LABEL[part] || "Whole block"}</strong></p>
    <div id="propBody">${bodyMarkupFor(section, view, image, part, page)}</div>
  `;
}

// -------------------------------------------------------------- binding ---
//
// Numeric fields commit on blur or Enter, never on every keystroke - unlike
// the Typography panel's fields (which patch the DRAFT, itself debounced by
// autosave), a picture's geometry PATCHes the database immediately on every
// call, so an "input" listener here would be a network request per digit.

const GEOMETRY_FIELDS = [
  { input: "propImgX", api: "x", row: "x_px", positive: false },
  { input: "propImgY", api: "y", row: "y_px", positive: false },
  { input: "propImgWidth", api: "width", row: "width_px", positive: true },
  { input: "propImgHeight", api: "height", row: "height_px", positive: true },
];

function commitOnBlurOrEnter(input, commit) {
  if (!input) return;
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur(); // fires "change" above
    }
  });
}

function bindGeometryFields(handlers) {
  GEOMETRY_FIELDS.forEach((field) => {
    const input = document.getElementById(field.input);
    commitOnBlurOrEnter(input, () => {
      const current = handlers.getSelectedImage?.();
      if (!current || !input) return;
      const existing = Math.round(Number(current[field.row]) || 0);
      const raw = Math.round(Number(input.value));

      // Reject, don't clamp-and-send: width/height <= 0 is not a placement
      // the block can hold, so the field reverts to what is actually saved
      // rather than asking the server to make sense of it.
      if (!Number.isFinite(raw) || (field.positive && raw <= 0)) {
        input.value = existing;
        return;
      }
      if (raw === existing) return;

      const patch = { [field.api]: raw };
      const locked = document.getElementById("propImgLock")?.checked;
      if (locked && (field.api === "width" || field.api === "height")) {
        // A UI-only convenience (Stage 3's own brief: fine as long as it does
        // not conflict with the persisted model, which stores width/height
        // as two independent columns either way) - the ratio is read fresh
        // from the image every time, not captured once and gone stale.
        const w = Number(current.width_px) || 1;
        const h = Number(current.height_px) || 1;
        const ratio = h / w;
        if (field.api === "width") patch.height = Math.max(1, Math.round(raw * ratio));
        else patch.width = Math.max(1, Math.round(raw / ratio));
      }
      handlers.onPatchImage?.(current.id, patch);
    });
  });
}

function bindRotationField(handlers) {
  const input = document.getElementById("propImgRotation");
  commitOnBlurOrEnter(input, () => {
    const current = handlers.getSelectedImage?.();
    if (!current || !input) return;
    const existing = normDeg(current.rotation);
    const raw = Number(input.value);
    if (!Number.isFinite(raw)) {
      input.value = existing;
      return;
    }
    const value = normDeg(raw);
    input.value = value;
    if (value === existing) return;
    handlers.onPatchImage?.(current.id, { rotation: value });
  });
}

function bindStandOffField(handlers) {
  const input = document.getElementById("propImgStandOff");
  commitOnBlurOrEnter(input, () => {
    const current = handlers.getSelectedImage?.();
    if (!current || !input) return;
    const existing = Math.round(Number(current.stand_off_px) || 0);
    const raw = Math.round(Number(input.value));
    if (!Number.isFinite(raw) || raw < 0) {
      input.value = existing;
      return;
    }
    if (raw === existing) return;
    handlers.onPatchImage?.(current.id, { standOffPx: raw });
  });
}

function bindShapeButtons(handlers) {
  document.querySelectorAll("[data-prop-shape] [data-shape]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = handlers.getSelectedImage?.();
      if (!current) return;
      handlers.onPatchImage?.(current.id, { shape: button.dataset.shape });
    });
  });
}

function bindLayerButtons(handlers) {
  document.querySelectorAll("[data-prop-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = handlers.getSelectedImage?.();
      if (!current) return;
      const patch = pictureAction(current, button.dataset.propLayer);
      if (patch) handlers.onPatchImage?.(current.id, patch);
    });
  });
}

// The block's own controls. Bound the same way the image controls are, and
// re-bound on every refresh for the same reason: refreshPropertiesPanel()
// rewrites #propBody, so a listener bound to a button inside it is on a
// detached node from the next repaint - the #edSpaceGroup trap.
function bindBorderButtons(handlers) {
  document.querySelectorAll("[data-prop-border] [data-border]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ borderStyle: button.dataset.border }, "properties-panel");
    });
  });
}

function bindTintButtons(handlers) {
  document.querySelectorAll("[data-prop-tint] [data-tint]").forEach((button) => {
    button.addEventListener("click", () => {
      // "" is White, and White is the absence of a tint - so it is stored as
      // NULL, not as #ffffff. A page whose blocks all carry an explicit white
      // could never be told apart from a page nobody had tinted.
      handlers.onPatch?.({ backgroundColor: button.dataset.tint || null }, "properties-panel");
    });
  });
}

function bindColumnButtons(handlers) {
  document.querySelectorAll("[data-prop-columns] [data-columns]").forEach((button) => {
    button.addEventListener("click", () => {
      const raw = button.dataset.columns;
      // "" is Auto, and Auto is NULL - the engine's own answer, not a number
      // this panel guessed and stored.
      handlers.onPatch?.({ columnCount: raw === "" ? null : Number(raw) }, "properties-panel");
    });
  });
}

function bindHeadlineStyleButtons(handlers) {
  document.querySelectorAll("[data-prop-headline-style] [data-headline-style]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ headlineStyle: button.dataset.headlineStyle }, "properties-panel");
    });
  });
}

function bindImageControls() {
  if (!boundHandlers) return;
  bindGeometryFields(boundHandlers);
  bindRotationField(boundHandlers);
  bindStandOffField(boundHandlers);
  bindShapeButtons(boundHandlers);
  bindLayerButtons(boundHandlers);
}

function bindBlockControls() {
  if (!boundHandlers) return;
  bindBorderButtons(boundHandlers);
  bindTintButtons(boundHandlers);
  bindColumnButtons(boundHandlers);
  bindHeadlineStyleButtons(boundHandlers);
}

export function bindPropertiesPanel(handlers) {
  boundHandlers = handlers;
  bindImageControls();
  bindBlockControls();
}

// ------------------------------------------------------------- refresh ---

export function refreshPropertiesPanel(section, view, image, source, part = "block", page = null) {
  const label = document.getElementById("propSelectionLabel");
  if (label) label.textContent = PART_LABEL[part] || "Whole block";

  const host = document.getElementById("propBody");
  if (!host) return;

  // Never while a NUMBER FIELD in this panel has focus - a live sync from
  // elsewhere (a drag on the canvas, an autosave landing) must not blur an
  // input mid-edit and lose what has not been committed. Deliberately
  // narrower than "anything in the panel has focus": Tab out of a number
  // field lands on the aspect-lock checkbox or a shape/layer button next in
  // the panel, and those hold no uncommitted text - blocking the refresh
  // for those too made a drag on the canvas silently stop updating Width
  // and Height the moment a desk had merely tabbed past a checkbox.
  const active = document.activeElement;
  if (active?.tagName === "INPUT" && active.type === "number" && host.contains(active)) return;

  host.innerHTML = bodyMarkupFor(section, view, image, part, page);
  if (part === "image") bindImageControls();
  if (part === "block") bindBlockControls();
}
