// Where the story is actually written.
//
// The External Editor is the full-width dock a desk composes in, and it had no
// text fields at all - pictures, a space read-out and the AI panel, and nowhere
// to type a word. A sub-editor sitting in front of it could not write. That is
// what "we cannot edit text" meant, and it is fixed by putting the writing
// surface where the writing happens.
//
// It is a rich editor because a story needs bold and italic - a name, an
// emphasis, a standfirst - and a plain textarea cannot say any of that.
//
// What it deliberately does NOT offer, and why:
//
//   font family, size, colour   The layout decides these for the whole block
//                               (see typeScaleFor in geometry.js). A story
//                               whose author picked its own font is how a page
//                               stops looking like one newspaper.
//   pictures inside the copy    Pictures are placed on the block, where the
//                               character grid can see them and flow text
//                               around them. A picture buried in a paragraph
//                               is invisible to that measurement.
//   links                       There is nothing to click on newsprint.
//
// Everything typed here is measured by the same character grid as before,
// because the grid counts the plain text underneath the marks (rich-text.js).
// The count under the box is live, and it is the real budget for this block.

import { sanitise, plainText, fromPlainText } from "../layout/rich-text.js";

// The marks a printer can set, in the order a desk reaches for them.
const TOOLS = [
  { command: "bold", label: "B", title: "Bold  (Ctrl+B)", className: "rt-bold" },
  { command: "italic", label: "I", title: "Italic  (Ctrl+I)", className: "rt-italic" },
  { command: "underline", label: "U", title: "Underline  (Ctrl+U)", className: "rt-underline" },
  { separator: true },
  { command: "insertUnorderedList", label: "• —", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1 —", title: "Numbered list" },
  { separator: true },
  { command: "removeFormat", label: "⌫", title: "Clear formatting" },
];

let onChange = null;
let budgetOf = null;

export function storyEditorMarkup(view, { budget = 0 } = {}) {
  const html = fromPlainText(view.body || "");
  const used = plainText(html).length;

  return `
    <div class="story-editor" id="storyEditor">
      <div class="story-editor-head">
        <label for="edStoryHeadline">Headline</label>
        <input id="edStoryHeadline" class="story-headline-input" maxlength="200"
               placeholder="मथळा — the headline as it will print"
               value="${escapeAttribute(plainText(view.headline))}">
        <input id="edStorySubheading" class="story-subheading-input" maxlength="300"
               placeholder="उपमथळा — the subheading, if the story has one"
               value="${escapeAttribute(plainText(view.subheading))}">
      </div>

      <div class="story-editor-toolbar" id="edStoryToolbar">
        ${TOOLS.map((tool) =>
          tool.separator
            ? `<span class="rt-sep"></span>`
            : `<button type="button" class="rt-btn ${tool.className || ""}"
                 data-command="${tool.command}" title="${escapeAttribute(tool.title)}">${tool.label}</button>`,
        ).join("")}
        <span class="rt-spacer"></span>
        <span class="rt-count" id="edStoryCount"></span>
      </div>

      <div class="story-editor-body" id="edStoryBody" contenteditable="true"
           spellcheck="false" role="textbox" aria-multiline="true"
           data-placeholder="बातमी येथे लिहा — write the story here.">${html}</div>

      <p class="story-editor-note">
        Bold, italic and underline print. Type size and font are set for the whole
        block in <strong>Typography</strong>, so the page stays one newspaper.
      </p>
    </div>`;
}

const escapeAttribute = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Repaints the character count under the box. */
export function refreshStoryCount() {
  const body = document.getElementById("edStoryBody");
  const readout = document.getElementById("edStoryCount");
  if (!body || !readout) return;

  const used = plainText(body.innerHTML).length;
  const budget = budgetOf ? budgetOf() : 0;
  const over = budget ? used - budget : 0;

  readout.textContent = budget
    ? over > 0
      ? `${used} of ${budget} — ${over} too many`
      : `${used} of ${budget} characters`
    : `${used} characters`;
  readout.classList.toggle("over", over > 0);
}

/**
 * Binds the editor.
 *
 * `onPatch(patch, source)` is the same channel every other panel writes
 * through, so a keystroke here goes down exactly the path a keystroke in the
 * Inspector always did: draft, live canvas repaint, autosave.
 */
export function bindStoryEditor({ onPatch, getBudget }) {
  onChange = onPatch;
  budgetOf = getBudget;

  const body = document.getElementById("edStoryBody");
  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  if (!body) return;

  const push = () => {
    onChange?.({ body: sanitise(body.innerHTML) }, "story-editor");
    refreshStoryCount();
  };

  body.addEventListener("input", push);

  // Paste is where a newspaper page gets ruined: copy arrives from Word, from
  // email, from a website, carrying fonts, colours and shading. Only the words
  // are taken, and the marks a printer can set.
  body.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";
    const cleaned = html ? sanitise(html) : escapeAttribute(text).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, cleaned);
    push();
  });

  headline?.addEventListener("input", () => onChange?.({ headline: headline.value }, "story-editor"));
  subheading?.addEventListener("input", () => onChange?.({ subheading: subheading.value }, "story-editor"));

  document.getElementById("edStoryToolbar")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command]");
    if (!button) return;
    event.preventDefault();
    body.focus();
    document.execCommand(button.dataset.command, false, null);
    push();
    syncToolbar();
  });

  // The toolbar shows what the cursor is sitting in, the way every editor does.
  ["keyup", "mouseup", "focus"].forEach((type) => body.addEventListener(type, syncToolbar));

  refreshStoryCount();
  syncToolbar();
}

function syncToolbar() {
  document.querySelectorAll("#edStoryToolbar [data-command]").forEach((button) => {
    let on = false;
    try {
      on = document.queryCommandState(button.dataset.command);
    } catch {
      on = false;
    }
    button.classList.toggle("active", on);
  });
}

/**
 * Repaints the editor when the block changes underneath it - a different block
 * selected, a story linked from a reporter, an AI fill.
 *
 * Never while the desk is typing in it: replacing the innerHTML of the box
 * somebody has a cursor in throws the cursor to the start, which is the classic
 * way a rich editor becomes unusable.
 */
export function refreshStoryEditor(view) {
  const body = document.getElementById("edStoryBody");
  if (!body) return;
  const typingHere = document.activeElement === body;

  if (!typingHere) {
    const next = fromPlainText(view.body || "");
    if (body.innerHTML !== next) body.innerHTML = next;
  }

  const headline = document.getElementById("edStoryHeadline");
  const subheading = document.getElementById("edStorySubheading");
  if (headline && document.activeElement !== headline) headline.value = plainText(view.headline);
  if (subheading && document.activeElement !== subheading) subheading.value = plainText(view.subheading);

  refreshStoryCount();
}
