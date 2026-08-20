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

import { sanitise, sanitiseSize } from "../layout/rich-text.js";
import { INKS, sanitiseInk } from "../layout/inks.js";
import {
  markDisplayField, clearDisplayField, activeDisplayField, applyDisplayMark, holdSelection,
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
import { DEFAULT_BODY_FONT_PX } from "../layout/text-flow.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
// The same functions the page canvas draws a headline, a deck and a flowed
// body with - so the WYSIWYG frame and the newspaper page can never drift
// onto two different renderings of the same block, the way the
// headline/subheading inputs and the canvas once did. smartCardFrame() is
// the SAME logical width/height/padding solve the page canvas passes a
// Smart Card - reused rather than re-derived, so "does this card fit" can
// never disagree between the two.
import { sectionContentMarkup, sectionComposition, smartCardFrame } from "../canvas/section-thumb.js";
// The same six words the Typography panel's "Editing: X" label uses - one
// catalog for what a selected object is called, not two that could drift.
import { PART_LABEL } from "./typography-panel.js";
// The same serif/sans classification the exact engine measures a body with
// (compose/font-metrics.js) - Quill is comfort-typing chrome, not the
// canonical preview (see above), so it does not have to pixel-match, but it
// should not paint a DIFFERENT face family than the one the story was
// actually measured in either.
import { publicationFamily } from "../compose/font-metrics.js";

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
let state = { section: null, view: null, images: [], selectedIds: new Set(), selectedPart: "block" };

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

// ----------------------------------------------------------------- markup ---

export function blockFrameMarkup() {
  return `
    <div class="block-frame" id="edBlockFrame">
      <!-- The marks toolbar is chrome, so it sits ABOVE the page rather than
           inside it. Rendered inside the body frame it was part of the block,
           which meant a picture dragged over the top of the copy covered the
           bold button. The page holds only what prints. -->
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
          <button type="button" class="ed-quill-size-btn" data-size="12px" title="12px">12</button>
          <button type="button" class="ed-quill-size-btn" data-size="14px" title="14px">14</button>
          <button type="button" class="ed-quill-size-btn" data-size="18px" title="18px">18</button>
          <button type="button" class="ed-quill-size-btn" data-size="22px" title="22px">22</button>
          <button type="button" class="ed-quill-size-btn" data-size="28px" title="28px">28</button>
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

        <!-- Interactive picture frames sit over the canonical text layer. They
             use the same persisted block-pixel geometry as the page canvas. -->
        <div class="frame-pictures" id="edFramePictures"></div>

        <!-- Transparent hit/selection frames. They do not render a second copy
             of the words; the canonical layer above is the only visual copy. -->
        <div class="frame frame-headline" id="edHeadlineFrame" tabindex="-1" title="Double-click to edit the headline"></div>
        <div class="frame frame-subheading" id="edSubheadingFrame" tabindex="-1" title="Double-click to edit the subheading"></div>
        <div class="frame frame-body" id="edBodyFrame" tabindex="-1"
             title="Double-click to edit body copy"></div>

        <span class="frame-selection-label" id="edSelectionLabel" hidden></span>
      </div>

      <!-- Quill is an EDITING CONTROL, not a second newspaper renderer. Keeping
           it outside the printable page means the enlarged page can remain
           pixel-for-pixel canonical while the desk still gets a comfortable
           rich-text writing surface. -->
      <div class="frame-writing-surface" id="edWritingSurface">
        <div class="frame-writing-label">Body copy</div>
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
  const pageRect = page.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  label.style.left = `${hostRect.left - pageRect.left + 2}px`;
  label.style.top = `${hostRect.top - pageRect.top + 2}px`;
  label.textContent = PART_LABEL[state.selectedPart] || state.selectedPart;
  label.hidden = false;
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

  const headlineBox = bandOf('headline', { left: margin, width: measure, top: margin, height: 0 });
  const deckBox = bandOf('deck', { left: margin, width: measure, top: margin, height: 0 });
  const bodyTop = composition ? composition.bodyTop : margin;

  // Render once at the section's TRUE logical dimensions, then zoom the whole
  // composition. This is the key parity rule: editor size changes can never
  // change line breaks, column flow or the amount of copy that fits.
  canonical.style.width = `${Number(state.section.width_px)}px`;
  canonical.style.height = `${Number(state.section.height_px)}px`;
  canonical.style.transform = `scale(${zoom})`;
  canonical.innerHTML = sectionContentMarkup(renderSection, state.view);

  // The canonical lines for a flow that is being typed into stay hidden. They
  // were hidden once, when the edit opened - and any refresh at all (an
  // autosave landing, a picture moving, the window resizing) rebuilt this
  // layer and put them back, so the desk saw the old composed words sitting
  // under the live ones they were typing.
  if (inlineTextEdit?.config?.selector) {
    canonical.querySelectorAll(inlineTextEdit.config.selector)
      .forEach((el) => { el.style.visibility = "hidden"; });
  }

  // These frames are interaction/selection hit targets only; the words inside
  // them are rendered by the canonical layer above.
  const placeFrame = (frame, box, part, present) => {
    if (!frame) return;
    frame.style.left = `${box.left / scale}px`;
    frame.style.width = `${box.width / scale}px`;
    frame.style.right = "";
    frame.style.top = `${box.top / scale}px`;
    frame.style.height = `${box.height / scale}px`;
    frame.style.display = present ? "" : "none";
    frame.classList.toggle("frame-selected", state.selectedPart === part);
  };

  placeFrame(headlineFrame, headlineBox, "headline", Boolean(state.view.headline) && headlineBox.height > 0);
  placeFrame(subheadingFrame, deckBox, "subheading", Boolean(state.view.subheading) && deckBox.height > 0);

  if (bodyFrame) {
    bodyFrame.style.left = `${margin / scale}px`;
    bodyFrame.style.right = `${margin / scale}px`;
    bodyFrame.style.top = `${bodyTop / scale}px`;
    bodyFrame.style.bottom = `${margin / scale}px`;
    bodyFrame.classList.toggle("frame-selected", state.selectedPart === "body");
  }

  // Quill is deliberately comfortable editing chrome, outside the newspaper
  // page. The canonical preview above remains the authority for actual fit.
  const editor = document.querySelector("#edWritingSurface .ql-editor");
  if (editor) {
    editor.style.fontSize = `${Math.max(15, Number(state.view.bodyFontPx) || DEFAULT_BODY_FONT_PX)}px`;
    editor.style.lineHeight = String(Math.max(1.45, Number(state.view.lineHeight) || 1.45));
    editor.style.textAlign = state.view.textAlign || "left";
    editor.style.fontFamily = publicationFamily(state.view.fontFamily).css;
  }
}

// Direct headline/deck editing happens on the SAME canonical newspaper
// renderer used by Layout. The separate plain inputs remain only as the
// existing state/persistence path and counter owner.
let inlineTextEdit = null;

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
  if (element) element.style.pointerEvents = "";
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
function beginInlineTextEdit(part, at = null) {
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
    frame.style.fontSize = `${(Number(state.view[`${part}FontPx`]) || 16) / scale}px`;
    frame.style.lineHeight = String(Math.max(1.1, (Number(state.view.lineHeight) || 1.25) - 0.15));
    frame.style.textAlign = "left";
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

  headline?.addEventListener("click", () => hooks.onSelectPart?.("headline"));
  headline?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    beginInlineTextEdit("headline");
  });

  subheading?.addEventListener("click", () => hooks.onSelectPart?.("subheading"));
  subheading?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    beginInlineTextEdit("subheading");
  });


  // Quill is the story's ONE editable document. The exact compositor remains
  // visible on the page and repaints from Quill on every keystroke; it must
  // never be hidden behind a temporary browser-flow rectangle, because CSS
  // cannot reproduce the compositor's columns, paragraph balancing or image
  // runaround. That temporary surface is why the story looked different until
  // the desk clicked outside. Headline/deck stay safe as semantic overlays:
  // each is one short flow; the body is not.
  const activateBodyEditor = () => {
    finishInlineTextEdit();
    hooks.onSelectPart?.("body");
    const writing = document.getElementById("edWritingSurface");
    writing?.classList.add("is-body-target");
    writing?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    requestAnimationFrame(() => {
      if (!quill) return;
      quill.focus();
      if (!quill.getSelection()) {
        quill.setSelection(Math.max(0, quill.getLength() - 1), 0, "silent");
      }
    });
  };

  body?.addEventListener("click", () => hooks.onSelectPart?.("body"));
  body?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    activateBodyEditor();
  });

  const page = document.getElementById("edFramePage");

  // Canonical poured runs can receive the pointer instead of the transparent
  // body hit frame. Use the body's actual geometry as the authority so a
  // double-click anywhere in the body area reliably activates editing.
  page?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".pic-frame")) return;

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
    activateBodyEditor();
  }, true);

  page?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) hooks.onSelectPart?.("block");
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
      ${handles}
    </figure>`;
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
  if (target.closest(".ed-quill-size-btn")) return "size";
  return target.closest(".ed-quill-ink-btn") ? "ink" : null;
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
    holdSelection(event);
  }, true);

  document.addEventListener("click", (event) => {
    const field = activeDisplayField();
    if (!field) return;
    if (!inToolbar(event.target)) return;
    const action = toolbarActionOf(event.target);
    if (!action) return;

    event.preventDefault();
    event.stopPropagation();

    const value = action === "ink"
      ? event.target.closest(".ed-quill-ink-btn")?.dataset.ink
      : event.target.closest(".ed-quill-size-btn")?.dataset.size;
    if (applyDisplayMark(action, value)) {
      // Straight down the ordinary field path - the same "input" event a
      // keystroke in the field raises, so the draft, the counters and the
      // canvas all update through one route rather than through a second one
      // invented for the toolbar.
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
}

export async function mountFrame(section, view, images, callbacks, selectedPart = "block", selectedImageIds = []) {
  hooks = callbacks || {};
  state = { section, view, images: images || [], selectedIds: new Set(selectedImageIds), selectedPart };

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
  // Plain buttons, not Quill's Picker (see the toolbar markup's own note
  // above for why) - one delegated click handler. `quill.getSelection(true)`
  // asks Quill to focus and hand back a range: a plain button click moves
  // DOM focus off the editor exactly like the Bold button's click does, and
  // Quill's own internal `lastRange` tracking (the same mechanism that keeps
  // Bold working after that focus loss) is what makes this still apply to
  // the text that was actually selected.
  bindMarksToolbar();
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
  document.getElementById("edQuillSize")?.addEventListener("click", (event) => {
    const button = event.target.closest(".ed-quill-size-btn");
    if (!button || !quill) return;
    const range = quill.getSelection(true);
    if (!range) return;
    // format() fires "text-change" synchronously (source "user"), which the
    // listener above already turns into a copyFromFrame() patch - no extra
    // re-patch needed now that copyFromFrame() reads the Delta directly (see
    // quillDeltaToCanonicalHtml()) rather than a DOM serialization that could
    // still be mid-restructure when a size lands on an already-bold range.
    quill.format("size", button.dataset.size, "user");
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
  state = {
    ...state,
    section,
    view,
    images: images || [],
    selectedPart: selectedPart ?? state.selectedPart,
    selectedIds: selectedImageIds ? new Set(selectedImageIds) : state.selectedIds,
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
