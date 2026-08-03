// The single source of truth for the whole workspace (Phase 10).
//
// Canvas, Inspector, External Editor and Toolbar all read from this one object
// and all write through these actions - none of them keeps its own copy of a
// section's content, and none of them imports another view module.
//
// Views subscribe to named topics rather than "any change", so a keystroke in
// the editor can re-render one canvas thumbnail without touching the rest of
// the workspace (Phase 11).

export const TOPICS = {
  EDITION: "edition", // newspaper + page list identity
  PAGE: "page", // which page is open / its sections changed
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

export function replacePage(page) {
  state.pages = state.pages.map((p) => (p.id === page.id ? page : p));
  emit(TOPICS.PAGE);
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
  emit(TOPICS.SELECTION, { previous, current: sectionKey });
}

export function clearSelection() {
  setSelectedSection(null, null);
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
