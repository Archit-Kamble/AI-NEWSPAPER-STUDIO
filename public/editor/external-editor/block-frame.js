// The block, as a page of frames.
//
// This replaces two days of trying to make a browser flow copy around a
// photograph placed in the middle of a column. It cannot: CSS wraps text around
// a FLOAT, and a float can only touch the left or right edge of its column. No
// editor library changes that - Quill, TipTap and CKEditor all draw through the
// same engine. So the picture could never go where the desk put it.
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
// processor rather than a hand-rolled contenteditable.

import { sanitise } from "../layout/rich-text.js";
import { buildFlowMap } from "../layout/text-flow.js";
import { placedPictureStyle } from "../layout/picture-style.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
// The same functions the page canvas draws a headline and a deck with - so
// the WYSIWYG frame and the newspaper page can never drift onto two
// different renderings of the same block, the way the headline/subheading
// inputs and the canvas once did.
import { headlineMarkup, subheadingMarkup } from "../canvas/section-thumb.js";

let quill = null;
let hooks = {};
// selectedId is which PICTURE is selected (unrelated to selectedPart="image" -
// that says WHICH KIND of object is targeted; selectedId says which one when
// there's more than one on the block). Both come from the one store
// (store.js's selectedPart/selectedImageId) via workspace.js - block-frame.js
// itself never decides selection, only draws it.
let state = { section: null, view: null, images: [], selectedId: null, selectedPart: "block" };

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
        <!-- The headline and deck are drawn here, in the block's own type, at
             the page's scale - not a separate generic input elsewhere that
             happens to hold the same words. Clicking either focuses the real
             input (below the page), which is still where the typing and the
             character-limit counters live - see story-editor.js. -->
        <div class="frame frame-headline" id="edHeadlineFrame" tabindex="-1" title="Click to edit the headline"></div>
        <div class="frame frame-subheading" id="edSubheadingFrame" tabindex="-1" title="Click to edit the subheading"></div>
        <div class="frame-pictures" id="edFramePictures"></div>
        <div class="frame frame-body" id="edBodyFrame">
          <!-- A block holding a Smart Card draws the CARD here, not its copy.
               The card is a grid or a table of twelve signs; typing into it as
               prose is not an edit anybody wants, and showing the desk the
               flattened text while the page shows squares is the exact
               mismatch this whole change exists to remove. Quill stays mounted
               underneath - the moment the card is removed the block is an
               ordinary block again. -->
          <div class="frame-card" id="edFrameCard" hidden></div>
          <div id="edQuill"></div>
        </div>
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
  const host = document.getElementById("edFrameCard");
  const quill = document.getElementById("edQuill");
  if (!host) return false;

  const markup = smartCardMarkup(state.view?.smartCardKey, state.view?.smartCardData);
  host.hidden = !markup;
  host.innerHTML = markup || "";
  if (quill) quill.hidden = Boolean(markup);
  return Boolean(markup);
}

// Headline, deck and body positioned from ONE buildFlowMap() call - the same
// map the page canvas measures a picture's runaround with and the AI brief is
// built from, so "how tall is the headline" has one answer everywhere it is
// asked. The body frame used to compute this map on its own; the headline and
// subheading frames now share that same computation rather than repeating it.
function layoutTextFrames() {
  const page = document.getElementById("edFramePage");
  const headlineFrame = document.getElementById("edHeadlineFrame");
  const subheadingFrame = document.getElementById("edSubheadingFrame");
  const bodyFrame = document.getElementById("edBodyFrame");
  if (!page || !state.section || !state.view) return;

  const scale = pageScale();
  const margin = Number(state.view.marginPx) || 12;
  const map = buildFlowMap(state.section, state.view, []);
  const headlineHeight = map.headlineRows * map.cellHeight;
  const subheadingHeight = map.subheadingRows * map.cellHeight;

  // The font size baked into headlineMarkup()/subheadingMarkup() is the
  // block's real, unscaled size (the same number the canvas sets) - scaled
  // down here, once, for the page's own on-screen size, exactly as the body
  // editor already scales bodyFontPx below.
  const scaledView = (fontField) => ({ ...state.view, [fontField]: (Number(state.view[fontField]) || 0) / scale });

  if (headlineFrame) {
    headlineFrame.style.left = `${margin / scale}px`;
    headlineFrame.style.right = `${margin / scale}px`;
    headlineFrame.style.top = `${margin / scale}px`;
    headlineFrame.style.height = `${headlineHeight / scale}px`;
    headlineFrame.style.display = state.view.headline ? "" : "none";
    headlineFrame.innerHTML = headlineMarkup(scaledView("headlineFontPx"));
    headlineFrame.classList.toggle("frame-selected", state.selectedPart === "headline");
  }

  if (subheadingFrame) {
    const top = margin + headlineHeight;
    subheadingFrame.style.left = `${margin / scale}px`;
    subheadingFrame.style.right = `${margin / scale}px`;
    subheadingFrame.style.top = `${top / scale}px`;
    subheadingFrame.style.height = `${subheadingHeight / scale}px`;
    subheadingFrame.style.display = state.view.subheading ? "" : "none";
    subheadingFrame.classList.toggle("frame-selected", state.selectedPart === "subheading");
    subheadingFrame.innerHTML = subheadingMarkup(scaledView("subheadingFontPx"));
  }

  if (bodyFrame) {
    const top = margin + headlineHeight + subheadingHeight;
    bodyFrame.style.left = `${margin / scale}px`;
    bodyFrame.style.right = `${margin / scale}px`;
    bodyFrame.style.top = `${top / scale}px`;
    bodyFrame.style.bottom = `${margin / scale}px`;
    bodyFrame.classList.toggle("frame-selected", state.selectedPart === "body");

    const editor = bodyFrame.querySelector(".ql-editor");
    if (editor) {
      editor.style.fontSize = `${(Number(state.view.bodyFontPx) || 10) / scale}px`;
      editor.style.lineHeight = String(Math.max(1.45, Number(state.view.lineHeight) || 1.45));
      editor.style.columnCount = String(Math.max(1, Number(state.view.columnCount) || 1));
      editor.style.textAlign = state.view.textAlign || "left";
      if (state.view.fontFamily) editor.style.fontFamily = state.view.fontFamily;
    }
  }
}

/**
 * Clicking the headline or deck frame selects that object AND focuses the
 * real input that types it - a click on the page is both "target this" and
 * "start editing this" at once, which is how direct manipulation is supposed
 * to feel; two separate clicks for the same object would not be.
 */
function bindTextFrames() {
  document.getElementById("edHeadlineFrame")?.addEventListener("click", () => {
    hooks.onSelectPart?.("headline");
    document.getElementById("edStoryHeadline")?.focus();
  });
  document.getElementById("edSubheadingFrame")?.addEventListener("click", () => {
    hooks.onSelectPart?.("subheading");
    document.getElementById("edStorySubheading")?.focus();
  });
}

// ---------------------------------------------------------- picture frames ---

function pictureMarkup(row) {
  return `
    <figure class="pic-frame" data-image-id="${row.id}" data-shape="${row.shape || "rect"}">
      <img src="${String(row.url || "")}" alt="" draggable="false">
      <button type="button" class="pic-remove" data-pic-remove aria-label="Take this picture off the block"></button>
      <span class="pic-handle" data-pic-size aria-hidden="true"></span>
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
    frame.classList.toggle("is-selected", row.id === state.selectedId);
  }

  host.querySelectorAll(".pic-frame").forEach((frame) => {
    if (!kept.has(frame.dataset.imageId)) frame.remove();
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
    state.selectedId = id;
    hooks.onSelectImage?.(id);
    hooks.onSelectPart?.("image", id);
    page.querySelectorAll(".pic-frame").forEach((f) => f.classList.toggle("is-selected", f === frame));

    const sizing = Boolean(event.target.closest("[data-pic-size]"));
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
        const width = Math.max(24, Math.min(bounds.width - from.left, from.width + dx));
        frame.style.width = `${Math.round(width)}px`;
        frame.style.height = `${Math.round(width * ratio)}px`;
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

export async function mountFrame(section, view, images, callbacks, selectedPart = "block") {
  hooks = callbacks || {};
  state = { section, view, images: images || [], selectedId: state.selectedId, selectedPart };

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
  renderPictures(state.images);
  bindPictureFrames();
  bindTextFrames();

  if (!window.__sahasFrameResize) {
    window.__sahasFrameResize = true;
    const relayout = () => {
      layoutPage();
      layoutTextFrames();
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
export function refreshFrame(section, view, images, source, selectedPart) {
  state = { ...state, section, view, images: images || [], selectedPart: selectedPart ?? state.selectedPart };
  layoutPage();
  layoutTextFrames();
  const showingCard = layoutCard();
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
  state.selectedId = id;
  renderPictures(state.images);
}
