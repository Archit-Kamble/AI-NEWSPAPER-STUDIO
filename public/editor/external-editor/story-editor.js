// The only rich-text writing surface for a story.  It deliberately keeps word
// formatting separate from block typography: font size and columns belong to
// the newspaper layout, while bold, italic and lists belong to the copy.

import { sanitise, plainText, fromPlainText } from "../layout/rich-text.js";

const TOOLS = [
  { command: "undo", label: "↶", title: "Undo (Ctrl+Z)" },
  { command: "redo", label: "↷", title: "Redo (Ctrl+Shift+Z)" },
  { separator: true },
  { command: "bold", label: "B", title: "Bold (Ctrl+B)", className: "rt-bold" },
  { command: "italic", label: "I", title: "Italic (Ctrl+I)", className: "rt-italic" },
  { command: "underline", label: "U", title: "Underline (Ctrl+U)", className: "rt-underline" },
  { separator: true },
  { command: "insertUnorderedList", label: "• List", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1. List", title: "Numbered list" },
  { command: "removeFormat", label: "Clear", title: "Clear formatting" },
];

let budgetOf = null;
let escapeBound = false;

const escapeAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function toolMarkup(tool) {
  if (tool.separator) return '<span class="rt-sep"></span>';
  return `<button type="button" class="rt-btn ${tool.className || ""}" data-command="${tool.command}"
      title="${escapeAttribute(tool.title)}">${tool.label}</button>`;
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
          ${TOOLS.map(toolMarkup).join("")}
          <span class="rt-spacer"></span>
          <button type="button" class="rt-btn" data-action="source" title="Edit stored markup">&lt;/&gt;</button>
          <button type="button" class="rt-btn" data-action="fullscreen" title="Focus writing (Esc to exit)">⤢</button>
        </div>
      </header>

      <div class="story-editor-paper" id="edStoryPaper">
        <label class="story-field-label" for="edStoryHeadline">Headline</label>
        <input id="edStoryHeadline" class="story-headline-input" maxlength="200"
          placeholder="मथळा — the headline as it will print" value="${escapeAttribute(plainText(view.headline))}">
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
    </article>`;
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
  const body = document.getElementById("edStoryBody");
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  const toolbar = document.getElementById("edStoryToolbar");
  if (!body) return;

  const pushBody = () => {
    onPatch?.({ body: sanitise(body.innerHTML) }, "story-editor");
    refreshStoryCount();
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

  headline?.addEventListener("input", () => onPatch?.({ headline: headline.value }, "story-editor"));
  subheading?.addEventListener("input", () => onPatch?.({ subheading: subheading.value }, "story-editor"));

  toolbar?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action) {
      event.preventDefault();
      if (action === "fullscreen") return toggleFullscreen();
      if (action === "source") return toggleSource(body, pushBody);
    }
    const button = event.target.closest("[data-command]");
    if (!button) return;
    event.preventDefault();
    body.focus();
    document.execCommand(button.dataset.command, false, null);
    pushBody();
    syncToolbar();
  });

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
}
