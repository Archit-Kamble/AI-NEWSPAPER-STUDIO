// The block, as a page of frames.
//
// This replaces two days of trying to make a browser flow copy around a
// photograph placed in the middle of a column. It cannot: CSS wraps text around
// a FLOAT, and a float can only touch the left or right edge of its column. No
// editor library changes that - Quill, TipTap and CKEditor all draw through the
// same engine. So the picture could never go where the desk put it - this is
// not a bug to patch, it is why Word and Google Docs need their own text-layout
// engine to do real image runaround at all, and building one is a project of
// its own, not a fix (see PROJECT_STATUS.md, Bug #1/#3).
//
// The model here is the one every page-layout tool uses - InDesign, Canva,
// Scribus, which is where this paper is going anyway. The block is a page at
// its true proportions. On it sit frames: a headline frame, a deck frame, a
// body frame, and one frame per picture. Every frame is dragged and sized on
// the page, and what is stored is its position in BLOCK PIXELS - the same
// numbers the character grid reads, the same numbers that print.
//
// The copy inside the body frame is edited with Quill (vendored under
// public/vendor/quill, BSD-3-Clause), so the writing surface is a real word
// processor rather than a hand-rolled contenteditable. Quill cannot show the
// real runaround live, so it does not try to fake it - it stays outside the
// printable page as editing chrome.
//
// What the desk LOOKS at is the exact composition (compose/), rendered by the
// same function the newspaper canvas renders with, at the block's own logical
// pixels, with a CSS scale() over the whole layer. The frames below it are
// transparent hit targets positioned from that same composition. So the
// editor is the page, enlarged - not a second rendering of it, and nothing
// about being enlarged can move a line.

import { sanitise, sanitiseSize, plainText } from "../layout/rich-text.js";
import { INKS, sanitiseInk } from "../layout/inks.js";
import { escapeHtml } from "../format.js";
import {
  markDisplayField, clearDisplayField, activeDisplayField, applyDisplayMark, holdSelection,
  rememberSelection, restoreSelection,
  fieldHtml, fieldValue, DISPLAY_TARGET_EVENT,
} from "./display-marks.js";

import { placedPictureStyle } from "../layout/picture-style.js";
import { resizeRect, RESIZE_HANDLES } from "../layout/image-resize.js";
import { snapPictureToLegalCorridor, leavesNoLegalColumn } from "../layout/corridor-snap.js";
import { MIN_CORRIDOR_EM } from "../compose/intervals.js";
import { blockExpectsCopy } from "../layout/block-kinds.js";
// The Devanagari-safe floor. The inline body editor sets the story at its
// real leading, and 1.45 is already at the edge of clipping a matra stack -
// see CLAUDE.md's note on why line_height must never be tidied downward.
import { DEFAULT_BODY_FONT_PX, datelineText, captionBox } from "../layout/text-flow.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
// The same functions the page canvas draws a headline, a deck and a flowed
// body with - so the WYSIWYG frame and the newspaper page can never drift
// onto two different renderings of the same block, the way the
// headline/subheading inputs and the canvas once did. smartCardFrame() is
// the SAME logical width/height/padding solve the page canvas passes a
// Smart Card - reused rather than re-derived, so "does this card fit" can
// never disagree between the two.
import { sectionContentMarkup, sectionComposition, smartCardFrame, insetPanelsMarkup } from "../canvas/section-thumb.js";
// The same six words the Typography panel's "Editing: X" label uses - one
// catalog for what a selected object is called, not two that could drift.
import { PART_LABEL, ALIGN_FIELD, ALIGNMENTS } from "./typography-panel.js";
// The engine's own default for a display flow whose alignment nobody has set,
// so the editing frame breaks its line exactly where the composition did.
import { DEFAULT_DISPLAY_ALIGN } from "../compose/compose.js";
// The same serif/sans classification the exact engine measures a body with
// (compose/font-metrics.js) - Quill is comfort-typing chrome, not the
// canonical preview (see above), so it does not have to pixel-match, but it
// should not paint a DIFFERENT face family than the one the story was
// actually measured in either.
import { publicationFamily } from "../compose/font-metrics.js";
import { snapToCluster } from "../compose/graphemes.js";
import { paintBodySelection, offsetAtPoint } from "./body-caret.js";
import "../layout/publication-type.js";

let quill = null;
let hooks = {};
// selectedIds is which PICTURE(s) are selected (unrelated to selectedPart=
// "image" - that says WHICH KIND of object is targeted; selectedIds says
// which ones when there's more than one on the block). Comes from the one
// store (store.js's selectedPart/selectedImageIds) via workspace.js -
// block-frame.js itself never decides selection, only draws it.
//
// A single "primary" id used to be tracked here too, separately from this
// Set, for exactly the single-selection case - and it rotted the first time
// Shift+click could leave the two disagreeing: a picture dropped from the
// Set by Shift+click stayed selected on screen because the OTHER field still
// named it. One field, no drift.
let state = {
  section: null, view: null, images: [], selectedIds: new Set(), selectedPart: "block",
  // The placed lines that painted the canvas. Direct body interaction maps
  // through these exact positions instead of asking browser flow to re-wrap.
  composition: null,
};

// ---------------------------------------------------------------- loading ---

let quillLoading = null;
let sizeAttributorRegistered = false;
function loadQuill() {
  if (window.Quill) return Promise.resolve(window.Quill);
  if (quillLoading) return quillLoading;

  quillLoading = new Promise((resolve, reject) => {
    if (!document.getElementById("quillStyles")) {
      const link = document.createElement("link");
      link.id = "quillStyles";
      link.rel = "stylesheet";
      link.href = "/vendor/quill/quill.snow.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "/vendor/quill/quill.js";
    script.onload = () => resolve(window.Quill);
    script.onerror = () => reject(new Error("Quill could not be loaded"));
    document.head.appendChild(script);
  });
  return quillLoading;
}

import { deviceBarMarkup, refreshDeviceBar } from "./device-bar.js";
import { chartDialogHostMarkup } from "./chart-dialog.js";

// ----------------------------------------------------------------- markup ---

export function blockFrameMarkup() {
  return `
    <div class="block-frame" id="edBlockFrame">
      <!-- The marks toolbar is chrome, so it sits ABOVE the page rather than
           inside it. Rendered inside the body frame it was part of the block,
           which meant a picture dragged over the top of the copy covered the
           bold button. The page holds only what prints. -->
      ${deviceBarMarkup()}
      ${chartDialogHostMarkup()}
      <div class="frame-toolbar" id="edQuillToolbar">
        <span class="ql-formats">
          <button class="ql-bold" type="button"></button>
          <button class="ql-italic" type="button"></button>
          <button class="ql-underline" type="button"></button>
        </span>
        <span class="ql-formats ed-quill-size-group" id="edQuillSize">
          <!-- The one deliberate exception to "colour, size and font are the
               block's, not the selection's" (see mountFrame() below): a
               sub-editor emphasising one word or phrase at a different size
               within the story. Serialises to rich-text.js's controlled
               data-sahas-size mark, not an arbitrary style - see
               copyFromFrame().

               OFFERED IN POINTS, AGAINST THIS BLOCK'S OWN BODY. The mark is
               stored as an absolute number of BLOCK pixels (rich-text.js's
               sanitiseSize), and a block's running body is 6.4 of them - 9pt
               at 2px/mm. So the fixed 12/14/18/22/28 this toolbar used to
               offer were browser-CSS numbers in a block-pixel field: the
               SMALLEST of them was 1.9x the copy and the largest 4.4x.
               Photographed on a real block, a 22px run inside 7px type opens
               its own row to three and a half times the leading and leaves a
               hole above and below - which is not emphasis, it is the same
               fault the drop cap exists to prevent, in the middle of a
               paragraph. The sizes are derived from the block instead, and
               labelled in points, which is the unit a printer sets in.

               Plain buttons, not a <select> wrapped in Quill's own Picker:
               a select with class="ql-size" IS what Quill auto-converts into
               a custom .ql-picker widget, and in this bundled Quill 2.0.3 a
               picker built for a custom-registered Attributor (rather than
               Quill's own built-in small/large/huge enum) never actually
               dispatches back to the toolbar - confirmed by instrumenting
               both the picker's underlying select (no "change" event reaches
               it on a real item click) and toolbar.addHandler() (never
               invoked). Bold/italic/underline are plain <button class="ql-*">
               and work correctly, so size uses the same shape instead of
               fighting the Picker abstraction. -->
          <!-- Filled in by refreshSizeButtons(), from the BLOCK's own body
               size - see its note. Static px numbers here were the fault:
               they are absolute BLOCK pixels, and a block's body is 6.4 of
               them, so the smallest "emphasis" on offer was already twice the
               copy. -->
        </span>
        <!-- The paper's inks. The second exception to "colour is the
             layout's, not the selection's", and bounded the same way the
             size buttons are: four named inks out of rich-text.js's INKS,
             never a colour wheel. A page is separated into plates, and a
             colour a desk mixed in a browser is an ink no press can lay
             down. Black is the absence of a mark, so it CLEARS. -->
        <span class="ql-formats ed-quill-ink-group" id="edQuillInk">
          ${INKS.map((ink) => `<button type="button" class="ed-quill-ink-btn${ink.hex ? "" : " is-none"}"
              data-ink="${ink.hex || ""}" title="${ink.label}"
              style="${ink.hex ? `--ink:${ink.hex}` : ""}"><i></i></button>`).join("")}
        </span>
        <span class="ql-formats">
          <button class="ql-list" value="ordered" type="button"></button>
          <button class="ql-list" value="bullet" type="button"></button>
        </span>
        <span class="ql-formats">
          <button class="ql-clean" type="button"></button>
        </span>
      </div>
      <div class="frame-page" id="edFramePage">
        <!-- The exact same printable text/card markup as the newspaper canvas.
             It keeps the block's LOGICAL pixel dimensions and the whole layer
             is zoomed as one object; text therefore never reflows merely
             because the editor has more room. -->
        <div class="frame-canonical-content" id="edCanonicalContent"></div>

        <!-- What the block is WAITING for. An empty article block composes to
             nothing, so this page was a blank white rectangle with no caret,
             no prompt and - because a band with no lines has no box - no
             headline or deck frame to click at all. The canvas at least said
             LEAD / EMPTY; here there was nothing, which is the "the editor is
             not editable" report. These labels are drawn where the words will
             actually be set, at the size they will be set in, and they are
             Block-Editor chrome: never composed, never on the canvas, never
             saved. -->
        <div class="frame-placeholders" id="edFramePlaceholders" aria-hidden="true"></div>

        <!-- The caret and the selection of the one body document, drawn on the
             composed page. Chrome, like the placeholders: never composed,
             never saved, never on the canvas. Without it a desk typed at a
             caret that was not drawn and marked words it could not see - see
             body-caret.js's own note. -->
        <div class="frame-body-selection" id="edBodySelection" aria-hidden="true"></div>

        <!-- Interactive picture frames sit over the canonical text layer. They
             use the same persisted block-pixel geometry as the page canvas. -->
        <div class="frame-pictures" id="edFramePictures"></div>

        <!-- Transparent hit/selection frames. They do not render a second copy
             of the words; the canonical layer above is the only visual copy. -->
        <div class="frame frame-headline" id="edHeadlineFrame" tabindex="-1" title="Double-click to edit the headline"></div>
        <div class="frame frame-subheading" id="edSubheadingFrame" tabindex="-1" title="Double-click to edit the subheading"></div>
        <div class="frame frame-body" id="edBodyFrame" tabindex="-1"
             title="Double-click to edit body copy"></div>
      </div>

      <!-- OUTSIDE the page, deliberately. Drawn inside it the chip sat at the
           selected frame's own top-left corner - which on the body frame is
           exactly where the story's first words are, so selecting the body
           covered the opening of the story it was naming. The page is
           overflow-hidden (overset copy may not spill onto the next block),
           so a label placed above a frame at the top of the page would simply
           be clipped away. It lives here, beside the page, and is positioned
           against the page's own box. -->
      <span class="frame-selection-label" id="edSelectionLabel" hidden></span>

      <!-- Quill is an EDITING CONTROL, not a second newspaper renderer. Keeping
           it outside the printable page means the enlarged page can remain
           pixel-for-pixel canonical while the desk still gets a comfortable
           rich-text writing surface. -->
      <div class="frame-writing-surface" id="edWritingSurface">
        <div class="frame-writing-label" id="edWritingLabel">Body copy</div>
        <div id="edQuill"></div>
      </div>

      <p class="frame-note muted" id="edFrameNote"></p>
    </div>
  `;
}

// ------------------------------------------------------------------ scale ---
//
// One number: how many block pixels one screen pixel of the page is worth.
// Everything on the page - a drag, a resize, the type size - goes through it,
// so the page cannot drift from what prints.

function pageScale() {
  const page = document.getElementById("edFramePage");
  const width = page?.getBoundingClientRect().width || 1;
  return (Number(state.section?.width_px) || width) / width;
}

/** Sizes the page to the block's proportions, fitted to the room it has. */
function layoutPage() {
  const page = document.getElementById("edFramePage");
  const host = document.getElementById("edBlockFrame");
  if (!page || !host || !state.section) return;

  const blockWidth = Number(state.section.width_px);
  const blockHeight = Number(state.section.height_px);
  const room = {
    width: (host.getBoundingClientRect().width || 900) - 8,
    height: Math.max(320, Math.min(880, window.innerHeight - 280)),
  };
  const factor = Math.min(room.width / blockWidth, room.height / blockHeight);

  page.style.width = `${Math.round(blockWidth * factor)}px`;
  page.style.height = `${Math.round(blockHeight * factor)}px`;

  const note = document.getElementById("edFrameNote");
  if (note) {
    note.textContent = `${blockWidth} × ${blockHeight} px · ${Math.round(blockWidth / 2)} × ${Math.round(blockHeight / 2)} mm`
      + ` · shown at ${Math.round(factor * 100)}%`;
  }
}

// ------------------------------------------------------------- text frames ---
//
// The headline and the deck take whole rows off the top of the block - the
// character grid decides how many - so the body frame starts where the copy
// really starts, and is set in the block's own type at the page's scale.

/**
 * Draws the Smart Card in the body frame, or puts the writing surface back.
 *
 * One renderer, shared with the page canvas, so the two cannot disagree about
 * the same card.
 */
function layoutCard() {
  const writing = document.getElementById("edWritingSurface");
  const frame = state.section && state.view ? smartCardFrame(state.section, state.view) : undefined;
  const hasCard = Boolean(smartCardMarkup(state.view?.smartCardKey, state.view?.smartCardData, frame));
  if (writing) writing.hidden = hasCard;
  return hasCard;
}

// ---------------------------------------------------------- selection UI ---
//
// One reusable mechanism for "show that this object is the one targeted" -
// a plain accent outline (no fake resize handles on flow-based text; see the
// CSS's own note) plus a small label chip, moved to whichever object is
// selected rather than duplicated per object. Both the outline classes and
// the label are driven from the ONE selectedPart the store holds - nothing
// here decides selection, only draws it, exactly as the rest of this file's
// frames already do for the block's content.
const LABEL_HOST_ID = {
  block: "edFramePage",
  headline: "edHeadlineFrame",
  subheading: "edSubheadingFrame",
  body: "edBodyFrame",
  smartCard: "edCanonicalContent",
};

function updateSelectionLabel() {
  const label = document.getElementById("edSelectionLabel");
  const page = document.getElementById("edFramePage");
  if (!label || !page) return;
  const hostId = LABEL_HOST_ID[state.selectedPart];
  const host = hostId && document.getElementById(hostId);
  // A card that isn't there (hidden), or a selection kind this label doesn't
  // cover (a picture - its handles already say "selected" on their own) -
  // hide rather than show a chip pointing at nothing.
  if (!host || host.hidden) {
    label.hidden = true;
    return;
  }
  // Positioned by coordinate, not appendChild()'d INTO the target frame:
  // headlineFrame/subheadingFrame/frameCard all replace their own innerHTML
  // on every layout pass (their text or their card changed), which would
  // silently destroy a label element living inside them. The page itself
  // never has its innerHTML replaced wholesale, only specific children
  // updated - so the label stays put there and is just repositioned.
  const frame = document.getElementById("edBlockFrame");
  const originRect = (frame || page).getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  // The chip is also where the direct-body-edit state is named. It used to be
  // a second chip drawn inside the body frame, at its top right - on top of a
  // justified column, whose lines reach exactly that edge.
  const naming = PART_LABEL[state.selectedPart] || state.selectedPart;
  label.textContent = state.selectedPart === "body" && canonicalBodyEdit
    ? `${naming} — typing · drag to select`
    : naming;
  label.hidden = false;

  // ABOVE the frame it names, never over the words inside it. Measured after
  // the text is set, because the chip's height is its own line box.
  const height = label.offsetHeight || 16;
  label.style.left = `${hostRect.left - originRect.left}px`;
  label.style.top = `${Math.max(0, hostRect.top - originRect.top - height - 2)}px`;
}

/** The block itself, selected: an outline around the whole page. */
function applyBlockSelection() {
  document.getElementById("edFramePage")?.classList.toggle("frame-selected", state.selectedPart === "block");
}

// Headline, deck and body positioned from ONE buildFlowMap() call - the same
// map the page canvas measures a picture's runaround with and the AI brief is
// built from, so "how tall is the headline" has one answer everywhere it is
// asked. The body frame used to compute this map on its own; the headline and
// subheading frames now share that same computation rather than repeating it.
//
// Built with the block's REAL placed pictures (it used to pass `[]` here,
// unconditionally - see this file's own header note and PROJECT_STATUS.md,
// Bug #1/#3 - which meant the headline and deck bands were positioned as if
// the block held no pictures at all, however many it actually had). The
// headline and deck are whole positioned bands (bandBox(), shared with the
// canvas), so they dodge a picture standing in their rows exactly as the
// canvas does. The body cannot - CSS floats only touch a column's edges -
// which is why the canonical composed layer, not Quill, is what the desk
// looks at (see this file's own header).
// ------------------------------------------------------- empty-block prompts ---
//
// An empty article block composes to nothing at all: no lines, so no bands, so
// `bandOf()` returns a zero-height box and placeFrame() hides the headline and
// deck frames outright. The desk was then shown a blank white rectangle with
// no caret and nothing to double-click - the headline and the deck could not
// be reached ON THE PAGE at any point, and a double click anywhere landed in
// the body because the body frame is the only one left. That is the "editor is
// not editable" report, and it is exactly the block a desk opens most: the one
// that has not been written yet.
//
// So a block whose flow is empty is composed a second time with the flow's own
// LABEL standing in for it. That gives the real band geometry - where the
// words will sit and at what size - which is used for two things: the hit
// frame gets a real box, and the label is drawn in it so the desk can see what
// the block is waiting for. Both are Block Editor chrome. The label never
// enters `state.view`, never reaches `sectionContentMarkup()` and so can never
// appear on the newspaper canvas or in anything that saves.
const PLACEHOLDER_LABEL = { headline: "Headline", subheading: "Subheading", body: "Write the story" };

/**
 * The flows this block wants and does not yet have.
 *
 * A headline and a story are not optional on a block meant to carry copy - an
 * article block is never published without a headline - so a missing one is a
 * real omission and is always named.
 *
 * A DECK IS OPTIONAL, so its prompt is offered only while the block is still
 * unwritten - and that is a rule about the PROMPT, not about the frame.
 *
 * The first version of this conflated the two and it cost a subheading. A flow
 * with no prompt has no band, a frame with no band is placed `display: none`,
 * and an object that is not on the page cannot be clicked or typed into at
 * all: type a headline on the page and then double click where the deck goes,
 * and committing the headline made the block "written", withdrew the deck's
 * prompt, hid its frame mid-gesture, and the double click fell THROUGH to the
 * body underneath. The deck the desk then typed was appended to the STORY and
 * stored that way - `subheading` NULL, its words the last sentence of the copy.
 *
 * Both halves are fixed, separately, because they are separate faults:
 *
 *  - a press can no longer land on the wrong object (bindTextFrames, which
 *    selects on pointer-down and never lets the page's own handler take a
 *    press meant for a flow);
 *  - and the deck is prompted whenever the desk is ADDRESSING it - editing it,
 *    or having selected it, including by clicking into the Subheading field
 *    below the page, which selects that object like any other route
 *    (story-editor.js). See layoutTextFrames().
 *
 * Which leaves the prompt itself free to be what it should be: a ghost on an
 * unwritten block, and never grey display type standing over a story that is
 * already set - which is exactly what an always-on deck prompt drew.
 */
function missingFlows(view, section) {
  if (!blockExpectsCopy(section?.block_type)) return [];
  if (view.smartCardKey && view.smartCardData) return [];
  const empty = (part) => !plainText(view[part] || "").trim();
  const unwritten = empty("headline") && empty("body");
  return ["headline", "subheading", "body"]
    .filter((part) => empty(part) && (part !== "subheading" || unwritten));
}

/**
 * The block composed with a label standing in for each missing flow.
 *
 * Composed with the block's real pictures and no body: the body's own frame is
 * placed from this composition's `bodyTop`, so an empty block's body starts
 * below where its headline is going to be rather than at the top of the block.
 */
function promptComposition(section, view, parts) {
  if (!parts.length) return null;
  // Only the DISPLAY flows stand in. Pouring a stand-in body would move
  // `bodyTop` and fill the frame with lines that are not the block's, and the
  // body's own prompt needs nothing but the top of the copy.
  const stand = { ...view, body: "" };
  for (const part of parts) if (part !== "body") stand[part] = PLACEHOLDER_LABEL[part];
  try {
    return sectionComposition(section, stand);
  } catch {
    return null;
  }
}

/** The labels, drawn at the exact lines the composition put them on. */
function renderPlaceholders(composition, parts, zoom, section, view) {
  const host = document.getElementById("edFramePlaceholders");
  if (!host) return;
  host.style.width = `${Number(section.width_px)}px`;
  host.style.height = `${Number(section.height_px)}px`;
  host.style.transform = `scale(${zoom})`;
  if (!composition || !parts.length) { host.innerHTML = ""; return; }

  const bandKey = { headline: "headline", subheading: "deck" };
  const span = (style, label) => `<span class="frame-placeholder" style="${style}">${escapeHtml(label)}</span>`;
  host.innerHTML = parts.flatMap((part) => {
    if (part === "body") {
      // The story has no band of its own until it exists, so its prompt is
      // set as one line of body type at the top of the copy - where the
      // first line will actually be.
      const px = Number(composition.typography?.bodyPx) || 0;
      const lh = Number(composition.typography?.lineHeight) || 1.45;
      if (!px || !composition.content) return [];
      return [span(`left:${composition.content.left.toFixed(2)}px;`
        + `top:${composition.bodyTop.toFixed(2)}px;`
        + `width:${composition.content.measure.toFixed(2)}px;`
        + `height:${(px * lh).toFixed(2)}px;font-size:${px}px;`
        + `line-height:${(px * lh).toFixed(2)}px;`
        + `font-family:${publicationFamily(view.fontFamily).css}`, PLACEHOLDER_LABEL[part])];
    }
    const band = composition.bands?.[bandKey[part]];
    return (band?.lines || []).map((line) => span(
      `left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
      + `width:${line.measure.toFixed(2)}px;height:${line.height.toFixed(2)}px;`
      + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;`
      + `font-family:${publicationFamily("sans").css};`
      + `font-weight:${part === "headline" ? 700 : 400}`, PLACEHOLDER_LABEL[part]));
  }).join("");
}

/**
 * The size a marked run is set in, offered as a DROPDOWN, in points.
 *
 * WHAT WAS HERE, AND WHY IT WAS NOT ENOUGH. Four fixed buttons - a step down
 * and three steps up from the block's own body. The unit was right and the
 * reasoning was right, but a sub-editor does not want four sizes: the desk's
 * report was "I select a text and try to change the font but I can change only
 * those option sizes above; it should have a drop down". A caption at 7pt, a
 * standfirst at 11, a pull quote at 18 - none of them are ratios of anything,
 * they are sizes, and a control that cannot express them is a control that
 * sends the desk back to retyping the copy somewhere else.
 *
 * So it is the publication's own ladder (publication-type.js), the same list
 * the object-size control beside it offers, in the same unit. The block's own
 * body is named on its rung, because emphasis is judged against the copy it
 * sits in - that was the true half of the ratios, and it is kept as a label
 * rather than as the whole of what is on offer.
 *
 * NOT rebuilt on every render. `layoutTextFrames()` runs on every keystroke,
 * and replacing a <select>'s options while it is open closes it under the
 * pointer; the options depend only on the block's body size, so they are
 * rebuilt when that changes and the VALUE is refreshed on its own.
 */
let sizeSelectFor = null;

function refreshSizeOptions() {
  const host = document.getElementById("edQuillSize");
  if (!host) return null;
  const bodyPx = Number(state.view?.bodyFontPx) || DEFAULT_BODY_FONT_PX;
  let select = host.querySelector("select");
  if (select && sizeSelectFor === bodyPx) return select;
  sizeSelectFor = bodyPx;
  const type = globalThis.SahasPublicationType;
  const rungs = type.typeLadder(bodyPx).map((rung) => {
    const body = rung.px === bodyPx ? " \u2014 body" : "";
    return `<option value="${rung.px}px">${rung.label}${body}</option>`;
  }).join("");
  host.innerHTML = `<span class="ed-quill-size-label">Selection</span>`
    + `<select class="ed-quill-size-select" id="edQuillSizeSelect"`
    + ` title="Size of the selected words, in points">`
    // "Default" rather than "Body size": this picker also aims at a headline
    // and a deck, and there the neutral choice means the object's own size,
    // not the body's.
    + `<option value="">Default</option>${rungs}</select>`;
  select = host.querySelector("select");
  return select;
}

/** Shows what the selected words are actually set in. */
function refreshSizeButtons() {
  refreshSizePicker(activeDisplayField());
}

function layoutTextFrames() {
  const page = document.getElementById("edFramePage");
  const canonical = document.getElementById("edCanonicalContent");
  const headlineFrame = document.getElementById("edHeadlineFrame");
  const subheadingFrame = document.getElementById("edSubheadingFrame");
  const bodyFrame = document.getElementById("edBodyFrame");
  if (!page || !canonical || !state.section || !state.view) return;

  const scale = pageScale();
  const zoom = 1 / scale;
  const margin = Number(state.view.marginPx) || 12;
  const renderSection = { ...state.section, images: state.images || [] };

  // The SAME composition the canonical layer below is drawn from, so a hit
  // frame can never sit somewhere the words are not. This used to build its
  // own flow map with its own defaults, which is precisely how the editor
  // came to disagree with the page about where a headline was.
  const composition = sectionComposition(renderSection, state.view);
  state.composition = composition;
  const measure = composition ? composition.content.measure : (Number(state.section.width_px) || 0) - margin * 2;

  // Where each flow actually ended up. An absent flow has no band at all -
  // nothing reserves a rectangle it is not using.
  const bandOf = (key, fallback) => {
    const band = composition?.bands?.[key];
    if (!band || !band.lines.length) return fallback;
    const left = Math.min(...band.lines.map((line) => line.x));
    const right = Math.max(...band.lines.map((line) => line.x + line.measure));
    return { left, width: right - left, top: band.top, height: band.height };
  };

  let headlineBox = bandOf('headline', { left: margin, width: measure, top: margin, height: 0 });
  let deckBox = bandOf('deck', { left: margin, width: measure, top: margin, height: 0 });
  let bodyTop = composition ? composition.bodyTop : margin;

  // The flows this block wants and has not got yet, composed with their own
  // labels standing in - see promptComposition()'s note. Their band geometry
  // becomes the hit frame's box, so an unwritten headline can be clicked
  // exactly where it is going to be set, and `bodyTop` follows it so the body
  // frame no longer swallows the whole empty block.
  const prompts = missingFlows(state.view, state.section);

  // AN OBJECT THE DESK IS ADDRESSING IS ALWAYS ON THE PAGE.
  //
  // A flow with no words composes to no band, and a frame with no band is
  // placed `display: none`. That is right for a flow nobody has asked for and
  // catastrophic for one they have: hiding a focused contenteditable BLURS it,
  // and every keystroke after that falls into the next editable on the page -
  // which is Quill, the body.
  //
  // Measured exactly that way. On an empty block the deck prompt exists only
  // while the block is unwritten, so: type a headline on the page, double
  // click the deck, type it - and committing the headline made the block
  // "written", the deck prompt went, the deck frame was hidden mid-edit, and
  // the subheading a desk had just typed was appended to the STORY. Stored
  // that way: `subheading` NULL, the deck's words the last sentence of the
  // copy, and nothing on screen to say so.
  //
  // So the flow being edited, and the flow selected, are prompted whether or
  // not they carry words: the prompt is what gives them real band geometry to
  // be present at. The label itself is still withheld from a flow being typed
  // into (see renderPlaceholders below) - this reserves the box, not the ink.
  const addressable = blockExpectsCopy(state.section?.block_type)
    ? [inlineTextEdit?.config?.part, state.selectedPart] : [];
  for (const part of addressable) {
    if (part !== "headline" && part !== "subheading") continue;
    if (prompts.includes(part)) continue;
    if (plainText(state.view[part] || "").trim()) continue;
    prompts.push(part);
  }

  const prompt = promptComposition(renderSection, state.view, prompts);
  if (prompt) {
    const promptBand = (key, fallback) => {
      const band = prompt.bands?.[key];
      if (!band || !band.lines.length) return fallback;
      const left = Math.min(...band.lines.map((line) => line.x));
      const right = Math.max(...band.lines.map((line) => line.x + line.measure));
      return { left, width: right - left, top: band.top, height: band.height };
    };
    if (prompts.includes('headline')) headlineBox = promptBand('headline', headlineBox);
    if (prompts.includes('subheading')) deckBox = promptBand('deck', deckBox);
    // ONLY while the body itself is unwritten. The prompt composition reserves
    // room for display type that is not set, so its `bodyTop` sits BELOW where
    // real copy actually starts - taking it on a block that has a story (but,
    // say, no headline yet) pushes the body's hit frame down past its own
    // first lines, and those lines stop being clickable.
    if (prompts.includes('body') && Number.isFinite(prompt.bodyTop)) bodyTop = prompt.bodyTop;
  }

  // Render once at the section's TRUE logical dimensions, then zoom the whole
  // composition. This is the key parity rule: editor size changes can never
  // change line breaks, column flow or the amount of copy that fits.
  canonical.style.width = `${Number(state.section.width_px)}px`;
  canonical.style.height = `${Number(state.section.height_px)}px`;
  canonical.style.transform = `scale(${zoom})`;
  // THE PANELS TOO, and this is the whole of the desk's report "editor not
  // showing as it things as layout news block for some things like seprator".
  //
  // The page canvas draws a block through sectionInnerHtml(), which calls
  // sectionContentMarkup() AND insetPanelsMarkup(). The Block Editor called
  // only the first. So a fact box, a pull quote, a cross-head or a separator
  // displaced the copy here exactly as it does on the page - the compositor
  // had it in its obstacle set either way - and then was not DRAWN, leaving a
  // rectangular hole in the type with nothing in it. The device appeared to do
  // nothing but damage, on the one surface a desk actually writes in.
  //
  // The same markup as the page's, from the same one panel layout, so the two
  // surfaces cannot disagree about where the panel is or what is in it.
  canonical.innerHTML = sectionContentMarkup(renderSection, state.view)
    + insetPanelsMarkup(renderSection, state.view);

  // The canonical lines for a flow that is being typed into stay hidden. They
  // were hidden once, when the edit opened - and any refresh at all (an
  // autosave landing, a picture moving, the window resizing) rebuilt this
  // layer and put them back, so the desk saw the old composed words sitting
  // under the live ones they were typing.
  if (inlineTextEdit?.config?.selector) {
    canonical.querySelectorAll(inlineTextEdit.config.selector)
      .forEach((el) => { el.style.visibility = "hidden"; });
  }

  // Drawn AFTER the canonical layer is rebuilt, so it is never left showing a
  // prompt for a flow the desk has just written into. A flow being typed into
  // has its prompt withheld as well - the live text is already there.
  renderPlaceholders(prompt, prompts.filter((part) => inlineTextEdit?.config?.part !== part
    && !(part === 'body' && canonicalBodyEdit)), zoom, state.section, state.view);

  // These frames are interaction/selection hit targets only; the words inside
  // them are rendered by the canonical layer above.
  const placeFrame = (frame, box, part, present) => {
    if (!frame) return;
    frame.style.left = `${box.left / scale}px`;
    frame.style.width = `${box.width / scale}px`;
    frame.style.right = "";
    frame.style.top = `${box.top / scale}px`;
    frame.style.height = `${box.height / scale}px`;
    // Belt and braces for the rule above: whatever the composition says, the
    // frame carrying an open edit is never taken off the page under the caret.
    frame.style.display = present || inlineTextEdit?.element === frame ? "" : "none";
    frame.classList.toggle("frame-selected", state.selectedPart === part);
    // A frame standing over a prompt rather than over real words says so, or
    // it is an invisible rectangle on an empty page again.
    frame.classList.toggle("is-prompt", Boolean(prompt) && prompts.includes(part));
  };

  // An EMPTY flow is placed too, on its prompt's box. It used to be hidden
  // outright, which is what made an unwritten headline unreachable on the page.
  placeFrame(headlineFrame, headlineBox, "headline",
    headlineBox.height > 0 && (Boolean(state.view.headline) || prompts.includes('headline')));
  placeFrame(subheadingFrame, deckBox, "subheading",
    deckBox.height > 0 && (Boolean(state.view.subheading) || prompts.includes('subheading')));

  if (bodyFrame) {
    bodyFrame.style.left = `${margin / scale}px`;
    bodyFrame.style.right = `${margin / scale}px`;
    bodyFrame.style.top = `${bodyTop / scale}px`;
    bodyFrame.style.bottom = `${margin / scale}px`;
    bodyFrame.classList.toggle("frame-selected", state.selectedPart === "body");
  }

  // Quill is deliberately comfortable editing chrome, outside the newspaper
  // page. The canonical preview above remains the authority for actual fit.
  refreshSizeButtons();
  // The device bar is drawn from the same live view, so the bar and the
  // settings rail can never disagree about what is on.
  refreshDeviceBar(state.view);

  const editor = document.querySelector("#edWritingSurface .ql-editor");
  if (editor) {
    editor.style.fontSize = `${Math.max(15, Number(state.view.bodyFontPx) || DEFAULT_BODY_FONT_PX)}px`;
    editor.style.lineHeight = String(Math.max(1.45, Number(state.view.lineHeight) || 1.45));
    editor.style.textAlign = state.view.textAlign || "left";
    editor.style.fontFamily = publicationFamily(state.view.fontFamily).css;
  }

  // The caret and the selection go on LAST, because they are measured off the
  // composed lines this function has just rebuilt.
  refreshBodyCaret();
}

/**
 * Draws the body document's caret and selection on the composed page.
 *
 * One call site's worth of state - which document, where its dateline ends,
 * and whether the desk is in the body at all - handed to the module that owns
 * the geometry. See body-caret.js for why the page has to draw these itself.
 */
/**
 * Names which of the story's two views the caret is in.
 *
 * The box below the page is the same document as the page, not a draft of it.
 * While the desk is typing on the page it says so, rather than sitting there
 * looking like a second story nobody is editing.
 */
function refreshWritingLabel() {
  const label = document.getElementById("edWritingLabel");
  if (!label) return;
  label.textContent = canonicalBodyEdit
    ? "Body copy — plain-text source · you are typing on the page above"
    : "Body copy";
}

function refreshBodyCaret() {
  const layer = document.getElementById("edBodySelection");
  if (!layer) return;
  // The Quill box below the page is a second way into the SAME document, so
  // the caret follows focus there too - typing in either place must show in
  // the place that prints.
  const active = Boolean(quill) && (canonicalBodyEdit || quill.hasFocus());
  paintBodySelection({
    layer,
    host: document.getElementById("edCanonicalContent"),
    page: document.getElementById("edFramePage"),
    range: active ? quill.getSelection() : null,
    offset: datelineText(state.view || {}).length,
    active,
    // AN UNWRITTEN BLOCK COMPOSES TO NO LINES, so there is nothing to measure
    // a caret against - and writing a block from nothing is the commonest job
    // there is. The body frame's own top-left is where the first character
    // will be set, so that is where the caret waits. The prompt beside it
    // ("Write the story") already says the same thing in words.
    empty: document.getElementById("edBodyFrame"),
  });
}

// Direct headline/deck editing happens on the SAME canonical newspaper
// renderer used by Layout. The separate plain inputs remain only as the
// existing state/persistence path and counter owner.
let inlineTextEdit = null;
let canonicalBodyEdit = false;

function endCanonicalBodyEdit({ blur = false } = {}) {
  if (!canonicalBodyEdit) return;
  canonicalBodyEdit = false;
  document.getElementById("edWritingSurface")?.classList.remove("is-canonical-body-editor", "is-body-target");
  document.getElementById("edBodyFrame")?.classList.remove("is-direct-body-editing");
  updateSelectionLabel();
  refreshWritingLabel();
  refreshBodyCaret();
  // The source document is intentionally hidden while the exact composition
  // remains on the page. Once the desk targets another object it must also
  // give up keyboard focus: otherwise Arrow/Delete and editor history keys
  // keep going to an invisible contenteditable instead of the selected
  // picture or block.
  if (blur && quill?.hasFocus()) quill.blur();
}

// Maps a pointer on the exact composed page to Quill's one source document.
// `line.at` is the compositor's source offset; dateline text is composed
// before authored body text, so it is removed before addressing Quill.
function bodyOffsetAt(point, bias = 0) {
  const page = document.getElementById("edFramePage");
  const host = document.getElementById("edCanonicalContent");
  if (!page || !point) return null;

  // MEASURED OFF THE PAINTED GLYPHS, not interpolated across the line.
  //
  // This used to map the pointer by proportion - `line.at + text.length x
  // ((x - line.x) / line.measure)` - which assumes every character is the same
  // width. Devanagari is nothing like it: in the publication serif क is 711
  // units, म is 556, and every vowel sign is ZERO, because a matra carries no
  // advance of its own. So the offset could land several aksharas from the one
  // the desk was pointing at, and picking out a single letter was guesswork.
  // See body-caret.js's offsetAtPoint(): the composed line is a real element,
  // so it is asked where its own letters are.
  const composed = offsetAtPoint(host, point.x, point.y);
  if (composed === null) return null;
  const authored = composed - datelineText(state.view || {}).length;
  const length = quill ? Math.max(0, quill.getLength() - 1) : 0;
  const offset = Math.max(0, Math.min(length, authored));
  // NEVER INSIDE AN AKSHARA. offsetAtPoint() already walks whole aksharas, so
  // this is the belt to its braces - and it still earns its place, because the
  // clamp above and the dateline subtraction are plain arithmetic on a
  // different string's indices. See graphemes.js's snapToCluster(): the same
  // rule the compositor has always cut copy by, applied to the desk's pointer.
  return quill ? snapToCluster(quill.getText(), offset, bias) : offset;
}

/**
 * Selects the word or the paragraph the pointer is standing in.
 *
 * A word is bounded by whitespace, so no akshara can be split by it and
 * snapToCluster is not needed; a paragraph is bounded by the newlines the
 * reporter typed, which is the same unit paragraph-policy.js works in.
 */
function selectAround(point, unit) {
  if (!quill) return;
  const at = bodyOffsetAt(point);
  if (at === null) return;
  const text = quill.getText();
  const edge = unit === "paragraph" ? /\n/ : /\s/;
  let from = at;
  let to = at;
  while (from > 0 && !edge.test(text[from - 1])) from -= 1;
  while (to < text.length && !edge.test(text[to])) to += 1;
  quill.focus();
  quill.setSelection(from, Math.max(0, to - from), "silent");
  refreshBodyCaret();
}

function beginCanonicalBodyEdit(point) {
  finishInlineTextEdit();
  hooks.onSelectPart?.("body");
  if (!quill) return;
  canonicalBodyEdit = true;
  const writing = document.getElementById("edWritingSurface");
  writing?.classList.add("is-body-target", "is-canonical-body-editor");
  // The exact lines stay visible, so this explicit frame state is the visible
  // equivalent of a caret/focus ring. Without it the body did accept typing,
  // but looked like ordinary read-only copy while Quill was hidden.
  document.getElementById("edBodyFrame")?.classList.add("is-direct-body-editing");
  updateSelectionLabel();
  refreshWritingLabel();
  quill.focus();
  quill.setSelection(bodyOffsetAt(point) ?? Math.max(0, quill.getLength() - 1), 0, "silent");
  refreshBodyCaret();
}

const INLINE_TEXT = {
  headline: {
    part: "headline",
    selector: ".section-headline",
    inputId: "edStoryHeadline",
    frameId: "edHeadlineFrame",
    label: "Edit headline",
    source: () => String(state.view.headline || ""),
    read: fieldValue,
  },
  subheading: {
    part: "subheading",
    selector: ".section-subheading",
    inputId: "edStorySubheading",
    frameId: "edSubheadingFrame",
    label: "Edit subheading",
    source: () => String(state.view.subheading || ""),
    read: fieldValue,
  },
};

function finishInlineTextEdit({ cancel = false } = {}) {
  const edit = inlineTextEdit;
  if (!edit) return;

  inlineTextEdit = null;

  const { element, config } = edit;

  element?.classList.remove("is-inline-editing", "is-semantic-text-editor");
  if (element) {
    // Everything setInlineTypography() put on the frame comes back off, or the
    // hit target keeps the editor's own height and overflow and stops matching
    // the band layoutTextFrames() places it on.
    element.style.pointerEvents = "";
    element.style.height = "";
    element.style.minHeight = "";
    element.style.overflow = "";
    element.style.textAlign = "";
  }
  clearDisplayField(element);

  if (!element?.isConnected) return;

  // Read as MARKUP now, not as textContent: this surface carries the desk's
  // bold/italic/underline and its selected-size spans, and reading only the
  // text off it threw every one of them away the moment the edit committed.
  // Normalised and sanitised by the same function the field below the page
  // uses, so the two writing surfaces for the same object cannot store it two
  // different ways.
  const value = (config.read || fieldValue)(element);

  element.removeAttribute("contenteditable");
  element.removeAttribute("role");
  element.removeAttribute("aria-label");
  element.textContent = "";
  element.style.whiteSpace = "";
  element.style.overflow = "";

  if (cancel) {
    layoutTextFrames();
    return;
  }

  // A flow with its own commit (the body, which belongs to Quill) rather than
  // a field below the page.
  if (config.commit) {
    config.commit(value);
    layoutTextFrames();
    return;
  }

  const input = document.getElementById(config.inputId);
  if (!input) {
    layoutTextFrames();
    return;
  }

  // Reuse the existing story-editor field event. This keeps one state, one set
  // of counters and one persistence path instead of inventing a second save
  // path. The field is contenteditable now (story-editor.js), so the value
  // goes in as markup rather than as `.value`.
  input.innerHTML = fieldHtml(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// Where the desk actually pointed, as a caret inside the frame.
//
// A story is long, and a double click halfway down it means "type here" - not
// "type at the end", which is the same jump-somewhere-else this whole change
// removes. Returns null when the point cannot be resolved into this frame, and
// the caller falls back.
function caretAt(frame, at) {
  if (!at) return null;
  const range = document.caretRangeFromPoint
    ? document.caretRangeFromPoint(at.x, at.y)
    : (() => {
      const position = document.caretPositionFromPoint?.(at.x, at.y);
      if (!position) return null;
      const made = document.createRange();
      made.setStart(position.offsetNode, position.offset);
      made.collapse(true);
      return made;
    })();
  if (!range || !frame.contains(range.startContainer)) return null;
  range.collapse(true);
  return range;
}

// The FRAME - not a span out of the canonical rendering - is the edit
// surface. A composed headline/deck is drawn as one <span> PER LINE
// (render.js), all sharing the same class, so `querySelector(".section-
// headline")` used to grab only the FIRST line: editing a 3-line headline
// silently discarded lines 2 and 3 the moment the edit committed, because
// the commit read `textContent` off an element that only ever held a third
// of the real text. The frame that already sits over the WHOLE band
// (`headlineBox`/`deckBox` in layoutTextFrames(), the union of every line
// the real composition placed) has no such limit - it is filled with the
// full semantic text from `state.view`, which is also the actual source of
// truth this text is edited FROM in the first place.
/**
 * SETS THE EDITING FRAME IN THE TYPE THE COMPOSITOR RESOLVED, not the type the
 * row asked for.
 *
 * The desk's report was that double-clicking a headline changes it, and it
 * does: photographed on a real 229x480 block, `सौरऊर्जा प्रकल्पाचे भूमिपूजन`
 * came apart into `सौरऊर्जा प्रकल्पाचे` the instant the frame opened - the
 * last word gone.
 *
 * The cause is one number. `headline_font_px` on that row is 21; the block
 * SETS at 20, because fitDisplayFlow() searches for the size that fills the
 * measure inside the line budget and 20 is what it settled on. The frame was
 * styled from the requested 21, so the editable text ran 5% wide of the
 * measure it had - and on a headline that already fills its line, 5% is one
 * whole word pushed onto a second line, which `.frame-headline`'s own
 * `overflow: hidden` then cut off. Nothing was lost from the copy; it simply
 * could not be seen, which is worse.
 *
 * Three things therefore come from the composition rather than from the row:
 *
 * - the SIZE and the LINE BOX, off the band's own resolved lines;
 * - the MEASURE, so the browser breaks the line where the compositor did
 *   (the band's box is its INK extent - on a centred headline that is
 *   narrower than the measure, and typing into an ink-tight box re-wraps on
 *   the first keystroke);
 * - the ALIGNMENT, which was hard-coded to `left`, so a centred headline
 *   jumped to the left edge as it opened and back again on blur.
 *
 * And while it is open the frame may GROW: a desk writing a longer headline
 * has to see the words. It commits on blur and the compositor re-fits it.
 */
function setInlineTypography(frame, part, scale) {
  const band = state.composition?.bands?.[part === "headline" ? "headline" : "deck"];
  const line = band?.lines?.[0];
  const content = state.composition?.content;

  const requested = Number(state.view[`${part}FontPx`]) || 16;
  const px = Number(line?.fontPx) || requested;
  frame.style.fontSize = `${px / scale}px`;
  frame.style.lineHeight = Number(line?.height)
    ? `${line.height / scale}px`
    : String(Math.max(1.1, (Number(state.view.lineHeight) || 1.25) - 0.15));

  // The frame is placed on the band's ink box by layoutTextFrames(); for
  // editing it takes the whole measure instead, which is what the line was
  // actually broken against.
  if (content) {
    frame.style.left = `${content.left / scale}px`;
    frame.style.width = `${content.measure / scale}px`;
  }

  const align = String(state.view[ALIGN_FIELD[part]] || "").trim();
  frame.style.textAlign = ALIGNMENTS.some((option) => option.value === align)
    ? align : DEFAULT_DISPLAY_ALIGN;

  // Never silently clip the words being typed. The frame carries a near-opaque
  // ground while it is open, so growing over the flow below it reads as an
  // editor state rather than as the page.
  frame.style.height = "auto";
  frame.style.minHeight = `${(band?.height || 0) / scale}px`;
  frame.style.overflow = "visible";
}

function beginInlineTextEdit(part, at = null) {
  endCanonicalBodyEdit();
  finishInlineTextEdit();
  document.getElementById("edWritingSurface")?.classList.remove("is-body-target");

  const config = INLINE_TEXT[part];
  if (!config) return;

  hooks.onSelectPart?.(part);

  // Selection can refresh the canonical renderer and the frame's own
  // position, so resolve both after that update has completed.
  queueMicrotask(() => {
    const canonical = document.getElementById("edCanonicalContent");
    const frame = document.getElementById(config.frameId);
    if (!frame || !canonical) return;

    // Marks stay marks while they are being edited, so the size spans keep
    // their real size on screen.
    const source = config.source();

    inlineTextEdit = { element: frame, config };

    // Real typography, not the frame's default (none - it is normally a
    // transparent hit target with the canonical layer doing all the
    // drawing). Zoom-adjusted the same way layoutTextFrames() positions the
    // frame itself: the frame lives in the editor's own display pixels, not
    // behind the canonical layer's separate CSS scale() transform.
    const scale = pageScale();
    // Headline/deck are always the sans face, at the stylesheet's own
    // weights (compose.js's DISPLAY_TYPOGRAPHY) - never derived from any
    // input, so this is fixed rather than looked up.
    frame.style.fontFamily = publicationFamily("sans").css;
    frame.style.fontWeight = part === "headline" ? "700" : "400";
    setInlineTypography(frame, part, scale);
    frame.style.padding = "0";
    frame.style.pointerEvents = "auto";

    frame.classList.add("is-inline-editing", "is-semantic-text-editor");
    // Rich, not "plaintext-only": marking a word inside a headline is exactly
    // what a sub-editor does, and this is the surface where the desk can see
    // the headline at its real size while doing it.
    frame.innerHTML = fieldHtml(source);
    frame.setAttribute("contenteditable", "true");
    frame.setAttribute("role", "textbox");
    frame.setAttribute("aria-label", config.label);
    // Bold/italic/size presses from the marks toolbar land here while this is
    // the open editor, instead of in the body Quill owns.
    markDisplayField(frame);

    // The canonical layer's own composed lines for this flow still sit
    // underneath the frame; hidden while the frame carries the live edit
    // text, so the desk is never shown both at once. A fresh render (either
    // path below) rebuilds the canonical layer from scratch, so nothing has
    // to restore this explicitly on the way out.
    canonical.querySelectorAll(config.selector).forEach((el) => { el.style.visibility = "hidden"; });

    frame.addEventListener(
      "blur",
      () => finishInlineTextEdit(),
      { once: true },
    );

    frame.addEventListener("keydown", (event) => {
      // Enter ends a display flow - headline/deck do not carry authored line
      // breaks; the compositor decides their lines from the measure.
      if (event.key === "Enter") {
        event.preventDefault();
        frame.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishInlineTextEdit({ cancel: true });
      }
    });

    frame.focus({ preventScroll: true });

    // FOCUS IS NOT A CARET. The element having focus and being editable is not
    // enough - until a range is placed inside it there is nowhere for a
    // character to go, and every keystroke is silently dropped. (Measured
    // exactly that way: activeElement was the frame, contenteditable was
    // "true", and neither typing nor insertText changed a thing, because the
    // selection was still wherever the double click had left it - outside.)
    const selection = window.getSelection();
    const range = caretAt(frame, at) || (() => {
      const fallback = document.createRange();
      fallback.selectNodeContents(frame);
      fallback.collapse(false);
      return fallback;
    })();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

function bindTextFrames() {
  const headline = document.getElementById("edHeadlineFrame");
  const subheading = document.getElementById("edSubheadingFrame");
  const body = document.getElementById("edBodyFrame");

  // CLICK TO SELECT, CLICK AGAIN TO EDIT - and a double click still works,
  // because a double click IS two clicks: the first selects the object, the
  // second finds it already selected and opens it.
  //
  // A dblclick LISTENER alone could not be relied on, and the reason is
  // specific to this page. Committing the flow the desk was in re-composes the
  // block, so a frame can MOVE between the two clicks of a double click - the
  // deck's box shifted from y=3 to y=108 the instant the headline above it
  // committed. The second click then landed on whatever was now under the
  // pointer, the `dblclick` event never fired on the frame at all, and (before
  // this) it fell through to the body. Handling each click on its own terms
  // makes the worst case a stray SELECTION rather than typing into the wrong
  // object.
  // ON POINTER-DOWN, not on click - and this is not a preference.
  //
  // A `click` is only dispatched on the element that received BOTH the
  // mousedown and the mouseup; if they differ the browser dispatches it on
  // their common ancestor instead. On this page they differ routinely, because
  // pressing on one flow BLURS the flow before it, and that commit re-composes
  // the block and moves every frame under the pointer. Measured on the deck,
  // pressing it while the headline was open:
  //
  //     pointerdown: edSubheadingFrame
  //     mousedown:   edSubheadingFrame
  //     mouseup:     edFramePage      <- the frame moved 32px out from under it
  //     click:       edFramePage
  //
  // So the deck's own click handler never ran, the page's background handler
  // ran instead and selected the BLOCK, and a desk pressing the subheading got
  // no subheading. The same movement is what let a double click fall through
  // to the body frame underneath and put a typed deck into the story.
  //
  // Selecting on pointer-down is also simply what a layout tool does - it is
  // the same press that would begin a drag.
  //
  // `armed` is the frame's OWN memory of the last press, deliberately not
  // `state.selectedPart`: selection travels out to the workspace and back
  // through refreshFrame(), and it has not returned by the time the second
  // press arrives.
  let armed = null;
  // A DOUBLE CLICK IS ONE GESTURE, AND IT BELONGS TO THE OBJECT ITS FIRST
  // PRESS LANDED ON.
  //
  // The frames move between the two presses - the first one commits the flow
  // that was open, that re-composes the block, and the deck's box shifted 39px
  // on a real 112x168 block while a double click was in progress. The second
  // press then lands on whatever is now under the pointer, which is the body,
  // and the body's own dblclick opens it for typing. Measured on that block:
  // the subheading a desk then typed went into Quill, and because the caret
  // was mid-string the STORY was later inserted into the middle of it - the
  // deck's words ended up split, half at the start of the copy and half at
  // the end.
  //
  // So a second press within the double-click window that lands on a different
  // object selects it and nothing more; it can never open it.
  const DOUBLE_CLICK_MS = 500;
  let gesture = { part: null, at: 0 };
  const stray = (part, now) => Boolean(gesture.part) && gesture.part !== part
    && now - gesture.at < DOUBLE_CLICK_MS;

  const beginners = {};
  const clickToEdit = (frame, part, begin) => {
    beginners[part] = begin;
    frame?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const now = event.timeStamp || Date.now();
      const followUp = stray(part, now);
      const already = !followUp && (armed === part || state.selectedPart === part);
      armed = part;
      // A stray second press does NOT take ownership of the gesture: the
      // gesture still belongs to the flow the first press landed on, and that
      // is what the double click below will open.
      if (!followUp) gesture = { part, at: now };
      // The page's own background handler must not also fire and reset the
      // selection to the whole block.
      event.stopPropagation();
      if (part !== "body") endCanonicalBodyEdit({ blur: true });
      hooks.onSelectPart?.(part);
      if (!already || inlineTextEdit || (part === "body" && canonicalBodyEdit)) return;
      event.preventDefault();
      begin(event);
    });
  };

  clickToEdit(headline, "headline", () => beginInlineTextEdit("headline"));
  clickToEdit(subheading, "subheading", () => beginInlineTextEdit("subheading"));
  clickToEdit(body, "body", (event) => beginCanonicalBodyEdit({ x: event.clientX, y: event.clientY }));

  // ONE double-click handler for the whole page, and it opens the flow the
  // GESTURE belongs to - not whatever the second press happened to land on.
  //
  // A per-frame `dblclick` listener cannot do this. The `dblclick` event is
  // dispatched on the element that received both presses, or on their common
  // ancestor when they differ - and here they differ routinely, because the
  // first press commits the flow that was open and the re-composition moves
  // every frame. Measured on a 112x168 block: the deck's box moved 39px
  // between the two presses of one double click, so the second press (and
  // therefore the `dblclick`) landed on the body, and the subheading a desk
  // typed next went into the story.
  document.getElementById("edFramePage")?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".pic-frame")) return;
    const owner = gesture.part;
    const begin = owner && beginners[owner];
    if (!begin) return;
    event.preventDefault();
    event.stopPropagation();
    if (inlineTextEdit?.config?.part === owner) return;
    if (owner === "body" && canonicalBodyEdit) return;
    armed = owner;
    begin(event);
  }, true);

  const page = document.getElementById("edFramePage");

  // Canonical poured runs can receive the pointer instead of the transparent
  // body hit frame. Use the body's actual geometry as the authority so a
  // double-click anywhere in the body area reliably activates editing.
  page?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".pic-frame")) return;
    // A display frame's own box can overlap the body's. This handler runs in
    // the CAPTURE phase, so without this it would take a click meant for the
    // headline or the deck and open the body instead - and the same is true of
    // a gesture that merely BEGAN on one of them and finished here because the
    // frame moved out from under the pointer.
    if (event.target === headline || event.target === subheading) return;
    if (gesture.part && gesture.part !== "body") return;

    const rect = body?.getBoundingClientRect();
    if (!rect) return;

    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inside) return;

    event.preventDefault();
    event.stopPropagation();
    // Already typing here: a second double click is not "open the body", it is
    // the gesture every editor gives a word. A third takes the paragraph. Both
    // are what a sub-editor reaches for to mark a phrase, and without them the
    // only way to select anything was to drag across it by hand.
    if (canonicalBodyEdit) {
      selectAround({ x: event.clientX, y: event.clientY }, "word");
      return;
    }
    beginCanonicalBodyEdit({ x: event.clientX, y: event.clientY });
  }, true);

  // A THIRD click takes the paragraph. `dblclick` fires on the second press and
  // never again, so a triple click has to be read off `detail` on the ordinary
  // click - which arrives after the drag handler below has set its collapsed
  // caret, and therefore wins.
  page?.addEventListener("click", (event) => {
    if (!canonicalBodyEdit || event.detail < 3) return;
    if (event.target.closest(".pic-frame")) return;
    const rect = body?.getBoundingClientRect();
    if (!rect || event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) return;
    event.preventDefault();
    event.stopPropagation();
    selectAround({ x: event.clientX, y: event.clientY }, "paragraph");
  }, true);

  // A drag across the visible composed body selects that range in Quill. The
  // toolbar can therefore mark a character, word, sentence or phrase directly
  // where it prints, without a second browser-flow body appearing below.
  page?.addEventListener("pointerdown", (event) => {
    if (!canonicalBodyEdit || event.target.closest(".pic-frame")) return;
    const rect = body?.getBoundingClientRect();
    if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const start = bodyOffsetAt({ x: event.clientX, y: event.clientY });
    if (start === null) return;
    event.preventDefault();

    // A selection grows OUTWARD to whole aksharas, so a drag never loses a
    // character the desk had covered and never marks half of one.
    const mark = (point) => {
      const finish = bodyOffsetAt(point) ?? start;
      const text = quill ? quill.getText() : "";
      const from = snapToCluster(text, Math.min(start, finish), -1);
      const to = snapToCluster(text, Math.max(start, finish), 1);
      quill?.setSelection(from, to - from, "silent");
      refreshBodyCaret();
    };

    // LIVE, while the pointer is still down. The selection used to be computed
    // only on release, so a desk dragging across a phrase saw nothing at all
    // until they let go and then had to judge whether they had got it - which
    // is the other half of "selecting is not smooth". Every editor paints the
    // band as the pointer moves, and now so does this one.
    const move = (on) => mark({ x: on.clientX, y: on.clientY });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", (up) => {
      window.removeEventListener("pointermove", move);
      quill?.focus();
      mark({ x: up.clientX, y: up.clientY });
    }, { once: true });
  }, true);

  // The bare page - not a frame, not a picture - is the whole block. On
  // pointer-down for the same reason the frames are: a press that starts on
  // the page background and ends somewhere the composition has moved to would
  // otherwise be lost, and `armed` has to be cleared here or the next press on
  // a frame would count as its second.
  page?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    armed = null;
    endCanonicalBodyEdit({ blur: true });
    hooks.onSelectPart?.("block");
  });
}

// ---------------------------------------------------------- picture frames ---

function pictureMarkup(row) {
  // Eight handles - the four corners (independent X/Y, Shift locks aspect)
  // and the four edges (one axis only) - see image-resize.js's own header
  // for why a corner-only set could never do a width-only or height-only
  // resize at all.
  const handles = RESIZE_HANDLES.map(
    (corner) => `<span class="pic-handle pic-handle-${corner}" data-pic-size data-corner="${corner}" aria-hidden="true"></span>`,
  ).join("");
  return `
    <figure class="pic-frame" data-image-id="${row.id}" data-shape="${row.shape || "rect"}">
      <img src="${String(row.url || "")}" alt="" draggable="false">
      <button type="button" class="pic-remove" data-pic-remove aria-label="Take this picture off the block"></button>
      <figcaption class="pic-caption"></figcaption>
      ${handles}
    </figure>`;
}

/**
 * The caption under the photograph, drawn from the ONE caption geometry.
 *
 * The page canvas drew this (section-thumb.js) and the Block Editor did not,
 * so the two halves of the same screen showed different blocks - the exact
 * parity fault editor-parity.browser.js exists to catch, and it had been sitting
 * in the one place that net could not see, because no field in the product
 * could put a caption on a picture in the first place.
 *
 * `captionBox()` is the same function the canvas, the compositor's obstacle
 * set, preflight and all four exports read, so this cannot be a second opinion
 * about where the words go. It is only converted out of block pixels into the
 * page's own screen pixels, which is what `scale` is.
 */
function paintCaption(frame, row, scale) {
  const node = frame.querySelector(".pic-caption");
  if (!node) return;
  const box = captionBox(row);
  if (!box) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = String(row.caption || "");
  node.setAttribute("style", [
    "position:absolute",
    "left:0",
    "top:100%",
    "width:100%",
    `height:${box.height / scale}px`,
    `padding:${box.paddingY / scale}px ${box.paddingX / scale}px`,
    `font-size:${box.fontPx / scale}px`,
    `line-height:${box.lineHeight}`,
  ].join(";"));
}

/** Draws each picture where its placement says it is, on the page. */
export function renderPictures(images) {
  state.images = images || [];
  const host = document.getElementById("edFramePictures");
  if (!host) return;

  const scale = pageScale();
  const kept = new Set();

  for (const row of state.images) {
    kept.add(String(row.id));
    let frame = host.querySelector(`.pic-frame[data-image-id="${row.id}"]`);
    if (!frame) {
      host.insertAdjacentHTML("beforeend", pictureMarkup(row));
      frame = host.lastElementChild;
    }
    const image = frame.querySelector("img");
    const url = String(row.url || "");
    if (image.getAttribute("src") !== url) image.setAttribute("src", url);

    // The same rule the page canvas draws with, so a photograph looks the same
    // in both places. It used to be `cover` on the page and `contain` here.
    const style = placedPictureStyle(row, scale);
    if (!frame.classList.contains("is-dragging")) frame.setAttribute("style", `position:absolute;${style.frame}`);
    image.setAttribute("style", style.image);
    frame.dataset.shape = style.shape;
    paintCaption(frame, row, scale);
    frame.classList.toggle("is-selected", state.selectedIds.has(row.id));
  }

  host.querySelectorAll(".pic-frame").forEach((frame) => {
    if (!kept.has(frame.dataset.imageId)) frame.remove();
  });
}

// A screen-space rectangle (what resizeRect() and the pointer both work in)
// converted to the block's own logical pixels - the SAME space state.images
// rows are stored in (x_px/y_px/width_px/height_px). `scale` is pageScale():
// how many block pixels one screen pixel is worth.
function logicalRectFromScreen(rect, scale) {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

// Writes a local preview geometry into state.images - never the server. This
// is what lets layoutTextFrames() recompose against where the picture is
// ABOUT to be while the pointer is still down, without a PATCH per frame.
function previewImageRect(id, logical) {
  state.images = state.images.map((image) =>
    Number(image.id) === Number(id)
      ? { ...image, x_px: logical.x, y_px: logical.y, width_px: logical.width, height_px: logical.height }
      : image,
  );
}

// The block's own measure and its minimum legal column, for the corridor
// snap. Read from the SAME composition everything else on this page is drawn
// from, so the picture snaps against the measure the words are actually set
// in rather than a re-derived guess at it.
function corridorRuleFor(image, composed) {
  const composition = composed
    || sectionComposition({ ...state.section, images: state.images || [] }, state.view);
  if (!composition || !composition.content) return null;
  const bodyPx = composition.typography?.bodyPx || 0;
  return {
    contentLeft: composition.content.left,
    contentRight: composition.content.right,
    standOffPx: Number(image?.stand_off_px ?? image?.standOffPx) || 0,
    minCorridorPx: MIN_CORRIDOR_EM * bodyPx,
    columnCount: composition.columns?.length || 1,
    bodyTop: composition.bodyTop,
    bodyBottom: composition.content.bottom,
    bandHeightPx: bodyPx * (composition.typography?.lineHeight || 0),
    // A display advert or a photo block is a picture and nothing else - there
    // is no column of type to protect, so nothing is snapped. Same gate as
    // NO_LEGAL_MEASURE's, from the same catalog.
    expectsCopy: blockExpectsCopy(state.section?.block_type),
  };
}

// Recomposing on every pointermove would run the exact engine dozens of
// times inside one browser frame - coalesce to one recomposition per paint.
let reflowFrame = null;
function requestImagePreviewReflow() {
  if (reflowFrame !== null) return;
  reflowFrame = requestAnimationFrame(() => {
    reflowFrame = null;
    layoutTextFrames();
  });
}

/**
 * Dragging and sizing a picture frame.
 *
 * Anywhere on the page, which is the whole point of frames: the placement is
 * two numbers, not a side. Bound once on the page, so frames added later need
 * no binding of their own.
 */
function bindPictureFrames() {
  const page = document.getElementById("edFramePage");
  if (!page) return;

  page.addEventListener("pointerdown", (event) => {
    const frame = event.target.closest?.(".pic-frame");
    if (!frame) return;
    if (event.target.closest("[data-pic-remove]")) return;

    endCanonicalBodyEdit({ blur: true });
    event.preventDefault();
    const id = Number(frame.dataset.imageId);
    const handle = event.target.closest("[data-pic-size]");

    // Shift+click (away from a resize handle) toggles this picture in or out
    // of the multi-selection instead of starting a drag - building up a
    // selection to align is a sequence of clicks to ADD pictures, not a
    // request to move whichever was clicked last.
    if (event.shiftKey && !handle) {
      if (state.selectedIds.has(id)) state.selectedIds.delete(id);
      else state.selectedIds.add(id);
      frame.classList.toggle("is-selected", state.selectedIds.has(id));
      hooks.onToggleImageSelection?.(id);
      return;
    }

    state.selectedIds = new Set([id]);
    hooks.onSelectImage?.(id);
    hooks.onSelectPart?.("image", id);
    page.querySelectorAll(".pic-frame").forEach((f) => f.classList.toggle("is-selected", f === frame));

    const sizing = Boolean(handle);
    const corner = handle?.dataset.corner || "se";
    const scale = pageScale();
    const start = { x: event.clientX, y: event.clientY };
    const from = {
      x: parseFloat(frame.style.left) || 0,
      y: parseFloat(frame.style.top) || 0,
      width: frame.offsetWidth,
      height: frame.offsetHeight,
    };
    const pageBounds = page.getBoundingClientRect();
    // The SAME local coordinate space `frame.style.left/top` are already in
    // (the page's own top-left as 0,0) - resizeRect()'s bounds are compared
    // directly against `from`, so this must not be the page's on-screen
    // position, only its size.
    const bounds = { x: 0, y: 0, width: pageBounds.width, height: pageBounds.height };

    // Snapshot the row as it stood before this drag, so a cancelled drag
    // (Esc, or the pointer leaving the surface some other way) can put it
    // back exactly - never mutated in place, only ever replaced.
    const imageIndex = state.images.findIndex((image) => Number(image.id) === id);
    const originalImage = imageIndex >= 0 ? { ...state.images[imageIndex] } : null;

    // A cut-out is trimmed to one exact silhouette - there is no more
    // subject to reveal by stretching it, only wasted frame around it that
    // strands the resize handles far from the picture a desk can actually
    // see (found live: handles drawn at the frame's corners, a third of the
    // frame's width away from the visible person once fit_mode was fixed to
    // `contain` for cutouts - see image-geometry.js). So a cut-out's aspect
    // ratio is locked always, not only while Shift is held - Shift stays the
    // opt-in lock for every other shape, where stretching to reveal more of
    // a rectangular photo is a legitimate choice.
    const lockAspect = originalImage?.shape === "cutout";

    // Once per drag, not once per pointermove: this runs the exact engine, and
    // neither the block's measure nor its body size changes while a picture is
    // being dragged. (The reflow below is coalesced to one per paint for the
    // same reason.)
    let lastLogical = null;

    frame.classList.add("is-dragging");

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;

      let screenRect;
      if (sizing) {
        // Read fresh on every move, not just at pointerdown - a desk holding
        // or releasing Shift mid-drag sees the aspect lock engage or let go
        // immediately, the way every page-layout tool's own handles do.
        screenRect = resizeRect(from, corner, dx, dy, { bounds, preserveAspect: lockAspect || moveEvent.shiftKey });
      } else {
        // Kept on the page: a frame dragged off the block would print off
        // the page, and the character grid would count cells that do not
        // exist.
        screenRect = {
          x: Math.round(Math.max(0, Math.min(bounds.width - from.width, from.x + dx))),
          y: Math.round(Math.max(0, Math.min(bounds.height - from.height, from.y + dy))),
          width: from.width,
          height: from.height,
        };
      }

      const logical = logicalRectFromScreen(screenRect, scale);
      lastLogical = logical;
      frame.style.width = `${screenRect.width}px`;
      frame.style.height = `${screenRect.height}px`;
      frame.style.left = `${screenRect.x}px`;
      frame.style.top = `${screenRect.y}px`;

      // Local preview only - no network. This is what makes copy visibly
      // reflow around the picture WHILE it is being dragged, not only after
      // the pointer comes up: layoutTextFrames() recomposes from state.images,
      // so writing the in-progress rectangle there before asking for that
      // recomposition is the whole mechanism.
      if (imageIndex >= 0) {
        previewImageRect(id, logical);
        requestImagePreviewReflow();
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", cancel);
      frame.classList.remove("is-dragging");
    };

    const done = () => {
      cleanup();

      // A picture may not be LEFT where the block can no longer set a line -
      // the frame would keep its depth, keep its copy, and print none of it.
      // Repaired on the drop rather than on every pointermove: the trigger is
      // the engine's own answer (leavesNoLegalColumn), which costs a
      // composition, and settling the picture when the pointer comes up is how
      // a snap behaves in every layout tool anyway. The live reflow during the
      // drag has already shown the desk the copy going; letting go puts it
      // right. See corridor-snap.js for the rule and why it is the ordinary
      // newspaper one.
      if (lastLogical) {
        const proposed = { ...state.section, images: state.images || [] };
        const settled = sectionComposition(proposed, state.view);
        // Measured against the composition being REPAIRED - the block with
        // this picture where the desk just dropped it - rather than against
        // one taken before the drag began. Where the copy starts moves with
        // the display type, and the display type moves with the picture, so
        // the pre-drag frame is not the frame the repair has to fit into.
        // Same correction as sectionImage.service.js's, for the same reason:
        // the two must not snap to different geometry.
        const corridorRule = leavesNoLegalColumn(settled)
          ? corridorRuleFor(originalImage, settled)
          : null;
        if (corridorRule) {
          const snapped = snapPictureToLegalCorridor(lastLogical, corridorRule);
          if (snapped.snapped) {
            lastLogical = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
            frame.style.left = `${Math.round(snapped.x / scale)}px`;
            frame.style.top = `${Math.round(snapped.y / scale)}px`;
            frame.style.width = `${Math.round(snapped.width / scale)}px`;
            frame.style.height = `${Math.round(snapped.height / scale)}px`;
            previewImageRect(id, lastLogical);
            layoutTextFrames();
          }
        }
      }

      // The rectangle that was last previewed, not one re-derived from the
      // frame's screen pixels: a snapped placement is exact in the block's own
      // coordinates, and a round trip through screen space and back would give
      // it up to a pixel of drift - enough to put a corridor back inside the
      // dead zone it was just snapped out of.
      const saved = lastLogical || {
        x: Math.round((parseFloat(frame.style.left) || 0) * scale),
        y: Math.round((parseFloat(frame.style.top) || 0) * scale),
        width: Math.round(frame.offsetWidth * scale),
        height: Math.round(frame.offsetHeight * scale),
      };
      hooks.onPatchImage?.(id, {
        x: saved.x, y: saved.y, width: saved.width, height: saved.height,
      });
    };

    const cancel = () => {
      cleanup();
      if (originalImage && imageIndex >= 0) {
        state.images = state.images.map((image) =>
          Number(image.id) === Number(id) ? originalImage : image,
        );
        renderPictures(state.images);
        layoutTextFrames();
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", cancel);
  });

  page.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-pic-remove]");
    if (!remove) return;
    event.preventDefault();
    hooks.onRemoveImage?.(Number(remove.closest(".pic-frame").dataset.imageId));
  });
}

// ------------------------------------------------------------------- copy ---

/** The story as it is stored: Quill's Delta, serialised to marks a printer can set. */
// The reverse conversion, for the way IN: a story already carrying
// rich-text.js's stored `data-sahas-size` mark has to become Quill's own
// `style="font-size:Npx"` again before dangerouslyPasteHTML(), or Quill's
// clipboard importer - which only round-trips formats it has a registered
// Attributor for - drops the mark on load, and the very next keystroke would
// save it away permanently even though the desk never touched that word.
function quillHtmlFromStored(html) {
  if (!html || !(html.includes("data-sahas-size") || html.includes("data-sahas-ink"))) return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll("[data-sahas-size]").forEach((el) => {
    const px = Number(el.getAttribute("data-sahas-size"));
    el.removeAttribute("data-sahas-size");
    if (Number.isFinite(px)) el.style.fontSize = `${px}px`;
  });
  // The ink mark, the same way and for the same reason: Quill's clipboard only
  // round-trips formats it has an Attributor for, and its own is a style.
  holder.querySelectorAll("[data-sahas-ink]").forEach((el) => {
    const ink = sanitiseInk(el.getAttribute("data-sahas-ink"));
    el.removeAttribute("data-sahas-ink");
    if (ink) el.style.color = ink;
  });
  return holder.innerHTML;
}

// ------------------------------------------------- Delta -> canonical HTML ---
// Quill's Delta, not its DOM, is the truth for what is actually selected and
// formatted: `format()` updates it synchronously, whereas the live DOM is
// restructured asynchronously relative to that call (splitting/rewrapping an
// existing <strong> to nest a new size span). Reading `root.innerHTML` or
// even `getSemanticHTML()` - which still serialises off the DOM one layer
// down - inside the same "text-change" tick that the format() call itself
// fired could observe that restructuring mid-flight: the Delta already
// showed `attributes:{bold:true,size:"28px"}`, confirmed by direct
// instrumentation, but the HTML read back in the same tick sometimes did
// not yet have the size. Walking the Delta directly cannot observe an
// unsettled DOM, because it never reads the DOM at all.
function escapeCanonicalText(text) {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function canonicalInlineHtml(text, attrs) {
  let html = escapeCanonicalText(text);
  const size = attrs.size ? sanitiseSize(Number.parseFloat(attrs.size)) : null;
  if (size !== null) html = `<span data-sahas-size="${size}">${html}</span>`;
  // Quill's own `color` attribute, back into the paper's controlled mark. An
  // ink that is not one of the four is dropped rather than stored - a colour
  // no press can separate must not reach the page just because a paste
  // carried it.
  const ink = attrs.color ? sanitiseInk(attrs.color) : null;
  if (ink !== null) html = `<span data-sahas-ink="${ink}">${html}</span>`;
  if (attrs.underline) html = `<u>${html}</u>`;
  if (attrs.italic) html = `<em>${html}</em>`;
  if (attrs.bold) html = `<strong>${html}</strong>`;
  return html;
}

function renderCanonicalBlocks(blocks) {
  let html = "";
  let currentList = null;
  const closeList = () => {
    if (!currentList) return;
    html += `</${currentList}>`;
    currentList = null;
  };
  for (const block of blocks) {
    if (block.type === "ol-item" || block.type === "ul-item") {
      const tag = block.type === "ol-item" ? "ol" : "ul";
      if (currentList !== tag) {
        closeList();
        html += `<${tag}>`;
        currentList = tag;
      }
      html += `<li>${block.html}</li>`;
      continue;
    }
    closeList();
    html += `<p>${block.html}</p>`;
  }
  closeList();
  return html;
}

/** Quill's Delta into rich-text.js's stored marks, one paragraph/list-item
 * per line break op. Quill attaches block-level attributes (list) to the
 * newline that ends the line, matching Quill's own Delta convention. */
function quillDeltaToCanonicalHtml(delta) {
  const blocks = [];
  let inline = [];

  const flushParagraph = (attrs = {}) => {
    const content = inline.join("") || "<br>";
    if (attrs.list === "ordered") blocks.push({ type: "ol-item", html: content });
    else if (attrs.list === "bullet") blocks.push({ type: "ul-item", html: content });
    else blocks.push({ type: "p", html: content });
    inline = [];
  };

  for (const op of delta.ops || []) {
    if (typeof op.insert !== "string") continue; // embeds carry no printable text
    const attrs = op.attributes || {};
    const pieces = op.insert.split("\n");
    for (let i = 0; i < pieces.length; i += 1) {
      const text = pieces[i];
      if (text) inline.push(canonicalInlineHtml(text, attrs));
      if (i < pieces.length - 1) flushParagraph(attrs);
    }
  }
  if (inline.length) flushParagraph();

  return renderCanonicalBlocks(blocks);
}

export function copyFromFrame() {
  if (!quill) return "";
  const html = quillDeltaToCanonicalHtml(quill.getContents());
  // Quill's empty document is one line with no marks, which renders here as
  // "<p><br></p>". Storing that would make an empty block look written, and
  // every count would be off by one line.
  if (/^<p>(<br\s*\/?>)?<\/p>$/i.test(html.trim())) return "";
  return sanitise(html);
}

// ------------------------------------------------- the marks toolbar's aim ---
//
// One toolbar, three text objects. Quill owns the body and binds these same
// buttons to it, so a press with the headline open used to embolden a word in
// the story - the control was aimed at the wrong object, exactly as the
// alignment buttons were.
//
// Intercepted in the CAPTURE phase, before Quill's own listener runs, and only
// while a display field actually has the caret. When none does, nothing is
// stopped and the event reaches Quill untouched - the body's behaviour is
// completely unchanged, which is what makes this safe to put in front of an
// editor this project did not write.
const TOOLBAR_ACTION = [
  ["bold", ".ql-bold"],
  ["italic", ".ql-italic"],
  ["underline", ".ql-underline"],
  ["clean", ".ql-clean"],
  ["list", ".ql-list"],
];

function toolbarActionOf(target) {
  for (const [action, selector] of TOOLBAR_ACTION) {
    if (target.closest(selector)) return action;
  }
  if (target.closest(".ed-quill-size-select")) return "size";
  return target.closest(".ed-quill-ink-btn") ? "ink" : null;
}

// Escape leaves the story, the way it already leaves a headline.
//
// A desk that has opened the body has the caret inside a Quill document that
// is not where the pointer is, so "click somewhere else" was the only way out
// - and the display flows had had a keyboard way out since they were written.
// Bound at the document because that is where the focus is: Quill's root is
// outside the page element, so a listener on the page never sees the key.
let bodyKeysBound = false;
function bindBodyKeys() {
  if (bodyKeysBound) return;
  bodyKeysBound = true;
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !canonicalBodyEdit) return;
    event.preventDefault();
    endCanonicalBodyEdit({ blur: true });
    hooks.onSelectPart?.("block");
  });
}

let marksToolbarBound = false;
function bindMarksToolbar() {
  if (marksToolbarBound) return;
  marksToolbarBound = true;

  // Bound to the DOCUMENT, not to #edQuillToolbar itself. The toolbar is part
  // of the Block Editor's markup and is rewritten wholesale on every render,
  // so a listener attached to the element that existed at mount time is a
  // listener on a detached node from the next repaint onwards - the control
  // draws perfectly and does nothing, which is the exact trap CLAUDE.md
  // records for #edSpaceGroup. Found here the same way: by pressing the
  // button in the running app and watching nothing happen.
  const inToolbar = (target) => (target instanceof Element ? target.closest("#edQuillToolbar") : null);

  // Pressing a button must not take the caret out of the field behind it, or
  // there is nothing selected left to mark by the time the click lands.
  document.addEventListener("mousedown", (event) => {
    if (!activeDisplayField()) return;
    if (!inToolbar(event.target)) return;
    if (!toolbarActionOf(event.target)) return;
    // The size picker is a native <select>: refusing its mousedown would stop
    // it opening. Its range is remembered and put back on "change" instead.
    if (event.target.closest(".ed-quill-size-select")) {
      rememberSelection();
      return;
    }
    holdSelection(event);
  }, true);

  // And by the keyboard, or any other route into the picker that is not a
  // press. The focusin handler further down deliberately exempts the toolbar,
  // so the aim is still the headline when this runs.
  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(".ed-quill-size-select")) return;
    if (activeDisplayField()) rememberSelection();
  }, true);

  document.addEventListener("click", (event) => {
    const field = activeDisplayField();
    if (!field) return;
    if (!inToolbar(event.target)) return;
    const action = toolbarActionOf(event.target);
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();

    const value = event.target.closest(".ed-quill-ink-btn")?.dataset.ink;
    if (applyDisplayMark(action, value)) {
      // Straight down the ordinary field path - the same "input" event a
      // keystroke in the field raises, so the draft, the counters and the
      // canvas all update through one route rather than through a second one
      // invented for the toolbar.
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    refreshMarksToolbarState();
  }, true);

  // The size picker lands as a "change", not a click, and it has to be taken
  // before the body's own handler on #edQuillSize sees it - otherwise a size
  // chosen for a headline would be applied to the story. When no display field
  // is aimed at, nothing is stopped and the body's handler runs untouched.
  document.addEventListener("change", (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(".ed-quill-size-select") || !inToolbar(event.target)) return;
    const field = restoreSelection();
    if (!field) return;
    event.preventDefault();
    event.stopPropagation();
    if (applyDisplayMark("size", event.target.value)) {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    refreshMarksToolbarState();
  }, true);

  // The caret leaving a display field is the marks toolbar losing its aim -
  // whatever it went to. Bound at the document, not on Quill's host: "the
  // body" is only one of the places focus can go, and a toolbar still
  // claiming to point at the headline after the desk has clicked away is the
  // same lie about which object is targeted that this whole mechanism exists
  // to remove. Presses on the toolbar itself are exempt - holdSelection()
  // stops them taking focus at all, and one that slipped through must not
  // clear the aim it is about to act on.
  document.addEventListener("focusin", (event) => {
    const field = activeDisplayField();
    if (!field) return;
    if (field === event.target || field.contains(event.target)) return;
    if (event.target instanceof Element && event.target.closest("#edQuillToolbar")) return;
    clearDisplayField(null);
  });

  // Whoever changes the aim - a field taking focus, an inline edit closing,
  // Quill taking it back - the toolbar is repainted from the one announcement.
  document.addEventListener(DISPLAY_TARGET_EVENT, refreshMarksToolbarState);
  refreshMarksToolbarState();
}

/**
 * The toolbar says which object it will act on, and greys out what that object
 * cannot do.
 *
 * A headline set as a bullet is not a headline, and the compositor has no
 * display flow that could carry a list - so those two buttons are disabled
 * rather than left looking live and doing nothing.
 */
function refreshMarksToolbarState() {
  const toolbar = document.getElementById("edQuillToolbar");
  if (!toolbar) return;
  const field = activeDisplayField();
  const part = field?.dataset?.part
    || (field?.id === "edHeadlineFrame" ? "headline"
      : field?.id === "edSubheadingFrame" ? "subheading"
        : field?.id === "edBodyFrame" ? "body" : null);
  toolbar.classList.toggle("is-display-target", Boolean(field));
  toolbar.setAttribute("aria-label", `Marks — ${PART_LABEL[part] || "Body"}`);
  toolbar.querySelectorAll(".ql-list").forEach((button) => {
    // A display field cannot carry a list. The body never becomes one of
    // these temporary fields; it stays in Quill, where list semantics live.
    button.toggleAttribute("disabled", Boolean(field));
    button.title = !field ? ""
      : part === "body" ? "Set a list in the writing surface below the page"
        : "Lists are a body form";
  });
  refreshSizePicker(field);
}

/**
 * What the size picker SHOWS - the mark actually on the words it is aimed at.
 *
 * It reads the aimed-at object rather than always reading the body, because a
 * control that keeps showing the last thing it did is a control that reports
 * a headline is set at a size it is not.
 */
function refreshSizePicker(field) {
  const select = refreshSizeOptions();
  if (!select || document.activeElement === select) return;
  // NEVER `quill.getFormat()` with no arguments. Its default first argument is
  // `this.getSelection(true)`, and the `true` there means "focus the editor and
  // then tell me" - so merely READING the toolbar's state pulled the caret into
  // the body on every render, and returned null (crashing on `.index`) whenever
  // the hidden editor could not take it. The range is asked for first, and the
  // format is only read when there is one.
  const range = quill ? quill.getSelection() : null;
  const marked = field ? displaySizeAt(field)
    : (range ? quill.getFormat(range.index, range.length)?.size : null);
  select.value = marked && [...select.options].some((option) => option.value === marked) ? marked : "";
}

/** The `data-sahas-size` a display field's caret is standing inside, if any. */
function displaySizeAt(field) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  let node = selection.getRangeAt(0).commonAncestorContainer;
  node = node.nodeType === 1 ? node : node.parentNode;
  while (node && node !== field) {
    const size = node.getAttribute?.("data-sahas-size");
    if (size) return `${size}px`;
    node = node.parentNode;
  }
  return null;
}

export async function mountFrame(section, view, images, callbacks, selectedPart = "block", selectedImageIds = []) {
  // The editor can be mounted again while a previous block had direct body
  // input active (edition reload, or reopening the workspace). Its hidden
  // source document must never follow that old block into the new one.
  endCanonicalBodyEdit({ blur: true });
  hooks = callbacks || {};
  state = {
    section, view, images: images || [], selectedIds: new Set(selectedImageIds), selectedPart,
    composition: null,
  };

  const host = document.getElementById("edQuill");
  if (!host) return;

  const Quill = await loadQuill().catch(() => null);
  if (!Quill) {
    host.innerHTML = `<p class="muted">The writing surface could not be loaded.</p>`;
    return;
  }

  // Colour and font stay the BLOCK's, decided by the layout - a newspaper is
  // one paper, not a scrapbook (rich-text.js). Size is the one deliberate
  // exception, for a sub-editor emphasising one word or phrase - registered
  // once, globally, with an open whitelist so `quill.format('size', 'Npx')`
  // below can ask for any value rather than a fixed few Quill ships with.
  // Quill applies it as a `size` Delta attribute (`"28px"`); copyFromFrame()
  // reads that straight off the Delta into rich-text.js's controlled
  // `data-sahas-size` mark, so no arbitrary inline style ever survives.
  if (!sizeAttributorRegistered) {
    const SizeStyle = Quill.import("attributors/style/size");
    SizeStyle.whitelist = null;
    Quill.register(SizeStyle, true);
    // Ink is the second exception, registered as a STYLE attributor for the
    // same reason size is: Quill's default colour attributor is a CLASS, and a
    // class round-trips through the clipboard as `ql-color-red`, which means
    // nothing to canonicalInlineHtml() or to a press file.
    //
    // Open whitelist, exactly like size, and it has to be. A StyleAttributor
    // reads its value back off the element, and a browser normalises every
    // inline colour: the style set as `#c8102e` reads back as
    // `rgb(200, 16, 46)`, which a whitelist of hexes rejects - so Quill
    // painted the words red in its own DOM and recorded NOTHING in the Delta,
    // and copyFromFrame() (which walks the Delta, deliberately) stored plain
    // text. Measured that way before this line changed. What keeps a foreign
    // colour off the page is sanitiseInk() at the one door to storage, not a
    // list Quill compares against a string it never produces.
    const ColorStyle = Quill.import("attributors/style/color");
    ColorStyle.whitelist = null;
    Quill.register(ColorStyle, true);
    sizeAttributorRegistered = true;
  }

  quill = new Quill(host, {
    theme: "snow",
    placeholder: "बातमी येथे लिहा — write the story here.",
    modules: {
      toolbar: { container: "#edQuillToolbar" },
      history: { delay: 600, maxStack: 200, userOnly: true },
    },
  });

  quill.clipboard.dangerouslyPasteHTML(quillHtmlFromStored(view.body || ""), "silent");
  quill.on("text-change", (delta, old, source) => {
    if (source !== "user") return;
    hooks.onPatch?.({ body: copyFromFrame() }, "block-frame");
  });
  // Moving the caret changes nothing about the copy, so nothing else repaints
  // - the caret has to follow the selection on its own.
  quill.on("editor-change", () => refreshBodyCaret());
  // Plain buttons, not Quill's Picker (see the toolbar markup's own note
  // above for why) - one delegated click handler. `quill.getSelection(true)`
  // asks Quill to focus and hand back a range: a plain button click moves
  // DOM focus off the editor exactly like the Bold button's click does, and
  // Quill's own internal `lastRange` tracking (the same mechanism that keeps
  // Bold working after that focus loss) is what makes this still apply to
  // the text that was actually selected.
  bindMarksToolbar();
  bindBodyKeys();
  // The ink buttons, for the BODY - the display fields go through
  // applyDisplayMark() above. Black carries no hex and clears the format,
  // which is what `false` means to Quill.
  document.getElementById("edQuillInk")?.addEventListener("click", (event) => {
    const button = event.target.closest(".ed-quill-ink-btn");
    if (!button || !quill) return;
    const range = quill.getSelection(true);
    if (!range) return;
    quill.format("color", sanitiseInk(button.dataset.ink) || false, "user");
  });
  // Delegated on the HOST, which survives - refreshSizeOptions() replaces only
  // its children. `quill.getSelection(true)` asks Quill to focus and hand back
  // a range: choosing from a <select> moves DOM focus off the editor exactly
  // as a toolbar button's click does, and Quill's own `lastRange` tracking is
  // what makes the size still land on the words that were selected.
  document.getElementById("edQuillSize")?.addEventListener("change", (event) => {
    if (!event.target.closest(".ed-quill-size-select") || !quill) return;
    const range = quill.getSelection(true);
    if (!range) return;
    // format() fires "text-change" synchronously (source "user"), which the
    // listener above already turns into a copyFromFrame() patch - no extra
    // re-patch needed now that copyFromFrame() reads the Delta directly (see
    // quillDeltaToCanonicalHtml()) rather than a DOM serialization that could
    // still be mid-restructure when a size lands on an already-bold range.
    // An empty value is "no size mark at all", which is what `false` means to
    // Quill - the same shape the Black ink button uses to clear a colour.
    quill.format("size", event.target.value || false, "user");
  });
  // A real click or keyboard focus in Quill is source "user"; refreshFrame()'s
  // own dangerouslyPasteHTML(..., "silent") sync (below) also moves Quill's
  // internal selection and would otherwise fire this the same way, quietly
  // reselecting "body" every time any OTHER part is selected. Only "user"
  // is a person actually choosing to edit the body.
  quill.on("selection-change", (range, oldRange, source) => {
    const writing = document.getElementById("edWritingSurface");
    if (range) writing?.classList.add("is-body-target");
    else if (source === "user") writing?.classList.remove("is-body-target");
    if (source === "user" && range) hooks.onSelectPart?.("body");
    refreshBodyCaret();
  });

  layoutPage();
  layoutTextFrames();
  layoutCard();
  applyBlockSelection();
  updateSelectionLabel();
  renderPictures(state.images);
  bindPictureFrames();
  bindTextFrames();

  if (!window.__sahasFrameResize) {
    window.__sahasFrameResize = true;
    const relayout = () => {
      layoutPage();
      layoutTextFrames();
      applyBlockSelection();
      updateSelectionLabel();
      renderPictures(state.images);
    };
    window.addEventListener("resize", relayout);
    // A splitter drag changes the room the page has without changing the
    // window, so the page would keep the size it was given for the old column
    // and the pictures on it would sit at the wrong scale.
    window.addEventListener("workspace-resized", relayout);
  }
}

/** Live sync: the block changed under us. */
export function refreshFrame(section, view, images, source, selectedPart, selectedImageIds) {
  // Selecting another block is also leaving the direct body target, even
  // though the click happened on the page canvas rather than inside this
  // frame. Without this handoff the prior block's hidden Quill document could
  // remain focused while the desk was looking at a different block.
  if (canonicalBodyEdit && state.section?.id !== section?.id) endCanonicalBodyEdit({ blur: true });
  // And leaving the body for another OBJECT ends it too, by whatever route the
  // desk took. The frame click handlers below already did this for a click on
  // the page itself, but a desk that moves to the headline FIELD under the
  // page - or Tabs into it, or picks the object in Typography - was leaving
  // the direct body edit running: `#edWritingSurface` stays collapsed to
  // nothing while it is (that is what puts the caret on the page instead), so
  // the separate writing surface stayed invisible and unclickable with no way
  // back to it short of double-clicking the body again. Selection is the one
  // place that knows about every route, so the rule lives here.
  if (canonicalBodyEdit && selectedPart && selectedPart !== "body") endCanonicalBodyEdit({ blur: true });
  state = {
    ...state,
    section,
    view,
    images: images || [],
    selectedPart: selectedPart ?? state.selectedPart,
    selectedIds: selectedImageIds ? new Set(selectedImageIds) : state.selectedIds,
    composition: null,
  };
  layoutPage();
  layoutTextFrames();
  const showingCard = layoutCard();
  applyBlockSelection();
  updateSelectionLabel();
  renderPictures(state.images);

  // A block showing a card has nothing for Quill to hold, and pasting the
  // card's flattened text back into a hidden editor would only put it back on
  // the next keystroke.
  if (showingCard) return;

  // Never while the desk is typing: replacing the document under a cursor
  // throws it back to the start, which is how a rich editor becomes unusable.
  if (source === "block-frame" || !quill || quill.hasFocus()) return;
  const wanted = view.body || "";
  if (copyFromFrame() !== wanted) quill.clipboard.dangerouslyPasteHTML(quillHtmlFromStored(wanted), "silent");
}

export function selectPictureFrame(id) {
  state.selectedIds = new Set([id]);
  renderPictures(state.images);
}
