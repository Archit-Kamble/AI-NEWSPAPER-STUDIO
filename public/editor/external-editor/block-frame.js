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

import { placedPictureStyle } from "../layout/picture-style.js";
import { resizeRect, RESIZE_HANDLES } from "../layout/image-resize.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
// The same functions the page canvas draws a headline, a deck and a flowed
// body with - so the WYSIWYG frame and the newspaper page can never drift
// onto two different renderings of the same block, the way the
// headline/subheading inputs and the canvas once did.
import { sectionContentMarkup, sectionComposition } from "../canvas/section-thumb.js";
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
// previewMode: has the desk asked to see the real flowed render instead of
// the plain Quill surface? Off by default on every mount - a picture that
// does not reach into the body needs no toggle at all (bindTextFrames()
// hides it), and one that does should not silently swap the desk's writing
// surface out from under them the moment they open the block.
let state = { section: null, view: null, images: [], selectedIds: new Set(), selectedPart: "block", previewMode: false };

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
  const hasCard = Boolean(smartCardMarkup(state.view?.smartCardKey, state.view?.smartCardData));
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
// canvas does. The body cannot: see renderFlowedPreview() below.
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
    editor.style.fontSize = `${Math.max(15, Number(state.view.bodyFontPx) || 10)}px`;
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
    selector: ".section-headline",
    inputId: "edStoryHeadline",
    frameId: "edHeadlineFrame",
    label: "Edit headline",
  },
  subheading: {
    selector: ".section-subheading",
    inputId: "edStorySubheading",
    frameId: "edSubheadingFrame",
    label: "Edit subheading",
  },
};

function finishInlineTextEdit({ cancel = false } = {}) {
  const edit = inlineTextEdit;
  if (!edit) return;

  inlineTextEdit = null;

  const { element, config } = edit;

  element?.classList.remove("is-inline-editing", "is-semantic-text-editor");
  if (element) element.style.pointerEvents = "";

  if (!element?.isConnected) return;

  const value = String(element.textContent || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  element.removeAttribute("contenteditable");
  element.removeAttribute("role");
  element.removeAttribute("aria-label");
  element.textContent = "";

  if (cancel) {
    layoutTextFrames();
    return;
  }

  const input = document.getElementById(config.inputId);
  if (!input) {
    layoutTextFrames();
    return;
  }

  // Reuse the existing story-editor input event. This keeps one state,
  // counters and persistence path instead of inventing a second save path.
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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
function beginInlineTextEdit(part) {
  finishInlineTextEdit();

  const config = INLINE_TEXT[part];
  if (!config) return;

  hooks.onSelectPart?.(part);

  // Selection can refresh the canonical renderer and the frame's own
  // position, so resolve both after that update has completed.
  queueMicrotask(() => {
    const canonical = document.getElementById("edCanonicalContent");
    const frame = document.getElementById(config.frameId);
    if (!frame || !canonical) return;

    const source = part === "headline" ? String(state.view.headline || "") : String(state.view.subheading || "");

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
    frame.textContent = source;
    frame.setAttribute("contenteditable", "plaintext-only");
    frame.setAttribute("role", "textbox");
    frame.setAttribute("aria-label", config.label);

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
      if (event.key === "Enter") {
        event.preventDefault();
        frame.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishInlineTextEdit({ cancel: true });
      }
    });

    frame.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(frame);
    range.collapse(false);
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

  // A raw DOM `.focus()` on Quill's contenteditable root does not reliably
  // put a caret where a desk can type - Quill tracks its own selection
  // state, and focusing the element without going through its API left
  // clicks landing with no visible caret often enough to be the actual
  // complaint. `quill.focus()` (the real instance, declared at module scope
  // above) goes through Quill's own selection machinery instead, and sets an
  // explicit collapsed selection at the end of the text if there was none -
  // "double-click the body" should always land somewhere typeable, not just
  // somewhere scrolled-into-view.
  const activateBodyEditor = () => {
    hooks.onSelectPart?.("body");

    const writing = document.getElementById("edWritingSurface");
    writing?.classList.add("is-body-target");
    writing?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    requestAnimationFrame(() => {
      if (!quill) return;
      quill.focus();
      const selection = quill.getSelection();
      if (!selection) {
        const length = Math.max(0, quill.getLength() - 1);
        quill.setSelection(length, 0, "silent");
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

    frame.classList.add("is-dragging");

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;

      let screenRect;
      if (sizing) {
        // Read fresh on every move, not just at pointerdown - a desk holding
        // or releasing Shift mid-drag sees the aspect lock engage or let go
        // immediately, the way every page-layout tool's own handles do.
        screenRect = resizeRect(from, corner, dx, dy, { bounds, preserveAspect: moveEvent.shiftKey });
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
        previewImageRect(id, logicalRectFromScreen(screenRect, scale));
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
      hooks.onPatchImage?.(id, {
        x: Math.round((parseFloat(frame.style.left) || 0) * scale),
        y: Math.round((parseFloat(frame.style.top) || 0) * scale),
        width: Math.round(frame.offsetWidth * scale),
        height: Math.round(frame.offsetHeight * scale),
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
  if (!html || !html.includes("data-sahas-size")) return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll("[data-sahas-size]").forEach((el) => {
    const px = Number(el.getAttribute("data-sahas-size"));
    el.removeAttribute("data-sahas-size");
    if (Number.isFinite(px)) el.style.fontSize = `${px}px`;
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
