// Parts 4 + 12: one section's thumbnail, including its selection chrome.
//
// Split out from canvas.js so a single section can be repainted on its own while
// the editor is being typed into - the canvas never rebuilds every box for one
// keystroke (Part 14).

import { placedPictureStyle } from "../layout/picture-style.js";
import { featureTableMarkup } from "../layout/feature-table.js";
import { smartCardMarkup, smartCardFitState, canRenderSmartCard, SMART_CARD_OVERSET_NOTE } from "../smart-cards/smart-cards.js";
import { smartCardFrameFromComposition } from "../smart-cards/layout.js";
import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { computeMetrics } from "../layout/layout-metrics.js";
import { imageTransformCss } from "../image/image-manager.js";
import { buildFlowMap, CELL, flowRuns, bandBox, pourIntoRuns, flowImageFromRow, datelineText, captionBox } from "../layout/text-flow.js";
import "../layout/inset-panels.js";
const { panelsOf, panelLayout } = globalThis.SahasInsetPanels;
import { textWithMarks, markRun, plainText } from "../layout/rich-text.js";
import { presentationRanges, renderPresentation } from "../layout/editorial-presentation.js";
import { composeSection } from "../compose/section-adapter.js";
import { composedMarkup, diagnosticMarkup } from "../compose/render.js";
import { fontsReady } from "../compose/font-metrics.js";

const ICONS = {
  article:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  lead: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 16.3 6.2 19.8l1.6-6.6L2.6 8.8l6.8-.5L12 2Z"/></svg>',
  photo:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>',
  briefs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h10"/></svg>',
  opinion:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>',
  banner:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="6" rx="1"/><path d="M3 16h12M3 20h8"/></svg>',
  reporter:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 4.9L18.6 8l-4.9 1.7L12 14.6l-1.7-4.9L5.4 8l4.9-1.1L12 2Z"/><path d="M18.5 14l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z"/></svg>',
  overflow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9 2.4 18a1.8 1.8 0 0 0 1.6 2.7h16a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>',
  placeholder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m3 17 5.5-5.5a2 2 0 0 1 2.8 0L18 18"/></svg>',
};

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Section type comes from the template's own section key - src/layout/templates.js
// stays the only catalog of those keys.
export function sectionType(sectionKey = "") {
  const key = sectionKey.toLowerCase();
  if (key.includes("photo")) return "photo";
  if (key.includes("brief")) return "briefs";
  if (key.includes("opinion") || key.includes("editorial")) return "opinion";
  if (key.includes("banner")) return "banner";
  if (key === "lead") return "lead";
  return "article";
}

// An empty block shows nothing but its name and status - the split between
// image and text is decided later, in the editor and by the AI fit, not
// pre-drawn here. Once content exists the block shows what is actually there,
// in normal flow, with no reserved areas.
// Pictures placed in the block, drawn where they actually sit. The page canvas
// and the composition canvas therefore show the same page.
function placedImagesMarkup(section) {
  const images = section?.images || [];
  if (!images.length) return "";
  return images
    .map((image) => {
      // One rule for how a placed picture is drawn - layout/picture-style.js -
      // so the page and the editor cannot disagree about the same photograph.
      const style = placedPictureStyle(image);
      const picture = `<span class="section-placed" style="${style.frame}" data-shape="${style.shape}">
                   <img class="section-placed-image" src="${escapeHtml(image.url)}" alt=""
                        onerror="this.remove()" style="${style.image}" /></span>`;
      // A photograph in a newspaper is captioned. The caption is set under the
      // picture, in the picture's own measure, not in the story's.
      if (!image.caption) return picture;
      const box = captionBox(image);
      return `${picture}<span class="section-placed-caption"
                   style="left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;padding:${box.paddingY}px ${box.paddingX}px;font-size:${box.fontPx}px;line-height:${box.lineHeight};z-index:${(image.z_index || 1) + 1}">${escapeHtml(image.caption)}</span>`;
    })
    .join("");
}

// --------------------------------------------------------- newspaper craft ---
//
// The furniture that makes a block read as a newspaper story rather than as a
// web card. All of it is what the reference pages actually do:
//
//   kicker    the small line above the headline that says what the story is
//             before the headline shouts it
//   accent    one word of the headline painted in the paper's colour - the
//             single most recognisable thing about a Marathi front page
//   dateline  "■ मुंबई, वृत्तसंस्था" opening the body, not sitting apart from it
//   measure   a wide block sets its copy in several narrow columns, because a
//             620-pixel line of 11-point type is unreadable and no paper prints
//             one

// The painted word. An editor marks it explicitly by wrapping it in asterisks -
// "ड्रग्जपासून *दूर राहा*" - which is deliberate: the software must never guess
// which word matters. Failing that, a block whose layout asked for the accent
// treatment paints its last word, which is the commonest choice in print.
export function headlineMarkup(view) {
  if (!view.headline) return "";
  const accent = escapeHtml(view.accentColor || "#c8102e");
  // Plain, because a headline is set as one line of display type - the marks a
  // body takes do not belong in it, and a stray tag from a paste must never
  // print as literal angle brackets.
  const text = plainText(view.headline);
  const semantic = presentationRanges(text, view.editorialPresentation, 'headline');

  // Alignment too, or the one paint before the publication font loads sets the
  // headline flush left and the real composition then moves it - two different
  // pages, a blink apart.
  const size = `style="font-size:${view.headlineFontPx}px;text-align:${escapeHtml(view.headlineAlign || 'left')}"`;

  if (semantic.length) return `<div class="section-headline" ${size}>${renderPresentation(text, [], semantic, escapeHtml)}</div>`;
  if (text.includes("*")) {
    const parts = text.split(/\*([^*]+)\*/g);
    const html = parts
      .map((part, index) =>
        index % 2
          ? `<span style="color:${accent}">${escapeHtml(part)}</span>`
          : escapeHtml(part),
      )
      .join("");
    return `<div class="section-headline" ${size}>${html}</div>`;
  }

  if (view.headlineStyle === "accent") {
    const words = text.trim().split(/\s+/);
    if (words.length > 1) {
      const last = words.pop();
      return `<div class="section-headline" ${size}>${escapeHtml(words.join(" "))} <span style="color:${accent}">${escapeHtml(last)}</span></div>`;
    }
  }
  return `<div class="section-headline" ${size}>${escapeHtml(text)}</div>`;
}

// One rule for the subheading/deck - the page canvas and the Block Editor's
// WYSIWYG frame both draw it with this, so they cannot drift onto two
// different font sizes the way the headline and body inputs once did.
export function subheadingMarkup(view) {
  if (!view.subheading) return "";
  const text = plainText(view.subheading);
  return `<div class="section-subheading" style="font-size:${view.subheadingFontPx}px;text-align:${escapeHtml(view.subheadingAlign || 'left')}">${renderPresentation(text, [], presentationRanges(text, view.editorialPresentation, 'subheading'), escapeHtml)}</div>`;
}

// "■ मुंबई, वृत्तसंस्था" — place first, then who filed. It opens the body text,
// which is where every paper puts it, so it is built into the body rather than
// being a line of its own.
function datelineMarkup(view) {
  const value = datelineText(view);
  return value ? `<span class="section-dateline">${escapeHtml(value.trimEnd())}</span> ` : "";
}

// How many columns the copy is set in. A newspaper column is about 40 mm; at 2
// px/mm that is 80 px, and a block three or four grid columns wide carries one
// text column, a seven-column lead carries three.
function measureColumns(view, widthPx) {
  if (Number(view.columnCount) > 1) return Number(view.columnCount);
  const usable = Math.max(0, widthPx - 2 * (Number(view.marginPx) || 12));
  return Math.max(1, Math.min(4, Math.floor(usable / 150)));
}

function contentMarkup(section, view) {
  const hasImage = Boolean(view.imageUrl);
  const hasText = Boolean(view.kicker || view.headline || view.body);
  if (!hasImage && !hasText) return "";

  const columns = measureColumns(view, Number(section.width_px) || 0);

  // The type sizes are the block's own, the same ones the character grid uses
  // to work out how much copy fits. Sizing the canvas differently from the
  // budget would mean the page you see is not the page that was measured.
  return `
    <div class="section-content" style="font-size:${view.bodyFontPx}px;line-height:${view.lineHeight || 1.25}">
      ${view.kicker ? `<div class="section-kicker" style="font-size:${Math.round(view.bodyFontPx * 1.05)}px;text-align:${escapeHtml(view.headlineAlign || 'left')}">${escapeHtml(plainText(view.kicker))}</div>` : ""}
      ${headlineMarkup(view)}
      ${subheadingMarkup(view)}
      ${
        hasImage
          ? `<span class="section-image-box"><img class="section-image" src="${escapeHtml(view.imageUrl)}" alt=""
               onerror="this.closest('.section-image-box').remove()"
               style="object-fit:${escapeHtml(view.imageFit || "cover")};${imageTransformCss(view)}" />${
                 view.caption ? `<span class="section-caption">${escapeHtml(view.caption)}</span>` : ""
               }</span>`
          : ""
      }
      ${bodyOrTableMarkup(section, view, columns)}
    </div>
  `;
}

/**
 * The exact composition a Smart Card's own frame is read from - the block's
 * real kicker, but with EMPTY headline, subheading and body fields and no
 * images: a Smart Card is never prose, so it must
 * not be measured through the body-pouring/whitespace logic that exists for
 * continuous copy. `body` is cleared on both the persisted row and the draft
 * view - composeSection()'s field picker falls through an empty-string
 * override to the other source, so both have to say so, or a block saved
 * before it held a card (with real body text still in the row) would still
 * measure against that leftover text.
 */
function smartCardComposition(section, view) {
  const emptyDisplay = { headline: '', subheading: '', body: '' };
  return composeSection(
    { ...section, images: [], ...emptyDisplay },
    { ...view, ...emptyDisplay },
  );
}

/**
 * The logical frame a Smart Card in this block has to solve against -
 * layoutSmartCard()'s own `{width, height, padding}` contract, in newspaper
 * pixels (never screen or editor-zoomed pixels - the caller's own
 * transform:scale() enlarges the WHOLE resulting card afterward, same as it
 * already does for headline/body).
 *
 * Read directly off the EXACT composition (compose/) rather than a second,
 * approximate estimate - this used to ask buildFlowMap() only for its
 * kicker/headline/subheading row count, which could disagree with the real
 * composition: a headline that auto-fit to a smaller size changes its real
 * line count, and the row-count estimate never tracked that, so a card
 * measured against a frame that was already wrong.
 */
export function smartCardFrame(section, view) {
  return smartCardFrameFromComposition(smartCardComposition(section, view));
}

/**
 * The block's copy - as a TABLE when it is a feature that is read as one.
 *
 * A sudoku reached the page as nine lines of "१ २ · · · ४" because a feature's
 * result becomes a headline and a body like any other block. A reader solves a
 * grid, so the paper prints squares. Anything the table builder does not
 * recognise falls straight through to ordinary copy - a feature must never
 * vanish off the page because nobody wrote a renderer for it.
 */
function bodyOrTableMarkup(section, view, columns) {
  // A Smart Card first, and from its OWN data. This is the same renderer the
  // editor's preview draws with, so the block on the page and the card the
  // desk approved cannot be two different things.
  //
  // sectionContentMarkup() normally handles a Smart Card block entirely on
  // its own exact-composition path (bands + an absolutely-positioned card at
  // bodyTop) and never reaches this function at all. This branch only runs
  // for the moment before the publication font has loaded (contentMarkup()'s
  // own fallback, same as the prose path below) - smartCardFrame() still
  // reads the exact composition, just composed against the same graceful
  // hmtx fallback compose.js itself uses before the shaper is ready.
  const card = smartCardMarkup(view.smartCardKey, view.smartCardData, smartCardFrame(section, view));
  if (card) return `<div class="section-feature">${card}</div>`;

  if (!view.body) return "";

  // The fallback, and only the fallback: blocks saved before Smart Cards
  // existed hold a sudoku as nine lines of text and nothing else. Parsing that
  // back into a grid is lossy - it cannot carry a solution or a difficulty -
  // which is why new cards never take this path.
  const table = featureTableMarkup(section?.feature_key || view.featureKey, view.body);
  if (table) return `<div class="section-feature">${table}</div>`;

  return `<p class="section-body" style="column-count:${columns}">${datelineMarkup(view)}${bodyMarkup(view)}</p>`;
}

// The body for a block with no picture in it: set as ordinary columns rather
// than poured cell by cell. The marks a sub-editor applied are put back, and
// everything else is escaped - so a story containing a literal "<" prints the
// character, and a story containing <b> prints in bold, and neither prints as
// angle brackets on the page.
function bodyMarkup(view) {
  const { text, marks } = textWithMarks(view.body);
  return renderPresentation(text, marks, presentationRanges(text, view.editorialPresentation, 'body'), escapeHtml);
}

// Copy poured into the cells the pictures leave free - the same calculation the
// composition canvas and the AI brief use, so the page shows the page.
//
// Exported so the Block Editor (block-frame.js) can show a real, accurate
// preview of the flowed result next to its own writing surface - a live
// contenteditable cannot flow text around a picture on both sides in one row
// (CSS float only pushes to one edge; Word and Google Docs need their own
// text-layout engine to do this, not a browser's), so the Block Editor's own
// Quill body stays plain rather than a second, approximate implementation of
// what this function already does correctly. See PROJECT_STATUS.md, Bug #1/#3.
export function flowedTextMarkup(section, view) {
  const images = (section?.images || []).map(flowImageFromRow);
  // The flow grid is the canonical composition plan for every prose story,
  // not just for stories with a placed image. Falling back to CSS columns for
  // no-image sections made the browser balance short copy across columns at
  // the top of a frame, while fit/preflight assumed copy pours down the grid.
  // That was why a canonical 82%-full banner visibly looked almost empty.
  const map = buildFlowMap(section, view, images);
  if (!map.cols || !map.rows) return null;

  const pad = Number(view.marginPx) || 12;
  const measure = map.cols * map.cellWidth;
  const pieces = [];

  // The headline and the deck are set across the measure, as whole wrapped
  // lines, in the rows the grid reserved for them. They are deliberately NOT
  // poured through the character cells: a headline broken cell by cell cannot
  // wrap, cannot carry the painted word, and clips its own vowel signs. The
  // grid's job for these two is to reserve the space, which it still does.
  const bandTop = pad;
  const kickerHeight = map.kickerRows * map.cellHeight;
  const headlineHeight = map.headlineRows * map.cellHeight;
  const subheadingHeight = map.subheadingRows * map.cellHeight;

  // The band keeps clear of any picture standing in it, the same way the body
  // does - a headline set straight over a photograph is the mistake this
  // avoids. bandBox() is shared with the Block Editor (block-frame.js), so
  // the two draw the same box for the same picture.
  const band = (kind, fallbackLeft) => bandBox(map, kind, pad, measure, fallbackLeft);

  if (view.kicker && kickerHeight > 0) {
    const box = band(CELL.KICKER, pad);
    pieces.push(`<div class="section-flowed section-flowed-band section-kicker" style="left:${box.left}px;top:${bandTop}px;width:${box.width}px;height:${kickerHeight}px;font-size:${Math.round(view.bodyFontPx * 1.05)}px">${escapeHtml(view.kicker)}</div>`);
  }

  if (view.headline && headlineHeight > 0) {
    const box = band(CELL.HEADLINE, pad);
    pieces.push(
      `<div class="section-flowed section-flowed-band" style="left:${box.left}px;top:${bandTop + kickerHeight}px;width:${box.width}px;height:${headlineHeight}px">${headlineMarkup(view)}</div>`,
    );
  }
  if (view.subheading && subheadingHeight > 0) {
    const box = band(CELL.SUBHEADING, pad);
    pieces.push(
      `<div class="section-flowed section-flowed-band" style="left:${box.left}px;top:${bandTop + kickerHeight + headlineHeight}px;width:${box.width}px;height:${subheadingHeight}px">${subheadingMarkup(view)}</div>`,
    );
  }

  pieces.push(flowedBodyMarkup(map, view, pad));
  return pieces.join("");
}

// Just the body: poured into the cells the pictures leave free, line by line
// - the part of flowedTextMarkup() that actually does the runaround. Split
// out so the Block Editor can show this exact body alone, beside its own
// headline/subheading frames (which it already positions correctly via
// bandBox()), without rendering a second copy of the headline/subheading.
export function flowedBodyMarkup(map, view, pad) {
  // The copy is poured as PLAIN text, because the grid measures and places
  // characters - a tag has no width. The bold and italic ranges are carried
  // separately and put back on each run afterwards, so what a sub-editor marked
  // is what appears on the page.
  const { text: bodyText, marks } = textWithMarks(view.body);
  const semantic = presentationRanges(bodyText, view.editorialPresentation, 'body');
  const prefix = datelineText(view);
  const body = bodyText ? `${prefix}${bodyText}` : "";
  const offset = prefix.length;

  return pourIntoRuns(flowRuns(map, CELL.TEXT), body).map((run) => {
    const at = (run.at || 0) - offset;
    const relevant = semantic.filter((range) => range.end > at && range.start < at + run.text.length).map((range) => ({ ...range, start: Math.max(0, range.start - at), end: Math.min(run.text.length, range.end - at) }));
    const marked = renderPresentation(run.text, marks.filter((mark) => mark.end > at && mark.start < at + run.text.length).map((mark) => ({ ...mark, start: Math.max(0, mark.start - at), end: Math.min(run.text.length, mark.end - at) })), relevant, escapeHtml);
    return `<span class="section-flowed" style="left:${pad + run.col * map.cellWidth}px;top:${pad + run.row * map.cellHeight}px;width:${run.length * map.cellWidth + 2}px;font-size:${view.bodyFontPx}px;line-height:${map.cellHeight}px">${marked}</span>`;
  }).join("");
}

// The printable content inside a section, without editor chrome or placed
// picture elements. This is the canonical text/card renderer shared by the
// newspaper canvas and the enlarged Block Editor preview. The editor may add
// selection overlays and picture handles, but it must never re-compose the
// story with a second text renderer.
// The one canonical render of a block's printable content.
//
// Both the newspaper canvas and the Block Editor call this, so there is a
// single renderer rather than two that have to be kept in step. It draws the
// exact composition (compose/) - a list of lines that already know exactly
// where they sit - which is what makes the two surfaces the same picture
// instead of two pictures that agree most of the time.
//
// A block whose type is not yet measurable falls back to the older character
// grid for one paint; ensureComposition() re-renders as soon as the
// publication font has loaded, so a fallback measurement never becomes what
// the desk approves.
export function sectionContentMarkup(section, view) {
  const mayHoldCard = Boolean(view.smartCardKey) && Boolean(view.smartCardData) && canRenderSmartCard(view.smartCardKey);

  // A Smart Card is drawn from the SAME exact composition its kicker/headline/
  // deck already use - not a second, browser-flow rendering of those bands
  // sitting above an independently-measured card. composedMarkup() draws the
  // display bands as already-positioned spans (an empty body composes to no
  // body lines at all), and the card is placed in the exact rectangle the
  // composition itself says is left: from `bodyTop` to `content.bottom`, at
  // `content.left`/`content.measure`. Editor zoom is a CSS transform over the
  // whole layer, so this frame - and therefore the card's own font size and
  // geometry - never changes with it.
  if (mayHoldCard && fontsReady()) {
    const composition = smartCardComposition(section, view);
    const frame = smartCardFrameFromComposition(composition);
    const card = smartCardMarkup(view.smartCardKey, view.smartCardData, frame);
    if (card) {
      const bands = composedMarkup(composition, view, { datelinePrefix: '' });
      // `offsetX`/`offsetY` are non-zero only when something - a page overlay,
      // a panel set inside the block - stands in the card's way and the frame
      // was moved clear of it. A card cannot flow round anything, so it is
      // given the clear rectangle and drawn at it.
      const box = `left:${(composition.content.left + (frame.offsetX || 0)).toFixed(2)}px;`
        + `top:${(composition.bodyTop + (frame.offsetY || 0)).toFixed(2)}px;`
        + `width:${frame.width.toFixed(2)}px;height:${frame.height.toFixed(2)}px;`;
      return bands + `<div class="section-feature-card" style="${box}">${card}</div>`;
    }
  }

  if (mayHoldCard) {
    // The publication font has not loaded yet (a Node caller that skipped
    // ensureFontsLoaded(), or the moment before the browser's own await
    // resolves) - fall back to the old flow-based rendering for one paint,
    // same principle as the prose path below.
    return contentMarkup(section, view);
  }

  if (!fontsReady()) {
    const flowed = flowedTextMarkup(section, view);
    return flowed === null ? contentMarkup(section, view) : flowed;
  }

  const composition = composeSection(section, view);
  if (!composition.bodyLines.length && !Object.keys(composition.bands).length) {
    return contentMarkup(section, view);
  }
  return composedMarkup(composition, view, { datelinePrefix: datelineText(view) })
    + diagnosticMarkup(composition);
}

/**
 * The composition of a block, for anything that needs the numbers rather
 * than the markup - the Space read-out, the overflow flag, the Block Editor's
 * hit frames.
 */
export function sectionComposition(section, view) {
  return fontsReady() ? composeSection(section, view) : null;
}

export function sectionInnerHtml(section, view, { dirty = false, selected = false } = {}) {
  const status = statusOf(view, Boolean((section.images || []).length));
  const type = sectionType(section.section_key);
  const metrics = computeMetrics(section, view);
  // The SAME question smartCardMarkup() already answered while drawing the
  // block, exposed here as desk-facing chrome rather than as a sentence
  // baked into the card's own printable markup (see SMART_CARD_OVERSET_NOTE).
  const cardOverset = view.smartCardKey && view.smartCardData
    ? smartCardFitState(view.smartCardKey, view.smartCardData, smartCardFrame(section, view)) === "OVERSET"
    : false;

  return `
    <div class="section-chrome">
      <span class="section-type-icon" title="${type}">${ICONS[type]}</span>
      <span class="section-label">${escapeHtml(section.section_key)}</span>
      <span class="section-flags">
        ${view.newsItemId ? `<span class="section-flag flag-reporter" title="Linked to a reporter story">${ICONS.reporter}</span>` : ""}
        ${view.aiGenerated ? `<span class="section-flag flag-ai" title="AI generated">${ICONS.ai}</span>` : ""}
        ${metrics.overflowing ? `<span class="section-flag flag-overflow" title="Content overflows this section">${ICONS.overflow}</span>` : ""}
        ${cardOverset ? `<span class="section-flag flag-overflow" title="${escapeHtml(SMART_CARD_OVERSET_NOTE)}">${ICONS.overflow}</span>` : ""}
        ${dirty ? `<span class="section-flag flag-unsaved" title="Unsaved changes"></span>` : ""}
      </span>
      <span class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>
    ${sectionContentMarkup(section, view)}
    ${placedImagesMarkup(section)}
    ${insetPanelsMarkup(section, view)}
    <div class="section-hover-toolbar">
      <button type="button" class="section-hover-btn" data-section-action="story" title="Attach a reporter story">Story</button>
      <button type="button" class="section-hover-btn" data-section-action="image" title="Open the image workspace">Image</button>
      <button type="button" class="section-hover-btn" data-section-action="clear" title="Clear this section">Clear</button>
    </div>
    ${selected ? HANDLES.map((h) => `<span class="section-handle handle-${h}" data-handle="${h}"></span>`).join("") : ""}
    ${selected ? `<span class="section-selected-label">${escapeHtml(section.section_key)}</span>` : ""}
  `;
}

/**
 * The panels set inside this block - the चौकट a printed paper puts a fact box
 * in. Drawn from the ONE panel layout (layout/inset-panels.js), which is also
 * what the compositor put in its obstacle set and what the exports place, so
 * the rectangle the copy ran round is the rectangle the reader sees.
 */
export function insetPanelsMarkup(section, view) {
  // THE DRAFT FIRST, like every other field. This read the ROW alone, so a
  // panel a desk had just added drew nothing until the edition was reloaded -
  // the same shape of fault as the dateline that was read from the view alone,
  // in the other direction.
  const panels = panelsOf({ ...section, inset_panels: view?.insetPanels ?? section?.inset_panels });
  if (!panels.length) return "";
  const bodyPx = Number(view?.bodyFontPx) || 6.4;
  return panels.map((panel) => {
    // A CHART PANEL DRAWS A CARD, not lines of type. The same renderer and the
    // same solve a whole-block chart uses, given the panel's own rectangle as
    // its frame - so moving a chart between a block and a panel changes its
    // size and nothing else about it.
    if (panel.kind === 'chart') {
      const card = smartCardMarkup('chart', panel.card, { width: panel.width, height: panel.height, padding: 0 });
      return `<span class="section-inset-panel section-inset-chart"
                    data-panel-id="${escapeHtml(panel.id)}"
                    style="left:${panel.x}px;top:${panel.y}px;width:${panel.width}px;height:${panel.height}px${
                      panel.tint ? `;background:${escapeHtml(panel.tint)}` : ""}">${card || ""}</span>`;
    }
    const solved = panelLayout(panel, bodyPx);
    const lines = solved.lines.map((line) => `<span style="left:${line.x}px;top:${line.y}px;width:${line.width}px;`
      + `font-size:${line.fontPx}px;line-height:${solved.lineHeight};`
      // An ornament's mark is centred on its own rule; everything else sets
      // flush left, as copy does. The one solve decides it, so the canvas and
      // all four exports cannot disagree.
      + `${line.align === 1 ? "text-align:center;" : ""}`
      + `${line.bold ? "font-weight:700;" : ""}">${escapeHtml(line.text)}</span>`).join("");
    return `<span class="section-inset-panel section-inset-${escapeHtml(panel.kind)}"
                  data-panel-id="${escapeHtml(panel.id)}"
                  style="left:${panel.x}px;top:${panel.y}px;width:${panel.width}px;height:${panel.height}px${
                    panel.tint ? `;background:${escapeHtml(panel.tint)}` : ""}">${lines}</span>`;
  }).join("");
}

export function sectionClassName(view, { selected = false, dirty = false, overflowing = false, atRightEdge = false, atFootEdge = false, hasImages = false } = {}) {
  // Same gap as statusOf() (status/section-status.js) and the same fix: a
  // block holding only a placed picture (section_images), no headline/body/
  // legacy image_url, was drawn with the empty-block treatment on the canvas
  // itself, not just badged wrong.
  const filled = Boolean(
    view.headline || view.body || view.imageUrl || hasImages
    || (view.smartCardKey && view.smartCardData),
  );
  return [
    "newspaper-section",
    // What the layout decided this block is, and how it is ruled off. Both are
    // print decisions, so they belong on the element rather than being inferred
    // from the section key.
    `block-${view.blockType || "article"}`,
    view.borderStyle && view.borderStyle !== "none" ? `ruled-${view.borderStyle}` : "",
    // A block against the right edge of the matter has nothing to its right to
    // be ruled off from.
    atRightEdge ? "at-right-edge" : "",
    // And a block at the foot of the matter has nothing below it either - a
    // rule there would be a rule against the page foot, which no printed
    // newspaper draws.
    atFootEdge ? "at-foot-edge" : "",
    filled ? "filled" : "",
    selected ? "active" : "",
    dirty ? "unsaved" : "",
    overflowing ? "overflowing" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
