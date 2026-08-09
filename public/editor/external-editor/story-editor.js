// The only rich-text writing surface for a story.  It deliberately keeps word
// formatting separate from block typography: font size and columns belong to
// the newspaper layout, while bold, italic and lists belong to the copy.
//
// It is also the only place the story is written. The Inspector used to carry a
// second headline, subheading and body bound to the same draft; what that form
// did that this one did not - the editorial length limits, and the words and
// reading-time read-outs - was moved here before it was deleted.

import { sanitise, plainText, fromPlainText } from "../layout/rich-text.js";
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

export function storyEditorMarkup(view, { budget = 0 } = {}) {
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

  const used = plainText(body.innerHTML).length;
  const budget = budgetOf ? budgetOf() : 0;
  const over = budget ? used - budget : 0;
  readout.textContent = budget
    ? over > 0 ? `${used} of ${budget} — ${over} too many` : `${used} of ${budget} characters`
    : `${used} characters`;
  readout.classList.toggle("over", over > 0);
}

export function bindStoryEditor({ onPatch, getBudget }) {
  budgetOf = getBudget;
  patchBlock = onPatch;
  const body = document.getElementById("edStoryBody");
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  const toolbar = document.getElementById("edStoryToolbar");
  if (!body) return;

  const pushBody = () => {
    onPatch?.({ body: sanitise(body.innerHTML) }, "story-editor");
    refreshStoryCount();
    refreshStoryStats({ body: body.innerHTML });
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
    source.value = sanitise(body.innerHTML);
    source.hidden = false;
    [...paper.children].forEach((element) => { if (element !== source) element.hidden = true; });
    source.focus();
    return;
  }
  body.innerHTML = sanitise(source.value);
  source.hidden = true;
  [...paper.children].forEach((element) => { if (element !== source) element.hidden = false; });
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
    if (body.innerHTML !== next) body.innerHTML = next;
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
