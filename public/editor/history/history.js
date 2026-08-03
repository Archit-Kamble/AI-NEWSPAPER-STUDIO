// Parts 11: undo/redo over editor state, plus the timeline the History tab
// reads.
//
// Scope is deliberately one section at a time: the stack resets when the
// selection moves, so Undo can never silently rewrite a section the editor is no
// longer looking at. Nothing here touches the network - undo of an
// already-saved change is a new edit, which autosave then persists.

const MAX_DEPTH = 60;
// Typing must not produce one undo step per character.
const COALESCE_MS = 500;

let past = [];
let future = [];
let lastPushAt = 0;
let onChange = null;
let clock = () => Date.now();

function snapshot(draft, label, kind) {
  return { draft: JSON.parse(JSON.stringify(draft)), label, kind, at: clock() };
}

export function configure(handler) {
  onChange = handler;
}

export function reset(draft, label = "Opened section") {
  past = draft ? [snapshot(draft, label, "open")] : [];
  future = [];
  lastPushAt = 0;
  onChange?.();
}

export function record(draft, { coalesce = true, label = "Edit", kind = "edit" } = {}) {
  if (!draft) return;
  const now = clock();
  const isRapid = coalesce && now - lastPushAt < COALESCE_MS;
  lastPushAt = now;

  if (isRapid && past.length > 1) {
    past[past.length - 1] = snapshot(draft, label, kind);
  } else {
    past.push(snapshot(draft, label, kind));
    if (past.length > MAX_DEPTH) past.shift();
  }
  future = [];
  onChange?.();
}

// Phase 7 ties in here: a successful autosave marks the current step, so the
// timeline shows which states actually reached the database.
export function markSaved() {
  const current = past[past.length - 1];
  if (current) current.saved = true;
  onChange?.();
}

export function undo() {
  if (past.length < 2) return null;
  future.unshift(past.pop());
  lastPushAt = 0;
  onChange?.();
  return JSON.parse(JSON.stringify(past[past.length - 1].draft));
}

export function redo() {
  if (!future.length) return null;
  const next = future.shift();
  past.push(next);
  lastPushAt = 0;
  onChange?.();
  return JSON.parse(JSON.stringify(next.draft));
}

// Jump straight to a timeline entry. Index is into the combined list the
// History tab renders (past first, then future).
export function jumpTo(index) {
  const combined = [...past, ...future];
  if (index < 0 || index >= combined.length) return null;
  past = combined.slice(0, index + 1);
  future = combined.slice(index + 1);
  lastPushAt = 0;
  onChange?.();
  return JSON.parse(JSON.stringify(combined[index].draft));
}

export function canUndo() {
  return past.length > 1;
}

export function canRedo() {
  return future.length > 0;
}

export function timeline() {
  const currentIndex = past.length - 1;
  return [...past, ...future].map((entry, index) => ({
    index,
    label: entry.label,
    kind: entry.kind,
    at: entry.at,
    saved: entry.saved === true,
    state: index < currentIndex ? "past" : index === currentIndex ? "current" : "future",
  }));
}
