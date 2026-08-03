// Phase 6: undo/redo over editor state only.
//
// Scope is deliberately one section at a time: the stack resets when the
// selection moves, so Undo can never silently rewrite a section the editor is
// no longer looking at. Nothing here touches the network or the page - undo of
// an already-saved change is a new edit, which autosave then persists.

const MAX_DEPTH = 60;
// Typing shouldn't produce one undo step per character.
const COALESCE_MS = 500;

let past = [];
let future = [];
let lastPushAt = 0;
let onChange = null;

function snapshot(draft) {
  return JSON.parse(JSON.stringify(draft));
}

export function configure(handler) {
  onChange = handler;
}

export function reset(draft) {
  past = draft ? [snapshot(draft)] : [];
  future = [];
  lastPushAt = 0;
  onChange?.();
}

export function record(draft, { coalesce = true } = {}) {
  if (!draft) return;
  const now = Date.now();
  const isRapid = coalesce && now - lastPushAt < COALESCE_MS;
  lastPushAt = now;

  if (isRapid && past.length > 1) {
    // Fold this keystroke into the step already on top of the stack.
    past[past.length - 1] = snapshot(draft);
  } else {
    past.push(snapshot(draft));
    if (past.length > MAX_DEPTH) past.shift();
  }
  future = [];
  onChange?.();
}

export function undo() {
  if (past.length < 2) return null;
  future.unshift(past.pop());
  lastPushAt = 0;
  onChange?.();
  return snapshot(past[past.length - 1]);
}

export function redo() {
  if (!future.length) return null;
  const next = future.shift();
  past.push(next);
  lastPushAt = 0;
  onChange?.();
  return snapshot(next);
}

export function canUndo() {
  return past.length > 1;
}

export function canRedo() {
  return future.length > 0;
}
