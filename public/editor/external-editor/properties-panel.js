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
import { composeSection, measureColumns, maxLegibleColumns } from "../compose/section-adapter.js";
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
// The border vocabulary and the rule ladder come from the ONE catalogue
// (layout/borders.js), which the canvas, the Block Editor, the .sla and the
// print model all read. The list here used to be written out locally and had
// drifted from what the server would accept: it offered "Rule below" and the
// service's whitelist was ['none', 'box'], so that button sent a payload the
// server refused and the page never changed.
import "../layout/borders.js";
const { BORDER_STYLES, BORDER_WIDTHS, isRuled, borderWidthPx } = globalThis.SahasBorders;
import "../layout/inset-panels.js";
const { INSET_PANEL_KINDS, INSET_PANEL_MIN_PX, panelsOf } = globalThis.SahasInsetPanels;

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

// How deep an initial letter is set. Two is the shallowest that reads as a
// drop cap rather than as a mistake; four is as deep as a newspaper column
// goes before the letter starts to dominate the story it opens.
const DROP_CAPS = [
  [0, "None"],
  [2, "2 lines"],
  [3, "3 lines"],
  [4, "4 lines"],
];

let boundHandlers = null;
// The block the panel controls are acting on. They send the WHOLE panel list
// on every change (a panel has no server-side id), so they need the block
// they belong to, and refreshPropertiesPanel() rewrites its own markup - so
// this is captured at render rather than closed over at bind time.
let boundSection = null;
let boundView = null;

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
  const autoSection = { ...section, columnCount: null, column_count: null };
  const autoView = { ...view, columnCount: null, column_count: null };
  const preferred = measureColumns(autoSection, autoView, width);
  // The width-derived count is the first choice. The final Auto count also
  // sees the current words and pictures, because a cut-out can make two
  // nominal columns hold less copy than one. This is the same composition the
  // canvas paints, not a second estimate made for the inspector.
  let auto = preferred;
  try {
    auto = composeSection(autoSection, autoView).columns.length || preferred;
  } catch {
    // Before the browser's font/shaper assets are ready, the width answer is
    // the only honest preview. The canvas will repaint this note once ready.
  }
  const most = maxLegibleColumns(section, view, width, 4);
  const cap = most < 4
    ? ` This block is too narrow for ${most === 1 ? "two" : `${most + 1}`} columns${most === 1 ? "" : " or more"} - they are greyed out because a column that narrow sets no words at all, not fewer.`
    : "";
  const fitted = auto < preferred
    ? ` Auto normally prefers ${preferred}, but the current copy would overflow there; ${auto} is the highest count that sets every word around the pictures.`
    : "";
  return (auto === 1
    ? "Auto sets this block in one column."
    : `Auto sets this block in ${auto} columns. A column is aimed at the 59 mm a printed page uses, and never made too narrow to set a word in.`) + fitted + cap;
}

function blockPropertiesMarkup(section, view, page) {
  const border = String(view.borderStyle || section.border_style || "none");
  const ruleWidth = borderWidthPx(view.borderWidthPx ?? section.border_width_px);
  const tint = view.backgroundColor ?? section.background_color ?? null;
  const headlineStyle = String(view.headlineStyle || section.headline_style || "plain");
  const rawColumns = view.columnCount ?? section.column_count ?? null;
  const columns = Number.isInteger(Number(rawColumns)) && Number(rawColumns) >= 1 ? Number(rawColumns) : null;
  const dropCapLines = Math.max(0, Number(view.dropCapLines ?? section.drop_cap_lines ?? 0) || 0);
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
          ${BORDER_STYLES.map(
            (style) => `<button type="button" class="segment${border === style.key ? " active" : ""}" data-border="${style.key}">${style.label}</button>`,
          ).join("")}
        </div>
      </div>
      ${isRuled(border) ? `
      <div class="form-group">
        <label>Rule</label>
        <div class="segmented" data-prop-border-width>
          ${BORDER_WIDTHS.map(
            (width) => `<button type="button" class="segment${Math.abs(ruleWidth - width.px) < 0.01 ? " active" : ""}" data-border-width="${width.px}">${width.label}</button>`,
          ).join("")}
        </div>
      </div>` : ""}
      <p class="muted ext-note">Nothing is ruled unless you rule it. A rule is specified in points, the way a printer specifies one. A box sets the copy in a little way from its own line, the way a printed panel does, and the page draws no hairline in the gutter beside a block that already has a box. There is no corner radius on purpose - every rule on a printed page meets its neighbour square.</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Panel inside the block</h5>
      <p class="muted ext-note">The चौकट a printed paper sets a fact box or a pull quote in. The story runs round it exactly as it runs round a photograph &mdash; it is a rectangle to the compositor and nothing more.</p>
      <div id="propPanels">${panelsMarkup(section, view)}</div>
      <div class="segmented" data-prop-panel-add>
        ${INSET_PANEL_KINDS.map((kind) => `<button type="button" class="segment" data-panel-add="${kind.key}" title="${escapeHtml(kind.note)}">+ ${escapeHtml(kind.label)}</button>`).join("")}
      </div>
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
          ${(() => {
            // A count this block cannot hold is not offered. Measured on a real
            // 150 x 264 lead in 12px type: 2, 3 and 4 columns each compose ZERO
            // body lines - NO_LEGAL_MEASURE, BODY_OVERSET, "Room for copy 0-0
            // characters" - so all three were choices that could only break the
            // block, offered with nothing to say so. The floor is the engine's
            // own (section-adapter.js's maxLegibleColumns), not a second guess.
            const most = maxLegibleColumns(section, view, Number(section.width_px) || 0, 4);
            return COLUMN_COUNTS.map(([value, label]) => {
              const tooMany = Number.isInteger(value) && value > most;
              return `<button type="button" class="segment${columns === value ? " active" : ""}"
                ${tooMany ? `disabled title="This block is only wide enough for ${most} column${most === 1 ? "" : "s"} - ${value} would set no words at all"` : ""}
                data-columns="${value ?? ""}">${label}</button>`;
            }).join("");
          })()}
        </div>
      </div>
      <p class="muted ext-note">${escapeHtml(columnsNote(section, view))}</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Drop cap</h5>
      <div class="form-group">
        <div class="segmented" data-prop-drop-cap>
          ${DROP_CAPS.map(
            ([value, label]) => `<button type="button" class="segment${dropCapLines === value ? " active" : ""}" data-drop-cap="${value}">${label}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">An initial letter set over the first lines of the story, with the copy running round it. It is stated in LINES, so it stays right whatever the block's body size is - and it is a property of the frame, not a size mark on a run: marking the first character bigger only makes one row of the column taller and leaves the letter on a stilt.</p>
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
  boundSection = section;
  boundView = view;
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
/** The panels on this block, each editable where it is listed. */
function panelsMarkup(section, view) {
  const panels = panelsOf({ ...section, inset_panels: view.insetPanels ?? section.inset_panels });
  if (!panels.length) return `<p class="muted">No panel on this block.</p>`;
  return panels.map((panel) => `
    <div class="prop-panel" data-panel-id="${escapeHtml(panel.id)}">
      <div class="prop-panel-head">
        <strong>${escapeHtml(INSET_PANEL_KINDS.find((k) => k.key === panel.kind)?.label || panel.kind)}</strong>
        <button type="button" class="btn-ghost" data-panel-remove="${escapeHtml(panel.id)}">Remove</button>
      </div>
      <label>Heading<input type="text" data-panel-field="title" value="${escapeHtml(panel.title)}"></label>
      <label>Lines, one per row<textarea rows="3" data-panel-field="lines">${escapeHtml(panel.lines.join("\n"))}</textarea></label>
      <div class="prop-panel-geometry">
        ${["x", "y", "width", "height"].map((field) => `<label>${field}<input type="number" data-panel-field="${field}" value="${Math.round(panel[field])}"></label>`).join("")}
      </div>
      <label>Ground
        <select data-panel-field="tint">
          ${TINTS.map((tint) => `<option value="${tint.hex || ""}"${(panel.tint || "") === (tint.hex || "") ? " selected" : ""}>${escapeHtml(tint.label)}</option>`).join("")}
        </select>
      </label>
    </div>`).join("");
}

/**
 * Every panel on the block, as the patch carries it.
 *
 * The whole array goes every time, deliberately: a panel has no id the server
 * addresses, so "change this one" can only be expressed as "here is the new
 * list". It is also how the last panel is taken off - an empty array, never a
 * null, because the column is written with COALESCE and null means leave it.
 */
function panelsFromDom(section, view) {
  return Array.from(document.querySelectorAll("#propPanels .prop-panel")).map((node) => {
    const field = (name) => node.querySelector(`[data-panel-field="${name}"]`)?.value ?? "";
    const was = panelsOf({ ...section, inset_panels: view.insetPanels ?? section.inset_panels })
      .find((p) => p.id === node.dataset.panelId);
    return {
      id: node.dataset.panelId,
      kind: was?.kind || "note",
      x: Number(field("x")), y: Number(field("y")),
      width: Number(field("width")), height: Number(field("height")),
      title: field("title"),
      tint: field("tint") || null,
      lines: String(field("lines")).split("\n"),
    };
  });
}

function bindPanelControls(handlers, section, view) {
  const send = (panels) => handlers.onPatch?.({ insetPanels: panels }, "properties-panel");

  document.querySelectorAll("[data-prop-panel-add] [data-panel-add]").forEach((button) => {
    button.addEventListener("click", () => {
      // Placed in the lower right of the block at a bit under half its width,
      // which is where a printed चौकट usually sits and is never over the
      // headline.
      const w = Math.max(INSET_PANEL_MIN_PX, Math.round((Number(section.width_px) || 200) * 0.45));
      const h = Math.max(INSET_PANEL_MIN_PX, Math.round((Number(section.height_px) || 200) * 0.3));
      send([...panelsFromDom(section, view), {
        id: `panel-${Date.now().toString(36)}`,
        kind: button.dataset.panelAdd,
        x: Math.max(0, (Number(section.width_px) || 200) - w - 2),
        y: Math.round((Number(section.height_px) || 200) * 0.45),
        width: w, height: h,
        title: button.dataset.panelAdd === "quote" ? "" : "ठळक मुद्दे",
        lines: ["\u2022"],
      }]);
    });
  });

  document.querySelectorAll("#propPanels [data-panel-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      send(panelsFromDom(section, view).filter((panel) => panel.id !== button.dataset.panelRemove));
    });
  });

  // On change, not on every keystroke: each of these is a save and a recompose.
  document.querySelectorAll("#propPanels [data-panel-field]").forEach((field) => {
    field.addEventListener("change", () => send(panelsFromDom(section, view)));
  });
}

function bindBorderButtons(handlers) {
  document.querySelectorAll("[data-prop-border] [data-border]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ borderStyle: button.dataset.border }, "properties-panel");
    });
  });
  document.querySelectorAll("[data-prop-border-width] [data-border-width]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ borderWidthPx: Number(button.dataset.borderWidth) }, "properties-panel");
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

function bindDropCapButtons(handlers) {
  document.querySelectorAll("[data-prop-drop-cap] [data-drop-cap]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ dropCapLines: Number(button.dataset.dropCap) }, "properties-panel");
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
  bindPanelControls(boundHandlers, boundSection, boundView);
  bindTintButtons(boundHandlers);
  bindColumnButtons(boundHandlers);
  bindDropCapButtons(boundHandlers);
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
