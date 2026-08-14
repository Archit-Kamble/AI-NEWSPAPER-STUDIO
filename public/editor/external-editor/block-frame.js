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
// real runaround live, so it does not try to fake it: the headline and deck
// frames position themselves clear of a picture exactly as the canvas does
// (bandBox(), text-flow.js), and the body frame shows the canvas's own,
// proven-correct flowed render (flowedBodyMarkup()) as an accurate, read-only
// "how this prints" strip above the plain writing surface, rather than
// silently letting a picture sit over text with no relationship to it at all.

import { sanitise } from "../layout/rich-text.js";
import { buildFlowMap, bandBox, CELL, flowImageFromRow } from "../layout/text-flow.js";
import { placedPictureStyle } from "../layout/picture-style.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
// The same functions the page canvas draws a headline, a deck and a flowed
// body with - so the WYSIWYG frame and the newspaper page can never drift
// onto two different renderings of the same block, the way the
// headline/subheading inputs and the canvas once did.
import { sectionContentMarkup } from "../canvas/section-thumb.js";
// The same six words the Typography panel's "Editing: X" label uses - one
// catalog for what a selected object is called, not two that could drift.
import { PART_LABEL } from "./typography-panel.js";

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
          <button class="ql-strike" type="button"></button>
        </span>
        <span class="ql-formats">
          <button class="ql-list" value="ordered" type="button"></button>
          <button class="ql-list" value="bullet" type="button"></button>
        </span>
        <span class="ql-formats">
          <button class="ql-link" type="button"></button>
          <button class="ql-blockquote" type="button"></button>
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
  const images = (state.images || []).map(flowImageFromRow);
  const renderSection = { ...state.section, images: state.images || [] };
  const map = buildFlowMap(renderSection, state.view, images);
  const measure = map.cols * map.cellWidth;
  const kickerHeight = map.kickerRows * map.cellHeight;
  const headlineHeight = map.headlineRows * map.cellHeight;
  const subheadingHeight = map.subheadingRows * map.cellHeight;
  const band = (kind, fallbackLeft) => bandBox(map, kind, margin, measure, fallbackLeft);

  // Render once at the section's TRUE logical dimensions, then zoom the whole
  // composition. This is the key parity rule: editor size changes can never
  // change line breaks, column flow or the amount of copy that fits.
  canonical.style.width = `${Number(state.section.width_px)}px`;
  canonical.style.height = `${Number(state.section.height_px)}px`;
  canonical.style.transform = `scale(${zoom})`;
  canonical.innerHTML = sectionContentMarkup(renderSection, state.view);

  // These frames are interaction/selection hit targets only; the words inside
  // them are rendered by the canonical layer above.
  if (headlineFrame) {
    const box = state.view.headline && headlineHeight > 0
      ? band(CELL.HEADLINE, margin)
      : { left: margin, width: measure };
    headlineFrame.style.left = `${box.left / scale}px`;
    headlineFrame.style.width = `${box.width / scale}px`;
    headlineFrame.style.right = "";
    headlineFrame.style.top = `${(margin + kickerHeight) / scale}px`;
    headlineFrame.style.height = `${headlineHeight / scale}px`;
    headlineFrame.style.display = state.view.headline ? "" : "none";
    headlineFrame.classList.toggle("frame-selected", state.selectedPart === "headline");
  }

  if (subheadingFrame) {
    const box = state.view.subheading && subheadingHeight > 0
      ? band(CELL.SUBHEADING, margin)
      : { left: margin, width: measure };
    subheadingFrame.style.left = `${box.left / scale}px`;
    subheadingFrame.style.width = `${box.width / scale}px`;
    subheadingFrame.style.right = "";
    subheadingFrame.style.top = `${(margin + kickerHeight + headlineHeight) / scale}px`;
    subheadingFrame.style.height = `${subheadingHeight / scale}px`;
    subheadingFrame.style.display = state.view.subheading ? "" : "none";
    subheadingFrame.classList.toggle("frame-selected", state.selectedPart === "subheading");
  }

  if (bodyFrame) {
    bodyFrame.style.left = `${margin / scale}px`;
    bodyFrame.style.right = `${margin / scale}px`;
    bodyFrame.style.top = `${(margin + kickerHeight + headlineHeight + subheadingHeight) / scale}px`;
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
    if (state.view.fontFamily) editor.style.fontFamily = state.view.fontFamily;
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
  const frame = document.getElementById(config.frameId);

  frame?.classList.remove("is-inline-editing");

  if (!element?.isConnected) return;

  const value = String(element.textContent || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  element.removeAttribute("contenteditable");
  element.removeAttribute("role");
  element.removeAttribute("aria-label");
  element.classList.remove("is-inline-text-editor");
  element.style.pointerEvents = "";

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

function beginInlineTextEdit(part) {
  finishInlineTextEdit();

  const config = INLINE_TEXT[part];
  if (!config) return;

  hooks.onSelectPart?.(part);

  // Selection can refresh the canonical renderer, so resolve its real text
  // node after the selection update has completed.
  queueMicrotask(() => {
    const canonical = document.getElementById("edCanonicalContent");
    const element = canonical?.querySelector(config.selector);
    const frame = document.getElementById(config.frameId);
    if (!element) return;

    inlineTextEdit = { element, config };

    frame?.classList.add("is-inline-editing");

    element.classList.add("is-inline-text-editor");
    element.setAttribute("contenteditable", "plaintext-only");
    element.setAttribute("role", "textbox");
    element.setAttribute("aria-label", config.label);
    element.style.pointerEvents = "auto";

    element.addEventListener(
      "blur",
      () => finishInlineTextEdit(),
      { once: true },
    );

    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        element.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        finishInlineTextEdit({ cancel: true });
      }
    });

    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
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

  body?.addEventListener("click", () => hooks.onSelectPart?.("body"));
  body?.addEventListener("dblclick", (event) => {
    event.preventDefault();
    hooks.onSelectPart?.("body");

    // The printed body is many absolutely-positioned poured runs. Making each
    // run contenteditable would create a second composition engine and destroy
    // canonical flow. Double-clicking the visible body therefore activates the
    // existing rich-text editing surface while leaving the canonical page
    // visible above as the authoritative result.
    const writing = document.getElementById("edWritingSurface");
    const editor = writing?.querySelector(".ql-editor");
    writing?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    queueMicrotask(() => editor?.focus());
  });

  document.getElementById("edFramePage")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) hooks.onSelectPart?.("block");
  });
}

// ---------------------------------------------------------- picture frames ---

// Four corners, at minimum, per Stage 2's own spec - a single bottom-right
// handle let a desk grow a picture but never shrink it from the top or left
// without also dragging it back into place afterwards.
const RESIZE_CORNERS = ["tl", "tr", "bl", "br"];

function pictureMarkup(row) {
  const handles = RESIZE_CORNERS.map(
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

// Resizing from one of the four corners keeps the OPPOSITE corner still, the
// way every page-layout tool does it - drag the top-left in and the picture's
// bottom-right edge does not move. Aspect ratio is preserved by default (the
// spec's own instruction), so only width is dragged directly; height follows
// it, and left/top are re-derived from whichever corner is the anchor.
function resizeFromCorner(corner, from, ratio, bounds, dx) {
  const minSize = 24;
  const growsRight = corner === "tr" || corner === "br";
  // The anchor edge that must not cross page 0, expressed as a max WIDTH
  // (height follows width via ratio, so a height limit becomes a width limit
  // too) - only relevant on corners whose anchor is the far edge from that
  // side. Corners that anchor the near edge (br's top-left, tr's bottom-left
  // "left" side, etc.) already can't go negative because dx is clamped
  // against the room to the right instead.
  const maxWidthByLeft = corner === "tl" || corner === "bl" ? from.left + from.width : Infinity;
  const maxWidthByTop = corner === "tl" || corner === "tr" ? (from.top + from.height) / ratio : Infinity;
  const maxWidthByRight = growsRight ? bounds.width - from.left : Infinity;

  const requested = growsRight ? from.width + dx : from.width - dx;
  const width = Math.max(minSize, Math.min(requested, maxWidthByLeft, maxWidthByTop, maxWidthByRight));
  const height = width * ratio;

  return {
    width,
    height,
    left: corner === "tl" || corner === "bl" ? from.left + from.width - width : from.left,
    top: corner === "tl" || corner === "tr" ? from.top + from.height - height : from.top,
  };
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
    const corner = handle?.dataset.corner || "br";
    const scale = pageScale();
    const start = { x: event.clientX, y: event.clientY };
    const from = {
      left: parseFloat(frame.style.left) || 0,
      top: parseFloat(frame.style.top) || 0,
      width: frame.offsetWidth,
      height: frame.offsetHeight,
    };
    const ratio = from.height / Math.max(1, from.width);
    const bounds = page.getBoundingClientRect();

    frame.classList.add("is-dragging");

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;

      if (sizing) {
        const next = resizeFromCorner(corner, from, ratio, bounds, dx);
        frame.style.width = `${Math.round(next.width)}px`;
        frame.style.height = `${Math.round(next.height)}px`;
        frame.style.left = `${Math.round(next.left)}px`;
        frame.style.top = `${Math.round(next.top)}px`;
        return;
      }
      // Kept on the page: a frame dragged off the block would print off the
      // page, and the character grid would count cells that do not exist.
      frame.style.left = `${Math.round(Math.max(0, Math.min(bounds.width - from.width, from.left + dx)))}px`;
      frame.style.top = `${Math.round(Math.max(0, Math.min(bounds.height - from.height, from.top + dy)))}px`;
    };

    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      frame.classList.remove("is-dragging");
      hooks.onPatchImage?.(id, {
        x: Math.round((parseFloat(frame.style.left) || 0) * scale),
        y: Math.round((parseFloat(frame.style.top) || 0) * scale),
        width: Math.round(frame.offsetWidth * scale),
        height: Math.round(frame.offsetHeight * scale),
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  });

  page.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-pic-remove]");
    if (!remove) return;
    event.preventDefault();
    hooks.onRemoveImage?.(Number(remove.closest(".pic-frame").dataset.imageId));
  });
}

// ------------------------------------------------------------------- copy ---

/** The story as it is stored: Quill's HTML, reduced to marks a printer can set. */
export function copyFromFrame() {
  if (!quill) return "";
  const html = quill.root.innerHTML;
  // Quill writes an empty document as "<p><br></p>". Storing that would make an
  // empty block look written, and every count would be off by one line.
  return /^<p>(<br\s*\/?>)?<\/p>$/i.test(html.trim()) ? "" : sanitise(html);
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

  quill = new Quill(host, {
    theme: "snow",
    placeholder: "बातमी येथे लिहा — write the story here.",
    modules: {
      // The marks a printer can actually set, and nothing else - the buttons
      // are written above, so colour, size and font are simply not offered.
      // Those are the BLOCK's, decided by the layout: a newspaper is one paper,
      // not a scrapbook (rich-text.js).
      toolbar: { container: "#edQuillToolbar" },
      history: { delay: 600, maxStack: 200, userOnly: true },
    },
  });

  quill.clipboard.dangerouslyPasteHTML(view.body || "", "silent");
  quill.on("text-change", (delta, old, source) => {
    if (source !== "user") return;
    hooks.onPatch?.({ body: copyFromFrame() }, "block-frame");
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
  if (copyFromFrame() !== wanted) quill.clipboard.dangerouslyPasteHTML(wanted, "silent");
}

export function selectPictureFrame(id) {
  state.selectedIds = new Set([id]);
  renderPictures(state.images);
}
