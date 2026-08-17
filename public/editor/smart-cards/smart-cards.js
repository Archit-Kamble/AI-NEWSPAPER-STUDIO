// Smart Cards: the structured daily features, drawn from their own data.
//
// A sudoku is a grid, a horoscope is twelve signs each with a lucky number and
// colour, an almanac is labelled times. All of that used to be flattened into
// one string of body copy the moment it arrived - "७ · · ३ · ·" down nine
// lines - and then parsed back out of that string on the way to the page. Both
// halves of that round trip lose things. A solution cannot be carried at all. A
// difficulty cannot be carried. One stray character makes the whole grid
// unreadable, and there is no way to tell a blank cell from a printed dot.
//
// So the card's own data is what is stored (`smart_card_data`), and this is the
// one place it is turned into marks on paper. ONE renderer, called by both the
// page canvas and the editor - the same rule the character grid and the picture
// style already follow, and for the same reason: two renderers drift, and then
// the desk is looking at a different puzzle from the one that prints.
//
// Every renderer here returns `null` for data it does not recognise. A card
// nobody wrote a renderer for must fall through to its body copy rather than
// vanish off the page: the text is still there, it is still printable, and a
// missing renderer is a missing feature, not a missing box.
//
// Sizing is now solved, not styled: every renderer takes the block's own
// FRAME (logical newspaper pixels) and reads layoutSmartCard()'s answer -
// an explicit fontPx and geometry, written as inline styles - rather than
// leaning on CSS classes whose font-size differed by context
// (`.section-feature .smart-card` vs `.frame-card .smart-card` vs
// `.smart-card-preview .smart-card`, three different hardcoded numbers with
// no relation to the block's actual size). The page canvas and the Block
// Editor share ONE call site for this (section-thumb.js's
// bodyOrTableMarkup()), so they can no longer disagree - and the Editor
// still zooms the WHOLE resulting card as one object, exactly like it
// already does for headline/body, rather than asking for a second solve at
// a different size.

import { escapeHtml } from "../format.js";
import { layoutSmartCard } from "./layout.js";

const DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

/** Devanagari numerals, which is how this paper prints a number. */
export function devanagari(value) {
  return String(value ?? "").replace(/\d/g, (d) => DIGITS[Number(d)]);
}

// ----------------------------------------------------------------- sudoku ---

function isGrid(grid) {
  return Array.isArray(grid)
    && grid.length === 9
    && grid.every((row) => Array.isArray(row) && row.length === 9);
}

/**
 * The puzzle as nine rows of nine squares.
 *
 * The heavier rules between the 3×3 boxes are what make a sudoku readable, and
 * a printed puzzle always sets them. A zero is an empty square - the grid is
 * numbers, so there is no dot to mistake for a clue.
 *
 * Cells carry their own explicit width/height (layoutSmartCard()'s `cell`,
 * the same number for all 81) rather than leaning on `table-layout:fixed`
 * to distribute space evenly - exact squares whatever the browser's own
 * table layout heuristics would otherwise have done at this size.
 */
function sudokuMarkup(data, layout) {
  const grid = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : null;
  if (!grid || !layout.geometry) return null;
  const { cell, gridSize, top } = layout.geometry;
  const cellStyle = `width:${cell}px;height:${cell}px;font-size:${layout.fontPx}px`;

  const rows = grid.map((row, y) => {
    const cells = row.map((value, x) => {
      const edges = [
        x % 3 === 2 && x !== 8 ? "box-right" : "",
        y % 3 === 2 && y !== 8 ? "box-bottom" : "",
      ].filter(Boolean).join(" ");
      const filled = Number(value) > 0;
      return `<td class="${edges}${filled ? "" : " blank"}" style="${cellStyle}">${filled ? devanagari(value) : ""}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");

  return `<table class="smart-card-grid-table" role="presentation" style="width:${gridSize}px;height:${gridSize}px;margin:${top}px auto 0">${rows}</table>`;
}

// --------------------------------------------------------------- label/value ---

/** `label : value` down a column - the almanac's five lines. */
/**
 * A stored card's list, or an empty one.
 *
 * `smart_card_data` is JSONB written months ago by a build that may not be this
 * one, so "it is an array because the builder makes arrays" is not something to
 * draw a page on. A renderer that throws does not spoil its own block - it takes
 * down the whole newspaper canvas, every block on it, because they are drawn in
 * one pass.
 */
function asList(value) {
  return Array.isArray(value) ? value : [];
}

function labelledMarkup(items, layout) {
  const rows = asList(items).filter((item) => item && item.label);
  if (!rows.length || !layout.geometry) return null;
  const { rowHeight } = layout.geometry;
  return `<table class="smart-card-table" style="font-size:${layout.fontPx}px">${rows
    .map((item) => `<tr style="height:${rowHeight}px"><th>${escapeHtml(item.label)}</th><td>${escapeHtml(item.text ?? "")}</td></tr>`)
    .join("")}</table>`;
}

// ------------------------------------------------------------------- rashi ---

/**
 * The twelve signs, each as its own row.
 *
 * The lucky number and colour are kept as their own line rather than run into
 * the sentence: a reader looks for them, and flattening them into the prose is
 * how they became "(शुभ अंक ३ । शुभ रंग निळा)" glued to the end of a paragraph.
 *
 * One column of twelve in a narrow block, two columns of six in a wide one
 * (layoutRashi()'s own call) - never twelve separate web cards, a grid of
 * newspaper rows either way.
 */
function rashiMarkup(data, layout) {
  const signs = Array.isArray(data?.signs) ? data.signs : null;
  if (!signs || !signs.length || !layout.geometry) return null;
  const { columns, rows, rowHeight } = layout.geometry;

  const items = signs
    .filter(Boolean)
    .map((sign) => {
      const luck = [
        sign.luckyNumber != null ? `शुभ अंक ${devanagari(sign.luckyNumber)}` : "",
        sign.luckyColour ? `शुभ रंग ${escapeHtml(sign.luckyColour)}` : "",
      ].filter(Boolean).join(" · ");
      return `<li class="smart-card-rashi-sign" style="height:${rowHeight}px">
        <strong class="rashi-name">${escapeHtml(sign.name || "")}</strong>
        <span class="rashi-text">${escapeHtml(sign.text || "")}</span>
        ${luck ? `<small class="rashi-luck">${luck}</small>` : ""}
      </li>`;
    })
    .join("");

  const gridStyle = `font-size:${layout.fontPx}px;grid-template-columns:repeat(${columns},1fr);`
    + `grid-auto-flow:column;grid-template-rows:repeat(${rows},${rowHeight}px)`;
  return `<ul class="smart-card-rashi" style="${gridStyle}">${items}</ul>`;
}

// ---------------------------------------------------------------- suvichar ---

function suvicharMarkup(data, layout) {
  if (!data?.text || !layout.geometry) return null;
  return `<blockquote class="smart-card-quote" style="font-size:${layout.fontPx}px">
    <p>${escapeHtml(data.text)}</p>
    ${data.attribution ? `<cite>— ${escapeHtml(data.attribution)}</cite>` : ""}
  </blockquote>`;
}

// -------------------------------------------------------------- dinvishesh ---

function dinvisheshMarkup(data, layout) {
  const entries = asList(data?.entries).filter(Boolean);
  if (!entries.length || !layout.geometry) return null;
  return `<ul class="smart-card-list" style="font-size:${layout.fontPx}px">${entries
    .map((entry) => `<li>${escapeHtml(typeof entry === "string" ? entry : entry.text || "")}</li>`)
    .join("")}</ul>`;
}

// ------------------------------------------------------------------ router ---

const RENDERERS = {
  sudoku: sudokuMarkup,
  "sudoku-solution": sudokuMarkup,
  panchang: (data, layout) => labelledMarkup(data?.items, layout),
  rashi: rashiMarkup,
  suvichar: suvicharMarkup,
  dinvishesh: dinvisheshMarkup,
};

/** Whether this key has a renderer at all. */
export function canRenderSmartCard(key) {
  return Boolean(RENDERERS[String(key || "")]);
}

export const SMART_CARD_KEYS = Object.keys(RENDERERS);

// A card the block is genuinely too small for. Still drawn - never deleted,
// never silently clipped (layoutSmartCard() clamps to a legible minimum
// rather than shrinking past it) - but flagged, both in the class a
// stylesheet or a screenshot can key off of and in a short desk-facing line
// preflight can also surface as an error for a printable card.
const OVERSET_NOTE = "या ब्लॉकमध्ये हे कार्ड नीट बसत नाही — अधिक जागा आवश्यक आहे.";

/**
 * A Smart Card as it prints, or `null` when there is nothing to draw.
 *
 * `null` is a normal answer - an unknown key, a payload the renderer does not
 * recognise, a card half-saved. The caller then prints the block's body copy,
 * which is always there.
 *
 * `frame` is the block's own logical width/height/padding (newspaper pixels -
 * never screen or editor-zoomed pixels). It is solved through
 * layoutSmartCard() ONCE here, so every renderer draws from the same answer
 * this function already has, rather than each re-deriving its own size.
 */
export function smartCardMarkup(key, data, frame) {
  const render = RENDERERS[String(key || "")];
  if (!render || !data) return null;

  const layout = layoutSmartCard(key, data, frame);
  const inside = render(data, layout);
  if (!inside) return null;

  const subtitle = data.subtitle ? `<p class="smart-card-subtitle">${escapeHtml(data.subtitle)}</p>` : "";
  const overset = layout.fitState === "OVERSET"
    ? `<p class="smart-card-overset-note">${escapeHtml(OVERSET_NOTE)}</p>`
    : "";
  const cls = `smart-card smart-card-${escapeHtml(key)}${layout.fitState === "OVERSET" ? " is-overset" : ""}`;
  return `<div class="${cls}">${subtitle}${overset}${inside}</div>`;
}

/**
 * Whether a placed card is too small for its own block - the SAME question
 * smartCardMarkup() already answers while drawing, exposed without drawing
 * anything, for preflight (src/services/preflight.service.js) to raise as
 * SMART_CARD_OVERSET on a printable page.
 */
export function smartCardFitState(key, data, frame) {
  if (!canRenderSmartCard(key) || !data) return null;
  return layoutSmartCard(key, data, frame).fitState;
}

/**
 * The card as printable copy.
 *
 * Everything that MEASURES a block reads its body text - the character grid,
 * the worklist, preflight, the fit action. A card still has to have a body, so
 * this is what goes in it. It is a rendering of the data, never the other way
 * round: the data is what is stored and what draws.
 */
export function smartCardText(key, data) {
  if (!data) return "";

  if (key === "sudoku" || key === "sudoku-solution") {
    const grid = isGrid(data.grid) ? data.grid : isGrid(data.solution) ? data.solution : null;
    if (!grid) return "";
    return grid.map((row) => row.map((n) => (Number(n) > 0 ? devanagari(n) : "·")).join(" ")).join("\n");
  }

  if (key === "rashi") {
    return asList(data.signs)
      .filter(Boolean)
      .map((sign) => {
        const luck = [
          sign.luckyNumber != null ? `शुभ अंक ${devanagari(sign.luckyNumber)}` : "",
          sign.luckyColour ? `शुभ रंग ${sign.luckyColour}` : "",
        ].filter(Boolean).join(" । ");
        return `${sign.name} : ${sign.text}${luck ? ` (${luck})` : ""}`;
      })
      .join("\n");
  }

  if (key === "suvichar") {
    return [data.text, data.attribution ? `— ${data.attribution}` : ""].filter(Boolean).join("\n");
  }

  if (key === "dinvishesh") {
    return asList(data.entries).map((e) => (typeof e === "string" ? e : e?.text || "")).join("\n");
  }

  if (key === "panchang") {
    return asList(data.items).filter(Boolean).map((item) => `${item.label} : ${item.text}`).join("\n");
  }

  return "";
}
