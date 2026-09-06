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
import { TINTS, INKS, HEADLINE_STYLES as HEADLINE_STYLE_TABLE } from "../layout/inks.js";
import { BLOCK_SHAPES } from "../layout/block-shapes.js";
import {
  BLOCK_DESIGN_CATEGORIES,
  availableBlockDesigns,
  blockDesignPatch,
  blockDesignPreviewMarkup,
  matchingBlockDesign,
  recommendedBlockDesigns,
} from "../layout/block-design-presets.js";
import { composeSection, measureColumns, maxLegibleColumns } from "../compose/section-adapter.js";
import { PART_LABEL } from "./typography-panel.js";
import { statusOf, statusLabel } from "../status/section-status.js";
// What kind of work a frame wants, from the one catalogue the worklist and the
// block's own heading already read - never a second list of these keys here.
import { BLOCK_KINDS } from "../layout/block-kinds.js";
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
const { BORDER_STYLES, BORDER_WIDTHS, BORDER_RADII, isRuled, canRound, borderWidthPx, borderRadiusPx } = globalThis.SahasBorders;
import "../layout/inset-panels.js";
const { INSET_PANEL_KINDS, INSET_PANEL_MARKERS, panelsOf, defaultPanelFor } = globalThis.SahasInsetPanels;

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
// From the one catalogue (layout/inks.js), never a second list of these keys -
// the service validates against the same table, so a treatment offered here
// and refused there is not possible.
const HEADLINE_STYLES = HEADLINE_STYLE_TABLE.map((entry) => [entry.key, entry.label]);

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

/**
 * WHAT THIS SPACE IS WORTH.
 *
 * `src/layout/rateCard.js` prices a block the way every rate card in the trade
 * does - column-centimetres times a rate that depends on where on the paper it
 * sits - and `GET /pages/:pageId/sections/:sectionKey/rate` has served it since
 * it was written. NOTHING in the browser had ever asked. So an advert desk that
 * quotes a dozen times a day did it with a calculator, beside software that
 * already knew the block's width in columns and its height in millimetres
 * exactly.
 *
 * A <details> rather than a readout, and fetched only when it is opened: the
 * price is a question a desk asks about SOME blocks on some days, and a request
 * per block selection is a request per click for an answer nobody wanted.
 */
function rateMarkup(section, page) {
  const pageId = page?.id;
  if (!pageId || !section?.section_key) return "";
  return `
    <details class="prop-rate" data-rate-page="${pageId}" data-rate-key="${escapeHtml(section.section_key)}">
      <summary>What this space is worth</summary>
      <div class="prop-rate-body"><p class="muted">…</p></div>
    </details>`;
}

const RUPEES = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function rateBodyMarkup(rate) {
  return `
    <p class="prop-rate-total"><strong>${RUPEES(rate.total)}</strong></p>
    <dl class="prop-rate-lines">
      <dt>Position</dt><dd>${escapeHtml(rate.positionName || rate.position)}</dd>
      <dt>Size</dt><dd>${rate.columns} col × ${rate.heightCm} cm = <strong>${rate.columnCm}</strong> col-cm</dd>
      <dt>Rate</dt><dd>${RUPEES(rate.perColumnCm)} per column-cm</dd>
      <dt>Base</dt><dd>${RUPEES(rate.base)}</dd>
      ${rate.colour
        ? `<dt>Colour</dt><dd>+ ${RUPEES(rate.colourSurcharge)}</dd>`
        : `<dt>Colour</dt><dd>none — this page prints black only</dd>`}
    </dl>
    <p class="muted ext-note">Sold by the column-centimetre, from the block the designer drew — there is no separate "ad size" for anyone to key in wrongly. Position is most of the price. Whether colour is charged follows the page's own forme.</p>`;
}

function bindRateDisclosure() {
  const box = document.querySelector(".prop-rate");
  if (!box || box.dataset.bound === "1") return;
  box.dataset.bound = "1";
  box.addEventListener("toggle", async () => {
    if (!box.open || box.dataset.loaded === "1") return;
    const body = box.querySelector(".prop-rate-body");
    body.innerHTML = '<p class="muted">Working it out…</p>';
    try {
      const response = await fetch(
        `/api/pages/${box.dataset.ratePage}/sections/${encodeURIComponent(box.dataset.rateKey)}/rate`,
      );
      if (!response.ok) throw new Error(`rate: HTTP ${response.status}`);
      const rate = await response.json();
      body.innerHTML = rateBodyMarkup(rate);
      box.dataset.loaded = "1";
    } catch (error) {
      // Never cached on failure - the templates cache learned that lesson the
      // hard way, and a price that stays "unavailable" for the rest of the
      // session because one request blipped is worse than asking again.
      console.error(error);
      body.innerHTML = '<p class="muted">That could not be worked out just now. Close this and open it again.</p>';
    }
  });
}

// WHAT THIS BLOCK IS, AND WHAT IT CARRIES.
//
// "Block type" was a READ-OUT: the template said what a frame was for and
// nobody else could. That is right for a template and wrong for a newsroom -
// the desk's report was "we cannot make this block rashi or lead or anchor".
// A page is made up by a person, and which box carries the horoscope this
// morning is their decision.
//
// Two lists, from the two catalogues that already own them - BLOCK_KINDS for
// the kind of work a frame wants, and the paper's own standing features for
// which one it carries. Neither is restated here: a second list of these keys
// is the drift this project has been bitten by twice.
//
// Naming a feature implies the kind, so the two cannot fall out of step, and
// the service says so as well as this panel - a control is a courtesy, the
// rule lives on the route.
// The paper's own standing features, fetched once. Only a good answer is
// cached, so one blip does not empty the picker for the rest of the session -
// the rule the templates and geometry caches had to learn the hard way.
let FEATURES = [];
export async function loadFeatureCatalogue() {
  if (FEATURES.length) return FEATURES;
  try {
    const response = await fetch("/api/features");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const list = await response.json();
    if (Array.isArray(list)) FEATURES = list;
  } catch (error) {
    console.error("Feature catalogue failed:", error);
  }
  return FEATURES;
}

function purposeMarkup(section, view) {
  const kind = String(view.blockType || section.block_type || "article");
  const feature = String(section.feature_key || "");
  const kinds = Object.entries(BLOCK_KINDS)
    .map(([key, entry]) => `<option value="${escapeHtml(key)}"${key === kind ? " selected" : ""}>`
      + `${escapeHtml(entry.label)} — ${escapeHtml(entry.work)}</option>`).join("");
  const featureOptions = [`<option value=""${feature ? "" : " selected"}>Not a standing feature</option>`]
    .concat(FEATURES.map((entry) => `<option value="${escapeHtml(entry.key)}"${entry.key === feature ? " selected" : ""}>`
      + `${escapeHtml(entry.name || entry.key)}</option>`)).join("");
  return `
    <div class="form-group prop-purpose">
      <label for="propBlockKind">What this block is</label>
      <select id="propBlockKind" data-purpose-kind>${kinds}</select>
    </div>
    <div class="form-group prop-purpose">
      <label for="propBlockFeature">Standing feature</label>
      <select id="propBlockFeature" data-purpose-feature>${featureOptions}</select>
      <button type="button" class="layout-btn" data-purpose-fill${feature ? "" : " disabled"}
        title="Build this feature for the edition's date and put it in this block">Fill it now</button>
      <small class="muted">Naming a feature makes this a feature block. "Fill it now" builds today's and writes it in.</small>
    </div>`;
}

function blockPropertiesMarkup(section, view, page) {
  const border = String(view.borderStyle || section.border_style || "none");
  const ruleWidth = borderWidthPx(view.borderWidthPx ?? section.border_width_px);
  const ruleRadius = borderRadiusPx(view.borderRadiusPx ?? section.border_radius_px);
  // NULL is "the desk has not said" - the same idiom border_ink already reads
  // as everywhere else (page-styles.js's automatic theming, print-model.js,
  // render.js). `view.borderInk` can genuinely be `null` where a desk has
  // just cleared it, so this must NOT fall through past an explicit null the
  // way `??` would - only an absent KEY should read the stored row.
  const ruleInk = "borderInk" in view ? view.borderInk : (section.border_ink ?? null);
  const shapeKey = String(view.frameShape ?? section.frame_shape ?? "");
  const tint = view.backgroundColor ?? section.background_color ?? null;
  const headlineStyle = String(view.headlineStyle || section.headline_style || "plain");
  // NULL is "the desk has not said" - the same idiom ruleInk already reads as.
  // headline_ink is the headline's (and kicker's) own TEXT colour when the
  // treatment is not reversed; accent_color is a DIFFERENT object - the fill
  // behind a reversed or screened band, and the colour of the accent word
  // under the 'accent' treatment (render.js: headlineLineHtml, and the
  // reverse-panel/band-screen pieces just above it). Two objects, two
  // controls - the rule this file already states for every other pair.
  const headInk = "headlineInk" in view ? view.headlineInk : (section.headline_ink ?? null);
  const accent = ("accentColor" in view ? view.accentColor : section.accent_color) || "#c8102e";
  const rawColumns = view.columnCount ?? section.column_count ?? null;
  const columns = Number.isInteger(Number(rawColumns)) && Number(rawColumns) >= 1 ? Number(rawColumns) : null;
  const dropCapLines = Math.max(0, Number(view.dropCapLines ?? section.drop_cap_lines ?? 0) || 0);
  const designs = availableBlockDesigns(section, view);
  const matchingDesign = matchingBlockDesign(view);
  const recommended = new Set(recommendedBlockDesigns(section, view));
  const initialDesign = matchingDesign || designs.find((entry) => recommended.has(entry.key)) || designs[0] || null;
  return `
    <div class="prop-section prop-design-section">
      <h5 class="prop-heading">Block design</h5>
      <p class="muted ext-note">Original SAHAS newspaper treatments, assembled from the same print-tested rules, inks and screens used by every export. Choose first; nothing changes until Apply.</p>
      ${designs.length ? `
        <label for="propBlockDesign">Design</label>
        <select id="propBlockDesign" data-prop-design>
          ${BLOCK_DESIGN_CATEGORIES.map((category) => {
            const choices = designs.filter((entry) => entry.category === category);
            if (!choices.length) return "";
            return `<optgroup label="${escapeHtml(category)}">${choices.map((entry) => `
              <option value="${escapeHtml(entry.key)}"${initialDesign?.key === entry.key ? " selected" : ""}>${
                recommended.has(entry.key) ? "★ " : ""}${escapeHtml(entry.marathi)} · ${escapeHtml(entry.label)}</option>`).join("")}</optgroup>`;
          }).join("")}
        </select>
        <div class="block-design-choice" id="propBlockDesignChoice">
          ${blockDesignChoiceMarkup(initialDesign, matchingDesign)}
        </div>
        <p class="block-design-guard" id="propBlockDesignGuard" role="status" aria-live="polite"></p>
        <button type="button" class="layout-btn" data-prop-design-apply${matchingDesign?.key === initialDesign?.key ? " disabled" : ""}>Apply design</button>
      ` : `<p class="muted">Design presets stay off advertisements and Smart Cards because those blocks own their complete printed treatment.</p>`}
      <p class="muted ext-note">A design changes appearance only. It never changes the block's position or size, copy, pictures, font sizes, margins or columns.${initialDesign?.insetRisk ? " A boxed design insets copy; check the Layout meter after applying it." : ""}</p>
    </div>

    <div class="field-grid">
      ${purposeMarkup(section, view)}
      <!-- DERIVED, like every other surface that says this. view.status is
           the stored column and it is NULL until a desk explicitly sets one,
           so reading it raw reported "empty" on every block nobody had
           statused by hand - including a block with a headline, a story and a
           photograph in it, sitting directly under this readout. The canvas
           badge, the Block Editor's own chip and the worklist all went through
           statusOf(); this was the one place that answered the question a
           second way, and so the one place that could disagree. -->
      <div class="form-group"><label>Status</label><p class="prop-readout">${escapeHtml(statusLabel(statusOf(view, Boolean((section.images || []).length))))}</p></div>
      <div class="form-group"><label>Size</label><p class="prop-readout">${section.width_px} × ${section.height_px} px</p></div>
      ${page?.template_key ? `<div class="form-group"><label>Layout</label><p class="prop-readout">${escapeHtml(page.template_key)}</p></div>` : ""}
    </div>
    ${rateMarkup(section, page)}
    <p class="muted ext-note">A block's position and size come from the page's layout template, not from this panel - see the small page map below for where it sits.</p>

    <div class="prop-section">
      <h5 class="prop-heading">Border</h5>
      <div class="form-group">
        <!-- A GRID, NOT A SEGMENTED CONTROL. Ten styles is a list, and set out
             as one row of ten in a 340px rail the labels overlapped into an
             unreadable band - measured the moment Rule left, Rule right and
             Rules left and right were added to the catalogue. Two columns,
             each button wrapping its own label, and every selector the nets
             press is unchanged. -->
        <div class="segmented segmented-grid" data-prop-border>
          ${BORDER_STYLES.map(
            (style) => `<button type="button" class="segment${border === style.key ? " active" : ""}" data-border="${style.key}">${style.label}</button>`,
          ).join("")}
        </div>
      </div>
      ${!isRuled(border) ? `<p class="muted ext-note">Pick a style above - Box, or any Rule - to set its width and colour. Corner then appears too, for a Box.</p>` : ""}
      ${isRuled(border) ? `
      <div class="form-group">
        <label>Rule</label>
        <div class="segmented" data-prop-border-width>
          ${BORDER_WIDTHS.map(
            (width) => `<button type="button" class="segment${Math.abs(ruleWidth - width.px) < 0.01 ? " active" : ""}" data-border-width="${width.px}">${width.label}</button>`,
          ).join("")}
        </div>
      </div>` : ""}
      ${isRuled(border) ? `
      <div class="form-group">
        <!-- BORDER COLOUR - the one Properties control this catalogue never
             had. border_ink has been a validated, stored, rendered, exported
             column since the theming pass (page-styles.js writes it, canvas.js
             reads it into --block-ink, print-model.js and Scribus both read it
             for the plate) - but nothing under public/ ever sent it, so a desk
             could see a themed rule's colour and had no way to set or clear
             one by hand. The same shape as list_style and drop_cap before it:
             a mechanism with no surface.

             FULL-STRENGTH INKS, not TINTS - a rule is a line, not a wash, and
             it is drawn at the paper's own ink strength wherever it comes
             from. The SAME catalogue and the SAME "Black clears" rule the
             marks toolbar's own ink picker already uses (block-frame.js):
             Black carries no hex (inks.js - "the absence of an ink"), so
             choosing it sends an empty string and the stored value is NULL,
             which is exactly what --block-ink's own CSS fallback (#111) also
             paints. Two separate "clear" affordances here (a Black swatch
             AND a second Auto/none button) would be the same state offered
             twice, which is worse than once. -->
        <label>Rule colour</label>
        <div class="tint-swatches" data-prop-border-ink>
          ${INKS.map(
            (ink) => `<button type="button" class="tint-swatch${(ruleInk || null) === ink.hex ? " active" : ""}"
              data-border-ink="${ink.hex || ""}" title="${escapeHtml(ink.label)}"
              style="--tint:${ink.hex || "#111111"}">${ink.hex ? "<i></i>" : "<i class=\"tint-swatch-none\"></i>"}</button>`,
          ).join("")}
        </div>
      </div>` : ""}
      ${canRound(border) ? `
      <div class="form-group">
        <!-- ONLY OFFERED WHERE THE BLOCK IS BOXED. A corner needs a rule on
             both of its edges to round - a single rule below has nothing to
             meet - and canRound() is the one place that says so, the same
             answer canvas.js checks before it ever writes the CSS property. -->
        <label>Corner</label>
        <div class="segmented" data-prop-border-radius>
          ${BORDER_RADII.map(
            (radius) => `<button type="button" class="segment${Math.abs(ruleRadius - radius.px) < 0.01 ? " active" : ""}" data-border-radius="${radius.px}">${radius.label}</button>`,
          ).join("")}
        </div>
      </div>` : ""}
      <p class="muted ext-note">Nothing is ruled unless you rule it. A rule is specified in points, the way a printer specifies one. Open frames attach a note to neighbouring coverage; corner rules mark direction without making a card. A full box sets the copy in from its own line, and the page draws no duplicate gutter hairline beside it.${canRound(border) ? " A rounded or pill corner is a printed feature page's own device - a front or city page keeps its corners square, so a page's theme sets this on purpose and you can still set it by hand." : " Only a full box can take a rounded corner."}</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Shape</h5>
      <div class="form-group">
        <!-- A CORNER CUT, never a new outline. block-shapes.js's own header
             says why: a shape a story's copy could not run round would need
             the compositor's own scanline algorithm to change, and a corner
             cut needs only one more OBSTACLE - the same vocabulary a picture
             and a पॅनल already are. So this offers what that budget can prove
             correct, not "any polygon". -->
        <div class="segmented segmented-grid" data-prop-shape>
          ${BLOCK_SHAPES.map(
            (shape) => `<button type="button" class="segment${(shapeKey || "rectangle") === shape.key ? " active" : ""}" data-shape="${shape.key}">${escapeHtml(shape.label)}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">A notch, diagonal or bevel is an obstacle to the compositor, exactly like a photograph - the story is composed clear of it, never printed through it. Two cuts on one edge are set shallower than one, so they can never meet.</p>
    </div>

    <div class="prop-section">
      <h5 class="prop-heading">Panel inside the block</h5>
      <p class="muted ext-note">The चौकट a printed paper sets a fact box or a pull quote in. The story runs round it exactly as it runs round a photograph &mdash; it is a rectangle to the compositor and nothing more.</p>
      <div id="propPanels">${panelsMarkup(section, view)}</div>
      <div class="segmented segmented-grid" data-prop-panel-add>
        ${INSET_PANEL_KINDS.filter((kind) => kind.key !== "chart" && kind.key !== "table")
          .map((kind) => `<button type="button" class="segment" data-panel-add="${kind.key}" title="${escapeHtml(kind.note)}">+ ${escapeHtml(kind.label)}</button>`).join("")}
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
        <div class="segmented segmented-grid" data-prop-headline-style>
          ${HEADLINE_STYLES.map(
            ([key, label]) => `<button type="button" class="segment${headlineStyle === key ? " active" : ""}" data-headline-style="${key}">${label}</button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">Every treatment is paint around already-composed type: reversed and screened bands, full, short, centred, heavy or double rules in real gaps, section tabs and rails, or stepped bands behind individual headline lines. None changes where a line breaks.</p>
      <!-- HEADLINE COLOUR - the same mechanism-with-no-surface gap Rule
           colour was. headline_ink has been read since render.js's own
           headlineLineHtml existed (the headline AND the kicker's own text
           colour, when the treatment is not reversed) but nothing sent it.
           Same "Black clears" rule as Rule colour: Black carries no hex, so
           choosing it stores NULL, which is what render.js's own fallback
           already paints. -->
      <div class="form-group">
        <label>Headline colour</label>
        <div class="tint-swatches" data-prop-headline-ink>
          ${INKS.map(
            (ink) => `<button type="button" class="tint-swatch${(headInk || null) === ink.hex ? " active" : ""}"
              data-headline-ink="${ink.hex || ""}" title="${escapeHtml(ink.label)}"
              style="--tint:${ink.hex || "#111111"}">${ink.hex ? "<i></i>" : "<i class=\"tint-swatch-none\"></i>"}</button>`,
          ).join("")}
        </div>
      </div>
      <!-- ACCENT COLOUR - a DIFFERENT object from Headline colour, and the
           two must not be merged into one control: this is the fill behind
           a reversed or screened band, and the accent WORD's own colour
           under the 'accent' treatment - never the headline's own running
           text. accent_color is NOT NULL with a real default (#c8102e), so
           there is no "unset" state to clear back to - every swatch here is
           a real ink, Black included as an actual choice rather than a
           clearing gesture. -->
      <div class="form-group">
        <label>Accent colour</label>
        <div class="tint-swatches" data-prop-accent-color>
          ${INKS.filter((ink) => ink.hex).map(
            (ink) => `<button type="button" class="tint-swatch${accent === ink.hex ? " active" : ""}"
              data-accent-color="${ink.hex}" title="${escapeHtml(ink.label)}"
              style="--tint:${ink.hex}"><i></i></button>`,
          ).join("")}
        </div>
      </div>
      <p class="muted ext-note">Accent colour is the fill behind a reversed or screened headline, and the colour of the accent word under the Accent treatment - not the running headline text.</p>
    </div>
  `;
}

function blockDesignChoiceMarkup(entry, matching = null) {
  if (!entry) return "";
  const current = matching?.key === entry.key;
  const panelNames = (entry.companionPanels || [])
    .map((key) => INSET_PANEL_KINDS.find((kind) => kind.key === key)?.label)
    .filter(Boolean);
  return `${blockDesignPreviewMarkup(entry)}
    <div class="block-design-copy">
      <strong>${escapeHtml(entry.marathi)} <span>${escapeHtml(entry.label)}</span></strong>
      <p>${escapeHtml(entry.description)}</p>
      ${panelNames.length ? `<p class="block-design-companion"><b>Works with:</b> ${escapeHtml(panelNames.join(" · "))}</p>` : ""}
      <small>${current ? "Current design" : entry.insetRisk ? "Uses an inset box · check Layout after applying" : "Open treatment · no box inset"}</small>
    </div>`;
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
  return panels.map((panel) => {
    const meta = INSET_PANEL_KINDS.find((kind) => kind.key === panel.kind) || {};
    const cardPanel = panel.kind === "chart" || panel.kind === "table";
    return `
    <div class="prop-panel" data-panel-id="${escapeHtml(panel.id)}">
      <div class="prop-panel-head">
        <strong>${escapeHtml(meta.label || panel.kind)}</strong>
        <button type="button" class="btn-ghost" data-panel-remove="${escapeHtml(panel.id)}">Remove</button>
      </div>
      ${cardPanel
        ? `<p class="muted ext-note">Structured ${escapeHtml(meta.label || panel.kind)} data is edited with its editor button; its size and position are below.</p>
           <input type="hidden" data-panel-field="title" value="">
           <input type="hidden" data-panel-field="lines" value="">`
        : `<label>${escapeHtml(meta.titleLabel || "Heading")}<input type="text" data-panel-field="title" value="${escapeHtml(panel.title)}"></label>
           <label>${escapeHtml(meta.linesLabel || "Lines, one per printed row")}<textarea rows="4" data-panel-field="lines">${escapeHtml(panel.lines.join("\n"))}</textarea></label>`}
      <div class="prop-panel-geometry">
        ${["x", "y", "width", "height"].map((field) => `<label>${field}<input type="number" data-panel-field="${field}" value="${Math.round(panel[field])}"></label>`).join("")}
      </div>
      <label>Lines
        <select data-panel-field="marker">
          ${INSET_PANEL_MARKERS.map((m) => `<option value="${m.key}"${(panel.marker || "none") === m.key ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
        </select>
      </label>
      <label>Ground
        <select data-panel-field="tint">
          ${TINTS.map((tint) => `<option value="${tint.hex || ""}"${(panel.tint || "") === (tint.hex || "") ? " selected" : ""}>${escapeHtml(tint.label)}</option>`).join("")}
        </select>
      </label>
    </div>`;
  }).join("");
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
      marker: field("marker") || "none",
      lines: String(field("lines")).split("\n"),
      // A CHART PANEL'S DATA IS NOT ON THE FORM, so it has to be carried
      // across. This function rebuilds every panel from its inputs and sends
      // the whole list; a chart panel has no title or lines to rebuild from,
      // so without this line panelOf() would reject it as empty and the chart
      // would vanish the moment a desk touched any OTHER panel on the block.
      card: was?.card || null,
    };
  });
}

function bindPanelControls(handlers, section, view) {
  const send = (panels) => handlers.onPatch?.({ insetPanels: panels }, "properties-panel");

  document.querySelectorAll("[data-prop-panel-add] [data-panel-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.panelAdd;
      send([...panelsFromDom(section, view), defaultPanelFor(kind, {
        width: Number(section.width_px) || 200,
        height: Number(section.height_px) || 200,
      }, Number(view?.bodyFontPx) || 6.4)]);
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
  document.querySelectorAll("[data-prop-border-radius] [data-border-radius]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ borderRadiusPx: Number(button.dataset.borderRadius) }, "properties-panel");
    });
  });
  document.querySelectorAll("[data-prop-border-ink] [data-border-ink]").forEach((button) => {
    button.addEventListener("click", () => {
      // "" is Black, and Black is the absence of an ink (inks.js) - the same
      // "Black clears" rule the marks toolbar's own ink picker already uses.
      handlers.onPatch?.({ borderInk: button.dataset.borderInk || null }, "properties-panel");
    });
  });
  document.querySelectorAll("[data-prop-headline-ink] [data-headline-ink]").forEach((button) => {
    button.addEventListener("click", () => {
      handlers.onPatch?.({ headlineInk: button.dataset.headlineInk || null }, "properties-panel");
    });
  });
  document.querySelectorAll("[data-prop-accent-color] [data-accent-color]").forEach((button) => {
    button.addEventListener("click", () => {
      // NEVER null. accent_color is NOT NULL with a real default at the
      // server - COALESCE(..., accent_color) there means a null/absent value
      // is silently ignored, not cleared, so every swatch here sends a real
      // hex (the filter above already dropped Black, which has none).
      handlers.onPatch?.({ accentColor: button.dataset.accentColor }, "properties-panel");
    });
  });
  document.querySelectorAll("[data-prop-shape] [data-shape]").forEach((button) => {
    button.addEventListener("click", () => {
      // "rectangle" is the plain state and is stored as NULL - the same
      // pattern White/Black/None already use throughout this catalogue.
      const key = button.dataset.shape;
      handlers.onPatch?.({ frameShape: key === "rectangle" ? "" : key }, "properties-panel");
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

function bindDesignPreset(handlers, section, view) {
  const select = document.querySelector("[data-prop-design]");
  const apply = document.querySelector("[data-prop-design-apply]");
  const host = document.getElementById("propBlockDesignChoice");
  const guard = document.getElementById("propBlockDesignGuard");
  if (!select || !apply || !host) return;
  const matching = matchingBlockDesign(view);
  const designs = availableBlockDesigns(section, view);
  const refresh = () => {
    const entry = designs.find((item) => item.key === select.value) || null;
    host.innerHTML = blockDesignChoiceMarkup(entry, matching);
    if (guard) guard.textContent = "";
    apply.disabled = !entry || matching?.key === entry.key;
    apply.title = entry?.insetRisk
      ? "Apply this design, then check the Layout meter because a box insets the copy"
      : "Apply this appearance to the selected block";
  };
  select.addEventListener("change", refresh);
  apply.addEventListener("click", () => {
    const patch = blockDesignPatch(select.value);
    if (!patch) return;
    // A box and a rounded corner consume real measure. Test the exact current
    // words in the exact current frame at CLICK time, not while drawing 24
    // thumbnails. A design may repair an already-overset custom treatment,
    // but it may never turn a block that fits into one that loses copy.
    try {
      const before = composeSection(section, view);
      const after = composeSection(section, { ...view, ...patch });
      const failed = (result) => result.fitState === "OVERSET" || result.fitState === "NO_ROOM";
      if (!failed(before) && failed(after)) {
        if (guard) guard.textContent = "Not applied: this treatment would push copy out of the block. Choose an open design or shorten the story first.";
        return;
      }
    } catch {
      // The exact shaper can still be loading during the first instant of the
      // editor. The ordinary Layout panel will recompose on the resulting
      // draft; do not make a temporary asset-loading state disable the desk.
    }
    handlers.onPatch?.(patch, "block-design-preset");
  });
  refresh();
}

function bindImageControls() {
  if (!boundHandlers) return;
  bindGeometryFields(boundHandlers);
  bindRotationField(boundHandlers);
  bindStandOffField(boundHandlers);
  bindShapeButtons(boundHandlers);
  bindLayerButtons(boundHandlers);
}

/**
 * What this block is for - the kind, the feature, and filling it now.
 *
 * Bound at the DOCUMENT, not to the selects: this panel is rewritten on every
 * repaint, so an element-bound listener is on a detached node from the next
 * one. That is the #edSpaceGroup trap this codebase has already been bitten by
 * twice, and it is found the same way both times - by pressing the control and
 * watching nothing happen.
 */
let purposeBound = false;
function bindPurposeControls(handlers) {
  loadFeatureCatalogue().then((list) => {
    // The picker is drawn before the catalogue can have arrived on the very
    // first paint, so one repaint once it is here - and only then, or every
    // block selection would redraw the panel a second time for nothing.
    if (list.length && !document.querySelector("[data-purpose-feature] option[value]:not([value=''])")) {
      handlers?.onRefresh?.();
    }
  });
  if (purposeBound) return;
  purposeBound = true;

  document.addEventListener("change", (event) => {
    const kind = event.target.closest?.("[data-purpose-kind]");
    if (kind) { handlers?.onPurpose?.({ blockType: kind.value }); return; }
    const feature = event.target.closest?.("[data-purpose-feature]");
    if (feature) handlers?.onPurpose?.({ featureKey: feature.value || null });
  });

  document.addEventListener("click", (event) => {
    const fill = event.target.closest?.("[data-purpose-fill]");
    if (!fill || fill.disabled) return;
    const chosen = document.querySelector("[data-purpose-feature]")?.value || "";
    if (!chosen) return;
    handlers?.onPurpose?.({ featureKey: chosen, fill: true });
  });
}

function bindBlockControls() {
  bindRateDisclosure();
  bindPurposeControls(boundHandlers);
  if (!boundHandlers) return;
  bindDesignPreset(boundHandlers, boundSection, boundView);
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
