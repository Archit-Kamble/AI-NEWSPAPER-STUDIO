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
import { askPrompt, askConfirm } from "../ui/dialog.js";
import { busyButton } from "../ui/busy.js";

import { renderCanvas, refreshSection, refreshSelection, refreshGuides, refreshColumnRules } from "./canvas/canvas.js";
import { renderMiniMap, configure as configureCanvasView, applyTransform } from "./canvas/canvas-view.js";
import { refreshRulers } from "./canvas/ruler.js";
import { setGuidesVisible } from "./canvas/page-guides.js";
import { loadGeometry, findFreeRect, getGeometry } from "./canvas/grid.js";
import { loadIdentity, getIdentity } from "./canvas/masthead.js";
// The real advance widths of the publication faces. Every measurement in the
// workspace - what fits, where a line breaks, how full a block is - is made
// against these, so they are loaded before the first paint.
import { ensureFontsLoaded, fontsReady } from "./compose/font-metrics.js";
import { composeSection } from "./compose/section-adapter.js";
// Real Devanagari shaping (see compose/shaper.js). Awaited alongside the
// fonts, before the first paint, for the same reason: a page composed from
// summed hmtx advances and then repainted once real shaping loads is two
// different pages, and this workspace must never show the desk the wrong one.
import { ensureShaperReady, requireShaperReady } from "./compose/shaper.js";
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
import { showFailure } from "../ui/notice.js";
import { applyStoredLayout, bindResizers, setEditorCollapsed, getSizes } from "./layout/resizer.js";
import { showPublicationFiles } from "./publication.js";
import { loadAiStatus, getAiTier, retrievalStatusMarkup } from "./external-editor/ai-panel.js";
import { renderWorklist } from "./worklist-panel.js";
import { renderPressPanel } from "./press-panel.js";
import * as store from "./store.js";
import * as history from "./history/history.js";
import * as autosave from "./autosave/autosave.js";
import { draftFromSection, draftFromStory, payloadFromDraft, viewOfSection } from "./section-model.js";
import { canRenderSmartCard, smartCardText } from "./smart-cards/smart-cards.js";
// The block a card wants when it brings its own - one catalogue, read by the
// panel's preview and by the placement below, so a desk never reviews a card
// at one size and gets it at another.
import { smartCardBlockSize } from "./smart-cards/layout.js";
import { smartCardFrame } from "./canvas/section-thumb.js";
import { candidatesOn, runBulk } from "./external-editor/bulk-generate.js";
import { computeAlignment } from "./external-editor/align.js";
import { escapeHtml, closeOnEscape, nameThePanel } from "./format.js";
import { isContentEdit, isExplicit } from "./status/section-status.js";
import { buildFlowMap, flowImageFromRow } from "./layout/text-flow.js";
import { setContinuations, legsOf, legsSentence } from "./layout/continuations.js";
// A side-effect module (CJS + globalThis, so the server can read it too), the
// same way the device bar and Scribus reach it.
import "./layout/typefaces.js";

const { TYPEFACES } = globalThis.SahasTypefaces;

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

/**
 * Leaving the edition - by the Back button, by the sidebar, or by signing out.
 *
 * The workspace is the one screen in this product that holds work which is
 * not yet in the database: autosave is on a timer, so between the last
 * keystroke and the next tick the only copy of a sentence is in the draft.
 * Navigating away used to be impossible (there was nowhere to navigate TO),
 * and now that Back goes back through the desk it is one keypress. So the
 * pending save is FLUSHED rather than cancelled - a desk who leaves a block
 * mid-sentence keeps the sentence.
 *
 * It is deliberately tolerant: a failed flush is reported and does not stop
 * the desk leaving. Trapping somebody on a screen because a save failed is
 * worse than the save failing, and the block is still in the draft.
 */
export async function leaveWorkspace() {
  try {
    await autosave.flush();
  } catch (error) {
    console.error('The open block could not be saved on the way out:', error);
  }
}

// What the signed-in person may do, as the SERVER answers it. Not a copy of
// the rules - src/auth/roles.js is the only statement of those - and not a
// guess from a role string either, which is what public/admin.js used to make.
// It decides one thing here: whether the Publish button is drawn.
let deskCan = {};

/**
 * WHAT THE DESK LOOKS AT WHILE AN EDITION OPENS.
 *
 * Measured by holding the pages API at 3 s and pressing Open. Frame by frame
 * from the click: the editions list, unchanged, unchanged, unchanged - then
 * the whole workspace at once at 3.81 s. The button was never disabled and the
 * cursor never changed, so for three seconds the application looked like it
 * had ignored the click, on the commonest action in the product.
 *
 * This is deliberately the SHAPE of the workspace rather than a spinner in the
 * middle of the screen: a desk should see the sheet arriving where the sheet
 * goes. It is thrown away wholesale by renderShell(), so it can never be a
 * second layout to keep in step with the real one - it has no ids, no
 * controls and nothing reads it.
 */
function renderWorkspaceSkeleton() {
  const content = document.getElementById("content");
  if (!content) return;
  content.setAttribute("aria-busy", "true");
  content.innerHTML = `
    <div class="workspace-skeleton" role="status" aria-live="polite">
      <span class="visually-hidden">Opening the edition…</span>
      <div class="ws-skel-bar"><span class="skel skel-pill"></span><span class="skel skel-pill"></span><span class="skel skel-pill wide"></span></div>
      <div class="ws-skel-body">
        <div class="ws-skel-rail"><span class="skel skel-line"></span><span class="skel skel-line"></span><span class="skel skel-line short"></span><span class="skel skel-block"></span></div>
        <div class="ws-skel-sheet"><span class="skel skel-sheet"></span><p class="ws-skel-say">Opening the edition…</p></div>
      </div>
    </div>`;
}

export async function renderWorkspace(newspaperId) {
  renderWorkspaceSkeleton();
  let newspaper, pages, reporterNews, me;
  try {
    [newspaper, pages, reporterNews, me] = await Promise.all([
      fetchJson(`/api/newspapers/${newspaperId}`),
      fetchJson(`/api/newspapers/${newspaperId}/pages`),
      fetchJson("/api/news"),
      fetchJson("/api/auth/me"),
      // The column grid and the px-per-mm scale come from the server; nothing is
      // laid out until they are known.
      loadGeometry(),
      // The publication font's own advance widths, which every measurement in
      // the edition is made against. Awaited before the first paint for the
      // same reason the identity is: a page composed against a fallback font
      // and then repainted when the real one arrives is two different pages,
      // and only one of them was the one the desk looked at.
      ensureFontsLoaded(),
      // Real shaping, same reasoning. requireShaperReady() below turns a
      // failed load into a loud error instead of every block on the page
      // silently composing from approximate widths.
      ensureShaperReady(),
    ]);
    requireShaperReady();
    deskCan = me?.user?.can || {};

    // The paper's standing furniture, and this edition's volume and issue number
    // worked out from its date. Fetched before the first paint so page one is
    // drawn complete rather than popping its nameplate in a moment later.
    await loadIdentity(newspaper?.publication_date, pages?.length);
  } catch (error) {
    renderWorkspaceLoadError(newspaperId, error);
    return;
  }

  store.setEdition({ newspaper, pages, reporterNews });
  setContinuations(pages);
  // Nothing is repaired on load, and that is the point.
  //
  // This used to ask POST /repair-structural-frames unconditionally every
  // time an edition was opened, on the reasoning that restoring the sold
  // corner beside the nameplate is a known invariant rather than a layout
  // choice. It stopped being an invariant the moment a paper was allowed to
  // say it does not sell that corner (pageSection.service.js's deleteSection,
  // masthead.js's ear): a desk removed the frame, the nameplate took the
  // whole measure exactly as intended, and the next time they opened the
  // edition the frame was silently back and the name small again. An
  // automatic repair that undoes an editorial decision is not a repair.
  //
  // The endpoint stays, for a desk who wants the corner back on purpose.
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
  content.removeAttribute("aria-busy");
  // The shaper failing to load is a real, distinct failure - not a dropped
  // connection - and showing it as one would send a desk retrying something
  // that will not fix itself. Composing a page from approximate widths and
  // saying nothing was the earlier behaviour this exists to replace.
  const isShaperFailure = error?.message === "EXACT_SHAPER_NOT_READY";
  const heading = isShaperFailure ? "The publication font could not be measured" : "This edition could not be opened";
  const body = isShaperFailure
    ? "Real Marathi text shaping failed to load, so nothing was drawn rather than risk showing sizes that would not match print."
    : "The connection may have dropped, or the edition may no longer exist. Nothing was lost — the edition itself is unchanged.";
  content.innerHTML = `
    <div class="workspace-load-error">
      <h2>${heading}</h2>
      <p>${body}</p>
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
// Picture rows are returned as a complete list. Two concurrent PATCH calls
// can therefore race: an older response can arrive last and replace a newer
// local list. A single per-workspace queue preserves each edit's real order
// for multi-select nudge, history replay and quick successive key presses.
let imagePatchQueue = Promise.resolve();

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

/**
 * A PICTURE FROM A LINK, on the selected block.
 *
 * The desk has the URL - a wire photograph, an agency link, something sent by
 * email - and had no way to give it to a block short of downloading it by hand
 * and uploading it again.
 *
 * The SERVER fetches it, not this browser: the bytes have to be checked against
 * the format's own signature and stored under a name this paper chooses, which
 * is the same hardening an upload goes through, and a browser fetch could do
 * neither. src/services/pictureLink.service.js is where that is made safe.
 */
async function addPictureFromLink() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block the picture goes on first.");

  const link = await askPrompt({
    title: "Add a picture from a link",
    label: "Picture address",
    placeholder: "https://…",
    help: "It is fetched, checked and stored by this paper — the link itself is never printed.",
    confirm: "Fetch the picture",
  });
  if (!link) return;

  showNotice("Fetching the picture…");
  try {
    const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images/from-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link }),
    });
    const result = await response.json().catch(() => ({}));
    // A REFUSAL IS THE SERVER'S OWN SENTENCE. It names what was wrong - not a
    // public address, not a picture, too large - and a generic line written
    // here would throw away the only thing the desk can act on.
    if (!response.ok) return showNotice(result.error || "That picture could not be added.");
    // The answer carries the block's whole image list, exactly as an uploaded
    // picture's does, so this ends where addSectionImage() ends.
    if (Array.isArray(result)) {
      sectionImages = result;
      redrawCompose();
    }
    showNotice("Picture placed. Drag it where the story wants it.");
  } catch (error) {
    showNotice("That picture could not be added.");
  }
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
  const source = await naturalImageSize(url);
  const section = page.sections?.find((row) => row.section_key === key);
  const placement = section && source ? placeInside(section, source.ratio) : null;

  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      filename: file.name,
      mimeType: file.type,
      // The browser already decoded the file it just uploaded - handing its
      // real natural size to media_assets means the source dimensions
      // image-geometry.js needs for contain/cover/stretch are known from the
      // moment the picture exists, not left null until something backfills
      // them later.
      sourceWidth: source?.width,
      sourceHeight: source?.height,
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

/** The picture's own natural width/height and their ratio, or null if the
 * browser cannot read it. */
function naturalImageSize(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      const width = Number(probe.naturalWidth);
      const height = Number(probe.naturalHeight);
      resolve(width > 0 && height > 0 ? { width, height, ratio: width / height } : null);
    };
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
  const pageId = page.id;
  const apply = async () => {
    const response = await fetch(
      `/api/pages/${pageId}/sections/${encodeURIComponent(key)}/images/${imageId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    // A response for a block the desk has since left is still valid on the
    // server, but must never replace the image list now shown for another
    // block.
    if (store.getCurrentPage()?.id === pageId && store.getState().selectedSectionKey === key) sectionImages = rows;
    return rows;
  };
  const pending = imagePatchQueue.then(apply, apply);
  imagePatchQueue = pending.catch(() => null);
  return pending;
}

function imagePatchLabel(patch) {
  if ("width" in patch || "height" in patch) return "Picture resized";
  if ("x" in patch || "y" in patch) return "Picture moved";
  if ("shape" in patch) return "Picture shape changed";
  if ("fitMode" in patch) return "Picture fit changed";
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
// undo/redo of a resize, a move, or any of the other patches that share the
// same one choke point (patchSectionImage(): fit mode, rotation, flip, shape,
// stand-off). Pictures the snapshot doesn't know about (added or removed
// since) are left alone: that is a different, wider kind of undo this stage
// does not cover - see block-frame.js's own note on scope.
// Row shape (GET, and what a snapshot stores) is the database's own column
// names (sectionImage.repository.js's `SELECT si.*`: x_px/y_px/width_px/
// height_px/rotation/flip_h/flip_v/shape/stand_off_px/fit_mode). The PATCH
// body the move/resize endpoint accepts is camelCase instead
// (sectionImage.service.js's `move()`) - an existing asymmetry this function
// has to bridge for every field it restores, not only geometry: undoing a
// fit-mode or rotation change used to be silently ignored, because only
// x_px/y_px/width_px/height_px were ever compared.
const UNDO_FIELDS = [
  ["x_px", "x", Number],
  ["y_px", "y", Number],
  ["width_px", "width", Number],
  ["height_px", "height", Number],
  ["rotation", "rotation", Number],
  ["flip_h", "flipH", Boolean],
  ["flip_v", "flipV", Boolean],
  ["shape", "shape", String],
  ["stand_off_px", "standOffPx", Number],
  ["fit_mode", "fitMode", String],
];

async function reconcileImages(images) {
  if (!Array.isArray(images)) return;
  const current = new Map(sectionImages.map((image) => [image.id, image]));

  for (const wanted of images) {
    const now = current.get(wanted.id);
    if (!now) continue;
    const patch = {};
    for (const [rowKey, patchKey, coerce] of UNDO_FIELDS) {
      const wasValue = coerce(now[rowKey] ?? (coerce === Number ? 0 : ""));
      const wantValue = coerce(wanted[rowKey] ?? (coerce === Number ? 0 : ""));
      if (wasValue !== wantValue) patch[patchKey] = wanted[rowKey];
    }
    if (Object.keys(patch).length) {
      await persistImagePatch(wanted.id, patch);
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
/**
 * WHAT THIS BLOCK IS FOR - its kind, its standing feature, and filling it.
 *
 * A route of its own rather than a field on the draft: `block_type` and
 * `feature_key` were the layout's alone (page.repository.js's saveLayout),
 * neither is copy, and nothing a desk has written can be lost by setting one.
 * So it does not travel through autosave and needs no fingerprint.
 *
 * The answer carries the whole page, so the canvas is TOLD rather than asked -
 * the shape every other production action on a block already uses.
 */
async function setBlockPurpose(body) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return;
  try {
    const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/purpose`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      showNotice(result.error || "That block's purpose could not be changed.");
      return;
    }
    // A STRUCTURAL REPLACE HANDS BACK NEW SECTION OBJECTS, so the panel has to
    // be pointed at the new one. Without this the Block Editor rebuilt with no
    // section at all and drew its "No block selected" state - the desk chose a
    // feature and watched the whole panel they were working in disappear.
    // A STRUCTURAL REPLACE HANDS BACK NEW SECTION OBJECTS AND CLEARS THE DRAFT,
    // and `currentView()` returns null without one - so the Block Editor
    // rebuilt with no section and drew its "No block selected" state. The desk
    // chose a feature and watched the panel they were working in disappear.
    //
    // selectSection() is the app's own selection path and builds the draft
    // from the fresh row, which is exactly what is wanted here: the block is
    // the same block, with a new purpose on it. Re-selected from nothing first,
    // because selectSection() treats "already selected" as a request to select
    // the block OBJECT and would not rebuild the draft.
    if (result.page) {
      store.replacePage(result.page, { structural: true });
      if (key) {
        store.clearSelection();
        selectSection(key);
      }
    }
    renderSidePanels();
    const filled = result.filled;
    if (filled) {
      // Say what happened, where the desk is looking. A feature that could not
      // be built explains itself rather than leaving an unchanged block.
      const done = filled.filled?.[0];
      const missed = filled.skipped?.[0];
      if (done) showNotice(`Written into this block - ${done.chars} characters of ${done.feature}.`);
      else showNotice(missed?.reason || filled.notes?.[0] || "Nothing could be built for this block today.");
    } else if (body.featureKey) {
      showNotice("This block now carries that standing feature. Press \u201cFill it now\u201d to write today\u2019s in.");
    }
  } catch (error) {
    showNotice("That block's purpose could not be changed.");
  }
}

async function requestSmartCard({
  key, variant, manualText = "", destination = "selected",
  imageUrl = "", wantsArtwork = false, advertStyle = "",
}) {
  const newspaper = store.getState().newspaper;
  const section = store.getSelectedSection();
  const view = currentView();
  if (!newspaper) return { error: "Open an edition first." };
  // A CARD THAT IS BRINGING ITS OWN BLOCK IS MEASURED AGAINST THAT BLOCK.
  //
  // Otherwise the desk reviews a card solved for whatever frame happened to be
  // open and gets a differently-solved one on the page - the exact fault the
  // proposal preview was built to prevent, arriving from the other side. The
  // stand-in carries the size layout.js says this card wants.
  const bringsOwnBlock = destination === "new";
  if (!bringsOwnBlock && (!section || !view)) return { error: "Choose a block first." };
  const wanted = smartCardBlockSize(key, { style: advertStyle });
  const measureSection = bringsOwnBlock
    ? { ...(section || {}), width_px: wanted.width, height_px: wanted.height, margin_px: 1 }
    : section;
  const measureView = bringsOwnBlock ? { ...(view || {}), headline: "", subheading: "", body: "" } : view;

  const budget = buildFlowMap(measureSection, { ...measureView, body: "" }, (bringsOwnBlock ? [] : sectionImages).map(flowImageFromRow)).bodyCharBudget;
  const smartVariant = key === "rashi" && variant === "auto"
    ? (budget < 180 ? "one" : budget < 520 ? "three" : "all")
    : variant;
  const signs = smartVariant === "one" ? 1 : smartVariant === "three" ? 3 : 12;
  const response = await fetch(`/api/features/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: newspaper.publication_date,
      charsPerSign: Math.max(30, Math.floor(budget / signs)),
      tier: getAiTier(),
      ...(key === "tender" || key === "advert" ? { sourceText: manualText } : {}),
      // The advert's artwork, and the block it has to fit. The size travels
      // with the request so a generated illustration comes back in the shape
      // of the hole rather than being cropped into it afterwards.
      ...(key === "advert" ? {
        imageUrl,
        wantsArtwork,
        // Which SHAPE of advert. It decides the block the card brings with it
        // as well as how the card is set, so it travels with the request
        // rather than being applied afterwards.
        style: advertStyle,
        blockWidth: bringsOwnBlock ? wanted.width : Number(section?.width_px) || undefined,
        blockHeight: bringsOwnBlock ? wanted.height : Number(section?.height_px) || undefined,
      } : {}),
    }),
  });
  const result = await response.json().catch(() => ({ error: "The Smart Card could not be built." }));
  if (!response.ok) return result;
  if (result?.error) return result;

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
    source: key === "tender" || key === "advert" ? "transformed"
      : result.writtenBy ? "written"
        : key === "dinvishesh" ? "curated"
        : key === "havaman" || key === "market" ? "feed"
          : "computed",
    fit: { bodyCharBudget: budget, charsUsed, charsRemaining: Math.max(0, budget - charsUsed) },
    // The SAME logical frame the block will solve the card against once
    // accepted - the proposal preview draws from this too (scaled up as one
    // object for comfortable reading), so a desk reviews the card at the
    // size and shape it will actually print, not a differently-solved one.
    frame: bringsOwnBlock
      ? { width: wanted.width, height: wanted.height, padding: 1 }
      : smartCardFrame(section, view),
  };
}

/**
 * A SMART CARD THAT BRINGS ITS OWN BLOCK, ALREADY FILLED.
 *
 * The desk's report: "rather than fixing smart blocks at layout, after
 * generating a smart block it will generate a new block with all data already
 * filled in." Until now a card could only be poured into a frame somebody had
 * already found, sized and emptied - which is the work in the wrong order,
 * because the card's own shape is knowable before any of that (a sudoku is
 * square, a statutory notice is a whole leg, a quote is a shallow strip).
 *
 * Two steps and no third: create the block at the size layout.js says this
 * card wants, then write the card into it through the ordinary section save.
 * Nothing new can go wrong here that + Block and an accept could not already.
 */
async function placeSmartCardInNewBlock(key, payload) {
  const page = store.getCurrentPage();
  const geometry = getGeometry();
  if (!page || !geometry) return { error: "Open a page first." };
  if (store.getState().dirty) await autosave.flush();

  const wanted = smartCardBlockSize(key, payload?.smartCardData);
  const rect = findFreeRect(page.sections || [], wanted.width, wanted.height);
  const onTopOfSomething = (page.sections || []).some(
    (s) => rect.x < Number(s.x_px) + Number(s.width_px)
      && Number(s.x_px) < rect.x + rect.width
      && rect.y < Number(s.y_px) + Number(s.height_px)
      && Number(s.y_px) < rect.y + rect.height,
  );

  const created = await fetch(`/api/pages/${page.id}/sections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rect),
  });
  if (!created.ok) return { error: "The card's block could not be added." };
  const updated = await created.json();
  const added = updated.sections[updated.sections.length - 1];
  if (!added) return { error: "The card's block could not be added." };

  // The card, straight into the block that was just made for it. A full
  // replace is safe here and only here: the block is one request old and has
  // never carried anything.
  const saved = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(added.section_key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      // A card block is furniture, not a story: it carries no rule of its own
      // unless a desk gives it one, and its type is the card's to decide.
      marginPx: 1,
    }),
  });
  if (!saved.ok) return { error: "The block was added but the card could not be written into it." };

  store.replacePage(await saved.json(), { structural: true });
  renderPageArea();
  selectSection(added.section_key);
  return {
    sectionKey: added.section_key,
    crowded: onTopOfSomething,
  };
}

// ----------------------------------------------------------------- actions ---

function selectSection(sectionKey) {
  const state = store.getState();
  if (state.selectedSectionKey === sectionKey) {
    // CLICKING THE BLOCK THAT IS ALREADY OPEN SELECTS THE BLOCK ITSELF.
    //
    // It used to do nothing at all, and that left a desk stuck: Properties
    // shows Border, Ground, Columns, Drop cap and Headline treatment only
    // while the whole BLOCK is the selected object, and every one of those is
    // a decision made after the story is written. Once the caret had been in
    // the body, the only way back to them was the Escape key - which is not
    // discoverable, and is not what a layout tool does. Clicking a frame you
    // are inside selects that frame; this is that gesture.
    selectPart("block");
    return;
  }

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
  syncReuniteButton();
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
  const material = draft && isContentEdit(patch);
  const revoked = material && isExplicit(draft.status)
    ? (draft.aiGenerated ? "needs_review" : "editing")
    : material && !draft.aiGenerated && draft.status !== "editing" ? "editing" : null;
  store.updateDraft(revoked ? { ...patch, status: revoked } : patch, source);
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

/**
 * Empty a block.
 *
 * It ASKS first when there is something to lose, and it says what it did.
 * This sat on the block's own hover toolbar with neither: a desk who caught
 * "Clear" instead of the block underneath it lost the headline, the deck, the
 * story and the picture with no question and nothing on screen afterwards -
 * the notice this used not to write went to a strip measured at zero pixels
 * wide (external-editor.js's showNotice records that). `deleteBlock` has asked
 * the same question about the same content since it was written; there was no
 * reason for the two to differ except that nobody had pressed this one by
 * accident yet. Undo still has it either way - this is about the desk knowing
 * it happened, which is the half undo cannot supply.
 */
/**
 * WHAT TO CALL A BLOCK IN A QUESTION.
 *
 * Captured live before this existed: `Clear "masthead-advert"? Its headline,
 * story and picture go with it.` The sentence is well written and it names the
 * block by its DATABASE KEY. What the desk sees is the advert ear on page one.
 *
 * So a question names, in order of what identifies the block to the person
 * looking at it: the headline they wrote, else the slug set as words. The slug
 * is still recognisable - the canvas chrome prints `MASTHEAD-ADVERT` on the
 * block itself - it is only no longer punctuation.
 */
function blockName(sectionKey, section) {
  const headline = String(section?.headline || "").trim();
  if (headline) return `“${headline.length > 60 ? `${headline.slice(0, 57)}…` : headline}”`;
  const words = String(sectionKey || "block").replace(/[-_]+/g, " ").trim();
  return `the ${words} block`;
}

async function clearSection(sectionKey) {
  if (store.getState().selectedSectionKey !== sectionKey) selectSection(sectionKey);
  const draft = store.getDraft();
  if (!draft) return;
  const carries = draft.headline || draft.subheading || draft.body || draft.imageUrl
    || draft.newsItemId || draft.smartCardKey;
  if (carries) {
    const has = [
      draft.headline && "its headline",
      draft.body && "its story",
      (draft.imageUrl || draft.newsItemId) && "its picture",
      draft.smartCardKey && "the card in it",
    ].filter(Boolean);
    const ok = await askConfirm({
      title: `Clear ${blockName(sectionKey, draft)}?`,
      body: `${has.join(", ").replace(/, ([^,]*)$/, " and $1")} go with it.\n\nUndo puts it back.`
        .replace(/^./, (c) => c.toUpperCase()),
      confirm: "Clear the block",
      cancel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
  }
  // THE CARD GOES TOO, AND IT USED NOT TO.
  //
  // A Smart Card is what is IN a block (`smart_card_key` + `smart_card_data`),
  // exactly as a headline and a story are - `feature_key` is the separate,
  // read-only thing saying what the layout reserved the frame FOR. This
  // cleared the copy and left the card, so pressing Clear on the almanac or
  // the rate panel emptied fields nobody could see and redrew the identical
  // card: the desk's "clearing a smart card block is not happening". It did
  // not even ask first, because `carries` could not see a card either.
  //
  // The payload writes both with `|| null` (section-model.js's
  // payloadFromDraft), so nulling them here is what reaches the row.
  store.replaceDraft(
    { ...draft, newsItemId: null, headline: "", subheading: "", body: "", caption: "", imageUrl: "",
      smartCardKey: null, smartCardData: null, aiGenerated: false, status: "empty" },
    "canvas",
  );
  history.record(store.getDraft(), { coalesce: false, label: "Cleared section", kind: "clear", images: sectionImages });
  autosave.schedule();
  showNotice(`Cleared ${sectionKey}. Undo puts it back.`);
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
  //
  // AND IT SAYS SO, because this is the one control on the canvas whose whole
  // effect is to move the desk somewhere else. Unexplained, that reads as the
  // software losing their place - which is exactly how it was reported. The
  // press itself is no longer reachable by accident (the block's hover
  // toolbar is drawn only on the block a desk has selected), so the movement
  // is now something they asked for; naming it is what makes it feel that way.
  if (action === "image") {
    showNotice(`Pictures for “${sectionKey}” are in the writing panel below.`);
    return focusGroup("story");
  }
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
  // Whether the page had room for it, said plainly. On a full page the block
  // is still added - and cascaded clear of the last one so it can be picked up
  // - but "Block added. Drag it where the page needs it." on a page with no
  // room reads as though a space was found, and the desk goes looking for one.
  const onTopOfSomething = (page.sections || []).some(
    (s) => rect.x < Number(s.x_px) + Number(s.width_px)
      && Number(s.x_px) < rect.x + rect.width
      && rect.y < Number(s.y_px) + Number(s.height_px)
      && Number(s.y_px) < rect.y + rect.height,
  );

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
  showNotice(onTopOfSomething
    ? "Block added, but this page has no free space — it is sitting over the blocks below it. Drag it where the page needs it, or make room first."
    : "Block added. Drag it where the page needs it.");
}

async function deleteBlock(sectionKey) {
  const page = store.getCurrentPage();
  const section = store.getSection(sectionKey);
  if (!page || !section) return;

  const filled = section.headline || section.body || section.image_url || section.news_item_id;
  if (filled) {
    const ok = await askConfirm({
      title: `Delete ${blockName(sectionKey, section)}?`,
      body: "The frame goes off the page, and its story and picture go with it.",
      confirm: "Delete the block",
      cancel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
  }

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

/**
 * A picture laid on the page, moved or resized.
 *
 * The whole overlay list goes back, because an overlay has no server-side id
 * to address - the same reason inset panels are patched whole. Structural, and
 * it has to be: the blocks the rectangle now touches (and the ones it has just
 * stopped touching) must set their type again.
 */
/**
 * A PICTURE LAID ACROSS TWO STORIES - placed, not just moved.
 *
 * `moveOverlay()` below has existed since overlays did, and nothing in the
 * product could ever CREATE one: the only overlays on any page were put there
 * by a fixture. So the device was real, the compositor set every block clear of
 * it, all four exports drew it - and a desk had no way to make one. That is the
 * "I have not seen the things you modified" report, in its sharpest form.
 *
 * It is placed straddling the selected block's own bottom edge, because that is
 * what an overlay is FOR: crossing the boundary between two stories. A desk
 * drags it from there.
 */
async function addOverlay(file) {
  const page = store.getCurrentPage();
  if (!page) return;

  const form = new FormData();
  form.append("images", await readableImage(file));
  const uploadResponse = await fetch("/api/uploads/images", { method: "POST", body: form });
  const uploaded = uploadResponse.ok ? await uploadResponse.json().catch(() => null) : null;
  const url = uploaded?.imageUrls?.[0];
  if (!url) return showNotice("The picture could not be uploaded.");

  const source = await naturalImageSize(url);
  const section = store.getSelectedSection();
  // Half the block's width, at the picture's own proportions, sitting on the
  // block's bottom edge so it reaches the story below. It does NOT snap to the
  // column grid - crossing that grid is the entire reason a desk places one
  // (layout/page-overlays.js).
  const width = Math.max(40, Math.round((Number(section?.width_px) || 200) * 0.5));
  const height = Math.max(30, Math.round(width / (source?.ratio || 1.5)));
  const x = Math.round(Number(section?.x_px || 0) + ((Number(section?.width_px) || 200) - width) / 2);
  const y = Math.round(Number(section?.y_px || 0) + (Number(section?.height_px) || 200) - height / 2);

  const overlays = [
    ...(Array.isArray(page.overlay_images) ? page.overlay_images : []),
    { id: `overlay-${Date.now().toString(36)}`, url, x, y, width, height, caption: "" },
  ];
  const response = await fetch(`/api/pages/${page.id}/overlays`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlays }),
  });
  if (!response.ok) return showNotice("Could not lay the picture on the page.");
  store.replacePage(await response.json(), { structural: true });
  showNotice("Picture laid across the page — drag it where it belongs.");
}

/** The file picker the button opens. One input, made once, reused. */
function pickImage(onChosen) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) onChosen(file);
  }, { once: true });
  input.click();
}

async function moveOverlay(id, rect) {
  const page = store.getCurrentPage();
  if (!page) return;
  const overlays = (Array.isArray(page.overlay_images) ? page.overlay_images : [])
    .map((entry) => (String(entry.id) === String(id) ? { ...entry, ...rect } : entry));

  const response = await fetch(`/api/pages/${page.id}/overlays`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlays }),
  });
  if (!response.ok) return showNotice("Could not move the picture.");
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

// HOW THIS PAGE IS DRESSED.
//
// The theme is a property of the PAGE, which is why the control sits beside
// the layout picker rather than in the Paper group: the paper's faces are one
// decision for the whole edition, and what page twelve looks like is not.
//
// It PROPOSES before it writes. The select fetches the answer, the question
// names the page, the look and the number of blocks about to move, and only
// then does anything change - the same shape as the placement repair and the
// AI proposal. A page already wearing its theme reports nothing to do and asks
// nothing, which is what makes the control safe to press twice.
async function bindPageTheme() {
  const select = document.getElementById("pageThemeSelect");
  if (!select) return;
  const { PAGE_THEMES } = await import("./layout/page-styles.js");
  // The store's OWN accessor, not a second copy of the same lookup. Written by
  // hand it silently fell back to `pages[0]` whenever the ids had not settled,
  // so turning to page four re-read page ONE's look and the select showed the
  // front page's theme over a feature page's sheet.
  const page = store.getCurrentPage();
  if (!page) return;

  select.innerHTML = PAGE_THEMES
    .map((theme) => `<option value="${theme.key}"${theme.key === page.style_theme ? " selected" : ""}>`
      + `${escapeHtml(theme.label)} — ${escapeHtml(theme.marathi)}</option>`)
    .join("");
  // A page nobody has dressed shows what it WOULD be given, rather than
  // pretending the desk has already chosen: the styler guesses from the page
  // number and what is on it, and the desk should see that guess before
  // pressing anything.
  if (!page.style_theme) {
    const guess = await fetchJson(`/api/pages/${page.id}/style`).catch(() => null);
    if (guess?.theme) select.value = guess.theme;
}

select.onchange = async () => {
  const theme = select.value;
  try {
    const proposal = await fetchJson(`/api/pages/${page.id}/style?theme=${encodeURIComponent(theme)}`);
    if (!proposal.changing) {
      showNotice(`Page ${proposal.pageNumber} is already dressed as ${proposal.themeName}.`);
      return;
    }
    const answer = await askConfirm({
      title: `Dress page ${proposal.pageNumber} as ${proposal.themeName}?`,
      body: `${proposal.changing} of ${proposal.blocks} block${proposal.blocks === 1 ? "" : "s"} change`
        + `, and ${proposal.dressed} will carry a ground. Adverts, standing features and Smart Cards`
        + ` are left alone. Nothing that is written changes — only how it is set.`,
      confirm: "Dress the page",
    });
    if (!answer) { select.value = page.style_theme || theme; return; }
    const done = await fetchJson(`/api/pages/${page.id}/style`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme }),
    });
    page.style_theme = done.theme;
    await reloadPages();
    showNotice(`Page ${done.pageNumber} dressed as ${done.themeName} — ${done.saved} block${done.saved === 1 ? "" : "s"} set`
      + `${done.refused?.length ? `, ${done.refused.length} refused` : ""}.`);
  } catch (error) {
    showNotice(error.message || "The page could not be dressed.");
  }
};
}

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
  content.removeAttribute("aria-busy");

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
            <!-- THE EXPLANATIONS ARE 37% OF THIS RAIL.
                 Measured on a real block: the rail is a 627px window holding
                 2621px, Properties alone is 1453px of that, and 537px of
                 Properties is eight paragraphs of prose explaining its own
                 controls. They are good paragraphs - this product explains
                 itself deliberately - but a note that pushes the control it
                 describes out of the window is competing with the thing it
                 explains.
                 One switch, not eight, and it is remembered: a desk learning
                 the paper turns them on, a desk who knows it leaves them off
                 and gets the room back. Nothing is deleted and nothing is
                 more than one press away. -->
            <button type="button" class="tools-notes-toggle" id="toolsNotesBtn"
                    aria-pressed="false"
                    title="Show or hide the notes that explain each control">Notes</button>
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
              <select id="pageThemeSelect" class="toolbar-select"
                      title="How this page is dressed - its grounds, its rules and its headings"></select>
              <button type="button" class="layout-btn" id="addBlockBtn" title="Add a block to this page">+ Block</button>
              <button type="button" class="layout-btn danger" id="removeBlockBtn" title="Remove the selected block">− Block</button>
              <!-- THE SOLD CORNER OF PAGE ONE, which had a server and no door.
                   masthead-advert is the advert ear beside the nameplate, and
                   the paper's own title is set for BOTH answers: while the ear
                   frame is on the page the nameplate leaves room for it, and
                   with no frame it takes the whole measure - 247x46 px to
                   426x80 px, measured on a real front page. Deleting the frame
                   has been allowed since the STRUCTURAL_FRAME_PROTECTED 409 was
                   retired, and POST /api/pages/:id/repair-structural-frames
                   has existed to put it back ever since - reachable from
                   nothing. So a desk who did not sell the corner one day could
                   never have it again, which is the report that the master
                   advert needs a way in and a way out "as it affects on
                   newspaper heading". It is page one's decision, so the button
                   is only on page one. -->
              <button type="button" class="layout-btn" id="mastheadEarBtn"
                      title="The advert ear beside the nameplate. Off, the paper's own title is set across the whole measure.">Ad ear</button>
              <!-- THE PAPER'S OWN DECISIONS, not this page's and not this
                   block's: the house faces and whether the gutters are ruled.
                   A desk had to open every block on every page to change a
                   face, and the rules drew whether anybody had asked or not.
                   ON THE EXISTING ROW, not a third one. A third row cost the
                   page 34 px of chrome and pushed the writing surface below
                   the fold - measured by the workspace net at a 1512x950
                   window, where a picture handle landed at y=1015 and stopped
                   being clickable at all. CLAUDE.md states that rule and this
                   broke it. -->
              <div class="canvas-toolbar-divider"></div>
              <span class="canvas-toolbar-label">Paper</span>
              <select id="paperBodyFace" class="toolbar-select"
                      title="The face every story in this edition is set in — blocks that have chosen their own keep it"></select>
              <select id="paperDisplayFace" class="toolbar-select"
                      title="The face every headline, kicker and deck in this edition is set in"></select>
              <button type="button" class="layout-btn" id="dressPaperBtn"
                      title="Give every page of this edition a look — one AI call picks each page's theme">Dress the paper</button>
              <button type="button" class="layout-btn" id="columnRulesBtn"
                      title="The hairlines between neighbouring stories. Off unless this edition asks for them.">Rules</button>
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
              <!-- The way out, beside the way in. reunite() has existed as
                   long as carryOver() has and no control could reach it, so a
                   story split across a page turn could not be put back at all.
                   Disabled rather than hidden, so a desk can see the way out
                   before they need it. (No backticks in here: this comment is
                   inside a template literal, and one closes the string.) -->
              <button type="button" class="layout-btn" id="reuniteBtn" disabled
                      title="Bring a carried-over story back into one block">Reunite</button>
              <div class="canvas-toolbar-divider"></div>
              <button type="button" class="layout-btn" id="fillFeaturesBtn"
                      title="Fill राशिभविष्य, सूर्योदय-सूर्यास्त, दिनविशेष and सुविचार for this edition's date">Fill features</button>
              <button type="button" class="layout-btn" id="writeEmptyBtn"
                      title="Say what tomorrow's paper should be made of, page by page — SAHAS researches the news, plans the edition, and you read the plan before anything is written">Write empty blocks</button>
              <div class="canvas-toolbar-divider"></div>
              <!-- NAMED, because these two are not about the copy. The row's
                   own label reads COPY and these are controls for the VIEW -
                   Guides shows or hides the rulers, Print view takes the
                   editor's chrome off the sheet - so under that label the row
                   said something untrue about a third of its own buttons.
                   Same rule as "every control names the object it acts on",
                   one level out: so does a group. -->
              <span class="canvas-toolbar-label">View</span>
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

      <!-- A NEWSPAPER IS MADE UP ON A DESK, AND SAYING SO IS MORE HONEST THAN
           PRETENDING OTHERWISE. Measured at 430px: the workspace reflows with
           no sideways scroll - which is a real achievement and is why nothing
           here is a media query hiding a broken layout - but the toolbar wraps
           to eight rows and the sheet lands 420px down the document at 18%.
           It works and it is unusable, and a desk who opens it on a phone at
           the bus stop deserves to be told that in one sentence rather than
           left pinching at a page they cannot place a block on.
           The three screens that genuinely DO work on a phone are offered
           beside it. Shown by CSS alone, so nothing is measured, no listener
           is bound, and the workspace underneath is untouched and one press
           away for anyone who means it. -->
      <div class="narrow-window-note" id="narrowWindowNote">
        <strong>The layout desk needs a wider screen.</strong>
        <p>A page is made up by dragging blocks around a sheet, and there is no
           honest way to do that in this width. Everything below still works,
           and these do work here:</p>
        <div class="narrow-window-links">
          <a href="#!/editions">Past Newspapers</a>
          <a href="#!/past-news">Past News</a>
          <a href="/epaper">The e-paper</a>
        </div>
        <button type="button" id="narrowWindowDismiss">Open it anyway</button>
      </div>

      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <aside class="workspace-sidebar-left" id="sidebarLeft"
             role="dialog" aria-modal="false" aria-labelledby="storyDrawerTitle">
        <div class="sidebar-drawer-header">
          <h3 id="storyDrawerTitle">Story Explorer</h3>
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
      onPreflight: runPreflight, onPressFile: downloadPressFile, onExport: downloadExport,
        onCompose: planComposition },
    can: deskCan,
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => store.setStoryPickerOpen(false));
  // Dismissing is a decision about THIS SESSION and is not persisted: nothing
  // in this project keeps a per-desk settings row, and a rule that hid itself
  // permanently after one press would be a rule a desk could never get back.
  document.getElementById("narrowWindowDismiss")?.addEventListener("click", () => {
    document.body.classList.add("narrow-window-accepted");
  });

  document.getElementById("sidebarDrawerClose").addEventListener("click", () => store.setStoryPickerOpen(false));
  // ESCAPE CLOSES IT, LIKE EVERY OTHER PANEL IN THIS WORKSPACE.
  //
  // What's left, Preflight and the Newsdesk panel all close on Escape and hand
  // focus back - that is the hard half and it was already done. This drawer was
  // the only one that did not, and it is opened by the control an editor uses
  // most, so every other panel had taught the desk that Escape works and this
  // one silently did not. The listener is at the document because the drawer's
  // own subtree is re-rendered as the desk filters it.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!store.getState().storyPickerOpen) return;
    // A dialog on top of the drawer answers Escape first.
    if (document.querySelector(".sahas-dialog")) return;
    store.setStoryPickerOpen(false);
  });

  document.getElementById("addBlockBtn").addEventListener("click", addBlock);
  document.getElementById("mastheadEarBtn").addEventListener("click", toggleMastheadEar);
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
    // A toggle has to SAY which state it is in, not only look it. The label
    // already flips, which is the right way to name a way out; nothing
    // announced it.
    event.currentTarget.setAttribute("aria-pressed", String(on));
  });
  document.getElementById("printViewBtn").setAttribute("aria-pressed", "false");

  bindPaperControls();
  bindPageTheme();
  bindDressPaper();

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

  
/**
 * THE PAPER'S OWN TYPE, AND ITS COLUMN RULES.
 *
 * One decision for the edition. The two faces are written DOWN onto the
 * edition's blocks, and only onto the blocks that have not chosen a face for
 * themselves - so a sub-editor who deliberately set one splash in Khand keeps
 * it. That is a house style, not an override; silently replacing somebody's
 * explicit choice is the same fault as the AI overwriting reporter copy.
 *
 * Written down rather than cascaded at read time because a fallback resolved
 * at composition would have to be threaded through the thirty-odd services
 * that compose a stored row, and any one of them that forgot would measure a
 * block in one face and print it in another.
 */

// DRESS THE WHOLE PAPER, which is the one-click the desk asked for.
//
// In the Paper group and not beside the page's own theme, because this is a
// decision for the EDITION - the same rung as the paper's faces and its column
// rules, which is exactly what this group holds.
//
// One AI call names each page's look from the catalogue; the deterministic
// styler then dresses every block, seeing each whole page at once. With no
// provider configured it still works - `proposeThemes` derives the same answer
// from the page number and what is on it - and it says which of the two it
// did, because "the AI chose this" and "this was worked out" are different
// claims and a desk should not be told the wrong one.
function bindDressPaper() {
  const button = document.getElementById("dressPaperBtn");
  if (!button) return;
  button.addEventListener("click", () => busyButton(button, "Dressing…", async () => {
    const state = store.getState();
    if (!state.newspaper) return;
    const answer = await askConfirm({
      title: "Dress every page of this edition?",
      body: "Each page is given a look from the paper's own catalogue and every story block on it"
        + " is set in a matching ground, rule and heading. Adverts, standing features and Smart Cards"
        + " are left alone, and nothing that is written changes — only how it is set."
        + " You can change any page afterwards, or set it back to Plain.",
      confirm: "Dress the paper",
    });
    if (!answer) return;
    try {
      const done = await fetchJson(`/api/newspapers/${state.newspaper.id}/dress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await reloadPages();
      await bindPageTheme();
      showNotice(`${done.pages} page${done.pages === 1 ? "" : "s"} dressed — ${done.dressed} block`
        + `${done.dressed === 1 ? "" : "s"} given a ground. `
        + (done.source === "ai" ? "The looks were chosen by AI." : "The looks were worked out from what is on each page."));
    } catch (error) {
      showNotice(error.message || "The paper could not be dressed.");
    }
  }));
}

function bindPaperControls() {
  const bodySelect = document.getElementById("paperBodyFace");
  const displaySelect = document.getElementById("paperDisplayFace");
  const rulesBtn = document.getElementById("columnRulesBtn");
  if (!bodySelect || !displaySelect || !rulesBtn) return;

  const paper = store.getState().newspaper || {};
  // The ONE typeface catalogue, exactly as the block's own face controls read
  // it. A second list here is the drift this codebase has been bitten by.
  const option = (face, current) => `<option value="${face.key}"${
    face.key === current ? " selected" : ""}>${escapeHtml(face.label)}</option>`;
  const blank = (label, current) => `<option value=""${current ? "" : " selected"}>${escapeHtml(label)}</option>`;

  bodySelect.innerHTML = blank("Story face", paper.body_family)
    + TYPEFACES.filter((f) => f.role === "text").map((f) => option(f, paper.body_family)).join("");
  displaySelect.innerHTML = blank("Headline face", paper.display_family)
    + TYPEFACES.map((f) => option(f, paper.display_family)).join("");
  rulesBtn.classList.toggle("active", Boolean(paper.column_rules));

  const blocks = (n) => `${n} block${n === 1 ? "" : "s"}`;

  // THE PAPER'S FACE, AND WHAT IT COULD NOT REACH.
  //
  // The house style moves a block that is carrying no face of its own or the
  // paper's PREVIOUS one; a face a sub-editor chose is left alone deliberately.
  // But a block can also drift out of step with the paper's own column, and
  // then it is indistinguishable from a deliberate choice and no house change
  // will ever move it again. On edition 40082 that was 37 of 46 blocks - the
  // dropdown changed, the page did not, and this said NOTHING, because it only
  // spoke when `restyled` was non-zero.
  //
  // So it always says what happened, and when blocks were left behind it
  // offers to set them too. Never silently: the desk is told the number and
  // presses it, which is the same shape as the placement repair.
  const send = async (patch, { asked = false } = {}) => {
    const state = store.getState();
    if (!state.newspaper) return;
    try {
      const result = await fetchJson(`/api/newspapers/${state.newspaper.id}/house-style`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      state.newspaper = result.newspaper;
      rulesBtn.classList.toggle("active", Boolean(result.newspaper.column_rules));

      // A face was named and some blocks are still set in something else.
      // Ask once, and only when there is a face in this patch to apply.
      const face = patch.bodyFamily || patch.displayFamily;
      if (face && result.kept > 0 && !asked) {
        const moved = result.restyled
          ? `Set in ${blocks(result.restyled)}.`
          : "No block took the new face.";
        const applyAll = await askConfirm({
          title: "Set every block in this paper to that face?",
          body: `${moved}\n\n${blocks(result.kept)} keep a face of their own and were left alone.`
            + "\n\nA block someone set by hand is a decision, so it was not moved. Saying yes overrides those too.",
          confirm: "Set every block",
          cancel: "Leave those alone",
        });
        if (applyAll) {
          await send({ ...patch, applyToAll: true }, { asked: true });
          return;
        }
      }

      // The blocks themselves changed under the editor, so the edition is
      // re-read rather than patched here - a face written onto forty blocks by
      // one SQL statement is not something this client can reconstruct, and
      // guessing would put the canvas and the database out of step.
      if (result.restyled) {
        showNotice(`Set in ${blocks(result.restyled)}. Reloading the edition…`);
        await renderWorkspace(state.newspaper.id);
      } else {
        // It used to say nothing at all here, which is exactly how a control
        // that had done its job came to read as broken.
        if (face) showNotice(`Every block was already set in that face.`);
        renderPageArea();
      }
    } catch (error) {
      showNotice("The paper's style could not be saved.");
    }
  };

  bodySelect.addEventListener("change", (event) => {
    if (!event.target.value) return;
    send({ bodyFamily: event.target.value });
  });
  displaySelect.addEventListener("change", (event) => {
    if (!event.target.value) return;
    send({ displayFamily: event.target.value });
  });
  rulesBtn.addEventListener("click", () => {
    send({ columnRules: !(store.getState().newspaper?.column_rules) });
  });
}

// The day's standing features. One press fills every block the layout marked
  // as one - the horoscope, the almanac box, दिनविशेष, the thought for the day -
  // for this edition's own date. What lands in them is ordinary copy the desk
  // can rewrite (VISION.md: AI assists, never owns).
  const fillBtn = document.getElementById("fillFeaturesBtn");
  fillBtn.addEventListener("click", () => busyButton(fillBtn, "Filling…", fillFeatures));

  // Writing the empty blocks of a page. One request per block, two at a time -
  // never the whole page in one request (bulk-generate.js says why).
  document.getElementById("writeEmptyBtn").addEventListener("click", writeEmptyBlocks);

  // Jump lines. The character grid already knows exactly how much of the story
  // will not fit; this turns that measurement into the move a sub-editor
  // actually makes - put what fits here, the rest on a later page, and set both
  // lines. One press, and it says where the story went.
  document.getElementById("carryOverBtn").addEventListener("click", carryOver);
  document.getElementById("reuniteBtn").addEventListener("click", reunite);

  // What is left. The whole edition's unfinished work on one list, each block
  // with the number of characters it holds - which is the number a sub-editor
  // needs BEFORE writing, not after the copy has already run over.
  const worklistBtn = document.getElementById("worklistBtn");
  worklistBtn.addEventListener("click", () => busyButton(worklistBtn, "Reading…", showWorklist));

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
  bindNotesToggle();
  window.addEventListener("resize", onWorkspaceResized);
  window.addEventListener("workspace-resized", onWorkspaceResized);
}

// Whether the settings rail shows the notes that explain its controls. Kept in
// localStorage beside the splitter sizes, and for the same reason: it is a
// decision about this desk's screen, not about the edition, so it must not
// have to be made again every morning.
const NOTES_KEY = "sahas.workspace.showNotes";

function bindNotesToggle() {
  const button = document.getElementById("toolsNotesBtn");
  // THE PANEL, NOT THE RAIL AROUND IT. The dock borrows this element and moves
  // it into the Block Editor's right-hand column (assist-dock.js), so a rule
  // scoped to `.workspace-tools` stops matching the moment a desk presses the
  // Block or Type tab - and every note the desk had switched off would come
  // straight back in the other column. The state belongs to the panel, so it
  // travels with it. The element itself survives re-renders; only its
  // innerHTML is rewritten.
  const rail = document.getElementById("workspaceToolsPanel");
  if (!button || !rail) return;
  // DEFAULT ON, and that is deliberate rather than timid. This product
  // explains itself on purpose, and switching every explanation off for a desk
  // who has never asked would quietly change what the whole newsroom sees on
  // open - a bigger decision than reclaiming 537px, and not one to take
  // unattended. workspace.browser.js asserts one of these notes by name
  // ("pointing at what actually decides its position"), which is the product
  // saying the same thing.
  // So the switch is purely additive: nothing moves until a desk presses it,
  // and once pressed it is remembered. Flipping this one comparison is all it
  // would take to change the default if the newsroom would rather have the
  // room than the prose.
  let on = true;
  try {
    on = localStorage.getItem(NOTES_KEY) !== "0";
  } catch {
    // A blocked or full storage quota must never keep the editor from opening.
  }
  const paint = () => {
    rail.classList.toggle("show-notes", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  };
  paint();
  button.addEventListener("click", () => {
    on = !on;
    try {
      localStorage.setItem(NOTES_KEY, on ? "1" : "0");
    } catch {
      // Same: the switch still works for this session.
    }
    paint();
  });
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
  const report = await fetch(`/api/newspapers/${newspaper.id}/preflight`)
    .then((r) => r.json()).catch(() => ({ error: "The edition could not be checked. Try again." }));
  if (!report || report.error) {
    return showFailure(report?.error || "The edition could not be checked.", { retry: runPreflight });
  }

  renderPreflight(report);
  showNotice(
    report.passed
      ? `Preflight clean. ${report.counts.warning} warning${report.counts.warning === 1 ? "" : "s"} to look at.`
      : `${report.counts.error} error${report.counts.error === 1 ? "" : "s"} must be fixed before this goes to press.`,
  );
}

/**
 * The preflight findings AND where the edition stands, on one panel.
 *
 * It used to be findings alone, and `if (!report.findings.length) return`
 * meant a CLEAN edition drew no panel at all - which is precisely the moment a
 * desk wants to pass its pages. Passing them had no control anywhere in the
 * product (see press-panel.js for what that cost), and preflight is the check
 * that gates it, so the finding and the action are one panel.
 */
function renderPreflight(report) {
  return renderPressPanel(store.getState().newspaper?.id, {
    report,
    pages: store.getState().pages,
    onNotice: showNotice,
    onOpenFinding: (pageNumber, sectionKey) => {
      const page = store.getState().pages.find((p) => Number(p.page_number) === Number(pageNumber));
      if (page) store.setCurrentPage(page.id);
      const key = String(sectionKey || "").split(" / ")[0];
      if (store.getSection(key)) selectSection(key);
    },
    // The forme decides whether the canvas greys this page's photographs, so
    // the page on screen is repainted from the row that has just changed - and
    // the fresh rows go back to the panel, whose own button label is read off
    // `prints_colour`.
    onPagesChanged: async () => {
      await reloadPages();
      return store.getState().pages;
    },
  });
}

// Edition-level composition is intentionally a reviewable plan before it is a
// write.  This stays in the existing workspace, beside Preflight, rather than
// becoming a second dashboard or a browser-side composer.
async function planComposition() {
  const newspaper = store.getState().newspaper; if (!newspaper) return;
  const aiMode = String(newspaper.publication_date || '').startsWith('2099-') ? 'codex-local' : 'production';
  const button = document.getElementById('tbAI'); if (button) button.disabled = true;
  try {
    // No maxServiceCalls here: the provider-call budget is demand-derived
    // server-side (compositionCallBudget.service.js) from the plan's actual
    // assignment count, not a number this file would have to keep in sync
    // with the real editorial demand.
    const response = await fetch(`/api/newspapers/${newspaper.id}/composition/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aiMode }) });
    const plan = await response.json();
    if (!plan.ok) {
      const budget = plan.callBudget;
      const detail = budget ? ` (${budget.plannedAssignments} planned stories need at least ${budget.minimumProviderCalls} provider calls; requested cap was ${budget.requestedProviderCallCap}.)` : '';
      return showNotice(`${plan.code || plan.error || 'Composition plan failed.'}${detail}`);
    }
    renderCompositionPlan(plan, aiMode);
  } catch (error) { showNotice(`Composition plan failed: ${error.message}`); } finally { if (button) button.disabled = false; }
}

function renderCompositionPlan(plan, aiMode) {
  document.getElementById('compositionPanel')?.remove(); const panel = document.createElement('aside'); panel.id = 'compositionPanel'; panel.className = 'preflight-panel composition-panel';
  const rows = plan.pages.map((page) => `<li><strong>p${page.page}</strong> · ${page.plannedAssignments.length}/${page.requiredFrames} planned · ${page.unresolvedDemand} unresolved</li>`).join('');
  const imageSummary = `${plan.expected.resolvedImages}/${plan.expected.requiredImages} required images resolved · ${plan.expected.plannedImages} source placements planned${plan.expected.unresolvedImageDemand ? ` · ${plan.expected.unresolvedImageDemand} unresolved` : ''}`;
  const content = plan.contentSummary; const auxiliary = content
    ? `Standing features ${content.standingFeatures.ready}/${content.standingFeatures.required} ready · External adverts ${content.adverts.ready}/${content.adverts.required} present · Utility ${content.utility.ready}/${content.utility.required} ready · Publication content ${content.publicationContentState}` : '';
  const budget = plan.callBudget; const budgetLine = budget
    ? `Provider-call budget: ${budget.selectedProviderCallCap} (minimum for ${budget.plannedAssignments} planned stories: ${budget.minimumProviderCalls} · exact-fit request ceiling: ${budget.exactFitRequestCeiling}${budget.risk === 'TIGHT' ? ' · TIGHT: not every story is guaranteed its repair attempt' : ''}). Provider retries/fallbacks also spend this cap.` : '';
  panel.innerHTML = `<header><strong>AI composition plan</strong><button type="button" id="compositionClose" aria-label="Close">×</button></header><p>${escapeHtml(plan.writerTransport)} · ${plan.sourceCount} approved sources · snapshot ${escapeHtml(plan.sourceSnapshotHash.slice(0, 12))}</p><p>Editorial composition: ${plan.expected.plannedFrames}/${plan.expected.requiredFrames} planned · coverage ${(plan.expected.editorialCoverageRatio * 100).toFixed(0)}% · area ${(plan.expected.weightedEditorialCoverageRatio * 100).toFixed(0)}%</p><p>${escapeHtml(imageSummary)}</p>${auxiliary ? `<p>${escapeHtml(auxiliary)}</p>` : ''}${budgetLine ? `<p>${escapeHtml(budgetLine)}</p>` : ''}<ul>${rows}</ul><button type="button" class="btn-primary" id="compositionApply">Apply AI Composition</button><p class="composition-note">Apply writes text and source images in one edition transaction using ${escapeHtml(plan.writerTransport)}. Confirmed plan only; changed newsroom copy, image files, or page placement is rejected.</p>`;
  nameThePanel(panel);
  document.body.appendChild(panel); document.getElementById('compositionClose').addEventListener('click', closeOnEscape(() => panel.remove()));
  document.getElementById('compositionApply').addEventListener('click', async () => {
    const confirmed = await askConfirm({
      title: `Apply this composition to ${store.getState().newspaper.publication_date}?`,
      body: `${plan.expected.plannedFrames} planned frames · ${plan.expected.unresolvedDemand} unresolved`
        + `\n${plan.expected.resolvedImages} of ${plan.expected.requiredImages} required images resolved`
        + `\nWritten by ${plan.writerTransport} · provider-call cap ${budget?.selectedProviderCallCap ?? 'unknown'}`
        + "\n\nThis writes text and source images into the edition. Every call it makes is billed.",
      confirm: "Apply the composition",
      cancel: "Not yet",
    });
    if (!confirmed) return;
    const apply = document.getElementById('compositionApply'); apply.disabled = true; apply.textContent = 'Composing…';
    // No maxServiceCalls sent here either - Apply consumes the exact cap the
    // desk already reviewed and confirmed above, bound into the plan token
    // server-side. Resupplying a number here would just be a second place
    // this file could drift from what was actually reviewed.
    try { const response = await fetch(`/api/newspapers/${plan.editionId}/composition/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planToken: plan.planToken, aiMode }) }); const result = await response.json(); if (!result.ok) { renderCompositionResult(result); return; } await renderWorkspace(plan.editionId); renderCompositionResult(result); }
    catch (error) { showNotice(`Composition failed: ${error.message}`); } finally { apply.disabled = false; apply.textContent = 'Apply AI Composition'; }
  });
}

function renderCompositionResult(result) {
  document.getElementById('compositionPanel')?.remove(); const panel = document.createElement('aside'); panel.id = 'compositionPanel'; panel.className = 'preflight-panel composition-panel';
  const duration = Number.isFinite(result.durationMs) ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : ''; const coverage = result.completion?.pages?.map((page) => `p${page.page} ${Math.round(page.editorialCoverageRatio * 100)}%`).join(' · ') || '';
  const safety = result.atomicallyApplied ? 'Text and images applied atomically.' : result.nothingApplied ? 'Nothing was applied to the edition.' : 'Manual verification required.';
  const imageCoverage = Number.isFinite(result.completion?.imageCoverageRatio) ? `Required image coverage ${Math.round(result.completion.imageCoverageRatio * 100)}% · ${result.completion.unresolvedImageDemand} unresolved` : '';
  const review = result.ok && result.review ? `<p><strong>Composition complete.</strong> ${result.review.required} blocks require editorial review. <strong>Not ready for press.</strong></p>` : '';
  const summary = result.contentSummary; const content = summary
    ? `<p>Editorial composition: <strong>${escapeHtml(result.editorialCompositionState || result.state)}</strong> · Publication content: <strong>${escapeHtml(result.publicationContentState || 'UNKNOWN')}</strong></p><p>Editorial ${summary.editorialDemand.present}/${summary.editorialDemand.required} complete · Image companions ${summary.imagePackages.resolved}/${summary.imagePackages.required} · Standing features ${summary.standingFeatures.ready}/${summary.standingFeatures.required} · External adverts ${summary.adverts.ready}/${summary.adverts.required} · Utility ${summary.utility.ready}/${summary.utility.required}</p>` : '';
  const breakdown = result.writerCallBreakdown ? Object.entries(result.writerCallBreakdown.byProvider || {}).map(([provider, count]) => `${provider} ${count}`).join(' · ') : '';
  const callBudgetLine = Number.isFinite(result.providerCallCap)
    ? `<p>Provider calls: ${result.writerCalls || 0} of ${result.providerCallCap} (${result.providerCallsRemaining ?? 0} remaining)${breakdown ? ` · ${escapeHtml(breakdown)}` : ''}</p>` : '';
  panel.innerHTML = `<header><strong>AI composition — ${escapeHtml(result.editorialCompositionState || result.state)}</strong><button type="button" id="compositionClose" aria-label="Close">×</button></header>${review}${content}<p>${escapeHtml(result.writerTransport || 'composition')} · ${result.writerCalls || 0} calls${duration}</p>${callBudgetLine}<p>${escapeHtml(safety)}</p>${imageCoverage ? `<p>${escapeHtml(imageCoverage)}</p>` : ''}${coverage ? `<p>${coverage}</p>` : ''}<ul>${(result.pages || []).map((page) => `<li><strong>p${page.page}</strong> · ${escapeHtml(page.state)}${page.error ? ` · ${escapeHtml(page.error)}` : ''}</li>`).join('')}</ul>`;
  nameThePanel(panel);
  document.body.appendChild(panel); document.getElementById('compositionClose').addEventListener('click', closeOnEscape(() => panel.remove())); showNotice(`AI composition ${result.state}: ${result.writerCalls} ${result.writerTransport} calls.`);
}

// What is left on this edition.
async function showWorklist() {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;

  // Whatever is being typed counts as work done, so it is saved before the
  // edition is measured - otherwise the list reports the block the desk is
  // looking at as empty.
  if (store.getState().dirty) await autosave.flush();

  const list = await fetch(`/api/newspapers/${newspaper.id}/worklist`)
    .then((r) => r.json()).catch(() => ({ error: "What is left could not be read. Try again." }));
  if (!list || list.error) {
    return showFailure(list?.error || "What is left could not be read.", { retry: showWorklist });
  }

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

  const ok = await askConfirm({
    title: "Set this block's type to make the copy fit?",
    body: proposal.message,
    confirm: "Set it tighter",
    cancel: "Leave the type alone",
  });
  if (!ok) return;

  const applied = await fetch(path, { method: "POST" }).then((r) => r.json()).catch(() => ({}));
  if (applied.error) return showNotice(applied.error);

  await reloadPages();
  showNotice(applied.message);
}

/**
 * One edition, in one of the four formats a production desk needs.
 *
 * Deliberately NOT gated on press readiness, and the press package beside it
 * still is. That one is the file that goes to the plate; these are the working
 * exports, wanted while the page is still being made up - which is the only
 * day they are any use.
 */
const EXPORT_LABEL = {
  pdf: "CMYK print PDF",
  indesign: "InDesign document",
  scribus: "Scribus document",
  word: "Word document",
};

async function downloadExport(format) {
  const newspaper = store.getState().newspaper;
  if (!newspaper) return;
  const label = EXPORT_LABEL[format] || format;

  showNotice(`Composing the ${label}…`);
  const response = await fetch(`/api/newspapers/${newspaper.id}/export/${format}`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    return showNotice(result.error || `The ${label} could not be generated.`);
  }

  const missing = Number(response.headers.get("X-Pictures-Missing") || 0);
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name ? name[1] : `sahas.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);

  const size = blob.size > 1e6 ? `${(blob.size / 1e6).toFixed(1)} MB` : `${Math.round(blob.size / 1024)} KB`;
  showNotice(
    `${label} downloaded — ${size}.`
    + (missing ? ` ${missing} picture file${missing === 1 ? "" : "s"} could not be found on the server.` : "")
    + (format === "word" ? " It carries the copy, not the page — use the PDF or InDesign for the layout." : "")
    + (format === "indesign" ? " InDesign needs the Noto Devanagari faces installed, and the photographs beside the file." : ""),
  );
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
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (result.code === 'PRESS_NOT_READY') {
      const counts = result.readiness?.counts || {};
      return showNotice(`Not ready for press — ${counts.needsReview || 0} need review, ${counts.preflightErrors || 0} preflight errors, ${counts.pagesNotPassed || 0} pages not passed.`);
    }
    return showNotice("The press package could not be generated.");
  }

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

/**
 * The story in the selected block continues into the block just shift-clicked.
 *
 * The same endpoint "Carry over" uses, with the target named instead of found:
 * jump.service.js has always accepted one and had never once been given one,
 * so the only continuation a desk could ask for was "the first empty block on
 * a later page". A big story running into a second leg on the SAME page is the
 * commoner arrangement by far, and it is what the desk asked for.
 */
async function continueInto(targetKey) {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block the story starts in first, then shift-click the one it continues into.");
  if (key === targetKey) return showNotice("A story cannot continue into itself.");

  await saveNow();
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/carry-over`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toPageId: page.id, toSectionKey: targetKey }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "This story could not be continued into that block.");

  await reloadPages();
  showNotice(
    `The story continues into "${result.to.sectionKey}" — ${result.to.chars} characters. `
    + "No jump line: the two legs are on the same page, so a reader simply carries on.",
  );
}

/**
 * THE EDITION'S PAGES, RE-READ - CHECKED, ONCE, IN ONE PLACE.
 *
 * Five actions end by pulling the whole edition back: Make it fit, Carry over,
 * Continue into, Fill features and the composition apply. All five wrote the
 * same line - `fetch(...).then((r) => r.json())` followed by `pages.forEach` -
 * and none of them looked at the response. A 500, a dropped session or a
 * network stall therefore resolved to an object like `{ error: "..." }`, and
 * `.forEach` on it threw a TypeError inside an async click handler: nothing on
 * screen, nothing said, the workspace left showing pre-action state that no
 * longer matched the database, and the only trace a console line no desk is
 * looking at. The action had usually SUCCEEDED - it is only the re-read that
 * failed - which is the worst version, because the desk is then told nothing
 * about work that really happened.
 *
 * Returns true when the canvas now matches the database, false when it does
 * not and the desk has been told so.
 */
async function reloadPages(newspaperId) {
  const id = newspaperId || store.getState().newspaper?.id;
  if (!id) return false;
  try {
    const response = await fetch(`/api/newspapers/${id}/pages`);
    if (!response.ok) throw new Error(String(response.status));
    const pages = await response.json();
    if (!Array.isArray(pages)) throw new Error("not a page list");
    // BEFORE the pages are replaced, not after. `replacePage` publishes the
    // PAGE topic synchronously, which repaints the canvas - so a catalogue
    // updated on the line below is updated one paint too late, and the block
    // goes on wearing the jump mark for an arrangement that has just been
    // undone. Measured by pressing Reunite and watching the flag stay put
    // while the database said the legs were already gone.
    //
    // Rebuilt from the FRESH pages rather than from the store's own copy, for
    // the same reason: carry-over and reunite both change these links and both
    // end here.
    setContinuations(pages);
    pages.forEach((page) => store.replacePage(page, { structural: true }));
    return true;
  } catch (error) {
    showNotice("The edition changed, but this screen could not re-read it. Reload the page to see it.");
    return false;
  }
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

  await reloadPages();
  showNotice(`Carried on to page ${result.to.pageNumber}, block "${result.to.sectionKey}". ${result.carryLine}`);
}

/**
 * Bring a carried-over story back into one block.
 *
 * The exact reverse of Carry over and it goes through the endpoint that has
 * always been there: `reunite()` strips the two furniture lines nobody typed -
 * the "(उर्वरित पान ...)" this block ends on and the "(पान ...)" the second leg
 * begins with - joins the copy, and empties the leg. A same-page continuation
 * has no pick-up line to strip, and stripping an absent line is a no-op, so
 * one call covers both.
 */
async function reunite() {
  const page = store.getCurrentPage();
  const key = store.getState().selectedSectionKey;
  if (!page || !key) return showNotice("Select the block the story starts in first.");
  const section = store.getSection(key);
  const legs = legsOf(section);
  if (!legs.length) return showNotice("This story does not carry on into another block.");

  // It moves copy between two blocks, so whatever is in the draft has to be in
  // the database first - the same reason Carry over and Make it fit save.
  await saveNow();
  const response = await fetch(`/api/pages/${page.id}/sections/${encodeURIComponent(key)}/reunite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return showNotice(result.error || "This story could not be brought back together.");

  await reloadPages();
  showNotice(
    `Brought back into one block. ${result.reunited === 1 ? "One leg was" : `${result.reunited} legs were`} emptied - `
    + "the copy is all here now, and the block may well be overset.",
  );
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
  if (!response.ok) {
    return showFailure(result.error || "The features could not be filled.", { retry: fillFeatures });
  }

  // Reload the pages so the filled blocks appear, then say plainly what did and
  // did not run. A box that could not be filled is reported, never left looking
  // finished.
  await reloadPages(newspaper.id);

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
  const state = store.getState();
  const newspaper = state.newspaper;
  if (!newspaper) return;

  const place = getIdentity()?.placeOfPublication || "";

  // Which blocks are open, and which of them the desk has already commissioned
  // by typing a headline into them. Computed from the store rather than
  // fetched: candidatesOn() is the ONE rule for what is writable and it
  // already runs in this browser - asking the server would be a second copy of
  // it, which is the drift this project has been bitten by twice.
  const byPage = {};
  let commissioned = 0;
  let openBlocks = 0;
  for (const page of state.pages || []) {
    const { ready } = candidatesOn(page, { place });
    const unbriefed = ready.filter((block) => block.fromToday);
    commissioned += ready.length - unbriefed.length;
    openBlocks += ready.length;
    if (unbriefed.length) byPage[page.page_number] = unbriefed.length;
  }

  if (!openBlocks) return showNotice("Every block in this edition is written, sold or standing furniture. There is nothing to fill.");

  // Nothing to plan, but blocks the desk has already commissioned by typing a
  // headline: that is exactly what this button used to do, so it still does it.
  if (!Object.keys(byPage).length) return writeCommissionedBlocks();

  const { openNewsdeskPanel } = await import("./newsdesk-panel.js");
  // Every page of the paper, so the brief can say "nothing free" rather than
  // silently omitting one - a list that drops a page is indistinguishable from
  // a list that has lost one.
  for (const page of state.pages || []) {
    if (!(page.page_number in byPage)) byPage[page.page_number] = 0;
  }

  openNewsdeskPanel({
    newspaperId: newspaper.id,
    byPage,
    // What the owner set in Settings as the ground this paper covers. The run
    // opens on it and the desk may change it for this run only.
    place: getIdentity()?.coverage || null,
    commissioned,
    notice: showNotice,
    // A block carrying a headline somebody typed is a story the desk has
    // already decided on. It is written FROM that headline, through the path
    // that has always done it - never handed a story off the wire, which would
    // silently discard an editorial decision.
    onWriteCommissioned: writeCommissionedBlocks,
    // The run writes server-side across the whole edition, so the pages this
    // browser is holding are stale the moment it lands. patchDraft() only ever
    // reached the page the desk happened to be looking at, which is why this
    // route does not use it.
    onDone: () => reloadPages(),
  });
}

/**
 * Write the blocks on THIS page that already carry a headline.
 *
 * The desk has said what these are about; the job is to write that. One
 * request per block, two at a time (bulk-generate.js says why), every one a
 * proposal. This is what "Write empty blocks" did before the Newsdesk Run
 * existed, and it is still the right thing for a commissioned block.
 */
async function writeCommissionedBlocks() {
  const page = store.getCurrentPage();
  if (!page) return;

  const { ready, skipped } = candidatesOn(page, { place: getIdentity()?.placeOfPublication || "" });
  const commissioned = ready.filter((block) => !block.fromToday);
  if (!commissioned.length) {
    return showNotice("No block on this page carries a headline waiting for its story.");
  }

  const button = document.getElementById("writeEmptyBtn");
  const label = button?.textContent;
  if (button) button.disabled = true;

  try {
    const batch = await runBulk({
      blocks: commissioned,
      onProgress: ({ phase, finished, total, sectionKey }) => {
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
    showBulkProposals(batch, skipped, { fromToday: 0 });
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
function showBulkProposals(batch, skipped, { fromToday = 0 } = {}) {
  const rows = batch.results.map((result) => {
    if (result.error) {
      return `<li class="bulk-row is-error"><strong>${escapeHtml(result.sectionKey)}</strong>
        <span class="muted">${escapeHtml(result.error)}</span></li>`;
    }
    return `<li class="bulk-row">
      <strong>${escapeHtml(result.sectionKey)}</strong>
      <span class="bulk-headline">${escapeHtml(result.proposal.headline)}</span>
      <span class="muted">${result.fit.charsUsed} of ${result.fit.bodyCharBudget} characters</span>
      ${result.retrieval ? `<div class="bulk-retrieval">${retrievalStatusMarkup(result.retrieval)}</div>` : ""}
      <button type="button" class="ext-editor-btn ext-editor-btn-primary" data-bulk-accept="${escapeHtml(result.sectionKey)}">Accept</button>
    </li>`;
  }).join("");

  const skippedNote = skipped.length
    ? `<p class="muted ext-note">Left alone: ${skipped.map((s) => `${escapeHtml(s.sectionKey)} (${escapeHtml(s.why)})`).join(", ")}.</p>`
    : "";

  // Said plainly, because a block written from the wire and a block written
  // from a headline somebody typed are not the same kind of proposal - the
  // first one's facts came from sources the desk can open in that proposal's
  // own row, the second one's did not.
  const todayNote = fromToday
    ? `<p class="muted ext-note">${fromToday} block${fromToday === 1 ? "" : "s"} had no headline, so ${fromToday === 1 ? "it was" : "they were"} written from today's checked news for this edition's own ground. A block whose sources could not be verified is refused rather than invented — that refusal is what you will see in its row.</p>`
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
    ${todayNote}
    ${skippedNote}
    <p class="ai-proposal-warn">The desk must check every fact before any of this is printed.</p>`;
  nameThePanel(panel);
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

/**
 * Reunite is live only on a block a story actually carries on FROM, and its
 * title says where the rest of it is. Disabled rather than hidden, which is
 * the rule the panel's own Remove buttons follow: a desk can see the way out
 * before they need it, and a control that appears and disappears as the
 * selection moves is one nobody learns is there.
 */
function syncReuniteButton() {
  const button = document.getElementById("reuniteBtn");
  if (!button) return;
  const section = store.getSelectedSection();
  const legs = section ? legsOf(section) : [];
  button.disabled = !legs.length;
  button.title = legs.length
    ? `Bring this story back into one block - it carries on into ${legsSentence(legs)}`
    : "Bring a carried-over story back into one block. Select the block the story starts in.";
}

/** Is the advert ear on this page, and may this page have one at all? */
const MASTHEAD_EAR_KEY = "masthead-advert";

function syncMastheadEarButton() {
  const button = document.getElementById("mastheadEarBtn");
  if (!button) return;
  const page = store.getCurrentPage();
  // Only page one has a nameplate, so only page one has a corner to sell.
  const onFront = Number(page?.page_number) === 1;
  button.hidden = !onFront;
  if (!onFront) return;
  const present = (page.sections || []).some((s) => s.section_key === MASTHEAD_EAR_KEY);
  button.classList.toggle("active", present);
  button.textContent = present ? "Ad ear" : "No ad ear";
  button.title = present
    ? "The advert ear is beside the nameplate. Press to take it off — the paper's own title is then set across the whole measure."
    : "The nameplate is set across the whole measure. Press to put the advert ear back beside it.";
}

/**
 * Sell the corner of page one, or do not.
 *
 * Both answers have always been real - `mastheadMarkup` reserves the ear only
 * while the frame exists, so removing it gives the paper's own title the whole
 * measure (measured: 247x46 px to 426x80 px) - and only one of them could be
 * reached. Deleting the frame was possible from "− Block"; putting it back was
 * possible only from an endpoint nothing called. An action with a server and no
 * door is the same fault as a control that cannot act, one step further along.
 *
 * Taking it off goes through `deleteBlock`, so a corner that has artwork in it
 * still asks before it goes.
 */
async function toggleMastheadEar() {
  const page = store.getCurrentPage();
  if (!page || Number(page.page_number) !== 1) return showNotice("The nameplate, and its ear, are page one's.");

  const present = (page.sections || []).some((s) => s.section_key === MASTHEAD_EAR_KEY);
  if (present) return deleteBlock(MASTHEAD_EAR_KEY);

  const response = await fetch(`/api/pages/${page.id}/repair-structural-frames`, { method: "POST" });
  if (!response.ok) return showNotice("The advert ear could not be put back.");
  const result = await response.json();
  store.replacePage(result.page, { structural: true });
  renderPageArea();
  showNotice(result.created?.length
    ? "The advert ear is back beside the nameplate."
    : "The advert ear is already there.");
}

function renderPageArea() {
  const state = store.getState();
  const page = store.getCurrentPage();
  renderCanvas(page, state.newspaper, state, {
    onSelectSection: selectSection,
    onContinueInto: continueInto,
    onSectionAction,
    onMoveSection: moveSection,
    onMoveOverlay: moveOverlay,
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
  syncReuniteButton();
  syncMastheadEarButton();
}

function renderSidePanels() {
  const section = store.getSelectedSection();
  const view = currentView();
  const story = currentStory();

  renderExternalEditor(section, view, story, store.getState().reporterNews, {
    onPatch: patchDraft,
    // The button opens a file picker and lays the picture across the selected
    // block's bottom edge - see addOverlay(). Nothing in the product could
    // create one of these before.
    onAddOverlay: () => pickImage(addOverlay),
    onPictureLink: addPictureFromLink,
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
      if (!section || !view) return null;
      // The EXACT engine, because that is what the Space panel beside this
      // counter reads. The comment that used to sit here said this was "the
      // same character grid the Space panel and preflight use - never a second
      // measurement that could quietly disagree with them", and it went stale
      // the day the Space panel moved to composeSection(): the footer was then
      // the second measurement. Measured on one real block, on one screen, at
      // the same moment: the footer said "51 of 300 characters" while the panel
      // a few pixels to its right said 147-336. Two numbers for one block is
      // the drift this codebase has already been bitten by twice.
      //
      // A range, not a scalar, and that is settled - the same block holds
      // 30-46% more or fewer characters depending only on what is written into
      // it (CLAUDE.md, "The character budget is a range"). The grid survives as
      // the fallback for the moment before the publication font is measurable,
      // which is exactly what it is for.
      if (fontsReady() && Number(section.width_px) > 0) {
        const composed = composeSection({ ...section, images: sectionImages }, view);
        const range = composed.capacity?.bodyCharRange;
        if (range) return { min: range.min, max: range.max, exact: true };
      }
      const budget = buildFlowMap(section, view, sectionImages.map(flowImageFromRow)).bodyCharBudget;
      return { min: budget, max: budget, exact: false };
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
    onPlaceSmartCardInNewBlock: placeSmartCardInNewBlock,
    onPurpose: setBlockPurpose,
    onRefresh: () => renderSidePanels(),
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
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  // Quill can receive programmatic focus while the workspace refreshes its
  // one body document after undo/redo. That is not a desk typing into the
  // body, so it must not swallow picture/history shortcuts. A real body edit
  // marks its source surface explicitly; display fields remain ordinary rich
  // contenteditables and retain browser-native text editing shortcuts.
  if (el.closest?.("#edWritingSurface")) return el.closest("#edWritingSurface")?.classList.contains("is-body-target") === true;
  return Boolean(el.isContentEditable);
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
  (async () => {
    // Each PATCH returns the complete image list, so this deliberately uses
    // the same ordered path as alignment. Parallel requests were able to
    // overwrite a moved sibling with a stale response.
    for (const row of rows) {
      const result = await persistImagePatch(row.id, {
        x: Math.round((Number(row.x_px) || 0) + dx),
        y: Math.round((Number(row.y_px) || 0) + dy),
      });
      if (!result) return showNotice("The selected pictures could not be moved.");
    }
    redrawCompose();
    history.record(store.getDraft(), { coalesce: false, label: "Pictures moved", kind: "image", images: sectionImages });
  })();
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
    // Bound once, at the document, and therefore still bound after the desk
    // has left the edition - which was harmless only while there was nowhere
    // to leave TO. Now that Back walks the desk's own screens, Ctrl+Z on the
    // Reporters screen would reach the workspace's undo stack and Delete
    // would reach a block nobody can see. The shell being on the page is what
    // says this screen is the workspace's; the same test the panels use.
    if (!document.querySelector(".workspace-shell")) return;
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
    if (source === "properties-panel") refreshColumnRules(section, view);
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
    refreshColumnRules(null, null, page);

    const section = store.getSelectedSection();
    if (section) refreshDockSavedAt(section);
  });

  // The theme control follows the page, like every other panel on this screen.
  //
  // Calling it from selectPage() was wrong twice over: it is nested one scope
  // in, so `bindPageTheme is not defined` was thrown on every page turn and
  // swallowed as an unhandled click-handler error - and even had it resolved,
  // selectPage is one of several ways the page changes. The store's own topic
  // is the one place that knows about all of them.
  store.subscribe(store.TOPICS.PAGE, () => { bindPageTheme(); });
  store.subscribe(store.TOPICS.PAGE, () => {
    renderPageArea();
    renderSidePanels();
    renderStoryPickerPanel();
    loadPageGuides();
    refreshToolbarSelection(Boolean(store.getState().selectedSectionKey), false);
    // Carry over and Reunite both end by reloading the pages, and both change
    // exactly this. selectFirstSection() below refreshes it too, but only when
    // the selection actually MOVES - and after a reunite it usually does not,
    // because the desk is still on the block they pressed it from.
    syncReuniteButton();
    selectFirstSection();
  });

  store.subscribe(store.TOPICS.STORY_PICKER, () => {
    const open = store.getState().storyPickerOpen;
    document.getElementById("sidebarLeft")?.classList.toggle("open", open);
    document.getElementById("sidebarBackdrop")?.classList.toggle("open", open);
    document.getElementById("tbFromReporter")?.classList.toggle("active", open);
  });
}
