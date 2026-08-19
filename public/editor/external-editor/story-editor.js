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
import {
  blockFrameMarkup, mountFrame, refreshFrame, copyFromFrame,
  renderPictures, selectPictureFrame,
} from "./block-frame.js";
import { escapeHtml as escapeAttribute } from "../format.js";

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
const BODY_SIZES = [7, 8, 8.5, 9, 9.5, 10, 11, 12, 13, 14, 16, 18, 20, 24];

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

const DISPLAY_SIZES = [
  7, 8, 8.5, 9, 9.5, 10, 11, 12, 13, 14, 16, 18, 20, 24,
  28, 32, 36, 40, 48, 56, 64, 72, 84, 96, 110, 120, 140,
];

function textSizeField(part = selectedTextPart) {
  return TEXT_SIZE_FIELD[part] || "bodyFontPx";
}

function textSizeValue(view, part = selectedTextPart) {
  return Number(view?.[textSizeField(part)]) || 0;
}

function textSizeOptions(current) {
  const value = Number(current) || 0;
  const sizes = DISPLAY_SIZES.includes(value) || !value
    ? DISPLAY_SIZES
    : [...DISPLAY_SIZES, value].sort((a, b) => a - b);

  return sizes
    .map((size) => `<option value="${size}"${size === value ? " selected" : ""}>${size} px</option>`)
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

export function storyEditorMarkup(view, { budget = 0, tools = "", pictures = "" } = {}) {
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
            <select class="rt-select rt-select-font" id="edStoryFont" title="Font for the whole block">
              ${options(FONT_FAMILIES, view.fontFamily || "")}
            </select>
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
        <span class="rt-count" id="edStoryCount">${used}${budget ? ` of ${budget} characters` : " characters"}</span>
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
  const budget = budgetOf ? budgetOf() : 0;
  const over = budget ? used - budget : 0;
  readout.textContent = budget
    ? over > 0 ? `${used} of ${budget} — ${over} too many` : `${used} of ${budget} characters`
    : `${used} characters`;
  readout.classList.toggle("over", over > 0);
}

export function bindStoryEditor({ onPatch, getBudget, getSection, getView, getImages, onPatchImage, onRemoveImage, onSelectImage, onSelectPart, onToggleImageSelection }) {
  budgetOf = getBudget;

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
  const alignNow = alignValueOf(view, selectedTextPart);
  const alignTarget = (PART_LABEL[selectedTextPart] || "Whole block").toLowerCase();
  document.querySelectorAll("#edStoryToolbar [data-align]").forEach((control) => {
    control.classList.toggle("active", alignNow === control.dataset.align);
    control.title = `Align ${control.dataset.align} — ${alignTarget}`;
    control.setAttribute("aria-label", control.title);
  });
}

export { selectPictureFrame };
