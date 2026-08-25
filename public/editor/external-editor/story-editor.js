// The one place a story is written: a page at the block's proportions, with
// frames on it.
//
// What was here before was a hand-rolled contenteditable with the pictures
// floated into the copy. Floats can only touch the left or right edge of a
// column, so a photograph could never be put where the desk wanted it, and no
// amount of CSS was going to change that - it is what the platform does. The
// page and its frames live in block-frame.js; the copy inside the body frame is
// edited with Quill. This module is the furniture around them: the block's own
// type, the editorial limits, and the counts a desk reads all day.

import { plainText } from "../layout/rich-text.js";
import { markDisplayField, fieldHtml, fieldValue } from "./display-marks.js";
import {
  FONT_FAMILIES, ALIGNMENTS, PART_LABEL, alignFieldFor, alignValueOf,
} from "./typography-panel.js";
import { bindDeviceBar } from "./device-bar.js";
import { bindChartDialog, openChartDialog } from "./chart-dialog.js";
import {
  blockFrameMarkup, mountFrame, refreshFrame, copyFromFrame,
  renderPictures, selectPictureFrame,
} from "./block-frame.js";
import { escapeHtml as escapeAttribute } from "../format.js";
// The publication's type ladder, in points - shared with the marks toolbar.
import "../layout/publication-type.js";

// The editorial limits, not the storage limits. A headline over about 90
// characters cannot be set at headline size in a column and stay a headline;
// the field still ACCEPTS more, because writing long and cutting back is
// normal, but the count turns and says so.
const HEADLINE_LIMIT = 90;
const SUBHEADING_LIMIT = 140;

// A reading speed for Devanagari prose. Only ever shown as a rounded minute: a
// sense of scale for the desk, never a measurement.
const WORDS_PER_MINUTE = 200;

// Sizes a desk actually sets body copy in, in editor px (2px per mm). The
// block's own derived size is added when it is not one of these, so opening a
// story never silently changes its type.
let budgetOf = null;
let escapeBound = false;

// The size and alignment controls follow the text object selected on the
// canonical page. Both are genuinely separate persisted fields per object
// (headline_font_px / subheading_font_px / body_font_px, and now
// headline_align / subheading_align / text_align). The FAMILY and the WEIGHT
// are still one value for the whole block and must not be falsely presented
// as object-specific - a newspaper does not let one paragraph pick its own
// face, and the schema does not carry it either.
let selectedTextPart = "body";

const TEXT_SIZE_FIELD = {
  headline: "headlineFontPx",
  subheading: "subheadingFontPx",
  body: "bodyFontPx",
  block: "bodyFontPx",
};

const TEXT_SIZE_LABEL = {
  headline: "Headline size",
  subheading: "Subheadline size",
  body: "Body size",
  block: "Body size",
};

// The sizes are the publication's one type ladder, in POINTS. They used to be
// this list's own numbers in editor BLOCK pixels - 7, 8, ... 140 - which is
// not a unit any printer sets in and not the unit the marks toolbar a few
// pixels below was already using. See publication-type.js's TYPE_LADDER_PT.
const typeScale = () => globalThis.SahasPublicationType;

function textSizeField(part = selectedTextPart) {
  return TEXT_SIZE_FIELD[part] || "bodyFontPx";
}

function textSizeValue(view, part = selectedTextPart) {
  return Number(view?.[textSizeField(part)]) || 0;
}

function textSizeOptions(current) {
  const value = Number(current) || 0;
  return typeScale().typeLadder(value)
    .map((rung) => `<option value="${rung.px}"${rung.px === value ? " selected" : ""}>${rung.label}</option>`)
    .join("");
}

function options(list, current) {
  return list
    .map((o) => `<option value="${escapeAttribute(o.value)}"${String(current) === String(o.value) ? " selected" : ""}>${escapeAttribute(o.label)}</option>`)
    .join("");
}

function sizeOptions(current) {
  // Kept as the initial body-size spelling used while the editor markup is
  // first mounted. refreshBlockControls() immediately switches this same
  // control to whichever text object is selected.
  return textSizeOptions(current);
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
 * The alignment buttons, aimed at whichever text object is selected.
 *
 * They used to be labelled "whole block" and to write `textAlign`
 * unconditionally, which is the body's field: a sub-editor who selected the
 * headline and pressed "centre" re-set the STORY and left the headline
 * exactly where it was. The title now names the object being changed, so the
 * button says what it will do before it is pressed.
 */
function alignButtonsMarkup(view, part) {
  const current = alignValueOf(view, part);
  const target = PART_LABEL[part] || "Whole block";
  return ALIGNMENTS.map((a) => `<button type="button" class="rt-btn rt-align${current === a.value ? " active" : ""}"
      data-align="${a.value}" aria-label="Align ${a.label.toLowerCase()} — ${target.toLowerCase()}"
      title="Align ${a.label.toLowerCase()} — ${target.toLowerCase()}">${alignIcon(a.value)}</button>`).join("");
}

/**
 * The counter under the story, in the unit the block is actually measured in.
 *
 * `budget` is a RANGE - {min, max} - because the same block holds 30-46% more
 * or fewer characters depending only on what is written into it: Marathi hides
 * zero-width vowel signs inside a cluster, so no single number can answer "how
 * much fits" (CLAUDE.md, "The character budget is a range, not a scalar"). The
 * Space panel a few pixels to the right has always said so; this line used to
 * quote one scalar from the retired character grid, and the two disagreed on
 * screen at the same instant.
 *
 * Over-set is called only above the MAXIMUM, because that is the only figure
 * that is certain: below it the copy may or may not fit, and the Space panel
 * and the engine's own fitState are what answer that. A counter that cried
 * "too many" at the floor would be red on ordinary blocks that set perfectly.
 */
function budgetText(used, budget) {
  const min = Number(budget?.min) || 0;
  const max = Number(budget?.max) || min;
  if (!min) return `${used} characters`;
  if (used > max) return `${used} of ${min}\u2013${max} \u2014 ${used - max} too many`;
  return min === max ? `${used} of ${min} characters` : `${used} of ${min}\u2013${max} characters`;
}

export function storyEditorMarkup(view, { budget = null, tools = "", pictures = "" } = {}) {
  const used = plainText(view.body).length;
  return `
    <article class="story-editor" id="storyEditor" aria-label="Story editor">
      <header class="story-editor-ribbon">
        <div class="story-editor-ribbon-title">
          <span>Writing</span><small>Changes save automatically</small>
        </div>
        <!-- This row sets the block's TYPE: the face for the whole block, and
             the size and alignment of whichever text object is selected on the
             page above. Marking WORDS - bold, italic, a phrase at its own size,
             lists - is the marks toolbar drawn over the page (block-frame.js),
             which follows the same selection. The two are deliberately not the
             same bar: one sets an object, the other marks a selection inside
             one. -->
        <div class="story-editor-toolbar" id="edStoryToolbar" role="toolbar" aria-label="Block type">
          <div class="rt-row rt-row-type">
            <!-- EVERY CONTROL NAMES THE OBJECT IT ACTS ON, and this row had two
                 that did not. The face is the whole BLOCK's; the size is
                 whichever text object is selected on the page above - so
                 double-clicking a headline moved this number from the body's
                 to the headline's with nothing on screen to say so, and the
                 desk read it as "the font size is changing automatically".
                 Only a title attribute said which object it meant, and a
                 tooltip is not something a person reads while working. -->
            <span class="rt-target" title="The face is set for the whole block">Block</span>
            <select class="rt-select rt-select-font" id="edStoryFont" title="Font for the whole block">
              ${options(FONT_FAMILIES, view.fontFamily || "")}
            </select>
            <span class="rt-target" id="edStorySizeTarget">Body</span>
            <select class="rt-select rt-select-size" id="edStorySize" title="Body size for the whole block">
              ${sizeOptions(view.bodyFontPx)}
            </select>
            <span class="rt-sep"></span>
            ${alignButtonsMarkup(view, selectedTextPart)}
            ${tools ? `<span class="rt-sep"></span>${tools}` : ""}
            <span class="rt-spacer"></span>
            <button type="button" class="rt-btn" data-action="fullscreen" title="Focus writing (Esc to exit)">&#10530;</button>
          </div>
        </div>
      </header>

      <div class="story-editor-paper" id="edStoryPaper">
        <!-- The block itself is the primary object here - the headline and
             deck are drawn inside it, in the block's own type (block-frame.js).
             The fields below are where the typing actually happens, not a
             second copy of the composition: kept deliberately plain and
             modest so the eye goes to the page above, not to two headlines. -->
        ${blockFrameMarkup()}
        <div class="story-fields">
          <!-- Contenteditable rather than <input>, because a headline carries
               MARKS: a name in bold, a phrase at its own size. An <input> can
               hold only a string, so every keystroke here used to overwrite
               whatever the desk had marked on the page above with the plain
               text of the field - one surface silently destroying the other's
               work. Same rich-text.js marks as the story, same sanitiser, and
               the counters still read plainText(), because a <b> is not a
               character a printer sets. -->
          <label class="story-field-label" for="edStoryHeadline">
            Headline
            <span class="field-counter" id="edStoryHeadlineCounter">${plainText(view.headline).length}/${HEADLINE_LIMIT}</span>
          </label>
          <div id="edStoryHeadline" class="story-headline-input rich-field" contenteditable="true"
            role="textbox" aria-label="Headline" data-part="headline"
            data-placeholder="मथळा — the headline as it will print">${fieldHtml(view.headline)}</div>
          <label class="story-field-label" for="edStorySubheading">
            Subheading
            <span class="field-counter" id="edStorySubheadingCounter">${plainText(view.subheading).length}/${SUBHEADING_LIMIT}</span>
          </label>
          <div id="edStorySubheading" class="story-subheading-input rich-field" contenteditable="true"
            role="textbox" aria-label="Subheading" data-part="subheading"
            data-placeholder="उपमथळा — the subheading, if the story has one">${fieldHtml(view.subheading)}</div>
        </div>
      </div>

      <footer class="story-editor-foot">
        <span class="rt-count" id="edStoryCount">${budgetText(used, budget)}</span>
        <span class="rt-foot-note">Drag a picture anywhere on the page; its corner sizes it.</span>
      </footer>

      <div class="stat-grid" id="edStoryStats">${statsMarkup(view)}</div>

      ${pictures ? `<section class="story-block">${pictures}</section>` : ""}
    </article>`;
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
    <div class="stat"><span>${stats.readingMinutes || "&mdash;"}</span><small>min read</small></div>`;
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
  const readout = document.getElementById("edStoryCount");
  if (!readout) return;

  const used = plainText(copyFromFrame()).length;
  const budget = budgetOf ? budgetOf() : null;
  readout.textContent = budgetText(used, budget);
  readout.classList.toggle("over", used > (Number(budget?.max) || Infinity));
}

/**
 * A SEPARATOR SET ACROSS THE STORY - the ornament a printed Marathi paper puts
 * between two parts of a page.
 *
 * It is an inset panel of the `ornament` kind, which means it costs the engine
 * exactly one more rectangle in the obstacle set and nothing else changes -
 * the same argument the fact box, the pull quote and the cross-head already
 * rest on. A separator that needed its own code in the compositor would be a
 * separator that could disagree with the copy running round it.
 */
function ornamentPanel(section, view, mark = "\u25c6") {
  const blockW = Number(section?.width_px) || 200;
  const blockH = Number(section?.height_px) || 200;
  const body = Number(view?.bodyFontPx) || 6.4;
  return {
    id: `panel-${Date.now().toString(36)}`,
    kind: "ornament",
    x: 2,
    y: Math.round(blockH * 0.5),
    width: Math.max(24, blockW - 4),
    height: Math.max(8, Math.round(body * 1.8)),
    title: "",
    // A PLAIN separator is two rules and nothing between them, so it carries
    // no line at all - and panelOf() rejects a panel with neither a title nor
    // a line as empty, which is right for a fact box and wrong for this. One
    // space is a line: it makes the panel real without printing a mark.
    lines: [mark || " "],
  };
}

/** No picture to caption: show the desk where pictures are added. */
function notifyNoPicture() {
  const host = document.querySelector(".picture-list, .ext-write-col");
  host?.scrollIntoView({ block: "center" });
}

export function bindStoryEditor({ onPatch, getBudget, getSection, getView, getImages, onPatchImage, onRemoveImage, onSelectImage, onSelectPart, onToggleImageSelection, onAddOverlay, getSelectedImageId }) {
  budgetOf = getBudget;

  // THE DEVICE BAR - every device this paper can set, on one row on the editor.
  // Bound here because this is where the frame is bound, and bound ONCE: it
  // listens at the document, so the bar being rewritten on every block change
  // cannot leave it on a detached node.
  bindDeviceBar({
    getView, getSection,
    onPatch,
    onAddOverlay,
    // These three do not get a second implementation. Each presses the control
    // that already exists and is already bound, so there is exactly one code
    // path per action however a desk reaches it.
    onProposePicture: () => document.getElementById("aiProposePicture")?.click(),
    // `.picture-caption` is the real field (pictures-panel.js) - the first
    // version of this reached for `[data-image-caption]` and `#edImageCaption`,
    // neither of which exists anywhere in the product, so the button scrolled
    // the column and focused nothing. Found by grepping for its own selectors
    // and getting no file back, which is a check worth making on any handler
    // written against a remembered id.
    //
    // The SELECTED picture's caption if one is selected, else the first - a
    // desk pressing this with a picture chosen means that picture's line. The
    // rows carry no selected CLASS, so the id is asked of the store rather
    // than read off the DOM; a class that does not exist is how the first
    // version of this button came to focus nothing at all.
    onFocusCaption: () => {
      const id = getSelectedImageId?.();
      const field = (id != null && document.querySelector(`.picture-caption[data-image-id="${id}"]`))
        || document.querySelector(".picture-caption");
      if (!field) return notifyNoPicture();
      field.scrollIntoView({ block: "center" });
      field.focus();
    },
    // `keep` is the panel list with any existing separator already taken out,
    // so choosing a different separator replaces the one that is there rather
    // than laying a second across the same measure.
    onInsertOrnament: (mark, keep) => {
      const view = getView?.() || {};
      const section = getSection?.() || {};
      const existing = Array.isArray(keep) ? keep
        : (Array.isArray(view.insetPanels) ? view.insetPanels : []);
      onPatch?.({ insetPanels: [...existing, ornamentPanel(section, view, mark)] }, "device-bar");
    },
    // A chart asks three questions before it can draw anything, so it opens a
    // dialog rather than writing a guess into the block. See chart-dialog.js.
    onChart: (chartType) => openChartDialog({
      chartType,
      view: getView?.() || {},
      section: getSection?.() || {},
      onPatch,
    }),
  });
  bindChartDialog();

  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  const toolbar = document.getElementById("edStoryToolbar");

  // Both fields behave identically, so they are bound identically rather than
  // twice by hand - the second copy is where "and the subheading does not do
  // that" comes from.
  for (const [part, field] of [["headline", headline], ["subheading", subheading]]) {
    if (!field) continue;

    field.addEventListener("input", () => {
      onPatch?.({ [part]: fieldValue(field) }, "story-editor");
      refreshFieldCounters({ headline: fieldValue(headline), subheading: fieldValue(subheading) });
    });

    // Typing here IS that object being edited - Tab-ing into the field, or a
    // click that landed on it rather than on the frame drawn over the page,
    // must select it exactly as clicking the frame does. `focusin` and not
    // `focus`, so it survives the caret landing on a child element a mark
    // created.
    field.addEventListener("focusin", () => {
      onSelectPart?.(part);
      // And this is where a bold/italic/size press will land from now on.
      markDisplayField(field);
    });

    // One flow, so Enter is not a paragraph - it is "done".
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); field.blur(); }
    });

    // A pasted headline brings a website's fonts with it. Only its words are
    // wanted; sanitise() would remove the rest on the way to storage anyway,
    // but taking it at the door keeps the field itself honest on screen.
    field.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return;
      event.preventDefault();
      document.execCommand("insertText", false, text.replace(/\s+/g, " "));
    });
  }

  // The block's own type. Same fields the Typography panel writes.
  document.getElementById("edStoryFont")?.addEventListener("change", (event) =>
    onPatch?.({ fontFamily: event.target.value }, "story-toolbar"));
  document.getElementById("edStorySize")?.addEventListener("change", (event) => {
    const field = textSizeField();
    onPatch?.({ [field]: Number(event.target.value) }, "story-toolbar");
  });

  toolbar?.addEventListener("click", (event) => {
    const align = event.target.closest("[data-align]");
    if (align) {
      event.preventDefault();
      // Resolved at click time against the object selected NOW - the same
      // rule the size control beside it already follows.
      onPatch?.({ [alignFieldFor(selectedTextPart)]: align.dataset.align }, "story-toolbar");
      toolbar.querySelectorAll("[data-align]").forEach((b) => b.classList.toggle("active", b === align));
      return;
    }
    if (event.target.closest('[data-action="fullscreen"]')) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  if (!escapeBound) {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") toggleFullscreen(false);
    });
    escapeBound = true;
  }

  const section = getSection?.();
  const view = getView?.();
  if (section && view) {
    mountFrame(section, view, getImages?.() || [], {
      onPatch: (patch, source) => {
        onPatch?.(patch, source);
        refreshStoryCount();
        refreshStoryStats({ body: copyFromFrame() });
      },
      onPatchImage,
      onRemoveImage,
      onSelectImage,
      // `imageId` and not just `part`: block-frame.js calls this with BOTH
      // when a picture is clicked, and this wrapper swallowed the second
      // argument - so store.setSelectedPart("image", undefined) narrowed the
      // selection to no picture at all. The block knew a picture was the
      // selected KIND of object and could not say WHICH, so every re-render
      // took the selection outline and the eight resize handles straight back
      // off the picture that had just been clicked. Found by the browser net
      // the moment it could reach this far again.
      onSelectPart: (part, imageId = null) => {
        if (part === "headline" || part === "subheading" || part === "body") {
          selectedTextPart = part;
        }
        onSelectPart?.(part, imageId);

        const currentView = getView?.();
        if (currentView) refreshBlockControls(currentView, part);
      },
      onToggleImageSelection,
    }).then(refreshStoryCount);
  }
}

function toggleFullscreen(next) {
  const editor = document.getElementById("storyEditor");
  if (!editor) return;
  const on = next === undefined ? !editor.classList.contains("is-fullscreen") : next;
  if (!on && !editor.classList.contains("is-fullscreen")) return;
  editor.classList.toggle("is-fullscreen", on);
  document.body.classList.toggle("story-fullscreen", on);
}

/** Repaints the words / characters / reading-time read-outs. */
export function refreshStoryStats(view) {
  const host = document.getElementById("edStoryStats");
  if (host) host.innerHTML = statsMarkup(view);
}

/** The pictures on the page, redrawn where their placements say they are. */
export function refreshStoryPictures(images) {
  renderPictures(images);
}

export function refreshStoryEditor(view, section, images, source, selectedPart, selectedImageIds) {
  if (selectedPart === "headline" || selectedPart === "subheading" || selectedPart === "body") {
    selectedTextPart = selectedPart;
  }

  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  // Never while the caret is in it: replacing innerHTML under a live caret
  // moves it to the start, which on a rich field means every second keystroke
  // lands at the beginning of the headline.
  const restore = (field, value) => {
    if (!field || field.contains(document.activeElement) || field === document.activeElement) return;
    const wanted = fieldHtml(value);
    if (field.innerHTML !== wanted) field.innerHTML = wanted;
  };
  restore(headline, view.headline);
  restore(subheading, view.subheading);

  if (section) refreshFrame(section, view, images, source, selectedPart, selectedImageIds);

  refreshStoryCount();
  refreshFieldCounters(view);
  refreshStoryStats(view);
  refreshBlockControls(view, selectedPart);
}

/** Keeps the toolbar's controls in step with the object selected on the
 * canonical newspaper page. */
function refreshBlockControls(view, part = selectedTextPart) {
  if (part === "headline" || part === "subheading" || part === "body") {
    selectedTextPart = part;
  }

  const font = document.getElementById("edStoryFont");
  if (font && document.activeElement !== font) font.value = view.fontFamily || "";

  const size = document.getElementById("edStorySize");
  if (size && document.activeElement !== size) {
    const value = textSizeValue(view);
    size.innerHTML = textSizeOptions(value);
    size.value = String(value);
    size.title = `${TEXT_SIZE_LABEL[selectedTextPart] || "Body size"} — selected object`;
    size.setAttribute(
      "aria-label",
      `${TEXT_SIZE_LABEL[selectedTextPart] || "Body size"} for selected object`,
    );
  }
  const target = document.getElementById("edStorySizeTarget");
  if (target) target.textContent = PART_LABEL[selectedTextPart] || "Body";
  const alignNow = alignValueOf(view, selectedTextPart);
  const alignTarget = (PART_LABEL[selectedTextPart] || "Whole block").toLowerCase();
  document.querySelectorAll("#edStoryToolbar [data-align]").forEach((control) => {
    control.classList.toggle("active", alignNow === control.dataset.align);
    control.title = `Align ${control.dataset.align} — ${alignTarget}`;
    control.setAttribute("aria-label", control.title);
  });
}

export { selectPictureFrame };
