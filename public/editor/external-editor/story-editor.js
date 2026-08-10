// The only rich-text writing surface for a story.  It deliberately keeps word
// formatting separate from block typography: font size and columns belong to
// the newspaper layout, while bold, italic and lists belong to the copy.
//
// It is also the only place the story is written. The Inspector used to carry a
// second headline, subheading and body bound to the same draft; what that form
// did that this one did not - the editorial length limits, and the words and
// reading-time read-outs - was moved here before it was deleted.

import { sanitise, plainText, fromPlainText } from "../layout/rich-text.js";
import { buildFlowMap } from "../layout/text-flow.js";
import { FONT_FAMILIES, ALIGNMENTS } from "./typography-panel.js";

// The editorial limits, not the storage limits.
//
// A headline over about 90 characters cannot be set at headline size in a
// column and stay a headline; the input still ACCEPTS more, because a
// sub-editor writing long and cutting back is normal, but the count turns and
// says so. These came from the Inspector's form and are the desk's rules.
const HEADLINE_LIMIT = 90;
const SUBHEADING_LIMIT = 140;

// A reading speed for Devanagari prose. Only ever shown as a rounded minute:
// it is a sense of scale for the desk, never a measurement.
const WORDS_PER_MINUTE = 200;

// Sizes a desk actually sets body copy in, in editor px (2px per mm). The
// block's own derived size is added when it is not one of these, so opening a
// story never silently changes its type.
const BODY_SIZES = [7, 8, 8.5, 9, 9.5, 10, 11, 12, 13, 14, 16, 18, 20, 24];

const TOOLS = [
  { command: "undo", label: "↶", title: "Undo (Ctrl+Z)" },
  { command: "redo", label: "↷", title: "Redo (Ctrl+Shift+Z)" },
  { separator: true },
  { command: "bold", label: "B", title: "Bold (Ctrl+B)", className: "rt-bold" },
  { command: "italic", label: "I", title: "Italic (Ctrl+I)", className: "rt-italic" },
  { command: "underline", label: "U", title: "Underline (Ctrl+U)", className: "rt-underline" },
  { command: "strikeThrough", label: "S", title: "Strikethrough", className: "rt-strike" },
  { action: "highlight", label: "A", title: "Highlight — a note to the desk. Does not print.", className: "rt-highlight" },
  { separator: true },
  { command: "insertUnorderedList", label: "•", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1.", title: "Numbered list" },
  { separator: true },
  { action: "link", label: "🔗", title: "Link — live in the e-paper, plain on paper" },
  { command: "removeFormat", label: "Clear", title: "Clear formatting" },
];

let budgetOf = null;
let patchBlock = null;
let escapeBound = false;
let savedRange = null;
// Everything the picture layer needs to turn a drag on this sheet into a
// placement on the block. Set by bindStoryEditor.
let picture = {};

const escapeAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toolMarkup(tool) {
  if (tool.separator) return '<span class="rt-sep"></span>';
  const key = tool.command ? `data-command="${tool.command}"` : `data-action="${tool.action}"`;
  return `<button type="button" class="rt-btn ${tool.className || ""}" ${key}
      title="${escapeAttribute(tool.title)}">${tool.label}</button>`;
}

function options(list, current) {
  return list
    .map((o) => `<option value="${escapeAttribute(o.value)}"${String(current) === String(o.value) ? " selected" : ""}>${escapeAttribute(o.label)}</option>`)
    .join("");
}

function sizeOptions(current) {
  const value = Number(current) || 0;
  const sizes = BODY_SIZES.includes(value) || !value ? BODY_SIZES : [...BODY_SIZES, value].sort((a, b) => a - b);
  return sizes.map((size) => `<option value="${size}"${size === value ? " selected" : ""}>${size} px</option>`).join("");
}

/**
 * The alignment icons, drawn rather than typed.
 *
 * There is no glyph for "flush right" that a font renders differently from
 * "flush left", so left and right came out as the same mark and the desk had
 * two identical buttons to guess between.
 */
function alignIcon(align) {
  const widths = { left: [13, 8, 11, 6], center: [13, 9, 11, 7], right: [13, 8, 11, 6], justify: [13, 13, 13, 13] }[align];
  const bars = widths.map((width, row) => {
    const x = align === "right" ? 14 - width : align === "center" ? (14 - width) / 2 : 1;
    return `<rect x="${x}" y="${2 + row * 3}" width="${width}" height="1.6" rx="0.6"/>`;
  }).join("");
  return `<svg viewBox="0 0 16 14" width="15" height="13" aria-hidden="true" fill="currentColor">${bars}</svg>`;
}

/**
 * The one editor for a block: its words and its pictures.
 *
 * `tools` and `pictures` are handed in by the External Editor rather than built
 * here - the picture markup belongs beside the code that binds it - but they
 * render INSIDE this sheet. There is no second surface: a story's words and its
 * pictures are one thing, because the copy has to run around the picture.
 */
export function storyEditorMarkup(view, { budget = 0, tools = "", pictures = "" } = {}) {
  const used = plainText(view.body).length;
  return `
    <article class="story-editor" id="storyEditor" aria-label="Story editor">
      <header class="story-editor-ribbon">
        <div class="story-editor-ribbon-title">
          <span>Writing</span><small>Changes save automatically</small>
        </div>
        <div class="story-editor-toolbar" id="edStoryToolbar" role="toolbar" aria-label="Text formatting">
          <!-- Row one sets the BLOCK's type; row two marks the SELECTED WORDS.
               A newspaper does not let one paragraph pick its own face, so font,
               size and alignment are the whole block's and write the same
               fields the Typography panel writes, from the same catalog. -->
          <div class="rt-row rt-row-type">
            <select class="rt-select rt-select-font" id="edStoryFont" title="Font for the whole block">
              ${options(FONT_FAMILIES, view.fontFamily || "")}
            </select>
            <select class="rt-select rt-select-size" id="edStorySize" title="Body size for the whole block">
              ${sizeOptions(view.bodyFontPx)}
            </select>
            <span class="rt-sep"></span>
            ${ALIGNMENTS.map((a) => `<button type="button" class="rt-btn rt-align${String(view.textAlign) === a.value ? " active" : ""}"
                data-align="${a.value}" aria-label="Align ${a.label.toLowerCase()}"
                title="Align ${a.label.toLowerCase()} — whole block">${alignIcon(a.value)}</button>`).join("")}
            <span class="rt-block-note">whole block</span>
          </div>
          <div class="rt-row rt-row-marks">
            ${TOOLS.map(toolMarkup).join("")}
            ${tools ? `<span class="rt-sep"></span>${tools}` : ""}
            <span class="rt-spacer"></span>
            <button type="button" class="rt-btn rt-source" data-action="source" title="Edit stored markup">&lt;/&gt;</button>
            <button type="button" class="rt-btn" data-action="fullscreen" title="Focus writing (Esc to exit)">⤢</button>
          </div>
        </div>
      </header>

      <div class="rt-linkbar" id="edStoryLinkbar" hidden>
        <label for="edStoryLinkUrl">Link the selected words to</label>
        <input type="url" id="edStoryLinkUrl" placeholder="https://…">
        <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edStoryLinkApply">Link</button>
        <button type="button" class="ext-editor-btn" id="edStoryLinkClear">Remove link</button>
        <button type="button" class="ext-editor-btn" id="edStoryLinkCancel">Cancel</button>
      </div>

      <div class="story-editor-paper" id="edStoryPaper">
        <label class="story-field-label" for="edStoryHeadline">
          Headline
          <span class="field-counter" id="edStoryHeadlineCounter">${plainText(view.headline).length}/${HEADLINE_LIMIT}</span>
        </label>
        <input id="edStoryHeadline" class="story-headline-input" maxlength="200"
          placeholder="मथळा — the headline as it will print" value="${escapeAttribute(plainText(view.headline))}">
        <label class="story-field-label" for="edStorySubheading">
          Subheading
          <span class="field-counter" id="edStorySubheadingCounter">${plainText(view.subheading).length}/${SUBHEADING_LIMIT}</span>
        </label>
        <input id="edStorySubheading" class="story-subheading-input" maxlength="300"
          placeholder="उपमथळा — the subheading, if the story has one" value="${escapeAttribute(plainText(view.subheading))}">
        <div class="story-editor-body" id="edStoryBody" contenteditable="true" spellcheck="true"
          role="textbox" aria-multiline="true" data-placeholder="बातमी येथे लिहा — write the story here.">${fromPlainText(view.body || "")}</div>
        <textarea class="story-editor-source" id="edStorySource" spellcheck="false" hidden
          aria-label="Stored article markup"></textarea>
      </div>

      <footer class="story-editor-foot">
        <span class="rt-count" id="edStoryCount">${used}${budget ? ` of ${budget} characters` : " characters"}</span>
        <span class="rt-foot-note">Formatting is preserved; layout type stays consistent across the page.</span>
      </footer>

      <div class="stat-grid" id="edStoryStats">${statsMarkup(view)}</div>

      ${pictures ? `<section class="story-block">${pictures}</section>` : ""}
    </article>`;
}

// ------------------------------------------------------- pictures, in the copy ---
//
// A photograph belongs IN the story, not in a panel beside it. It sits in this
// sheet, floated, with the copy running around it, and you drag it the way you
// drag a picture in a word processor.
//
// What it is NOT is part of the text. The story is stored as plain marked-up
// copy - markup is presentation, text is content (rich-text.js) - and a picture
// is layout, held in `section_images` with a real position and size in block
// pixels. So the figures live in this sheet's DOM and are stripped back out
// before a single character is stored or counted. Drag one and what changes is
// its PLACEMENT, which is what the character grid, the press file and Scribus
// all read.

/** The block behind this sheet: its grid, and how sheet pixels map to it. */
function blockGeometry() {
  const section = picture.getSection?.();
  const view = picture.getView?.();
  const body = document.getElementById("edStoryBody");
  if (!section || !view || !body) return null;

  const style = getComputedStyle(body);
  const sheetWidth = Math.max(
    1,
    body.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0),
  );
  const margin = Number(view.marginPx) || 12;
  const blockWidth = Math.max(1, Number(section.width_px) - margin * 2);

  return {
    section,
    view,
    margin,
    // The measure is the same measure: this sheet is the block's text column,
    // set wider so it can be read and typed into.
    scale: blockWidth / sheetWidth,
    sheetWidth,
    map: buildFlowMap(section, view, []),
  };
}

/** The first row of body copy, in block pixels. */
function copyTop(geometry) {
  const { map, margin } = geometry;
  return margin + (map.headlineRows + map.subheadingRows) * map.cellHeight;
}

/** The story as it is stored: the words, with the pictures taken out. */
function copyOf(body) {
  const clone = body.cloneNode(true);
  clone.querySelectorAll(".story-picture").forEach((figure) => figure.remove());
  return sanitise(clone.innerHTML);
}

/**
 * Puts a picture back where its placement says it belongs.
 *
 * Its `y` is a row on the character grid, so the number of characters above it
 * is `row × columns` - which is the point in the copy the picture is anchored
 * to. No new column is needed to remember it; the placement already says.
 */
function anchor(body, figure, row, geometry) {
  const lines = Math.max(0, Math.round((Number(row.y_px) - copyTop(geometry)) / (geometry.map.cellHeight || 1)));
  const wanted = lines * (geometry.map.cols || 1);

  let seen = 0;
  for (const node of [...body.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("story-picture")) continue;
    const length = (node.textContent || "").length;
    if (seen + length >= wanted) return body.insertBefore(figure, node);
    seen += length;
  }
  body.appendChild(figure);
}

/** What this figure now says its placement is, in block pixels. */
function placementOf(body, figure, geometry) {
  const width = Math.round(figure.offsetWidth * geometry.scale);
  const height = Math.round(figure.offsetHeight * geometry.scale);
  const x = figure.dataset.side === "right"
    ? Math.max(0, Number(geometry.section.width_px) - geometry.margin - width)
    : geometry.margin;

  let chars = 0;
  for (const node of body.childNodes) {
    if (node === figure) break;
    if (node.nodeType === Node.ELEMENT_NODE && node.classList?.contains("story-picture")) continue;
    chars += (node.textContent || "").length;
  }
  const lines = Math.floor(chars / (geometry.map.cols || 1));
  return { x, y: Math.round(copyTop(geometry) + lines * geometry.map.cellHeight), width, height };
}

function figureFor(row) {
  const figure = document.createElement("figure");
  figure.className = "story-picture";
  figure.contentEditable = "false";
  figure.dataset.imageId = row.id;
  // The × is drawn in CSS, not typed: anything with text in it here would be
  // counted as characters of the story.
  figure.innerHTML = `
    <img src="${escapeAttribute(row.url)}" alt="" draggable="false">
    <button type="button" class="story-picture-remove" data-picture-remove aria-label="Take this picture off the block"></button>
    <span class="story-picture-size" data-picture-size aria-hidden="true"></span>`;
  return figure;
}

/**
 * Everything about a picture that is not its box: which file it is now, which
 * way up it is, and what the copy runs around.
 *
 * All three were being ignored, so the sheet showed a stale picture the right
 * way up in a box that had been turned. Taking the background out replaces the
 * photograph with a NEW file - that is how the original survives - and the
 * sheet went on drawing the old one, which is why the button looked dead.
 */
function paintFigure(figure, row) {
  const image = figure.querySelector("img");
  if (!image) return;

  // The cut-out is a different file from the photograph it came from.
  const url = String(row.url || "");
  if (image.getAttribute("src") !== url) image.setAttribute("src", url);

  // A photograph placed before the editor knew its proportions is stored in a
  // box of the wrong shape, and `contain` then letterboxes it - white bands
  // inside a frame bigger than the picture, which is what prints. Snap the box
  // to the picture, once, so the frame IS the picture.
  image.onload = () => {
    if (figure.dataset.fitted || !image.naturalWidth || !image.naturalHeight) return;
    figure.dataset.fitted = "yes";
    const natural = image.naturalWidth / image.naturalHeight;
    const stored = Number(row.width_px) / Math.max(1, Number(row.height_px));
    const turned = ((((Number(row.rotation) || 0) % 360) + 360) % 360) % 180 !== 0;
    const wanted = turned ? 1 / natural : natural;
    if (Math.abs(stored - wanted) / wanted > 0.02) {
      picture.onPatchImage?.(row.id, { height: Math.max(20, Math.round(Number(row.width_px) / wanted)) });
    }
  };

  const turn = (((Number(row.rotation) || 0) % 360) + 360) % 360;
  const quarter = turn % 180 !== 0;
  const width = figure.style.width;
  const height = figure.style.height;

  // A quarter turn swaps the box, so the picture inside it is set to the box's
  // other way round and then turned into place.
  image.style.width = quarter ? height : "100%";
  image.style.height = quarter ? width : "100%";
  image.style.transform = `translate(-50%, -50%) rotate(${turn}deg)`
    + (row.flip_h ? " scaleX(-1)" : "") + (row.flip_v ? " scaleY(-1)" : "");

  // A cut-out's own alpha is the shape the copy runs around - the same alpha
  // the character grid samples its mask from, so the screen and the page agree.
  figure.style.shapeOutside = row.shape === "cutout" ? `url("${url}")` : "";
}

/**
 * Gives the sheet the shape of the block it is writing.
 *
 * The writing area is the block's own text area, magnified: same proportions,
 * same number of columns, and the body set at the block's type times the same
 * magnification. So copy that fills this box is copy that fills the block, and
 * copy that runs past the bottom of it is copy that will not fit - visible
 * while it is being written rather than counted afterwards.
 *
 * The character count stays the authority. This is the shape of the hole; the
 * grid is the size of it.
 */
function shapeSheetToBlock(geometry) {
  const body = document.getElementById("edStoryBody");
  const paper = document.getElementById("edStoryPaper");
  if (!body || !paper || !geometry) return;

  const { section, view, scale } = geometry;

  // The sheet IS the block: the three fields together have the block's
  // proportions, set larger so it can be read and typed into, and each field
  // takes the share of it the character grid says it takes on the page.
  //
  // The labels and counters are chrome - they are not part of the block - so
  // their height is added on top rather than taken out of the fields. Setting
  // the paper to the block's aspect ratio and leaving them inside it was what
  // squeezed the body of a big-headline block down to a strip.
  const rowsFor = (rows) => Math.max(28, Math.round((rows * geometry.map.cellHeight) / scale));
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  const headlineHeight = rowsFor(Math.max(1, geometry.map.headlineRows));
  const subheadingHeight = rowsFor(Math.max(1, geometry.map.subheadingRows));
  if (headline) headline.style.height = `${headlineHeight}px`;
  if (subheading) subheading.style.height = `${subheadingHeight}px`;

  const style = getComputedStyle(paper);
  const chrome = [...paper.querySelectorAll(".story-field-label")]
    .reduce((total, label) => total + label.offsetHeight, 0)
    + (parseFloat(style.rowGap) || 0) * 4
    + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);

  const blockHeight = Math.max(0, Number(section.height_px) - geometry.margin * 2);
  paper.style.aspectRatio = "auto";
  paper.style.height = `${Math.round(blockHeight / scale + chrome)}px`;

  // The body takes what is left of the block, and is set in the block's own
  // type at the same magnification - so copy that fills this box is copy that
  // fills the block, and copy past the bottom is copy that will not fit.
  body.style.flex = "1";
  body.style.minHeight = "0";
  body.style.overflowY = "auto";
  body.style.fontSize = `${(Number(view.bodyFontPx) || 10) / scale}px`;
  body.style.lineHeight = String(Math.max(1.45, Number(view.lineHeight) || 1.45));
  body.style.columnCount = String(Math.max(1, Number(view.columnCount) || 1));
  body.style.columnGap = `${Math.round(14 / scale)}px`;
  body.style.textAlign = view.textAlign || "left";
  if (view.fontFamily) body.style.fontFamily = view.fontFamily;
}

/** Draws every picture on the block into the sheet, and takes away the rest. */
export function refreshStoryPictures() {
  const body = document.getElementById("edStoryBody");
  const geometry = blockGeometry();
  if (!body || !geometry) return;

  shapeSheetToBlock(geometry);

  const images = picture.getImages?.() || [];
  const kept = new Set();

  for (const row of images) {
    kept.add(String(row.id));
    let figure = body.querySelector(`.story-picture[data-image-id="${row.id}"]`);
    if (!figure) {
      figure = figureFor(row);
      anchor(body, figure, row, geometry);
    }
    const centre = Number(row.x_px) + Number(row.width_px) / 2;
    figure.dataset.side = centre > Number(geometry.section.width_px) / 2 ? "right" : "left";
    figure.dataset.shape = row.shape || "rect";
    if (!figure.classList.contains("is-dragging")) {
      figure.style.width = `${Math.round(Number(row.width_px) / geometry.scale)}px`;
      figure.style.height = `${Math.round(Number(row.height_px) / geometry.scale)}px`;
    }
    paintFigure(figure, row);
  }

  body.querySelectorAll(".story-picture").forEach((figure) => {
    if (!kept.has(figure.dataset.imageId)) figure.remove();
  });
}

/**
 * Dragging and sizing, on the sheet.
 *
 * Sideways decides which side of the column the picture floats on; up and down
 * moves it through the copy, so it re-anchors between paragraphs as it passes
 * them. The corner sizes it, keeping its proportions - a photograph stretched
 * out of shape is a printing error, not a design.
 */
function bindStoryPictures(body) {
  body.addEventListener("pointerdown", (event) => {
    const figure = event.target.closest?.(".story-picture");
    if (!figure) {
      body.querySelectorAll(".story-picture.is-selected").forEach((f) => f.classList.remove("is-selected"));
      return;
    }
    if (event.target.closest("[data-picture-remove]")) return;

    event.preventDefault();
    body.querySelectorAll(".story-picture.is-selected").forEach((f) => f.classList.remove("is-selected"));
    figure.classList.add("is-selected");
    picture.onSelectImage?.(Number(figure.dataset.imageId));

    const geometry = blockGeometry();
    if (!geometry) return;

    const sizing = Boolean(event.target.closest("[data-picture-size]"));
    const startX = event.clientX;
    const startWidth = figure.offsetWidth;
    const ratio = figure.offsetHeight / Math.max(1, figure.offsetWidth);

    figure.classList.add("is-dragging");
    // So the pointer reads what is UNDER the picture and the copy can be
    // re-anchored as it passes.
    if (!sizing) figure.style.pointerEvents = "none";

    const move = (moveEvent) => {
      if (sizing) {
        const width = Math.min(geometry.sheetWidth, Math.max(48, startWidth + (moveEvent.clientX - startX)));
        figure.style.width = `${Math.round(width)}px`;
        figure.style.height = `${Math.round(width * ratio)}px`;
        return;
      }

      const middle = body.getBoundingClientRect().left + body.clientWidth / 2;
      figure.dataset.side = moveEvent.clientX > middle ? "right" : "left";

      const under = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const sibling = [...body.childNodes].find(
        (node) => node.nodeType === Node.ELEMENT_NODE && node !== figure && node.contains(under),
      );
      if (sibling) {
        const box = sibling.getBoundingClientRect();
        body.insertBefore(figure, moveEvent.clientY < box.top + box.height / 2 ? sibling : sibling.nextSibling);
      }
    };

    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      figure.classList.remove("is-dragging");
      figure.style.pointerEvents = "";
      picture.onPatchImage?.(Number(figure.dataset.imageId), placementOf(body, figure, geometry));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  });

  body.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-picture-remove]");
    if (!remove) return;
    event.preventDefault();
    picture.onRemoveImage?.(Number(remove.closest(".story-picture").dataset.imageId));
  });
}

/**
 * Words, characters and reading time.
 *
 * Three different questions a desk asks about the same copy: is it long enough
 * to be a story, will it fit the hole, and how long does it take to read.
 * Counted on the PLAIN text - `<b>` is not a word - so the numbers say the same
 * thing as the character grid.
 */
function storyStats(view) {
  const text = plainText(view.body);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    words,
    characters: text.length,
    readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
  };
}

function statsMarkup(view) {
  const stats = storyStats(view);
  return `
    <div class="stat"><span>${stats.words}</span><small>words</small></div>
    <div class="stat"><span>${stats.characters}</span><small>characters</small></div>
    <div class="stat"><span>${stats.readingMinutes || "—"}</span><small>min read</small></div>`;
}

/** The editorial length read-outs beside the headline and the subheading. */
function refreshFieldCounters(view) {
  const set = (id, value, limit) => {
    const counter = document.getElementById(id);
    if (!counter) return;
    const length = plainText(value).length;
    counter.textContent = `${length}/${limit}`;
    counter.classList.toggle("over", length > limit);
  };
  set("edStoryHeadlineCounter", view.headline, HEADLINE_LIMIT);
  set("edStorySubheadingCounter", view.subheading, SUBHEADING_LIMIT);
}

export function refreshStoryCount() {
  const body = document.getElementById("edStoryBody");
  const readout = document.getElementById("edStoryCount");
  if (!body || !readout) return;

  // The copy, without the pictures standing in it: a photograph is not
  // characters, and counting the figure markup as text would say a story is
  // hundreds of characters longer than it is.
  const used = plainText(copyOf(body)).length;
  const budget = budgetOf ? budgetOf() : 0;
  const over = budget ? used - budget : 0;
  readout.textContent = budget
    ? over > 0 ? `${used} of ${budget} — ${over} too many` : `${used} of ${budget} characters`
    : `${used} characters`;
  readout.classList.toggle("over", over > 0);
}

export function bindStoryEditor({ onPatch, getBudget, ...pictures }) {
  budgetOf = getBudget;
  patchBlock = onPatch;
  picture = pictures;
  const body = document.getElementById("edStoryBody");
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  const toolbar = document.getElementById("edStoryToolbar");
  if (!body) return;

  const pushBody = () => {
    const copy = copyOf(body);
    onPatch?.({ body: copy }, "story-editor");
    refreshStoryCount();
    refreshStoryStats({ body: copy });
  };

  body.addEventListener("input", pushBody);
  body.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";
    const clean = html ? sanitise(html) : escapeAttribute(text).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, clean);
    pushBody();
  });

  headline?.addEventListener("input", () => {
    onPatch?.({ headline: headline.value }, "story-editor");
    refreshFieldCounters({ headline: headline.value, subheading: subheading?.value });
  });
  subheading?.addEventListener("input", () => {
    onPatch?.({ subheading: subheading.value }, "story-editor");
    refreshFieldCounters({ headline: headline?.value, subheading: subheading.value });
  });

  // The block's own type. Same fields the Typography panel writes.
  document.getElementById("edStoryFont")?.addEventListener("change", (event) =>
    onPatch?.({ fontFamily: event.target.value }, "story-toolbar"));
  document.getElementById("edStorySize")?.addEventListener("change", (event) =>
    onPatch?.({ bodyFontPx: Number(event.target.value) }, "story-toolbar"));

  toolbar?.addEventListener("click", (event) => {
    const align = event.target.closest("[data-align]");
    if (align) {
      event.preventDefault();
      onPatch?.({ textAlign: align.dataset.align }, "story-toolbar");
      toolbar.querySelectorAll("[data-align]").forEach((b) => b.classList.toggle("active", b === align));
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) {
      event.preventDefault();
      if (action === "fullscreen") return toggleFullscreen();
      if (action === "source") return toggleSource(body, pushBody);
      if (action === "highlight") { body.focus(); toggleHighlight(); return pushBody(); }
      if (action === "link") return openLinkbar();
    }
    const button = event.target.closest("[data-command]");
    if (!button) return;
    event.preventDefault();
    body.focus();
    document.execCommand(button.dataset.command, false, null);
    pushBody();
    syncToolbar();
  });

  bindLinkbar(body, pushBody);
  bindStoryPictures(body);
  refreshStoryPictures();

  ["keyup", "mouseup", "focus"].forEach((type) => body.addEventListener(type, syncToolbar));
  if (!escapeBound) {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleFullscreen(false);
    });
    escapeBound = true;
  }
  refreshStoryCount();
  syncToolbar();
}

/**
 * The highlight, wrapped by hand.
 *
 * `hiliteColor` would do it, but Chrome writes it as an inline background
 * colour on a <span>, and the sanitiser strips inline styles - so the highlight
 * would vanish on the next keystroke. A <mark> is a real element with a real
 * meaning and it survives the round trip. It does NOT print: newsprint has no
 * yellow, so the words are set plain (rich-text.js).
 */
function toggleHighlight() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;

  const existing = enclosing(selection.anchorNode, "MARK");
  if (existing) return existing.replaceWith(...existing.childNodes);

  const range = selection.getRangeAt(0);
  const mark = document.createElement("mark");
  try {
    range.surroundContents(mark);
  } catch {
    // The selection crossed an element boundary.
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  }
}

function enclosing(node, tag) {
  let current = node;
  while (current && current.id !== "edStoryBody") {
    if (current.tagName === tag) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * The link bar. A window.prompt() would do it in three lines and would also
 * stop the browser dead, which is not what a desk under deadline needs.
 */
function openLinkbar() {
  const bar = document.getElementById("edStoryLinkbar");
  const input = document.getElementById("edStoryLinkUrl");
  if (!bar || !input) return;
  const selection = window.getSelection();
  if (selection?.rangeCount && !selection.isCollapsed) savedRange = selection.getRangeAt(0).cloneRange();
  input.value = enclosing(selection?.anchorNode, "A")?.getAttribute("href") || "";
  bar.hidden = false;
  input.focus();
}

function bindLinkbar(body, pushBody) {
  const bar = document.getElementById("edStoryLinkbar");
  const input = document.getElementById("edStoryLinkUrl");
  if (!bar) return;

  const restore = () => {
    body.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  };
  const close = () => { bar.hidden = true; savedRange = null; };

  document.getElementById("edStoryLinkApply")?.addEventListener("click", () => {
    const url = (input.value || "").trim();
    if (!url) return;
    restore();
    document.execCommand("createLink", false, url);
    close();
    pushBody();
  });
  document.getElementById("edStoryLinkClear")?.addEventListener("click", () => {
    restore();
    document.execCommand("unlink", false, null);
    close();
    pushBody();
  });
  document.getElementById("edStoryLinkCancel")?.addEventListener("click", close);
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.getElementById("edStoryLinkApply")?.click();
    if (event.key === "Escape") close();
  });
}

function toggleSource(body, pushBody) {
  const source = document.getElementById("edStorySource");
  const paper = document.getElementById("edStoryPaper");
  if (!source || !paper) return;
  if (source.hidden) {
    source.value = copyOf(body);
    source.hidden = false;
    [...paper.children].forEach((element) => { if (element !== source) element.hidden = true; });
    source.focus();
    return;
  }
  body.innerHTML = sanitise(source.value);
  source.hidden = true;
  [...paper.children].forEach((element) => { if (element !== source) element.hidden = false; });
  // Rewriting the copy wiped the figures out of the sheet; put them back where
  // their placements say they stand.
  refreshStoryPictures();
  pushBody();
}

function toggleFullscreen(next) {
  const editor = document.getElementById("storyEditor");
  if (!editor) return;
  const on = next === undefined ? !editor.classList.contains("is-fullscreen") : next;
  if (!on && !editor.classList.contains("is-fullscreen")) return;
  editor.classList.toggle("is-fullscreen", on);
  document.body.classList.toggle("story-fullscreen", on);
  if (on) document.getElementById("edStoryBody")?.focus();
}

function syncToolbar() {
  document.querySelectorAll("#edStoryToolbar [data-command]").forEach((button) => {
    let active = false;
    try { active = document.queryCommandState(button.dataset.command); } catch { active = false; }
    button.classList.toggle("active", active);
  });
}

/** Repaints the words / characters / reading-time read-outs. */
export function refreshStoryStats(view) {
  const host = document.getElementById("edStoryStats");
  if (host) host.innerHTML = statsMarkup(view);
}

export function refreshStoryEditor(view) {
  const body = document.getElementById("edStoryBody");
  if (!body) return;
  if (document.activeElement !== body) {
    const next = fromPlainText(view.body || "");
    if (copyOf(body) !== next) {
      body.innerHTML = next;
      refreshStoryPictures();
    }
  }
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  if (headline && document.activeElement !== headline) headline.value = plainText(view.headline);
  if (subheading && document.activeElement !== subheading) subheading.value = plainText(view.subheading);
  refreshStoryCount();
  refreshFieldCounters(view);
  refreshStoryStats(view);
  refreshBlockControls(view);
}

/** Keeps the toolbar's block controls in step with the Typography panel. */
function refreshBlockControls(view) {
  const font = document.getElementById("edStoryFont");
  if (font && document.activeElement !== font) font.value = view.fontFamily || "";

  const size = document.getElementById("edStorySize");
  if (size && document.activeElement !== size) {
    const wanted = String(Number(view.bodyFontPx));
    // A derived size is fractional and may not be on the list; add it rather
    // than let the dropdown fall back and silently reset the block's type.
    if (![...size.options].some((option) => option.value === wanted)) {
      size.add(new Option(`${wanted} px`, wanted));
    }
    size.value = wanted;
  }
  document.querySelectorAll("#edStoryToolbar [data-align]").forEach((control) => {
    control.classList.toggle("active", String(view.textAlign) === control.dataset.align);
  });
}
