// Parts 4 + 12: one section's thumbnail, including its selection chrome.
//
// Split out from canvas.js so a single section can be repainted on its own while
// the editor is being typed into - the canvas never rebuilds every box for one
// keystroke (Part 14).

import { placedPictureStyle } from "../layout/picture-style.js";
import { featureTableMarkup } from "../layout/feature-table.js";
import { smartCardMarkup } from "../smart-cards/smart-cards.js";
import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, statusClass } from "../status/section-status.js";
import { computeMetrics } from "../layout/layout-metrics.js";
import { imageTransformCss } from "../image/image-manager.js";
import { buildFlowMap, CELL, flowRuns, bandSpan, pourIntoRuns, flowImageFromRow } from "../layout/text-flow.js";
import { textWithMarks, markRun, plainText } from "../layout/rich-text.js";

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
      return `${picture}<span class="section-placed-caption"
                   style="left:${image.x_px}px;top:${image.y_px + image.height_px}px;width:${image.width_px}px;z-index:${(image.z_index || 1) + 1}">${escapeHtml(image.caption)}</span>`;
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

  const size = `style="font-size:${view.headlineFontPx}px"`;

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
  return `<div class="section-subheading" style="font-size:${view.subheadingFontPx}px">${escapeHtml(plainText(view.subheading))}</div>`;
}

// "■ मुंबई, वृत्तसंस्था" — place first, then who filed. It opens the body text,
// which is where every paper puts it, so it is built into the body rather than
// being a line of its own.
function datelineMarkup(view) {
  const parts = [view.location, view.author].map((p) => String(p || "").trim()).filter(Boolean);
  if (!parts.length) return "";
  return `<span class="section-dateline">■ ${escapeHtml(parts.join(", "))}</span> `;
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
      ${view.kicker ? `<div class="section-kicker" style="font-size:${Math.round(view.bodyFontPx * 1.05)}px">${escapeHtml(view.kicker)}</div>` : ""}
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
  // editor's preview draws with, so the block on the page and the card the desk
  // approved cannot be two different things.
  const card = smartCardMarkup(view.smartCardKey, view.smartCardData);
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
  return markRun(text, 0, marks, escapeHtml);
}

// Copy poured into the cells the pictures leave free - the same calculation the
// composition canvas and the AI brief use, so the page shows the page.
function flowedTextMarkup(section, view) {
  const images = (section?.images || []).map(flowImageFromRow);
  if (!images.length) return null;

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
  const headlineHeight = map.headlineRows * map.cellHeight;
  const subheadingHeight = map.subheadingRows * map.cellHeight;

  // The band keeps clear of any picture standing in it, the same way the body
  // does - a headline set straight over a photograph is the mistake this
  // avoids.
  // If dodging the picture would leave the band less than half the measure, the
  // picture is in the wrong place, not the headline: squeezing a headline into
  // a third of the column reads far worse than letting the designer see the
  // clash and move the photograph.
  const MIN_BAND_SHARE = 0.5;
  const band = (kind, fallbackLeft) => {
    const span = bandSpan(map, kind);
    if (!span || span.length * map.cellWidth < measure * MIN_BAND_SHARE) {
      return { left: fallbackLeft, width: measure };
    }
    return { left: pad + span.col * map.cellWidth, width: span.length * map.cellWidth };
  };

  if (view.headline && headlineHeight > 0) {
    const box = band(CELL.HEADLINE, pad);
    pieces.push(
      `<div class="section-flowed section-flowed-band" style="left:${box.left}px;top:${bandTop}px;width:${box.width}px;height:${headlineHeight}px">${headlineMarkup(view)}</div>`,
    );
  }
  if (view.subheading && subheadingHeight > 0) {
    const box = band(CELL.SUBHEADING, pad);
    pieces.push(
      `<div class="section-flowed section-flowed-band" style="left:${box.left}px;top:${bandTop + headlineHeight}px;width:${box.width}px;height:${subheadingHeight}px">${subheadingMarkup(view)}</div>`,
    );
  }

  // The body is what actually flows round the picture, line by line, which is
  // the whole point of the grid.
  const dateline = [view.location, view.author].map((p) => String(p || "").trim()).filter(Boolean).join(", ");
  // The copy is poured as PLAIN text, because the grid measures and places
  // characters - a tag has no width. The bold and italic ranges are carried
  // separately and put back on each run afterwards, so what a sub-editor marked
  // is what appears on the page.
  const { text: bodyText, marks } = textWithMarks(view.body);
  const prefix = dateline ? `■ ${dateline} ` : "";
  const body = bodyText ? `${prefix}${bodyText}` : "";
  const offset = prefix.length;

  pourIntoRuns(flowRuns(map, CELL.TEXT), body).forEach((run) => {
    const marked = markRun(run.text, (run.at || 0) - offset, marks, escapeHtml);
    pieces.push(
      `<span class="section-flowed" style="left:${pad + run.col * map.cellWidth}px;top:${pad + run.row * map.cellHeight}px;width:${run.length * map.cellWidth + 2}px;font-size:${view.bodyFontPx}px;line-height:${map.cellHeight}px">${marked}</span>`,
    );
  });
  return pieces.join("");
}

export function sectionInnerHtml(section, view, { dirty = false, selected = false } = {}) {
  const status = statusOf(view);
  const type = sectionType(section.section_key);
  const metrics = computeMetrics(section, view);
  // A Smart Card is a grid or a table. It is not copy, so it is not poured
  // through the character cells around the pictures - a sudoku with a
  // photograph on the block was drawing as nine lines of text because the
  // flowed path never asked whether the block held a card at all.
  const hasCard = Boolean(smartCardMarkup(view.smartCardKey, view.smartCardData));
  const flowed = hasCard ? null : flowedTextMarkup(section, view);

  return `
    <div class="section-chrome">
      <span class="section-type-icon" title="${type}">${ICONS[type]}</span>
      <span class="section-label">${escapeHtml(section.section_key)}</span>
      <span class="section-flags">
        ${view.newsItemId ? `<span class="section-flag flag-reporter" title="Linked to a reporter story">${ICONS.reporter}</span>` : ""}
        ${view.aiGenerated ? `<span class="section-flag flag-ai" title="AI generated">${ICONS.ai}</span>` : ""}
        ${metrics.overflowing ? `<span class="section-flag flag-overflow" title="Content overflows this section">${ICONS.overflow}</span>` : ""}
        ${dirty ? `<span class="section-flag flag-unsaved" title="Unsaved changes"></span>` : ""}
      </span>
      <span class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span>
    </div>
    ${flowed === null ? contentMarkup(section, view) : flowed}
    ${placedImagesMarkup(section)}
    <div class="section-hover-toolbar">
      <button type="button" class="section-hover-btn" data-section-action="story" title="Attach a reporter story">Story</button>
      <button type="button" class="section-hover-btn" data-section-action="image" title="Open the image workspace">Image</button>
      <button type="button" class="section-hover-btn" data-section-action="clear" title="Clear this section">Clear</button>
    </div>
    ${selected ? HANDLES.map((h) => `<span class="section-handle handle-${h}" data-handle="${h}"></span>`).join("") : ""}
    ${selected ? `<span class="section-selected-label">${escapeHtml(section.section_key)}</span>` : ""}
  `;
}

export function sectionClassName(view, { selected = false, dirty = false, overflowing = false, atRightEdge = false } = {}) {
  const filled = Boolean(view.headline || view.body || view.imageUrl);
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
    filled ? "filled" : "",
    selected ? "active" : "",
    dirty ? "unsaved" : "",
    overflowing ? "overflowing" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
