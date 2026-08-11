// The single source of truth for the whole workspace (Phase 10).
//
// The newspaper canvas, the Block Editor and the toolbar all read from this one object
// and all write through these actions - none of them keeps its own copy of a
// section's content, and none of them imports another view module.
//
// Views subscribe to named topics rather than "any change", so a keystroke in
// the editor can re-render one canvas thumbnail without touching the rest of
// the workspace (Phase 11).

export const TOPICS = {
  EDITION: "edition", // newspaper + page list identity
  PAGE: "page", // the open page changed structurally (switched page, new template)
  PAGE_SYNC: "pageSync", // same page, fresher rows - e.g. what a save returned
  SELECTION: "selection", // which section is selected
  DRAFT: "draft", // live edits to the selected section
  SAVE: "save", // save lifecycle (dirty / saving / saved / error)
  HISTORY: "history", // undo/redo availability
  STORY_PICKER: "storyPicker",
  ZOOM: "zoom",
};

const state = {
  newspaper: null,
  pages: [],
  currentPageId: null,
  reporterNews: [],
  selectedSectionKey: null,
  // WHICH PART of the selected block is the active editing target - the block
  // as a whole, or one of the objects inside it. One source of truth for
  // selection, read by the Block Editor's frames (which draw the selection
  // box) and the Typography panel (which points its controls at it), rather
  // than each inferring it from DOM classes or focus state independently.
  // "block" is the default: nothing more specific is targeted yet.
  selectedPart: "block", // block | headline | subheading | body | image | smartCard
  selectedImageId: null,
  // The full multi-selection, for bulk operations (align, nudge, delete) on
  // more than one picture at once (Stage 7). selectedImageId above stays the
  // single "primary" picture the Properties/Typography panels show - those
  // panels' numeric fields have no meaning averaged across several pictures,
  // so multi-selection is additive: it never changes what those panels do
  // for a single selection, only what the NEW bulk actions can act on.
  selectedImageIds: [],
  // Working copy of the selected section. Everything the user types lives here
  // until it is saved - never in the DOM, so undo/redo and autosave can read it.
  draft: null,
  dirty: false,
  saveState: "idle", // idle | saving | saved | error
  saveError: null,
  storyPickerOpen: false,
  canvasZoom: "fit",
};

const listeners = new Map();

export function subscribe(topic, handler) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(handler);
  return () => listeners.get(topic).delete(handler);
}

function emit(topic, detail = {}) {
  const handlers = listeners.get(topic);
  if (!handlers) return;
  handlers.forEach((handler) => handler(detail));
}

export function getState() {
  return state;
}

export function getCurrentPage() {
  return state.pages.find((page) => page.id === state.currentPageId) || null;
}

export function getSection(sectionKey) {
  return getCurrentPage()?.sections?.find((s) => s.section_key === sectionKey) || null;
}

export function getSelectedSection() {
  return state.selectedSectionKey ? getSection(state.selectedSectionKey) : null;
}

export function getDraft() {
  return state.draft;
}

export function findStory(newsItemId) {
  if (!newsItemId) return null;
  return state.reporterNews.find((item) => item.id === newsItemId) || null;
}

// ---------------------------------------------------------------- edition ---

export function setEdition({ newspaper, pages, reporterNews }) {
  state.newspaper = newspaper;
  state.pages = pages;
  state.reporterNews = reporterNews;
  const stillExists = pages.some((page) => page.id === state.currentPageId);
  state.currentPageId = stillExists ? state.currentPageId : pages[0]?.id || null;
  state.selectedSectionKey = null;
  state.draft = null;
  state.dirty = false;
  state.saveState = "idle";
  state.storyPickerOpen = false;
  emit(TOPICS.EDITION);
}

// `structural` means the page's shape changed - a different template, a
// different page. A save is NOT structural: it returns the same layout with
// fresher rows, and re-rendering the workspace for it would throw away panel
// state, scroll positions and the caret on every autosave.
export function replacePage(page, { structural = false } = {}) {
  state.pages = state.pages.map((p) => (p.id === page.id ? page : p));
  emit(structural ? TOPICS.PAGE : TOPICS.PAGE_SYNC);
}

export function setCurrentPage(pageId) {
  if (state.currentPageId === pageId) return;
  state.currentPageId = pageId;
  state.selectedSectionKey = null;
  state.draft = null;
  state.dirty = false;
  state.storyPickerOpen = false;
  emit(TOPICS.PAGE);
  emit(TOPICS.SELECTION);
}

// -------------------------------------------------------------- selection ---

export function setSelectedSection(sectionKey, draft) {
  const previous = state.selectedSectionKey;
  state.selectedSectionKey = sectionKey;
  state.draft = draft;
  state.dirty = false;
  // A new block starts with nothing more specific than the block itself
  // targeted - the previous block's headline being selected must never
  // silently carry over onto whatever is clicked next.
  state.selectedPart = "block";
  state.selectedImageId = null;
  state.selectedImageIds = [];
  emit(TOPICS.SELECTION, { previous, current: sectionKey });
}

export function clearSelection() {
  setSelectedSection(null, null);
}

// Which object within the selected block is the active editing target -
// e.g. clicking the headline frame in the Block Editor, or clicking a
// picture. Does not touch which block is selected or its draft. An ordinary
// (non-shift) click on a picture always narrows the selection to just that
// one picture - the same behaviour as before multi-selection existed.
export function setSelectedPart(part, imageId = null) {
  const sameSingle = state.selectedPart === part && state.selectedImageId === imageId && state.selectedImageIds.length <= 1;
  if (sameSingle) return;
  state.selectedPart = part;
  state.selectedImageId = part === "image" ? imageId : null;
  state.selectedImageIds = part === "image" && imageId != null ? [imageId] : [];
  emit(TOPICS.SELECTION, { current: state.selectedSectionKey, part });
}

export function getSelectedPart() {
  return state.selectedPart;
}

// Shift+click on a picture: add it to the selection, or drop it if it was
// already in. The last picture added becomes the new "primary" (what the
// Properties panel shows); dropping the primary hands that role to whatever
// is left, or back to "block" if nothing is.
export function toggleSelectedImage(imageId) {
  const set = new Set(state.selectedImageIds);
  if (set.has(imageId)) set.delete(imageId);
  else set.add(imageId);
  state.selectedImageIds = [...set];
  if (set.has(imageId)) {
    state.selectedPart = "image";
    state.selectedImageId = imageId;
  } else {
    state.selectedImageId = state.selectedImageIds[state.selectedImageIds.length - 1] ?? null;
    state.selectedPart = state.selectedImageId != null ? "image" : "block";
  }
  emit(TOPICS.SELECTION, { current: state.selectedSectionKey, part: state.selectedPart });
}

export function getSelectedImageIds() {
  return state.selectedImageIds;
}

// Escape's own step-out: a multi-selection collapses to its single primary
// picture first, the way a step-out should - a block-wide Escape is one step
// further "out" than dropping down from several pictures to one. Returns
// whether it did anything, so the caller knows whether to also reduce to
// "block" instead of just this.
export function collapseMultiSelection() {
  if (state.selectedImageIds.length <= 1) return false;
  state.selectedImageIds = state.selectedImageId != null ? [state.selectedImageId] : [];
  emit(TOPICS.SELECTION, { current: state.selectedSectionKey, part: state.selectedPart });
  return true;
}

// ------------------------------------------------------------------ draft ---

// `source` lets a view ignore the echo of its own edit, so typing in an input
// never re-renders that same input out from under the caret (Phase 3).
export function updateDraft(patch, source = null) {
  if (!state.draft) return;
  const changed = Object.keys(patch).filter((key) => state.draft[key] !== patch[key]);
  if (!changed.length) return;

  Object.assign(state.draft, patch);
  state.dirty = true;
  if (state.saveState === "saved") state.saveState = "idle";
  emit(TOPICS.DRAFT, { patch, changed, source });
  emit(TOPICS.SAVE);
}

// Used by undo/redo and by "load story into section" - replaces the whole draft
// rather than patching it, and tells views to repaint every bound input.
export function replaceDraft(draft, source = null) {
  state.draft = draft;
  state.dirty = true;
  emit(TOPICS.DRAFT, { patch: draft, changed: Object.keys(draft), source, replaced: true });
  emit(TOPICS.SAVE);
}

// ------------------------------------------------------------------- save ---

export function setSaveState(saveState, error = null) {
  state.saveState = saveState;
  state.saveError = error;
  if (saveState === "saved") state.dirty = false;
  emit(TOPICS.SAVE);
}

export function isDirty() {
  return state.dirty;
}

// ------------------------------------------------------------------- misc ---

export function setStoryPickerOpen(open) {
  state.storyPickerOpen = open;
  emit(TOPICS.STORY_PICKER);
}

export function setZoom(mode) {
  state.canvasZoom = mode;
  emit(TOPICS.ZOOM);
}

export function emitHistory() {
  emit(TOPICS.HISTORY);
}
