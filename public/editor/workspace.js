// The workspace orchestrator.
//
// Layout, top to bottom:
//   Header (app chrome)  ·  Toolbar
//   The page, full width
//   The Block Editor, full width - the other view of the SAME editor
//
// There used to be an Inspector beside the page carrying its own headline,
// subheading and body bound to the same draft. Two editors on one story is how
// a desk loses work: the plain textarea could only show the rich editor's marks
// as literal `<p><br></p>`, and every read-out had to be kept in step twice.
// Everything it did that the dock did not - the 90 and 140 character editorial
// limits, the words/characters/reading-time read-outs, the block's size, the
// last-saved time and an explicit Save - was moved into the dock first. Then it
// was deleted.
//
// This is the only module that talks to the section API and the only one that
// subscribes to the store on behalf of the views. Views never import each other.

import { renderCanvas, refreshSection, refreshSelection, refreshGuides } from "./canvas/canvas.js";
import { renderMiniMap, configure as configureCanvasView, applyTransform } from "./canvas/canvas-view.js";
import { refreshRulers } from "./canvas/ruler.js";
import { setGuidesVisible } from "./canvas/page-guides.js";
import { loadGeometry, findFreeRect, getGeometry } from "./canvas/grid.js";
import { loadIdentity } from "./canvas/masthead.js";
import { zoomControlMarkup, bindZoomControl, syncZoomControl, pageIndicatorMarkup } from "./canvas/canvas-toolbar.js";
import { renderPageNavigator } from "./page-navigator.js";
import { renderLayoutSidebar } from "./layout-sidebar.js";
import { renderStoryPicker } from "./story-picker.js";
import { renderToolbar, refreshHistoryButtons, refreshSaveIndicator, refreshToolbarSelection } from "./toolbar.js";
import {
  renderExternalEditor,
  refreshExternalEditor,
  refreshDockSavedAt,
  refreshHistoryTab,
  showNotice,
  focusGroup,
} from "./external-editor/external-editor.js";
import { applyStoredLayout, bindResizers, setEditorCollapsed, getSizes } from "./layout/resizer.js";
import { showPublicationFiles } from "./publication.js";
import { loadAiStatus, getAiTier } from "./external-editor/ai-panel.js";
import { renderWorklist } from "./worklist-panel.js";
import * as store from "./store.js";
import * as history from "./history/history.js";
import * as autosave from "./autosave/autosave.js";
import { draftFromSection, draftFromStory, payloadFromDraft, viewOfSection } from "./section-model.js";
import { canRenderSmartCard, smartCardText } from "./smart-cards/smart-cards.js";
import { candidatesOn, runBulk } from "./external-editor/bulk-generate.js";
import { computeAlignment } from "./external-editor/align.js";
import { escapeHtml, closeOnEscape } from "./format.js";
import { isContentEdit, isExplicit } from "./status/section-status.js";
import { buildFlowMap, flowImageFromRow } from "./layout/text-flow.js";

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

export async function renderWorkspace(newspaperId) {
  let newspaper, pages, reporterNews;
  try {
    [newspaper, pages, reporterNews] = await Promise.all([
      fetchJson(`/api/newspapers/${newspaperId}`),
      fetchJson(`/api/newspapers/${newspaperId}/pages`),
      fetchJson("/api/news"),
      // The column grid and the px-per-mm scale come from the server; nothing is
      // laid out until they are known.
      loadGeometry(),
    ]);

    // The paper's standing furniture, and this edition's volume and issue number
    // worked out from its date. Fetched before the first paint so page one is
    // drawn complete rather than popping its nameplate in a moment later.
    await loadIdentity(newspaper?.publication_date, pages?.length);
  } catch (error) {
    renderWorkspaceLoadError(newspaperId, error);
    return;
  }

  store.setEdition({ newspaper, pages, reporterNews });
  autosave.configure({ save: persistDraft, onStateChange: onAutosaveState });
  history.configure(() => {
    refreshHistoryButtons(history.canUndo(), history.canRedo());
    refreshHistoryTab();
  });
  // Rulers redraw their tick marks whenever the scale changes, same trigger
  // as the zoom control's own readout - one combined handler, not a second
  // subscription slot canvas-view.js does not have.
  configureCanvasView(() => {
    syncZoomControl();
    refreshRulers();
  });
  renderShell();
}

// The edition could not be loaded at all - a dropped connection, a stale
// link, a server error. The desk must never be left staring at whatever the
// dashboard left behind (a hidden right panel, a half-cleared screen) with no
// way back and no idea why. No stack trace: this is the one message a desk
// reads, so it says what happened and offers the one thing that can fix it.
function renderWorkspaceLoadError(newspaperId, error) {
  console.error("Workspace load failed:", error);
  const content = document.getElementById("content");
  if (!content) return;
  content.innerHTML = `
    <div class="workspace-load-error">
      <h2>This edition could not be opened</h2>
      <p>The connection may have dropped, or the edition may no longer exist. Nothing was lost — the edition itself is unchanged.</p>
      <button type="button" class="btn-secondary" id="workspaceLoadRetry">Try again</button>
    </div>
  `;
  document.getElementById("workspaceLoadRetry")?.addEventListener("click", () => renderWorkspace(newspaperId));
}

// ------------------------------------------------------------ derived data ---

function currentView() {
  const section = store.getSelectedSection();
  const draft = store.getDraft();
  if (!section || !draft) return null;
  return { ...viewOfSection(section, draft, store.getState().selectedSectionKey), sectionKey: section.section_key };
}

function currentStory() {
  return store.findStory(store.getDraft()?.newsItemId);
}

// -------------------------------------------------------------- page guides ---
//
// Ruler guides (Stage 4) - page-level, not per-block, so they load on a page
// switch, not a section switch, and there is no "no page open" case the way
// there is for a block's own images.

let pageGuides = [];
let guidesVisible = true;

async function loadPageGuides() {
  const page = store.getCurrentPage();
  if (!page) {
    pageGuides = [];
    return;
  }
  const response = await fetch(`/api/pages/${page.id}/guides`);
  pageGuides = response.ok ? await response.json() : [];
  refreshGuides(pageGuides);
}

async function createGuide(orientation, positionPx) {
  const page = store.getCurrentPage();
  if (!page) return;
  const response = await fetch(`/api/pages/${page.id}/guides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orientation, positionPx }),
  });
  if (!response.ok) return showNotice("The guide could not be added.");
  pageGuides = await response.json();
  refreshGuides(pageGuides);
}

async function moveGuide(guideId, positionPx) {
  const page = store.getCurrentPage();
  if (!page) return;
  const response = await fetch(`/api/pages/${page.id}/guides/${guideId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positionPx }),
  });
  if (!response.ok) return showNotice("The guide could not be moved.");
  pageGuides = await response.json();
  refreshGuides(pageGuides);
}

async function deleteGuide(guideId) {
  const page = store.getCurrentPage();
  if (!page) return;
  const response = await fetch(`/api/pages/${page.id}/guides/${guideId}`, { method: "DELETE" });
  if (!response.ok) return;
  pageGuides = await response.json();
  refreshGuides(pageGuides);
}

// ------------------------------------------------------- pictures in a block ---
//
// A block can hold several pictures, placed where the designer wants them. That
// placement is layout data: it decides which cells of the character grid are
// occupied, and therefore how much copy the AI is asked for.

let sectionImages = [];

async function loadSectionImages() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) {
    sectionImages = [];
    return;
  }
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`);
  sectionImages = response.ok ? await response.json() : [];
  // The opening history snapshot (history.reset(), in selectSection()) was
  // taken before these arrived, so it doesn't yet know this block's actual
  // pictures - correct it in place rather than push a second "opened" step.
  history.primeImages(sectionImages);
  redrawCompose();
}

function redrawCompose() {
  const section = store.getSelectedSection();
  const view = currentView();
  if (!section || !view) return;

  // The PAGE has to be told too. Moving, turning or removing a picture goes
  // straight to its own endpoint, which returns the pictures - not the page -
  // so the canvas went on drawing the placement it was last given. The desk saw
  // the picture move in the editor and stay put on the page, and reasonably
  // reported that the two did not match.
  section.images = sectionImages;
  refreshSection(section, view, { selected: true, dirty: store.getState().dirty });

  // Without the selected part, refreshExternalEditor's own default ("block")
  // would silently reset the Properties/Typography scoping every time a
  // picture changes - including from an edit made IN the Properties panel
  // itself, which would watch its own commit knock it back to block-level a
  // moment later.
  refreshExternalEditor(section, view, currentStory(), "images", store.getSelectedPart(), store.getSelectedImageIds());
}

async function addSectionImage(file) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;

  const form = new FormData();
  form.append("images", await readableImage(file));
  const uploadResponse = await fetch("/api/uploads/images", { method: "POST", body: form });
  const uploaded = uploadResponse.ok ? await uploadResponse.json().catch(() => null) : null;
  const url = uploaded?.imageUrls?.[0];
  if (!url) return showNotice("The picture could not be uploaded.");

  // At the picture's OWN proportions. The default placement was half the
  // block's width by a third of its height whatever the photograph was, so an
  // upright portrait was placed in a landscape box and the top and bottom of it
  // were simply cut off. The block decides how WIDE a picture may be; the
  // picture decides how tall that makes it.
  const shape = await naturalShape(url);
  const section = page.sections?.find((row) => row.section_key === key);
  const placement = section && shape ? placeInside(section, shape) : null;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      filename: file.name,
      mimeType: file.type,
      ...(placement || {}),
    }),
  });
  if (!response.ok) return showNotice("The picture could not be placed.");

  sectionImages = await response.json();
  redrawCompose();
  showNotice("Picture placed. Drag it where the story wants it.");
}

// What the server's image library can actually decode. Everything downstream
// of the upload reads the file with Jimp - the cut-out model, the flood fill,
// the alpha mask the copy wraps to, the press package - and Jimp does not
// decode WebP. A .webp uploaded fine, drew fine in the browser, and then every
// one of those failed with "that picture could not be read from disk", which is
// why Remove background looked broken. Phones and Google Images hand out WebP
// constantly, so this is the normal case, not an edge one.
const SERVER_CAN_READ = /^image\/(png|jpeg|bmp|gif|tiff)$/;

/**
 * The same picture in a format the whole pipeline can read.
 *
 * The browser decodes WebP, AVIF and HEIC natively, so the conversion happens
 * here, once, at the moment of upload - rather than adding a native image
 * library to the server for a job the browser has already done.
 */
async function readableImage(file) {
  if (SERVER_CAN_READ.test(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.png`, { type: "image/png" });
  } catch {
    // Better to upload what we have and fail loudly later than to lose the
    // picture at the door.
    return file;
  }
}

/**
 * Where a new picture lands: half the block's width, at the picture's own
 * proportions, and never bigger than the block.
 *
 * A photograph taller than the block it is dropped into used to be placed at
 * its full height and clipped by the block's edge - the desk saw a picture with
 * its head cut off and no way to tell that the box, not the picture, was wrong.
 * A picture that does not fit is made to fit first.
 */
function placeInside(section, shape) {
  const margin = Number(section.margin_px) || 12;
  const room = {
    width: Math.max(20, Number(section.width_px) - margin * 2),
    height: Math.max(20, Number(section.height_px) - margin * 2),
  };

  let width = Math.round(room.width / 2);
  let height = Math.round(width / shape);
  if (height > room.height) {
    height = room.height;
    width = Math.round(height * shape);
  }
  if (width > room.width) {
    width = room.width;
    height = Math.round(width / shape);
  }
  return { width: Math.max(20, width), height: Math.max(20, height) };
}

/** The picture's own width ÷ height, or null if the browser cannot read it. */
function naturalShape(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(probe.naturalWidth && probe.naturalHeight
      ? probe.naturalWidth / probe.naturalHeight
      : null);
    probe.onerror = () => resolve(null);
    probe.src = url;
  });
}

// Saves a picture's own row - the PATCH the drag/resize handles, and history
// undo/redo, both go through. No history recording here: recording is what
// makes THIS an undoable step versus a step the history navigation itself is
// merely applying to catch the app up to a past/future snapshot.
async function persistImagePatch(imageId, patch) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return null;

  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
  );
  if (!response.ok) return null;
  sectionImages = await response.json();
  return sectionImages;
}

function imagePatchLabel(patch) {
  if ("width" in patch || "height" in patch) return "Picture resized";
  if ("x" in patch || "y" in patch) return "Picture moved";
  if ("shape" in patch) return "Picture shape changed";
  return "Picture changed";
}

// A drag, a resize, or a control in the pictures panel. One choke point for
// every way a picture's own row changes, so recording undo history here -
// once - covers all of them, rather than each caller remembering to.
async function patchSectionImage(imageId, patch) {
  const result = await persistImagePatch(imageId, patch);
  if (!result) return showNotice("The picture could not be moved.");
  redrawCompose();
  history.record(store.getDraft(), { coalesce: false, label: imagePatchLabel(patch), kind: "image", images: sectionImages });
}

// Brings the placed pictures back to what a history snapshot says they were -
// undo/redo of a resize or a move. Pictures the snapshot doesn't know about
// (added or removed since) are left alone: that is a different, wider kind of
// undo this stage does not cover - see block-frame.js's own note on scope.
// Row shape (GET, and what a snapshot stores) is x_px/y_px/width_px/height_px -
// the database's own column names (sectionImage.repository.js's `SELECT si.*`).
// The PATCH body the move/resize endpoint accepts is camelCase x/y/width/height
// instead (sectionImage.service.js's `move()`) - an existing asymmetry this
// function has to bridge, not one it introduces.
async function reconcileImages(images) {
  if (!Array.isArray(images)) return;
  const current = new Map(sectionImages.map((image) => [image.id, image]));
  const GEOMETRY_KEYS = ["x_px", "y_px", "width_px", "height_px"];

  for (const wanted of images) {
    const now = current.get(wanted.id);
    if (!now) continue;
    const changed = GEOMETRY_KEYS.some((k) => Number(now[k] ?? 0) !== Number(wanted[k] ?? 0));
    if (changed) {
      await persistImagePatch(wanted.id, {
        x: Number(wanted.x_px) || 0,
        y: Number(wanted.y_px) || 0,
        width: Number(wanted.width_px) || 0,
        height: Number(wanted.height_px) || 0,
      });
    }
  }
  redrawCompose();
}

// Background removal runs on our own BiRefNet service - see
// src/services/backgroundRemoval.service.js for why not remove.bg or @imgly.
// The returned cut-out becomes the picture, and its alpha mask feeds the
// character grid so copy wraps the subject rather than its box.
async function removeImageBackground(imageId) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;

  showNotice("Removing the background…");
  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}/cutout`,
    { method: "POST" },
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return showNotice(result.error || "Background removal is not available.");
  }
  sectionImages = result;
  redrawCompose();
  showNotice("Background removed. Copy now wraps the subject.");
}

async function removeSectionImage(imageId) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;
  const response = await fetch(
    `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/${imageId}`,
    { method: "DELETE" },
  );
  if (!response.ok) return;
  sectionImages = await response.json();
  redrawCompose();
}

// Smart cards use the existing, classified daily-feature service. The only
// client-side calculation is the selected block's available character budget;
// it is the same grid used by the Space panel and press preflight.
async function requestSmartCard({ key, variant }) {
  const newspaper = store.getState().newspaper;
  const section = store.getSelectedSection();
  const view = currentView();
  if (!newspaper || !section || !view) return { error: "Choose a block first." };

  const budget = buildFlowMap(section, { ...view, body: "" }, sectionImages.map(flowImageFromRow)).bodyCharBudget;
  const smartVariant = key === "rashi" && variant === "auto"
    ? (budget < 180 ? "one" : budget < 520 ? "three" : "all")
    : variant;
  const signs = smartVariant === "one" ? 1 : smartVariant === "three" ? 3 : 12;
  const response = await fetch(`/api/features/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: newspaper.publication_date, charsPerSign: Math.max(30, Math.floor(budget / signs)), tier: getAiTier() }),
  });
  const result = await response.json().catch(() => ({ error: "The Smart Card could not be built." }));
  if (!response.ok) return result;

  // The structured payload, if the builder sent one. This is what is stored and
  // what draws; the body text below is a RENDERING of it, kept because
  // everything that measures a block reads body text - the character grid, the
  // worklist, preflight, the fit action.
  //
  // A card the desk asked to be shortened is shortened in the DATA, not by
  // cutting the text afterwards: three signs means three signs in the payload,
  // so the block on the page and the block in the editor both draw three.
  let card = result.card || null;
  if (card && key === "rashi") {
    const wanted = smartVariant === "one" ? 1 : smartVariant === "three" ? 3 : 12;
    card = { ...card, signs: (card.signs || []).slice(0, wanted) };
  }

  let items = Array.isArray(result.items) ? result.items : [];
  if (key === "rashi") items = items.slice(0, smartVariant === "one" ? 1 : smartVariant === "three" ? 3 : 12);

  const body = card && canRenderSmartCard(key)
    ? smartCardText(key, card)
    : items.map((item) => `${item.label ? `${item.label} : ` : ""}${item.text || ""}${item.note ? ` (${item.note})` : ""}`).join("\n");

  const charsUsed = body.length;
  return {
    // The card travels with the proposal, so accepting it puts the DATA in the
    // draft rather than a picture of it.
    smartCardKey: card && canRenderSmartCard(key) ? key : null,
    smartCardData: card && canRenderSmartCard(key) ? card : null,
    proposal: { headline: result.title || "", subheading: result.subtitle || "", body },
    source: result.writtenBy ? "written" : key === "dinvishesh" ? "curated" : "computed",
    fit: { bodyCharBudget: budget, charsUsed, charsRemaining: Math.max(0, budget - charsUsed) },
  };
}

// ----------------------------------------------------------------- actions ---

function selectSection(sectionKey) {
  const state = store.getState();
  if (state.selectedSectionKey === sectionKey) return;

  // Leaving a section with unsaved work must not lose it: the debounce timer is
  // never given the chance to expire after the draft has been swapped out.
  const leaving = state.selectedSectionKey;
  if (leaving && state.dirty) autosave.flush();

  const section = store.getSection(sectionKey);
  if (!section) return;

  const draft = draftFromSection(section);
  store.setSelectedSection(sectionKey, draft);
  history.reset(draft, `Opened ${sectionKey}`);

  refreshSelection(leaving, sectionKey, store.getCurrentPage()?.sections, draft);
  renderMiniMap(store.getCurrentPage(), state.newspaper, sectionKey);
  renderSidePanels();
  loadSectionImages();
  syncRemoveBlockButton();
  refreshToolbarSelection(true, store.getState().storyPickerOpen);
}

// Which object inside the selected block is the editing target - clicking
// the headline frame, the body, a picture. Unlike selectSection(), this never
// touches the draft, history or autosave: it is purely "what is the
// Typography panel and the selection box pointed at right now."
function selectPart(part, imageId = null) {
  store.setSelectedPart(part, imageId);
}

// Shift+click on a picture - add or drop it from the multi-selection that
// align/bulk-delete/bulk-nudge act on. Same non-touching-draft-or-history
// rule as selectPart() above.
function toggleImageSelection(imageId) {
  store.toggleSelectedImage(imageId);
}

function patchDraft(patch, source) {
  const draft = store.getDraft();
  // Editing the article's words advances the lifecycle, unless an editor has
  // already made an explicit call or the text came from AI - neither should be
  // silently downgraded to "editing".
  const advances =
    draft && isContentEdit(patch) && !isExplicit(draft.status) && !draft.aiGenerated && draft.status !== "editing";

  store.updateDraft(advances ? { ...patch, status: "editing" } : patch, source);
  history.record(store.getDraft(), { label: describePatch(patch), images: sectionImages });
  autosave.schedule();
}

function describePatch(patch) {
  const keys = Object.keys(patch).filter((k) => k !== "status");
  if (!keys.length) return "Edit";
  const labels = {
    headline: "Headline",
    subheading: "Subheadline",
    body: "Body",
    caption: "Caption",
    author: "Reporter",
    imageUrl: "Image",
    imageRotation: "Image rotation",
    imageZoom: "Image zoom",
    imageFit: "Image fit",
    imageFlipH: "Image flip",
    imageFlipV: "Image flip",
  };
  return labels[keys[0]] || `${keys[0]} changed`;
}

function chooseStory() {
  if (!store.getState().selectedSectionKey) return;
  store.setStoryPickerOpen(true);
}

async function selectStoryForSection(story) {
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(draftFromStory(draft, story), "story-picker");
  history.record(store.getDraft(), { coalesce: false, label: `Linked "${story.title}"`, kind: "link", images: sectionImages });
  autosave.schedule();
  store.setStoryPickerOpen(false);

  // A reporter files pictures with the story. Taking the story has to bring
  // them into the editor - otherwise the desk has to hunt down and re-upload
  // photographs the newsroom already has.
  await placeStoryImages(story);
}

async function placeStoryImages(story) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  const urls = Array.isArray(story?.image_urls) ? story.image_urls.filter(Boolean) : [];
  if (!page || !key || !urls.length) return;

  const already = new Set(sectionImages.map((image) => image.url));
  const fresh = urls.filter((url) => !already.has(url));
  if (!fresh.length) return;

  for (const url of fresh) {
    const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: url.split("/").pop() }),
    });
    if (response.ok) sectionImages = await response.json();
  }
  redrawCompose();
  showNotice(
    fresh.length === 1
      ? "The reporter's picture is on the block. Drag it where you want it."
      : `${fresh.length} of the reporter's pictures are on the block.`,
  );
}

function clearSection(sectionKey) {
  if (store.getState().selectedSectionKey !== sectionKey) selectSection(sectionKey);
  const draft = store.getDraft();
  if (!draft) return;
  store.replaceDraft(
    { ...draft, newsItemId: null, headline: "", subheading: "", body: "", caption: "", imageUrl: "", aiGenerated: false, status: "empty" },
    "canvas",
  );
  history.record(store.getDraft(), { coalesce: false, label: "Cleared section", kind: "clear", images: sectionImages });
  autosave.schedule();
}

function setSectionStatus(statusKey) {
  if (!store.getDraft()) return;
  patchDraft({ status: statusKey }, "canvas");
}

function onSectionAction(sectionKey, action) {
  if (action === "clear") return clearSection(sectionKey);
  if (action === "add-block") return addBlock();
  if (action === "delete-block") return deleteBlock(sectionKey);

  selectSection(sectionKey);
  if (action === "story") return chooseStory();
  // Pictures are part of the writing surface, so "Add a picture" from the
  // page's own menu goes to the story panel - there is no separate picture
  // group to send it to any more.
  if (action === "image") return focusGroup("story");
  if (action === "mark-ready") return setSectionStatus("ready");
  if (action === "mark-review") return setSectionStatus("needs_review");
}

// ------------------------------------------------------------ page layout ---
//
// A page is no longer whatever its template declared. An editor adds the blocks
// the day's file needs - a dense inside page runs to fifteen or twenty - and
// drags them onto the column grid.

async function addBlock() {
  const page = store.getCurrentPage();
  const geometry = getGeometry();
  if (!page || !geometry) return;
  if (store.getState().dirty) await autosave.flush();

  // A new block defaults to two columns and roughly a quarter page, dropped in
  // the first free space so it never lands on top of finished work.
  const width = Math.round(geometry.columnPx * 2 + geometry.gutterPx);
  const height = geometry.baselinePx * 24;
  const rect = findFreeRect(page.sections || [], width, height);

  const response = await fetch(`/api/pages/${page.id}/sections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rect),
  });
  if (!response.ok) return showNotice("Could not add the block.");

  const updated = await response.json();
  store.replacePage(updated, { structural: true });
  const added = updated.sections[updated.sections.length - 1];
  renderPageArea();
  if (added) selectSection(added.section_key);
  showNotice("Block added. Drag it where the page needs it.");
}

async function deleteBlock(sectionKey) {
  const page = store.getCurrentPage();
  const section = store.getSection(sectionKey);
  if (!page || !section) return;

  const filled = section.headline || section.body || section.image_url || section.news_item_id;
  if (filled && !window.confirm(`Delete "${sectionKey}"? Its story and image go with it.`)) return;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(sectionKey)}`, {
    method: "DELETE",
  });
  if (!response.ok) return showNotice("Could not delete the block.");

  autosave.cancel();
  store.clearSelection();
  store.replacePage(await response.json(), { structural: true });
  renderPageArea();
  renderSidePanels();
  showNotice(`Deleted ${sectionKey}.`);
}

// Committed once, when a drag ends - not on every frame.
async function moveSection(sectionKey, rect) {
  const page = store.getCurrentPage();
  if (!page) return;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(sectionKey)}/geometry`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rect),
  });
  if (!response.ok) return showNotice("Could not move the block.");

  // Structural: the block's rectangle changed, so the canvas and every
  // measurement derived from it have to be redrawn.
  store.replacePage(await response.json(), { structural: true });
}

async function undo() {
  const result = history.undo();
  if (!result) return;
  store.replaceDraft(result.draft, "history");
  await reconcileImages(result.images);
  autosave.schedule();
}

async function redo() {
  const result = history.redo();
  if (!result) return;
  store.replaceDraft(result.draft, "history");
  await reconcileImages(result.images);
  autosave.schedule();
}

async function jumpHistory(index) {
  const result = history.jumpTo(index);
  if (!result) return;
  store.replaceDraft(result.draft, "history");
  await reconcileImages(result.images);
  autosave.schedule();
}

function cancelEdits() {
  const section = store.getSelectedSection();
  if (!section) return;
  const draft = draftFromSection(section);
  store.replaceDraft(draft, "cancel");
  // `replaceDraft` intentionally marks every replacement dirty for undo and
  // story-link operations. A Revert is different: it has just restored the
  // persisted row, so leaving it dirty would make a later block switch flush a
  // needless save and leave the toolbar claiming there is unsaved work.
  store.setSaveState("saved");
  history.reset(draft, "Reverted to saved", sectionImages);
  autosave.cancel();
  showNotice("Reverted to the last saved version.");
}

// ------------------------------------------------------------------- save ---

async function persistDraft() {
  const state = store.getState();
  const page = store.getCurrentPage();
  const draft = store.getDraft();
  if (!page || !draft || !state.selectedSectionKey) return true;

  const response = await fetch(`/api/pages/${page.id}/sections/${state.selectedSectionKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloadFromDraft(draft)),
  });
  if (!response.ok) return false;

  store.replacePage(await response.json());
  history.markSaved();
  return true;
}

function onAutosaveState(saveState, message) {
  store.setSaveState(saveState, message);
}

async function saveNow() {
  if (!store.getState().selectedSectionKey) return;
  await autosave.flush();
}

function scrollTo(elementId, notice) {
  document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (notice) showNotice(notice);
}

// Step 4 of the flow (VISION.md: "Save -> open the block for editing"):
// the story is written, so the dock opens by itself at step 1, the image.
// Step 8: composition is done, so go back up to the page with the block filled.
async function saveAndReturn() {
  await saveNow();
  scrollTo("workspaceTop");
}

// ------------------------------------------------------------- page/layout ---

function selectPage(pageId) {
  if (store.getState().dirty) autosave.flush();
  store.setCurrentPage(pageId);
}

async function applyTemplate(templateKey) {
  const page = store.getCurrentPage();
  if (!page) return;
  if (store.getState().dirty) await autosave.flush();

  const response = await fetch(`/api/pages/${page.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template: templateKey }),
  });
  store.replacePage(await response.json(), { structural: true });
  store.clearSelection();
  renderPageArea();
  renderSidePanels();
}

function toggleStoryPicker() {
  const state = store.getState();
  if (!state.selectedSectionKey) return;
  store.setStoryPickerOpen(!state.storyPickerOpen);
}

function toggleDock() {
  const shell = document.querySelector(".workspace-shell");
  if (!shell) return;
  setEditorCollapsed(shell, !getSizes().editorCollapsed);
  applyTransform();
}

function openPublish() {
  const { newspaper } = store.getState();
  if (newspaper) showPublicationFiles(newspaper.id);
}

// --------------------------------------------------------------- rendering ---

function renderShell() {
  const content = document.getElementById("content");
  if (!content) return;

  content.innerHTML = `
    <div class="workspace-shell">
      <header class="workspace-toolbar" id="toolbar"></header>

      <div class="workspace-top" id="workspaceTop">
        <!-- LEFT: how the open block is SET. Typography, the story's own
             particulars, its history and the small layout - everything that
             describes the block rather than composes it. It sits beside the
             page because that is what it changes: a type size set here shows on
             the sheet a hand's width away, which is the whole reason a desk
             changes one. It was three folded panels at the bottom of a rail
             below the fold, where nobody found them. -->
        <aside class="workspace-tools" id="workspaceTools">
          <div class="workspace-tools-head">
            <h3>Block settings</h3>
            <span class="workspace-tools-block" id="toolsBlockName">No block open</span>
          </div>
          <div class="workspace-tools-body" id="workspaceToolsPanel"></div>
        </aside>

        <div class="splitter splitter-v" id="toolsResizer" role="separator"
             aria-orientation="vertical" tabindex="0" title="Drag to resize the block settings rail"></div>

        <!-- RIGHT: the page itself. -->
        <main class="workspace-canvas-host">
          <!-- Two rows, and the split is a real one: the first says WHICH page
               and WHAT SHAPE it is, the second says what to DO with it. Twelve
               controls in one wrapping row re-flowed into two, three or four
               rows depending on the window - 186px of chrome at a 1129px
               viewport, taken straight out of the page's own room. Two declared
               rows are shorter than four accidental ones and always in the
               same place. -->
          <div class="canvas-toolbar">
            <div class="canvas-toolbar-row">
              <!-- "Layout" was labelled and the pages beside it were not, so the
                   first row read as four numbers and then a labelled control. -->
              <span class="canvas-toolbar-label">Page</span>
              <div id="pageSwitcher" class="page-switcher"></div>
              <div class="canvas-toolbar-divider"></div>
              <div id="layouts" class="layout-switcher"></div>
              <button type="button" class="layout-btn" id="addBlockBtn" title="Add a block to this page">+ Block</button>
              <button type="button" class="layout-btn danger" id="removeBlockBtn" title="Remove the selected block">− Block</button>
            </div>
            <!-- Five buttons in a row read as five unrelated buttons. Three of
                 them are the three moves a sub-editor has when copy does not
                 fit the hole - cut it, set it tighter, carry it over - and the
                 dividers say so. The other two are not moves on a story at all:
                 one fills the day's standing features, one takes the editing
                 chrome off the page. -->
            <div class="canvas-toolbar-row">
              <span class="canvas-toolbar-label">Copy</span>
              <button type="button" class="layout-btn" id="worklistBtn"
                      title="Every block on this edition that is not finished, and how much copy each one holds">What's left</button>
              <button type="button" class="layout-btn" id="fitBtn"
                      title="Set the selected block a notch tighter so its copy fits">Make it fit</button>
              <button type="button" class="layout-btn" id="carryOverBtn"
                      title="Carry what does not fit onto a later page, with a jump line">Carry over</button>
              <div class="canvas-toolbar-divider"></div>
              <button type="button" class="layout-btn" id="fillFeaturesBtn"
                      title="Fill राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष and सुविचार for this edition's date">Fill features</button>
              <button type="button" class="layout-btn" id="writeEmptyBtn"
                      title="Write every block on this page that has a headline and no copy — one request per block, and every one comes back as a proposal">Write empty blocks</button>
              <div class="canvas-toolbar-divider"></div>
              <button type="button" class="layout-btn active" id="guidesToggleBtn"
                      title="Show or hide ruler guides - hiding never deletes them">Guides</button>
              <button type="button" class="layout-btn" id="printViewBtn"
                      title="See the page as it prints - no block chrome, no grid">Print view</button>
            </div>
          </div>
          <div id="canvas" class="canvas-stage"></div>
          <!-- Zoom and "page 1 of 4" are controls for the VIEW, so they sit on
               the view - in the empty grey beside the sheet, opposite the
               minimap - rather than taking the tail of a toolbar row and
               wrapping it onto a third line. -->
          <div class="canvas-view-controls">
            <div id="pageIndicator"></div>
            ${zoomControlMarkup()}
          </div>
          <div class="splitter splitter-h" id="canvasResizer" role="separator"
               aria-orientation="horizontal" tabindex="0" title="Drag to resize the page area"></div>
        </main>

        <!-- BELOW BOTH: the desk. Writing on the left with most of the width,
             because a story wants width; the machine that helps write it on the
             right, where it can be read against the copy instead of underneath
             it. It is a child of this grid rather than a sibling so that a
             narrow window can reorder all three - see the grid areas in
             styles.css: the page, then the desk, then the settings. -->
        <section class="workspace-external-editor" id="externalEditorPanel"></section>
      </div>

      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <aside class="workspace-sidebar-left" id="sidebarLeft">
        <div class="sidebar-drawer-header">
          <h3>Story Explorer</h3>
          <button class="sidebar-drawer-close" id="sidebarDrawerClose">&times;</button>
        </div>
        <div class="sidebar-panel" id="sidebarPanel"></div>
      </aside>
    </div>
    <div class="modal-root" id="modalRoot"></div>
  `;

  const shell = content.querySelector(".workspace-shell");
  applyStoredLayout(shell);
  bindResizers(shell);

  renderToolbar({
    newspaper: store.getState().newspaper,
    hasSelection: false,
    storyPickerOpen: false,
    handlers: { onSave: saveNow, onPublish: openPublish, onToggleStoryPicker: toggleStoryPicker, onUndo: undo, onRedo: redo,
      onPreflight: runPreflight, onPressFile: downloadPressFile },
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => store.setStoryPickerOpen(false));
  document.getElementById("sidebarDrawerClose").addEventListener("click", () => store.setStoryPickerOpen(false));

  document.getElementById("addBlockBtn").addEventListener("click", addBlock);
  document.getElementById("removeBlockBtn").addEventListener("click", () => {
    const key = store.getState().selectedSectionKey;
    if (!key) return showNotice("Select a block on the page first.");
    deleteBlock(key);
  });

  // Print view. Not a mode with its own screen and not a tab - one toggle that
  // takes the editing chrome off the page the editor is already looking at, so
  // the desk can see what will come off the press without leaving the
  // workspace (VISION.md: everything happens on the one screen).
  document.getElementById("printViewBtn").addEventListener("click", (event) => {
    const on = document.body.classList.toggle("print-view");
    event.currentTarget.classList.toggle("active", on);
    event.currentTarget.textContent = on ? "Editing view" : "Print view";
  });

  // Guides ON/OFF. A view toggle, not a data operation - hiding never
  // deletes a guide or touches its stored position (setGuidesVisible only
  // ever toggles a CSS class), and turning it back on shows the exact same
  // guides. Not persisted: nothing in this project keeps a per-desk editor
  // settings row to persist a view toggle into, so this stays session-only,
  // same as the print-view toggle beside it.
  document.getElementById("guidesToggleBtn").addEventListener("click", (event) => {
    guidesVisible = !guidesVisible;
    event.currentTarget.classList.toggle("active", guidesVisible);
    setGuidesVisible(guidesVisible);
  });

  // The day's standing features. One press fills every block the layout marked
  // as one - the horoscope, the almanac box, दिनविशेष, the thought for the day -
  // for this edition's own date. What lands in them is ordinary copy the desk
  // can rewrite (VISION.md: AI assists, never owns).
  document.getElementById("fillFeaturesBtn").addEventListener("click", fillFeatures);

  // Writing the empty blocks of a page. One request per block, two at a time -
  // never the whole page in one request (bulk-generate.js says why).
  document.getElementById("writeEmptyBtn").addEventListener("click", writeEmptyBlocks);

  // Jump lines. The character grid already knows exactly how much of the story
  // will not fit; this turns that measurement into the move a sub-editor
  // actually makes - put what fits here, the rest on a later page, and set both
  // lines. One press, and it says where the story went.
  document.getElementById("carryOverBtn").addEventListener("click", carryOver);

  // What is left. The whole edition's unfinished work on one list, each block
  // with the number of characters it holds - which is the number a sub-editor
  // needs BEFORE writing, not after the copy has already run over.
  document.getElementById("worklistBtn").addEventListener("click", showWorklist);

  // Making a story fit. The third of the three moves a sub-editor has, beside
  // cutting and carrying over: set it a notch tighter. The software knows every
  // number involved, so it can find the smallest change that works - and say so
  // before it does it.
  document.getElementById("fitBtn").addEventListener("click", makeItFit);

  bindZoomControl();
  // Who writes this paper's copy is configuration, so the editor asks rather
  // than assuming - the AI panel's menu then describes the real newsroom.
  loadAiStatus();
  renderPageArea();
  renderSidePanels();
  renderStoryPickerPanel();
  loadPageGuides();
  subscribeViews();
  if (!window.__sahasShortcutsBound) {
    window.__sahasShortcutsBound = true;
    bindKeyboardShortcuts();
  }
  selectFirstSection();

  // Fit mode is derived from the container, so it has to be recomputed whenever
  // the container changes size - a window resize or a splitter drag.
  measureToolbar();
  window.addEventListener("resize", onWorkspaceResized);
  window.addEventListener("workspace-resized", onWorkspaceResized);
}

// Both the page canvas and the live preview are scaled to their containers, so
// both have to be re-fitted whenever those containers change size.
function onWorkspaceResized() {
  measureToolbar();
  applyTransform();
}

/**
 * Publishes the workspace toolbar's real height as a CSS variable.
 *
 * The page canvas pins itself under that toolbar so the page stays in view
 * while the dock scrolls past it. The offset cannot be a
 * constant: the toolbar carries Save, Preflight, Press file and Publish, and it
 * wraps to two rows on a narrow window - a hard-coded 36px would then hide the
 * top of the page behind it.
 */
function measureToolbar() {
  const toolbar = document.getElementById("toolbar");
  const shell = document.querySelector(".workspace-shell");
  if (!toolbar || !shell) return;
  shell.style.setProperty("--toolbar-h", `${Math.round(toolbar.getBoundingClientRect().height)}px`);

  // How tall the page area is, so the settings rail beside it can be capped to
  // the same height and scroll inside itself.
  //
  // Without the cap the rail is as tall as its own panels, and being the taller
  // of the two it sets the height of the whole top row - which pushes the
  // editor below the fold. That is the one failure this layout exists to
  // prevent, and it came straight back the moment a second column appeared up
  // here. The page area's height does not depend on the rail (it is the canvas
  // toolbar plus --canvas-height), so there is no circle in measuring it.
  const pageArea = shell.querySelector(".workspace-canvas-host");
  if (pageArea) {
    shell.style.setProperty("--page-area-h", `${Math.round(pageArea.getBoundingClientRect().height)}px`);
  }
}

// Preflight, and passing a page for press.
//
// The checks a print shop runs before the plate: pictures with the resolution
// for the size they are used at, copy that fits, nothing outside the matter,
// nothing overlapping, no jump that leads nowhere. Findings are listed against
// the block they are on, and clicking one opens that block - the point is to
// fix it, not to read a report.
async function runPreflight() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Checking the edition…");
  const report = await fetch(`/api/newspapers/${newspaper.id}/preflight`).then((r) => r.json());
  if (report.error) return showNotice(report.error);

  renderPreflight(report);
  showNotice(
    report.passed
      ? `Preflight clean. ${report.counts.warning} warning${report.counts.warning === 1 ? "" : "s"} to look at.`
      : `${report.counts.error} error${report.counts.error === 1 ? "" : "s"} must be fixed before this goes to press.`,
  );
}

function renderPreflight(report) {
  document.getElementById("preflightPanel")?.remove();
  if (!report.findings.length) return;

  const order = { error: 0, warning: 1, note: 2 };
  const rows = [...report.findings]
    .sort((a, b) => order[a.level] - order[b.level] || a.pageNumber - b.pageNumber)
    .map(
      (finding) => `
        <li class="preflight-row preflight-${finding.level}"
            data-page="${finding.pageNumber}" data-section="${escapeHtml(finding.sectionKey)}">
          <span class="preflight-where">p${finding.pageNumber} · ${escapeHtml(finding.sectionKey)}</span>
          <span class="preflight-what">${escapeHtml(finding.message)}</span>
        </li>`,
    )
    .join("");

  const panel = document.createElement("aside");
  panel.id = "preflightPanel";
  panel.className = "preflight-panel";
  panel.innerHTML = `
    <header>
      <strong>Preflight — ${report.passed ? "clean" : `${report.counts.error} to fix`}</strong>
      <button type="button" id="preflightClose" aria-label="Close">×</button>
    </header>
    <ul>${rows}</ul>`;
  document.body.appendChild(panel);

  document.getElementById("preflightClose").addEventListener("click", closeOnEscape(() => panel.remove()));
  panel.querySelectorAll(".preflight-row").forEach((row) => {
    row.addEventListener("click", () => {
      const page = store.getState().pages.find((p) => Number(p.page_number) === Number(row.dataset.page));
      if (page) store.setCurrentPage(page.id);
      const key = row.dataset.section.split(" / ")[0];
      if (store.getSection(key)) selectSection(key);
    });
  });
}

// What is left on this edition.
async function showWorklist() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  // Whatever is being typed counts as work done, so it is saved before the
  // edition is measured - otherwise the list reports the block the desk is
  // looking at as empty.
  if (store.getState().dirty) await autosave.flush();

  const list = await fetch(`/api/newspapers/${newspaper.id}/worklist`).then((r) => r.json());
  if (list.error) return showNotice(list.error);

  renderWorklist(list, {
    onGoTo: (pageNumber, sectionKey) => {
      const page = store.getState().pages.find((p) => Number(p.page_number) === Number(pageNumber));
      if (page) store.setCurrentPage(page.id);
      if (store.getSection(sectionKey)) selectSection(sectionKey);
    },
  });
}

// Make the selected block's copy fit.
//
// It asks first and applies second, in two presses, because changing the type
// size of a block is a design decision: the desk sees exactly what the change
// would be, and can carry the story over or cut it instead.
async function makeItFit() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block that will not fit first.");

  await saveNow();
  const path = `/api/pages/${page.id}/sections/${encodeURIComponent(key)}/fit`;
  const proposal = await fetch(path).then((r) => r.json()).catch(() => ({}));

  if (proposal.error) return showNotice(proposal.error);
  // Already fits, or nothing legible would make it fit - either way there is
  // nothing to apply, and the message says which.
  if (!proposal.fits || proposal.to === undefined) return showNotice(proposal.message);

  if (!window.confirm(`${proposal.message}\n\nApply it?`)) return;

  const applied = await fetch(path, { method: "POST" }).then((r) => r.json()).catch(() => ({}));
  if (applied.error) return showNotice(applied.error);

  const pages = await fetch(`/api/newspapers/${store.getState().newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((updated) => store.replacePage(updated, { structural: true }));
  showNotice(applied.message);
}

// The press file. Scribus opens it, the designer adjusts, and the CMYK PDF
// comes out of Scribus - the pipeline CLAUDE.md describes.
async function downloadPressFile() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Generating the press package…");
  // The package, not the bare .sla: a Scribus document alone points at pictures
  // by path, and those paths mean nothing on the machine that opens it.
  const response = await fetch(`/api/newspapers/${newspaper.id}/press-package`);
  if (!response.ok) return showNotice("The press package could not be generated.");

  const pictures = response.headers.get("X-Pictures-Included") || "0";
  const missing = Number(response.headers.get("X-Pictures-Missing") || 0);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `sahas-${String(newspaper.publication_date).slice(0, 10)}-press.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showNotice(
    `Press package downloaded — the document and ${pictures} photograph${pictures === "1" ? "" : "s"}.` +
      (missing ? ` ${missing} picture file${missing === 1 ? "" : "s"} could not be found on the server.` : "") +
      " Unzip it and open the .sla in Scribus.",
  );
}

async function carryOver() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block that will not fit first.");

  await saveNow();
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/carry-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "This story could not be carried over.");

  const pages = await fetch(`/api/newspapers/${store.getState().newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((updated) => store.replacePage(updated, { structural: true }));
  showNotice(`Carried on to page ${result.to.pageNumber}, block "${result.to.sectionKey}". ${result.carryLine}`);
}

async function fillFeatures() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  showNotice("Filling today's features…");
  // The effort tier chosen in the AI panel rides along, so "Fill features" and
  // the per-block actions obey the same dial.
  const response = await fetch(`/api/newspapers/${newspaper.id}/features`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tier: getAiTier() }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "The features could not be filled.");

  // Reload the pages so the filled blocks appear, then say plainly what did and
  // did not run. A box that could not be filled is reported, never left looking
  // finished.
  const pages = await fetch(`/api/newspapers/${newspaper.id}/pages`).then((r) => r.json());
  pages.forEach((page) => store.replacePage(page, { structural: true }));

  const filled = result.filled?.length || 0;
  const blocked = result.notes?.length || 0;
  showNotice(
    filled
      ? `Filled ${filled} feature${filled === 1 ? "" : "s"}${blocked ? `. ${result.notes[result.notes.length - 1]}` : "."}`
      : result.notes?.[result.notes.length - 1] || "Nothing to fill.",
  );
}

/**
 * Writes every block on this page that has a headline and no copy.
 *
 * One request per block, two at a time - never the whole page in one request.
 * See bulk-generate.js for why. Nothing is saved: every block comes back as a
 * proposal and the desk accepts them one at a time, exactly as it does for a
 * single block.
 */
async function writeEmptyBlocks() {
  const page = store.getCurrentPage();
  if (!page) return;

  const { ready, skipped } = candidatesOn(page);
  if (!ready.length) {
    return showNotice(
      skipped.length
        ? `Nothing to write on this page. ${skipped.length} block${skipped.length === 1 ? " was" : "s were"} left alone — give a block a headline and no copy, and it becomes one to write.`
        : "Nothing to write on this page.",
    );
  }

  const button = document.getElementById("writeEmptyBtn");
  const label = button?.textContent;
  if (button) button.disabled = true;

  try {
    const batch = await runBulk({
      blocks: ready,
      onProgress: ({ phase, finished, total, sectionKey }) => {
        // "Generating 3 of 12" - and which one, because a desk watching a page
        // fill wants to know where it has got to.
        if (button) button.textContent = `Writing ${Math.min(finished + 1, total)} of ${total}…`;
        if (phase === "start") showNotice(`Writing ${sectionKey} — ${finished} of ${total} done.`);
      },
      request: (block) =>
        fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(block.sectionKey)}/write`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed: block.seed, notes: block.notes, language: block.language, tier: getAiTier() }),
        }).then((response) => response.json().catch(() => ({ error: "The AI did not answer." }))),
    });

    showBulkProposals(batch, skipped);
  } finally {
    if (button) { button.disabled = false; button.textContent = label; }
  }
}

/**
 * The batch, as a list the desk works down.
 *
 * Each proposal is accepted into its own block through the ordinary path -
 * select the block, patch the draft, let autosave carry it - so a bulk run and
 * a single block end up in exactly the same place.
 */
function showBulkProposals(batch, skipped) {
  const rows = batch.results.map((result) => {
    if (result.error) {
      return `<li class="bulk-row is-error"><strong>${escapeHtml(result.sectionKey)}</strong>
        <span class="muted">${escapeHtml(result.error)}</span></li>`;
    }
    return `<li class="bulk-row">
      <strong>${escapeHtml(result.sectionKey)}</strong>
      <span class="bulk-headline">${escapeHtml(result.proposal.headline)}</span>
      <span class="muted">${result.fit.charsUsed} of ${result.fit.bodyCharBudget} characters</span>
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" data-bulk-accept="${escapeHtml(result.sectionKey)}">Accept</button>
    </li>`;
  }).join("");

  const skippedNote = skipped.length
    ? `<p class="muted ext-note">Left alone: ${skipped.map((s) => `${escapeHtml(s.sectionKey)} (${escapeHtml(s.why)})`).join(", ")}.</p>`
    : "";

  // The same kind of panel over the workspace that "What's left" uses - never
  // another screen (VISION.md: everything happens inside the one workspace).
  document.getElementById("bulkPanel")?.remove();
  const panel = document.createElement("aside");
  panel.id = "bulkPanel";
  panel.className = "preflight-panel worklist-panel";
  panel.innerHTML = `
    <header>
      <strong>Written ${batch.written} of ${batch.written + batch.failed}</strong>
      <button type="button" id="bulkClose" aria-label="Close">×</button>
    </header>
    <p class="worklist-summary">Nothing has been saved. Accept a block and it lands in that block's
       draft, marked <strong>needs review</strong>, exactly as a single block does.</p>
    <ul class="bulk-list">${rows}</ul>
    ${skippedNote}
    <p class="ai-proposal-warn">The desk must check every fact before any of this is printed.</p>`;
  document.body.appendChild(panel);
  document.getElementById("bulkClose").addEventListener("click", closeOnEscape(() => panel.remove()));

  panel.querySelectorAll("[data-bulk-accept]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.bulkAccept;
      const result = batch.results.find((r) => r.sectionKey === key);
      if (!result?.proposal) return;
      selectSection(key);
      patchDraft({ ...result.proposal, aiGenerated: true, status: "needs_review" }, "bulk");
      button.disabled = true;
      button.textContent = "Accepted";
    });
  });
}

// A page with no block selected leaves the dock empty, which
// reads as "nothing here". Opening a page opens its first block, so there is
// always something loaded to work on (VISION.md: the software guides the flow).
function selectFirstSection() {
  const page = store.getCurrentPage();
  const first = page?.sections?.[0];
  if (!first) return;
  if (store.getState().selectedSectionKey) return;
  selectSection(first.section_key);
}

function syncRemoveBlockButton() {
  const button = document.getElementById("removeBlockBtn");
  if (button) button.disabled = !store.getState().selectedSectionKey;
}

function renderPageArea() {
  const state = store.getState();
  const page = store.getCurrentPage();
  renderCanvas(page, state.newspaper, state, {
    onSelectSection: selectSection,
    onSectionAction,
    onMoveSection: moveSection,
    guides: pageGuides,
    guidesVisible,
    onCreateGuide: createGuide,
    onMoveGuide: moveGuide,
    onDeleteGuide: deleteGuide,
  });
  renderPageNavigator(state.pages, page, state.newspaper, selectPage);
  renderLayoutSidebar(page, applyTemplate);
  const indicator = document.getElementById("pageIndicator");
  if (indicator) indicator.innerHTML = pageIndicatorMarkup(page, state.pages);
  syncZoomControl();
  syncRemoveBlockButton();
}

function renderSidePanels() {
  const section = store.getSelectedSection();
  const view = currentView();
  const story = currentStory();

  renderExternalEditor(section, view, story, store.getState().reporterNews, {
    onPatch: patchDraft,
    onChooseStory: chooseStory,
    onSave: saveNow,
    onReturnToPage: saveAndReturn,
    onCancel: cancelEdits,
    onUndo: undo,
    onRedo: redo,
    onJumpHistory: jumpHistory,
    onToggleDock: toggleDock,
    getView: currentView,
    getSection: () => store.getSelectedSection(),
    getImages: () => sectionImages,
    getSelectedImage: () => sectionImages.find((image) => image.id === store.getState().selectedImageId) || null,
    // The story editor shows the block's real character budget under the box.
    getBudget: () => {
      const section = store.getSelectedSection();
      const view = currentView();
      if (!section || !view) return 0;
      // The same character grid the Space panel and preflight use - never a
      // second measurement that could quietly disagree with them.
      return buildFlowMap(section, view, sectionImages.map(flowImageFromRow)).bodyCharBudget;
    },
    // The small layout in the dock needs the whole page, not just this block.
    getPage: () => store.getCurrentPage(),
    getNewspaper: () => store.getState().newspaper,
    onSelectSection: selectSection,
    onSelectPart: selectPart,
    onToggleImageSelection: toggleImageSelection,
    onAlignImages: alignSelectedImages,
    onRemoveSelectedImages: removeSelectedImages,
    onAddImage: addSectionImage,
    onPatchImage: patchSectionImage,
    onRemoveImage: removeSectionImage,
    onRemoveBackground: removeImageBackground,
    onRequestSmartCard: requestSmartCard,
    onPickBlock: () => {
      selectFirstSection();
      scrollTo("workspaceTop");
    },
  });
}

function renderStoryPickerPanel() {
  const state = store.getState();
  renderStoryPicker(store.getCurrentPage(), state.reporterNews, state.selectedSectionKey, selectStoryForSection);
}

/**
 * Repaints every block on the page from the rows the store now holds.
 *
 * The selected block is painted from the DRAFT, not from the row. A save that
 * lands while somebody is still typing returns the copy as it was when the
 * request left; painting that row would take the last few characters back off
 * the page under the writer's hands. `currentView()` layers the draft over the
 * row, which is the same rule the canvas uses everywhere else.
 */
function repaintSections(page) {
  if (!page?.sections?.length) return;
  const state = store.getState();
  const draft = store.getDraft();

  for (const section of page.sections) {
    const selected = section.section_key === state.selectedSectionKey;
    const view = selected ? currentView() : viewOfSection(section, draft, state.selectedSectionKey);
    if (!view) continue;
    refreshSection(section, view, { selected, dirty: selected && state.dirty });
  }
}

// -------------------------------------------------------- keyboard shortcuts ---
//
// A professional editor's shortcuts must never fight typing: Ctrl+Z inside a
// text field is the browser's own undo of the last few characters, not this
// editor's undo of the last edit, and arrow keys inside a field move the text
// cursor, not the selected object. Every shortcut here is guarded on that.

function isTypingTarget(el) {
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}

function nudgeSelectedImage(dx, dy) {
  // Two or more pictures selected: move them all together, one history step -
  // the single-picture path below remains exactly what it always was.
  const ids = store.getSelectedImageIds();
  if (ids.length > 1) return nudgeSelectedImages(dx, dy);

  const { selectedPart, selectedImageId } = store.getState();
  if (selectedPart !== "image" || !selectedImageId) return false;
  const image = sectionImages.find((row) => row.id === selectedImageId);
  if (!image) return false;
  patchSectionImage(selectedImageId, {
    x: Math.round((Number(image.x_px) || 0) + dx),
    y: Math.round((Number(image.y_px) || 0) + dy),
  });
  return true;
}

function deleteSelectedImage() {
  const ids = store.getSelectedImageIds();
  if (ids.length > 1) return removeSelectedImages();

  const { selectedPart, selectedImageId } = store.getState();
  if (selectedPart !== "image" || !selectedImageId) return false;
  removeSectionImage(selectedImageId);
  return true;
}

// ---------------------------------------------------- multi-selection (Stage 7) ---
//
// Pictures are the one object with real, freely-persisted X/Y/W/H (see
// external-editor/align.js's own note) - a block's geometry is always
// re-snapped to the grid server-side, and text has no coordinate at all - so
// a multi-selection, and everything that acts on one, is scoped to pictures
// within the currently open block.

function selectedImageRows() {
  const ids = new Set(store.getSelectedImageIds());
  return sectionImages.filter((row) => ids.has(row.id));
}

async function alignSelectedImages(kind) {
  const rows = selectedImageRows();
  if (rows.length < 2) return;
  const patches = computeAlignment(rows, kind);
  for (const row of rows) {
    const patch = patches[row.id];
    if (patch) await persistImagePatch(row.id, patch);
  }
  redrawCompose();
  history.record(store.getDraft(), { coalesce: false, label: "Aligned pictures", kind: "image", images: sectionImages });
}

function nudgeSelectedImages(dx, dy) {
  const rows = selectedImageRows();
  if (rows.length < 2) return false;
  Promise.all(rows.map((row) => persistImagePatch(row.id, {
    x: Math.round((Number(row.x_px) || 0) + dx),
    y: Math.round((Number(row.y_px) || 0) + dy),
  }))).then(() => {
    redrawCompose();
    history.record(store.getDraft(), { coalesce: false, label: "Pictures moved", kind: "image", images: sectionImages });
  });
  return true;
}

// Deleting is not undoable for a single picture either (history.js's own
// reconcileImages() explicitly leaves added/removed rows alone - see its own
// note) - bulk delete matches that existing behaviour rather than quietly
// becoming the one delete path that can be undone.
async function removeSelectedImages() {
  const ids = [...store.getSelectedImageIds()];
  if (ids.length < 2) return false;
  for (const id of ids) await removeSectionImage(id);
  store.setSelectedPart("block");
  return true;
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    const typing = isTypingTarget(event.target);
    const primary = event.ctrlKey || event.metaKey;

    if (event.key === "Escape") {
      // First press backs out of the object that is targeted, to the block
      // itself - not out of the block entirely, which would read as closing
      // the editor a desk is still looking at. A field also gives up focus,
      // the ordinary meaning of Escape in a form. A multi-selection is one
      // step further "in" than a single picture, so it collapses to its
      // primary first - only the step after that reaches "block".
      if (typing) event.target.blur();
      if (store.collapseMultiSelection()) return;
      if (store.getState().selectedPart !== "block") store.setSelectedPart("block");
      return;
    }

    if (primary && !event.shiftKey && event.key.toLowerCase() === "z") {
      if (typing) return; // the field's own undo, not the editor's
      event.preventDefault();
      undo();
      return;
    }
    if (primary && (event.shiftKey && event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      if (typing) return;
      event.preventDefault();
      redo();
      return;
    }

    if (typing) return; // everything below moves/deletes an OBJECT, never while typing

    if (event.key === "Delete" || event.key === "Backspace") {
      if (deleteSelectedImage()) event.preventDefault();
      return;
    }
    if (event.key.startsWith("Arrow")) {
      const step = event.shiftKey ? 10 : 1;
      const delta = {
        ArrowUp: [0, -step], ArrowDown: [0, step],
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      }[event.key];
      if (delta && nudgeSelectedImage(delta[0], delta[1])) event.preventDefault();
    }
  });
}

// ------------------------------------------------------------ subscriptions ---

function subscribeViews() {
  // Part 14: a keystroke repaints one canvas box and the read-only parts of the
  // side panels. Nothing else re-renders.
  store.subscribe(store.TOPICS.DRAFT, ({ source }) => {
    const section = store.getSelectedSection();
    const view = currentView();
    if (!section || !view) return;
    refreshSection(section, view, { selected: true, dirty: store.isDirty() });
    refreshExternalEditor(section, view, currentStory(), source, store.getSelectedPart(), store.getSelectedImageIds());
  });

  // Which OBJECT within the block is targeted changed (a click on the
  // headline frame, the body, a picture...) - not what it says, so this
  // updates the Block Editor's selection box and the Typography panel's
  // highlighted field without touching the draft or re-fetching anything.
  store.subscribe(store.TOPICS.SELECTION, ({ part }) => {
    if (part === undefined) return; // a block (not a part) changed - selectSection() already handled it
    const section = store.getSelectedSection();
    const view = currentView();
    if (!section || !view) return;
    refreshExternalEditor(section, view, currentStory(), "selection", store.getSelectedPart(), store.getSelectedImageIds());
  });

  store.subscribe(store.TOPICS.SAVE, () => {
    const { saveState, saveError, dirty } = store.getState();
    refreshSaveIndicator(saveState, dirty, saveError);
    const section = store.getSelectedSection();
    const view = currentView();
    if (section && view) refreshSection(section, view, { selected: true, dirty });
  });

  // A save returns the same layout with fresher rows. Only the things a save can
  // change are touched - never the panels the editor is working in.
  store.subscribe(store.TOPICS.PAGE_SYNC, () => {
    const state = store.getState();
    const page = store.getCurrentPage();
    renderPageNavigator(state.pages, page, state.newspaper, selectPage);
    renderMiniMap(page, state.newspaper, state.selectedSectionKey);
    // The layout picker guards against overwriting filled blocks, so it has to
    // see the blocks a save just filled - otherwise the guard is stale from the
    // moment the first block is written.
    renderLayoutSidebar(page, applyTemplate);

    // THE BLOCKS THEMSELVES. This is what was missing, and it was missing in a
    // way that hid itself: after a save the canvas usually looked right,
    // because the DRAFT subscriber had already painted the selected block on
    // the last keystroke. It was only wrong when the fresher rows carried
    // something the canvas had never been told - Make it fit changing type
    // sizes, Carry over moving copy onto a second block, Fill features writing
    // a dozen blocks at once, a picture endpoint returning a repositioned
    // block. Each of those replaced the page and left the page LOOKING like it
    // did before.
    //
    // One targeted refreshSection per block, not a workspace re-render: the
    // panels the editor is working in, the caret and every scroll position
    // survive, which is the whole reason PAGE_SYNC exists as a topic separate
    // from PAGE.
    repaintSections(page);

    const section = store.getSelectedSection();
    if (section) refreshDockSavedAt(section);
  });

  store.subscribe(store.TOPICS.PAGE, () => {
    renderPageArea();
    renderSidePanels();
    renderStoryPickerPanel();
    loadPageGuides();
    refreshToolbarSelection(Boolean(store.getState().selectedSectionKey), false);
    selectFirstSection();
  });

  store.subscribe(store.TOPICS.STORY_PICKER, () => {
    const open = store.getState().storyPickerOpen;
    document.getElementById("sidebarLeft")?.classList.toggle("open", open);
    document.getElementById("sidebarBackdrop")?.classList.toggle("open", open);
    document.getElementById("tbFromReporter")?.classList.toggle("active", open);
  });
}
