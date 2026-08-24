// Marking WORDS inside a headline, a kicker or a deck.
//
// The marks toolbar over the block (bold, italic, underline, a phrase at its
// own size, clear formatting) is Quill's, and Quill owns exactly one document:
// the body. So every one of those buttons acted on the story no matter which
// object the desk had selected - press bold with the headline open and a word
// somewhere in the copy went bold instead. The controls were not subtly wrong,
// they were aimed at the wrong object, which is the same fault the alignment
// buttons had (typography-panel.js's ALIGN_FIELD).
//
// A headline is not a Quill document and should not become one: it is one flow
// of a few words with no paragraphs, no lists and no history stack, and giving
// it a second full editor would be a second writing surface for the same text -
// the thing this editor exists not to have. What it needs is the three marks a
// printer can actually set on a display line, applied to a selection inside an
// ordinary contenteditable.
//
// Everything here produces only what rich-text.js's sanitise() already keeps:
// <b>, <i>, <u> and the two controlled spans, `data-sahas-size` and
// `data-sahas-ink`. Nothing invents a FACE or an arbitrary inline style, and
// the ink is not an arbitrary colour either - it is one of the four the paper
// prints from (rich-text.js's INKS), because a page is separated into plates
// and a colour off a browser wheel is an ink that does not exist.

import { sanitise, sanitiseSize, isMarkedUp, plainText } from "../layout/rich-text.js";
import { sanitiseInk } from "../layout/inks.js";
import { escapeHtml } from "../format.js";

// The display field the desk is typing in, if any. Held rather than derived
// from document.activeElement at the moment of the click: pressing a toolbar
// button is a click on the BUTTON, so by the time the handler runs the field
// has already lost focus in any browser that has not been told otherwise.
// beginDisplayMarking() is what tells it otherwise.
let activeField = null;

// Announced rather than polled, so the toolbar can say which object it is
// aimed at the moment the aim changes - the desk should never have to press a
// button to discover what it was pointing at.
export const DISPLAY_TARGET_EVENT = "sahas:display-target";

function announce() {
  document.dispatchEvent(new CustomEvent(DISPLAY_TARGET_EVENT));
}

export function markDisplayField(element) {
  if (activeField === (element || null)) return;
  activeField = element || null;
  announce();
}

export function clearDisplayField(element) {
  if (element && activeField !== element) return;
  if (activeField === null) return;
  activeField = null;
  announce();
}

/** The field a mark would land in right now, or null for "the body's". */
export function activeDisplayField() {
  return activeField && activeField.isConnected ? activeField : null;
}

/**
 * Keeps the caret where it is while a toolbar button is pressed.
 *
 * A plain <button> takes focus on mousedown, which collapses the selection in
 * the contenteditable behind it - so by the time the click lands there is
 * nothing selected to embolden. Every rich editor solves this the same way and
 * so does this: refuse the focus change, and the selection is still there.
 */
export function holdSelection(event) {
  event.preventDefault();
}

// A <select> IS NOT A BUTTON, and holdSelection() cannot be used on one: the
// preventDefault that keeps the caret in place is also what stops a dropdown
// opening at all. So the marked range is remembered on the press and put back
// when the choice lands - the same end, by the only means a native picker
// leaves open.
let held = null;

export function rememberSelection() {
  const field = activeDisplayField();
  const range = field ? selectionInside(field) : null;
  held = range && !range.collapsed ? { field, range: range.cloneRange() } : null;
  return Boolean(held);
}

export function restoreSelection() {
  // Nothing was remembered - a keyboard route to the picker, or a browser that
  // left the contenteditable's range alone when the select took focus. The
  // live selection inside the aimed-at field is then still the right answer,
  // and falling back to it is what keeps this working by whatever route the
  // desk reached the control.
  if (!held) {
    const field = activeDisplayField();
    const range = field ? selectionInside(field) : null;
    if (!field || !range || range.collapsed) return null;
    held = { field, range: range.cloneRange() };
  }
  if (!held.field.isConnected) {
    held = null;
    return null;
  }
  const { field, range } = held;
  held = null;
  markDisplayField(field);
  field.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return field;
}

function selectionInside(field) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return field.contains(range.commonAncestorContainer) ? range : null;
}

/**
 * One word or phrase at its own size.
 *
 * document.execCommand('fontSize') only speaks the legacy 1-7 scale and emits
 * a <font> tag, so the size is applied by hand instead - as the same
 * `data-sahas-size` span Quill's own size button serialises to for the body
 * (block-frame.js), so both surfaces store one mark and not two.
 */
function applySize(field, px) {
  const range = selectionInside(field);
  if (!range || range.collapsed) return false;
  // "Body size" - no mark at all - is a real choice, and the only way to take
  // one back off. The same shape Black already has among the inks.
  if (px === "" || px === null || px === undefined) return stripSize(field, range);
  const size = sanitiseSize(parseFloat(px));
  if (size === null) return false;

  const span = document.createElement("span");
  span.setAttribute("data-sahas-size", String(size));
  span.style.fontSize = `${size}px`;
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents refuses a range that cuts across an element boundary
    // ("प्रचंड <b>य|श</b>"), which is an ordinary selection, not an error.
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }

  const selection = window.getSelection();
  const after = document.createRange();
  after.selectNodeContents(span);
  selection?.removeAllRanges();
  selection?.addRange(after);
  return true;
}

/**
 * One of the paper's inks on the selected words.
 *
 * The same shape as applySize() above, and for the same reasons: the mark is
 * one controlled attribute with a finite set of legal values, and it carries a
 * real style as well so the field shows the ink while it is being edited -
 * fieldValue()'s sanitise() takes the style back off on the way to storage.
 *
 * Black is not an ink here, it is the absence of one: choosing it strips the
 * mark, so the word goes back to being set in whatever the block is set in.
 */
function applyInk(field, hex) {
  const range = selectionInside(field);
  if (!range || range.collapsed) return false;

  const ink = sanitiseInk(hex);
  if (ink === null) return stripInk(field, range);

  const span = document.createElement("span");
  span.setAttribute("data-sahas-ink", ink);
  span.style.color = ink;
  try {
    range.surroundContents(span);
  } catch {
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }

  const selection = window.getSelection();
  const after = document.createRange();
  after.selectNodeContents(span);
  selection?.removeAllRanges();
  selection?.addRange(after);
  return true;
}

// Back to the block's own ink. Every inked span the selection touches is
// unwrapped - a partial selection inside one would need the span split, and
// the honest simple rule ("choosing Black clears the ink on the words you
// selected, and on the run they are part of") is one a desk can predict.
function stripSize(field, range) {
  const touched = [...field.querySelectorAll("[data-sahas-size]")]
    .filter((span) => range.intersectsNode(span));
  if (!touched.length) return false;
  touched.forEach((span) => span.replaceWith(...span.childNodes));
  field.normalize();
  return true;
}

function stripInk(field, range) {
  const touched = [...field.querySelectorAll("[data-sahas-ink]")]
    .filter((span) => range.intersectsNode(span));
  if (!touched.length) return false;
  touched.forEach((span) => span.replaceWith(...span.childNodes));
  field.normalize();
  return true;
}

// A mark is applied by hand rather than by document.execCommand, and the
// reason is measurable rather than stylistic: a headline field is ALREADY set
// in the paper's bold display face, so `execCommand('bold')` reads the
// selection as bold and does the only thing it can - it takes bold OFF,
// emitting `<span style="font-weight: normal">`. sanitise() then unwraps that
// span (it carries no size), so pressing bold on a headline stored exactly
// nothing. Verified in the running app before this was written, not assumed.
//
// Wrapping the range directly has no such ambiguity: the mark this editor
// stores is a TAG, and the tag is what is put there.
const SAME_MARK = { B: ['B', 'STRONG'], I: ['I', 'EM'], U: ['U'] };

function markAround(field, node, tag) {
  let element = node && node.nodeType === 1 ? node : node?.parentNode;
  while (element && element !== field) {
    if (SAME_MARK[tag].includes(element.tagName)) return element;
    element = element.parentNode;
  }
  return null;
}

function selectContents(node) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Bold, italic or underline over the selection - on if it was off, off if on. */
function toggleMark(field, tag) {
  const range = selectionInside(field);
  if (!range || range.collapsed) return false;

  // Already inside this mark: take it off. A headline is a handful of words,
  // so the whole mark is unwrapped rather than split around the selection -
  // partial un-marking is a distinction a display line does not need, and
  // splitting one is where a hand-rolled editor starts inventing bugs.
  const existing = markAround(field, range.commonAncestorContainer, tag);
  if (existing) {
    const parent = existing.parentNode;
    existing.replaceWith(...existing.childNodes);
    parent.normalize();
    selectContents(field);
    return true;
  }

  const element = document.createElement(tag.toLowerCase());
  try {
    range.surroundContents(element);
  } catch {
    element.appendChild(range.extractContents());
    range.insertNode(element);
  }
  selectContents(element);
  return true;
}

/** The selection reduced to its own words, with every mark taken off. */
function clearMarks(field) {
  const range = selectionInside(field);
  if (!range || range.collapsed) return false;
  const text = range.toString();
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  return true;
}

/**
 * Applies one toolbar action to the active display field.
 *
 * Returns false when the action is not this field's to perform - the caller
 * then lets the event through to Quill, which owns the body.
 */
export function applyDisplayMark(action, value) {
  const field = activeDisplayField();
  if (!field) return false;

  field.focus({ preventScroll: true });

  if (action === "size") return applySize(field, value);
  if (action === "ink") return applyInk(field, value);
  if (action === "clean") return clearMarks(field);
  if (action === "bold") return toggleMark(field, "B");
  if (action === "italic") return toggleMark(field, "I");
  if (action === "underline") return toggleMark(field, "U");
  // Lists are a body form. A headline set as a bullet is not a headline, and
  // the compositor has no display flow that could carry one.
  return action === "list";
}

// --------------------------------------------- a display field's own value ---

/**
 * A stored headline/deck as the editable markup of one of these fields.
 *
 * Copy written before there were marks is plain text and has to be escaped;
 * copy that carries them is put through the same sanitiser everything else is,
 * so nothing a paste dragged in can reach the field either.
 */
export function fieldHtml(value) {
  const raw = String(value ?? "");
  if (!isMarkedUp(raw)) return escapeHtml(raw);
  const holder = document.createElement("div");
  holder.innerHTML = sanitise(raw);
  // A size mark stores only its VALUE (rich-text.js keeps `data-sahas-size`
  // and strips every style, which is what stops a pasted stylesheet reaching
  // the page). CSS cannot read an attribute into a font-size, so the field
  // paints it here instead - and fieldValue()'s sanitise() takes the style
  // straight back off on the way to storage, so the round trip stores exactly
  // what it stored before.
  holder.querySelectorAll("[data-sahas-size]").forEach((span) => {
    span.style.fontSize = `${span.getAttribute("data-sahas-size")}px`;
  });
  // The ink mark, for the same reason and taken off again the same way.
  holder.querySelectorAll("[data-sahas-ink]").forEach((span) => {
    span.style.color = span.getAttribute("data-sahas-ink");
  });
  return holder.innerHTML;
}

/**
 * What one of these fields currently holds, ready to store.
 *
 * A headline and a deck are ONE flow each - no paragraphs, no list items - so
 * the block structure a contenteditable inevitably accumulates (a <div> per
 * Enter, a stray <br> from a paste) is flattened to spaces before the marks
 * are kept. Otherwise a headline would arrive at the compositor carrying a
 * paragraph break it has no way to set.
 */
export function fieldValue(element) {
  if (!element) return "";
  const html = sanitise(element.innerHTML || "")
    .replace(/<\/(p|div|li)\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<(p|div|ul|ol|li)(\s[^>]*)?>/gi, "");
  // A field holding only marks and whitespace is an EMPTY field, not a block
  // that has a headline made of nothing.
  return plainText(html).trim() ? html.replace(/\s+/g, " ").trim() : "";
}
