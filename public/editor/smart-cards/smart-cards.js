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
import { layoutSmartCard, arcPoints, cardRuleFor } from "./layout.js";

const DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

/** Devanagari numerals, which is how this paper prints a number. */
export function devanagari(value) {
  return String(value ?? "").replace(/\d/g, (d) => DIGITS[Number(d)]);
}

/**
 * One or more already-resolved lines, printed verbatim - layoutSmartCard()
 * did the wrapping (real shaped widths, akshara-safe breaks), so this never
 * re-wraps. A single line prints as plain text (the common case for a short
 * label or a sign's name), so a field that always resolves to one line - as
 * every panchang label and every rashi name does, by construction: their
 * column width is sized to the widest one - keeps printing as bare escaped
 * text rather than growing a span wrapper it never needed. Multiple lines
 * print as their own blocks, each pinned to `white-space:nowrap` so the
 * browser cannot re-wrap a line this module already measured onto a second,
 * different one.
 */
function linesMarkup(lines) {
  if (!lines || !lines.length) return "";
  if (lines.length === 1) return escapeHtml(lines[0]);
  return lines.map((line) => `<span class="smart-card-line">${escapeHtml(line)}</span>`).join("");
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
  const {
    cell, gridSize, top, headingText, headingFontPx, headingLineHeightPx,
  } = layout.geometry;
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

  return `<div class="smart-card-sudoku-body">
    <p class="smart-card-sudoku-heading" style="height:${headingLineHeightPx}px;font-size:${headingFontPx}px;line-height:${headingLineHeightPx}px">${escapeHtml(headingText)}</p>
    <table class="smart-card-grid-table" role="presentation" style="width:${gridSize}px;height:${gridSize}px;left:calc(50% - ${gridSize / 2}px);top:${top}px">${rows}</table>
  </div>`;
}

// --------------------------------------------------------------- label/value ---

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

/**
 * `label : value` down a column - the almanac's rows. Each row's own
 * `labelLines`/`valueLines` and `rowHeight` were solved in layoutSmartCard()
 * against the label column's REAL shaped width, not a font-height check
 * alone - a value column that used to report FITS while its own text ran
 * off the edge of the block.
 */
function labelledMarkup(layout) {
  if (!layout.items || !layout.items.length || !layout.geometry) return null;
  // The label column's real width - measured in layoutSmartCard() against
  // the widest actual label, not CSS's own guessed percentage - set through
  // a <colgroup> so <th> itself stays bare (the label text is what a printed
  // page reads, not a style attribute) while the rendered column still
  // matches the width every value line was wrapped against.
  const g = layout.geometry;
  // The cell inset is the SOLVER's number, written here - never the
  // stylesheet's own em padding, which the solver could not see and which made
  // this card report FITS while the browser wrapped a value and pushed the
  // last row off the block.
  const pad = `padding:${g.cellPadY}px ${g.cellPadX}px`;
  const colgroup = `<colgroup><col style="width:${g.labelWidth}px"><col></colgroup>`;
  return `<table class="smart-card-table" style="font-size:${layout.fontPx}px">${colgroup}${layout.items
    .map((item) => `<tr style="height:${item.rowHeight}px;--row-text-nudge:${item.textNudgeY || 0}px"><th style="${pad}"><span class="panchang-label">${linesMarkup(item.labelLines)}</span></th><td style="${pad}">${linesMarkup(item.valueLines)}</td></tr>`)
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
/**
 * The twelve signs, each as its own row - one column of twelve in a narrow
 * block, two columns of six in a wide one (layoutRashi()'s own call). Every
 * sign's reading text and lucky-metadata line were wrapped in
 * layoutSmartCard() against its REAL column width; the row grid's own track
 * heights (`rowHeights`, one per visual row, each the taller of that row's
 * two signs when the card is two columns wide) carry that content-aware
 * height rather than dividing the block evenly and hoping.
 */
function rashiMarkup(data, layout) {
  if (!layout.items || !layout.items.length || !layout.geometry) return null;
  const {
    columns, rows, rowHeights, columnGap, iconSize, itemPadding, lineHeightPx,
    bandHeight, bandAfterRow,
  } = layout.geometry;

  // THE SIGNS ARE PLACED EXPLICITLY, NOT AUTO-FLOWED.
  //
  // With the nameplate's band taking a track out of the middle, `grid-auto-flow:
  // column` would pour the seventh sign INTO the band. Each sign therefore
  // names its own row and column - the same arithmetic the export walk does,
  // so the two cannot put a sign in different places.
  const banded = bandHeight > 0 && bandAfterRow >= 0;
  const gridRowFor = (row) => (banded && row >= bandAfterRow ? row + 2 : row + 1);

  // THE BAND IS RULED ON BOTH SIDES.
  //
  // Every sign carries a bottom rule, so the row above the band closed with
  // one and the row below it opened with nothing - the desk's "the
  // rashi-bhavishya word/image has 2 line upside, it should have same line
  // downside also". The first sign under the band takes a top rule to match.
  const items = layout.items
    .map((item, index) => `<li class="smart-card-rashi-sign${banded && index % rows === bandAfterRow ? " is-after-band" : ""}" style="grid-column:${Math.floor(index / rows) + 1};grid-row:${gridRowFor(index % rows)};height:${rowHeights[index % rowHeights.length]}px;padding:${itemPadding}px">
        <span class="rashi-emblem" style="width:${iconSize}px">
          ${item.imageFile
    ? `<img class="rashi-art" src="/${escapeHtml(item.imageFile)}" alt="${escapeHtml(item.name)}" style="width:${iconSize}px;height:${iconSize}px">`
    : `<span class="rashi-art rashi-art-missing" style="width:${iconSize}px;height:${iconSize}px" aria-hidden="true"></span>`}
          ${item.luckLines.length
    ? `<small class="rashi-luck rashi-luck-under" style="font-size:${item.luckFontPx}px;line-height:${item.luckLineHeightPx}px">${linesMarkup(item.luckLines)}</small>`
    : ""}
        </span>
        <span class="rashi-copy" style="line-height:${lineHeightPx}px">
          <strong class="rashi-name">${escapeHtml(item.name)}</strong>
          <span class="rashi-text">${linesMarkup(item.readingLines)}</span>
        </span>
      </li>`)
    .join("");

  const tracks = rowHeights.map((h) => `${h}px`);
  if (banded) tracks.splice(bandAfterRow, 0, `${bandHeight}px`);
  const gridStyle = `font-size:${layout.fontPx}px;grid-template-columns:repeat(${columns},1fr);`
    + `column-gap:${columnGap}px;grid-template-rows:${tracks.join(" ")}`;
  return `<ul class="smart-card-rashi" style="${gridStyle}">${items}</ul>`;
}

// ---------------------------------------------------------------- suvichar ---

/**
 * The thought for the day, set as a printed pull quote: the words wrapped and
 * centred on their own measure, a short rule beneath them, and the credit
 * under that. Every line here was already wrapped and measured by
 * layoutSuvichar() - the browser is never asked to break one again.
 */
function suvicharMarkup(data, layout) {
  if (!data?.text || !layout.geometry) return null;
  const g = layout.geometry;
  // One line: the credit runs on at the end of it, which is how a printed
  // thought-for-the-day strip sets. Wrapped: the credit drops under a short
  // centred rule, as a pull quote's does.
  // `g.strip` and NOT `g.inlineCredit`: a one-line quote with no attribution
  // is still a strip, and it was being sent through the wrapped blockquote
  // below - which writes the side inset again as padding, inside a box the
  // solver had already cut to the line's own width. See layoutSuvichar.
  if (g.strip) {
    return `<blockquote class="smart-card-quote is-strip" style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px">
      <p class="smart-card-quote-text">${linesMarkup(layout.quoteLines)}</p>
      ${g.creditText && g.inlineCredit ? `<cite class="smart-card-quote-credit" style="font-size:${g.creditFontPx}px;line-height:${g.lineHeightPx}px;margin-inline-start:${g.creditGap}px">${escapeHtml(g.creditText)}</cite>` : ""}
    </blockquote>`;
  }
  const credit = layout.attributionLines?.length
    ? `<span class="smart-card-quote-rule" style="width:${g.ruleWidth}px;margin:${g.ruleGap}px auto"></span>
       <cite class="smart-card-quote-credit" style="font-size:${g.creditFontPx}px;line-height:${g.creditLineHeightPx}px">${linesMarkup(layout.attributionLines)}</cite>`
    : "";
  return `<blockquote class="smart-card-quote" style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px;padding:0 ${g.sideInset}px">
    <p class="smart-card-quote-text">${linesMarkup(layout.quoteLines)}</p>
    ${credit}
  </blockquote>`;
}

// -------------------------------------------------------------- dinvishesh ---

function dinvisheshMarkup(data, layout) {
  if (!layout.items || !layout.items.length || !layout.geometry) return null;
  const centred = Boolean(layout.geometry.centred);
  const cls = centred ? " is-centred" : "";
  return `<ul class="smart-card-list${cls}" style="font-size:${layout.fontPx}px;gap:${layout.geometry.rowGap}px">${layout.items
    .map((item) => {
      const mark = `<b class="dinvishesh-symbol${item.symbol === "flag" ? " is-flag" : ""}" aria-hidden="true">${item.symbol === "flag" ? "" : escapeHtml(item.symbol)}</b>`;
      // A CENTRED ENTRY CARRIES ITS MARK INSIDE ITS FIRST LINE. The mark is
      // set into the line rather than hanging beside it (a hanging mark on a
      // centred entry points at nothing), and the lines below it are the
      // solver's own - each one its own centred row, never re-broken. Laying
      // the mark outside them would put it on a row of its own.
      const body = centred ? centredLinesMarkup(item.lines, mark) : `${mark}${linesMarkup(item.lines)}`;
      return `<li style="min-height:${item.height}px;padding-left:${layout.geometry.textInset}px">${body}</li>`;
    })
    .join("")}</ul>`;
}

/**
 * The solved lines of one centred entry, the mark opening the first of them.
 *
 * Every line is its own row - the base `.smart-card-line` rule, which the
 * centred variant used to override to `display: inline` so the browser could
 * re-flow them as one paragraph. That threw the solver's own line breaks away:
 * measured on a real 268px card, the solver set
 * "१६०० - ब्रिटिश ईस्ट इंडिया कंपनीला" / "राजाज्ञा मिळाली" and the browser drew
 * "...राजाज्ञा" / "मिळाली". A card measured at one set of breaks and drawn at
 * another can overflow its own block, which is the one thing the solver exists
 * to prevent.
 */
function centredLinesMarkup(lines, mark) {
  if (!lines || !lines.length) return mark;
  return lines
    .map((line, i) => `<span class="smart-card-line">${i === 0 ? mark : ""}${escapeHtml(line)}</span>`)
    .join("");
}

// ----------------------------------------------------------------- havaman ---

/**
 * The forecast, led by its numbers. One city gets a real weather panel - the
 * place, the condition, the maximum and minimum as display figures under their
 * own captions, the rain beneath; several get one ruled row each. Both shapes
 * come pre-solved from layoutHavaman(), which is also what the export walk
 * reads, so the plate prints the panel the desk approved.
 */
function havamanMarkup(data, layout) {
  if (!layout.geometry) return null;
  const g = layout.geometry;
  const source = layout.sourceLines?.length
    ? `<p class="smart-card-weather-source" style="font-size:${g.sourceFontPx}px;line-height:${g.sourceLineHeightPx}px;height:${g.sourceHeight}px">${linesMarkup(layout.sourceLines)}</p>`
    : "";

  if (g.solo) {
    const figures = (layout.figures || []).map((figure) => `<div class="smart-card-weather-figure is-${figure.kind}" style="width:${g.halfWidth}px">
        <b style="font-size:${g.figureFontPx}px;line-height:${g.figureLineHeightPx}px">${escapeHtml(figure.text)}</b>
        <span style="font-size:${g.capFontPx}px;line-height:${g.capLineHeightPx}px">${escapeHtml(figure.label)}</span>
      </div>`).join("");
    return `<div class="smart-card-weather-solo" style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px;padding:0 ${g.inset}px">
      <strong class="smart-card-weather-place" style="font-size:${g.placeFontPx}px;line-height:${g.placeHeight}px">${escapeHtml(layout.placeLine || "")}</strong>
      <span class="smart-card-weather-condition">${linesMarkup(layout.conditionLines)}</span>
      <div class="smart-card-weather-figures" style="gap:${g.gap}px;height:${g.figureHeight}px">${figures}</div>
      <span class="smart-card-weather-rain">${linesMarkup(layout.rainLines)}</span>
      ${source}
    </div>`;
  }

  if (!layout.items || !layout.items.length) return null;
  const rows = layout.items.map((item) => `<div class="smart-card-weather-row" style="height:${item.rowHeight}px;line-height:${g.lineHeightPx}px;padding:${g.rowPadding}px 0">
      <strong style="width:${g.nameWidth}px">${escapeHtml(item.name)}</strong>
      <b style="width:${g.tempWidth}px">${escapeHtml(item.tempText)}</b>
      <span style="width:${g.restWidth}px">${linesMarkup(item.restLines)}</span>
    </div>`).join("");
  return `<div class="smart-card-weather-table" style="font-size:${layout.fontPx}px">${rows}${source}</div>`;
}

// ------------------------------------------------------------------ market ---

/**
 * The rate table: what it is, what it closed at, and how far it moved - the
 * move given both as a percentage and in the instrument's own unit, with a
 * direction mark, which is how every printed market table sets it. Rows are
 * grouped under निर्देशांक / सराफा बाजार because an index in points and a
 * metal in rupees per १० ग्रॅम are not the same kind of number.
 */
const MARKET_MARKS = { up: "\u25B2", down: "\u25BC", flat: "\u2013" };

function marketMarkup(data, layout) {
  if (!layout.items?.length || !layout.geometry) return null;
  const g = layout.geometry;

  const rowMarkup = (item) => `<div class="smart-card-market-row is-${item.direction}" style="height:${item.rowHeight}px;line-height:${g.lineHeightPx}px;padding:${g.rowPadding}px 0">
      <strong style="width:${g.labelWidth}px">${escapeHtml(item.labelText)}${item.unitText ? `<i style="font-size:${g.unitFontPx}px">${escapeHtml(item.unitText)}</i>` : ""}</strong>
      <b style="width:${g.valueWidth}px">${escapeHtml(item.valueText)}</b>
      <span class="market-change" style="width:${g.changeWidth}px">${MARKET_MARKS[item.direction] || ""} ${escapeHtml(item.changeText)}</span>
    </div>`;

  let rows = "";
  if (g.grouped) {
    for (const group of g.groupOrder) {
      const inGroup = layout.items.filter((item) => item.group === group);
      if (!inGroup.length) continue;
      const label = g.groupLabels[group] || "";
      if (label) {
        rows += `<div class="smart-card-market-head" style="height:${g.headLineHeightPx + g.rowPadding}px;font-size:${g.headFontPx}px;line-height:${g.headLineHeightPx}px">${escapeHtml(label)}</div>`;
      }
      rows += inGroup.map(rowMarkup).join("");
    }
  } else {
    rows = layout.items.map(rowMarkup).join("");
  }

  // THE MONTH'S LINE, DRAWN FROM THE SOLVER'S OWN POINT LIST.
  //
  // An inline SVG rather than a stack of divs, because the same points reach
  // Scribus and the PDF as a `poly` and this is the one place they could
  // disagree. Nothing here recomputes a coordinate: the solver normalised the
  // closes into the plot box, and the browser and the plate read that.
  const axis = layout.trend && layout.trend.axis;
  const trend = layout.trend
    ? `<figure class="smart-card-market-trend" style="height:${g.trendHeight}px">
        <figcaption style="font-size:${g.trendLabelFontPx}px;line-height:${g.trendLabelLineHeightPx}px">${escapeHtml(layout.trend.headLine)}</figcaption>
        <svg viewBox="0 0 ${layout.trend.width} ${layout.trend.plotHeight}" width="${layout.trend.width}" height="${layout.trend.plotHeight}" preserveAspectRatio="none" role="img">
          <line x1="${axis.width}" y1="0.3" x2="${layout.trend.width}" y2="0.3" stroke="#ddcbd0" stroke-width="0.6"></line>
          <line x1="${axis.width}" y1="${(layout.trend.plotHeight / 2).toFixed(2)}" x2="${layout.trend.width}" y2="${(layout.trend.plotHeight / 2).toFixed(2)}" stroke="#eadfe1" stroke-width="0.5" stroke-dasharray="2 2"></line>
          <line x1="${axis.width}" y1="0" x2="${axis.width}" y2="${layout.trend.plotHeight}" stroke="#c9aeb3" stroke-width="0.6"></line>
          <polygon points="${layout.trend.area.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ")}" fill="${layout.trend.ink}" fill-opacity="0.12"></polygon>
          <polyline points="${layout.trend.points.map((pt) => `${pt.x.toFixed(2)},${pt.y.toFixed(2)}`).join(" ")}" fill="none" stroke="${layout.trend.ink}" stroke-width="1.1" stroke-linejoin="round"></polyline>
        </svg>
        <b class="trend-y trend-y-high" style="font-size:${g.trendFootFontPx}px;line-height:${g.trendFootLineHeightPx}px;width:${axis.width}px;top:${g.trendLabelLineHeightPx + 2}px">${escapeHtml(axis.highLabel)}</b>
        <b class="trend-y trend-y-low" style="font-size:${g.trendFootFontPx}px;line-height:${g.trendFootLineHeightPx}px;width:${axis.width}px;top:${(g.trendLabelLineHeightPx + 2 + layout.trend.plotHeight - g.trendFootLineHeightPx).toFixed(2)}px">${escapeHtml(axis.lowLabel)}</b>
        <small class="trend-x" style="font-size:${g.trendFootFontPx}px;line-height:${g.trendFootLineHeightPx}px;padding-left:${axis.width}px">
          <span>${escapeHtml(axis.fromLabel)}</span>
          <span>${escapeHtml(axis.sessionsLabel)} ${escapeHtml(axis.changeLabel)}</span>
          <span>${escapeHtml(axis.toLabel)}</span>
        </small>
      </figure>`
    : "";

  // What the bullion figures ARE - derived from the international close at the
  // session's own rupee rate, never a सराफा retail quote. It prints; it is not
  // a developer note.
  const note = layout.noteLines?.length
    ? `<p class="smart-card-market-note" style="font-size:${g.sourceFontPx}px;line-height:${g.sourceLineHeightPx}px">${linesMarkup(layout.noteLines)}</p>`
    : "";

  // THE BAND GAPS ARE THE SOLVER'S, written inline. The stylesheet used to
  // carry a hard 6px under the title, which is the one gap it happened to
  // know about - so any room the panel had left over could only pile up
  // somewhere the solver had not accounted for. layoutMarket() resolves one
  // gap from what is actually left and every band is set to it, which is also
  // the number the export walk steps by.
  return `<div class="smart-card-market" style="font-size:${layout.fontPx}px">
    <h3 style="height:${g.titleHeight}px;margin-bottom:${g.gap}px;font-size:${g.titleFontPx}px;line-height:${g.titleLineHeightPx}px">${linesMarkup(layout.titleLines)}${layout.asOfLine ? `<small style="font-size:${g.headFontPx}px;line-height:${g.headLineHeightPx}px">${escapeHtml(layout.asOfLine)}</small>` : ""}</h3>
    <div class="smart-card-market-rows" style="margin-bottom:${trend ? g.gap : 0}px">${rows}</div>
    ${trend}
    ${note}
    <p class="smart-card-market-source" style="margin-top:${g.gap}px;height:${g.sourceHeight}px;font-size:${g.sourceFontPx}px;line-height:${g.sourceLineHeightPx}px">${linesMarkup(layout.sourceLines)}</p>
  </div>`;
}

// ------------------------------------------------------------------ tender ---

/**
 * The notice, in the bands a printed प्रकटपत्र carries: the issuer over its
 * office; a ruled band with the email at one end and the address at the other;
 * a second with the outward number opposite the place and date; the legal
 * subject over the title; justified, indented paragraphs; the appendix under
 * its own head with its group labels; then place and date on the left against
 * the signature block on the right, and the jimaka note at the foot.
 */
function tenderMarkup(data, layout) {
  if (!layout.issuerLines?.length || !layout.geometry) return null;
  const g = layout.geometry;

  const splitBand = (left, right, fontPx, lineHeightPx, height, cls, leftWidth, rightWidth) =>
    (left.length || right.length
      ? `<div class="smart-card-tender-band ${cls}" style="height:${height}px;padding:${g.bandPadY}px 0;font-size:${fontPx}px;line-height:${lineHeightPx}px">
          <span style="width:${leftWidth ?? g.halfWidth}px">${linesMarkup(left)}</span>
          <span style="width:${rightWidth ?? g.halfWidth}px">${linesMarkup(right)}</span>
        </div>`
      : "");

  const contactBand = splitBand(layout.emailLines, layout.addressLines,
    g.smallFontPx, g.smallLineHeightPx, g.contactBandHeight, "is-contact",
    g.emailWidth, g.addressWidth);
  const referenceBand = splitBand(layout.referenceLines, layout.dateLines,
    g.smallFontPx, g.smallLineHeightPx, g.referenceBandHeight, "is-reference");

  // The opening indent is the FIRST line's, which is how a paragraph is set -
  // `text-indent` on the <p> reached every line, because each composed line is
  // its own block. Every line is still MEASURED at the narrower indented width
  // (layoutTender), so this can only ever leave a line room to spare.
  const paragraphs = layout.paragraphItems.map((item) => `<p style="min-height:${item.height}px">${
    (item.lines || []).map((text, index) => `<span class="smart-card-line"${
      index === 0 ? ` style="padding-left:${item.indentPx}px"` : ""}>${escapeHtml(text)}</span>`).join("")
  }</p>`).join("");

  const groups = layout.groupLines?.length
    ? `<div class="smart-card-tender-groups" style="height:${g.groupHeight}px;line-height:${g.strongLineHeightPx}px">${layout.groupLines
      .map((lines) => `<span style="width:${g.groupWidth}px">${linesMarkup(lines)}</span>`).join("")}</div>`
    : "";

  const cellPad = `padding:${g.bandPadY}px ${g.cellPadX}px`;
  const table = layout.table ? `<table class="smart-card-tender-table"><thead><tr>${layout.table.header.cells
    .map((lines) => `<th style="width:${layout.table.columnWidth}px;height:${layout.table.header.height}px;${cellPad}">${linesMarkup(lines)}</th>`).join("")}</tr></thead><tbody>${layout.table.rows.map((row) => `<tr>${row.cells
    .map((lines) => `<td style="width:${layout.table.columnWidth}px;height:${row.height}px;${cellPad}">${linesMarkup(lines)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";

  const close = (layout.placeLines?.length || layout.signatoryLines?.length)
    ? `<div class="smart-card-tender-close" style="min-height:${g.closeHeight}px">
        <div class="smart-card-tender-place" style="width:${g.halfWidth}px">
          ${layout.placeLines?.length ? `<span class="smart-card-line">${linesMarkup(layout.placeLines)}</span>` : ""}
          ${layout.noticeDateLines?.length ? `<span class="smart-card-line">${linesMarkup(layout.noticeDateLines)}</span>` : ""}
        </div>
        <div class="smart-card-tender-sign" style="width:${g.halfWidth}px">
          <strong>${linesMarkup(layout.signatoryLines)}</strong>
          <span style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.designationLines)}</span>
          <span style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.signOfficeLines)}</span>
        </div>
      </div>`
    : "";

  return `<article class="smart-card-tender" style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px;--tender-gap:${g.gap}px">
    <header><h3 style="font-size:${g.issuerFontPx}px;line-height:${g.issuerLineHeightPx}px">${linesMarkup(layout.issuerLines)}</h3>${layout.officeLines.length ? `<p style="line-height:${g.strongLineHeightPx}px">${linesMarkup(layout.officeLines)}</p>` : ""}</header>
    ${contactBand}
    ${referenceBand}
    ${layout.subjectLines.length ? `<h4 style="line-height:${g.strongLineHeightPx}px">${linesMarkup(layout.subjectLines)}</h4>` : ""}
    <h2 style="font-size:${g.titleFontPx}px;line-height:${g.titleLineHeightPx}px">${linesMarkup(layout.titleLines)}</h2>
    <div class="smart-card-tender-copy">${paragraphs}</div>
    ${layout.tableTitleLines?.length ? `<h5 style="line-height:${g.strongLineHeightPx}px">${linesMarkup(layout.tableTitleLines)}</h5>` : ""}
    ${groups}
    ${table}
    ${layout.contactLines.length ? `<p class="smart-card-tender-contact" style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.contactLines)}</p>` : ""}
    ${close}
    ${layout.footerLines?.length ? `<p class="smart-card-tender-footer" style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.footerLines)}</p>` : ""}
  </article>`;
}

/**
 * The advertisement, as an advert desk sets one: a ruled panel, the
 * advertiser's name as a small head, the shout line, a standfirst, the detail,
 * an offer flash reversed out of the accent, and the contact on a rule at the
 * foot. Artwork - supplied by the advertiser or generated - sits at the top in
 * the share layoutAdvert() reserved for it.
 */
function advertMarkup(data, layout) {
  if (!layout.geometry) return null;
  const g = layout.geometry;
  const has = (lines) => Array.isArray(lines) && lines.length > 0;
  const box = (rect) => `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;

  // The artwork, wherever this shape puts it. One <img>, one rectangle from
  // the solver - never a share of the panel worked out again here.
  const artwork = g.art && g.imageUrl
    ? `<div class="smart-card-advert-art" style="${box(g.art)}"><img src="${escapeHtml(g.imageUrl)}" alt="">${
      g.aiArtwork ? '<span class="smart-card-advert-ai">AI</span>' : ""}</div>`
    : "";

  // The चौकट, and the classified's two rules. Ink at a rectangle the solver
  // already stood the type clear of.
  const frame = g.frameStyle === "double"
    ? `<i class="smart-card-advert-frame" style="left:${g.framePad - g.frameInk}px;top:${g.framePad - g.frameInk}px;right:${g.framePad - g.frameInk}px;bottom:${g.framePad - g.frameInk}px;border-width:${g.frameInk}px"></i>`
    : "";

  // A poster's reversed panel: solid ink over the foot of the photograph, so
  // the type is white on black rather than white on whatever the picture is.
  const panel = g.panel
    ? `<i class="smart-card-advert-panel" style="${box(g.panel)}"></i>`
    : "";

  // A classified's two rules, over and under its type - inside the box the
  // solver already stood the type clear of, never on the card's own edge.
  const rules = g.frameStyle === "rule"
    ? `<i class="smart-card-advert-hr" style="left:${g.typeBox.x}px;top:${g.typeBox.y - g.frameHairPx}px;width:${g.typeBox.width}px;height:${g.frameHairPx}px"></i>
       <i class="smart-card-advert-hr" style="left:${g.typeBox.x}px;top:${g.typeBox.y + g.typeBox.height}px;width:${g.typeBox.width}px;height:${g.frameHairPx}px"></i>`
    : "";

  // NOT `.smart-card-advert`. smartCardMarkup() already puts `smart-card-advert`
  // on the card's own wrapper (`smart-card-${key}`), so naming this div the
  // same thing makes every selector and every test match two elements - the
  // `.smart-card-artwork` collision that moved every nameplate on every card,
  // caught here before it could do the same again.
  const cls = `smart-card-advert-body is-${escapeHtml(g.style)}${g.reversed ? " is-reversed" : ""} is-${escapeHtml(g.align)}`;
  const offerCls = g.offerStyle === "reverse" ? " is-reverse" : g.offerStyle === "rule" ? " is-ruled" : "";

  return `<div class="${cls}" style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px">
    ${artwork}${frame}${panel}${rules}
    <div class="smart-card-advert-type" style="${box(g.typeBox)};padding:${g.rowGap}px ${g.inset}px;gap:${g.rowGap}px">
      ${has(layout.nameLines) ? `<strong class="smart-card-advert-name" style="font-size:${g.nameFontPx}px;line-height:${g.nameLineHeightPx}px">${linesMarkup(layout.nameLines)}</strong>` : ""}
      ${has(layout.shoutLines) ? `<b class="smart-card-advert-shout" style="font-size:${g.shoutFontPx}px;line-height:${g.shoutLineHeightPx}px">${linesMarkup(layout.shoutLines)}</b>` : ""}
      ${has(layout.standLines) ? `<span class="smart-card-advert-stand" style="font-size:${g.standFontPx}px;line-height:${g.standLineHeightPx}px">${linesMarkup(layout.standLines)}</span>` : ""}
      ${has(layout.detailLines) ? `<span class="smart-card-advert-detail">${linesMarkup(layout.detailLines)}</span>` : ""}
      ${has(layout.offerLines) ? `<span class="smart-card-advert-offer${offerCls}" style="height:${g.offerHeight}px;padding:${g.offerStyle === "plain" ? 0 : g.rowGap}px 0">${linesMarkup(layout.offerLines)}</span>` : ""}
      ${has(layout.contactLines) ? `<span class="smart-card-advert-contact" style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.contactLines)}</span>` : ""}
      ${has(layout.addressLines) ? `<span class="smart-card-advert-address" style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.addressLines)}</span>` : ""}
      ${has(layout.footerLines) ? `<span class="smart-card-advert-footer" style="font-size:${g.smallFontPx}px;line-height:${g.smallLineHeightPx}px">${linesMarkup(layout.footerLines)}</span>` : ""}
    </div>
  </div>`;
}

// -------------------------------------------------------------------- chart ---
//
// Drawn from layoutSmartCard()'s resolved geometry and nothing else, so the
// bar a desk sees is the bar the press file draws. Every number is already in
// block pixels by the time it gets here.
//
// EVERY READING CARRIES ITS OWN `ink`, resolved once by rowInk() in the solver
// - so this file never decides a colour and cannot disagree with the plate
// about one. `--chart-ink` remains on the container for the parts that belong
// to the CHART rather than to a reading: the plot's connecting line, and the
// fallback for anything drawn without an item.

function chartMarkup(data, layout) {
  const g = layout.geometry;
  if (!layout.items?.length) return "";
  const source = g.source
    ? `<p class="smart-chart-source" style="font-size:${layout.fontPx * 0.85}px">${escapeHtml(g.source)}</p>`
    : "";

  if (g.chartType === "stat") {
    const cells = layout.items.map((item) => `
      <div class="smart-chart-stat" style="width:${g.columnWidth}px;height:${g.bandHeight}px">
        <b style="font-size:${g.figurePx}px;line-height:${g.figureLine}px;color:${item.ink}">${escapeHtml(item.valueText)}</b>
        <span style="font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px">${linesMarkup(item.captionLines)}</span>
      </div>`).join("");
    return `<div class="smart-chart smart-chart-stats" style="--chart-ink:${g.ink}">${cells}</div>${source}`;
  }

  // A PIE AND A LINE PLOT ARE DRAWN AS SVG, from the SAME point lists the
  // export walk turns into `poly` items - `arcPoints()` in layout.js is the
  // one segmentation, so the wheel on screen and the wheel on the plate are
  // the same polygon rather than two roundings of the same arc.
  if (g.chartType === "pie") {
    const cx = g.radius;
    const cy = g.radius;
    const slices = layout.items.map((item) => {
      const points = arcPoints(cx, cy, g.radius, item.from, item.to)
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      return `<polygon points="${points}" fill="${item.ink}"/>`;
    }).join("");
    const legend = layout.items.map((item) => `
      <div class="smart-chart-legend-row" style="height:${g.legendLine}px;font-size:${layout.fontPx}px;line-height:${g.legendLine}px">
        <i style="background:${item.ink};width:${g.legendLine * 0.5}px;height:${g.legendLine * 0.5}px"></i>
        <span>${escapeHtml(item.label)} — ${escapeHtml(item.valueText)}</span>
      </div>`).join("");
    return `<div class="smart-chart smart-chart-pie">
      <svg width="${g.diameter}" height="${g.diameter}" viewBox="0 0 ${g.diameter} ${g.diameter}">${slices}</svg>
      <div class="smart-chart-legend" style="width:${g.legendWidth}px">${legend}</div>
    </div>${source}`;
  }

  if (g.chartType === "line" || g.chartType === "dots") {
    const height = g.valueBand + g.plotHeight + g.labelBand;
    const width = g.inset * 2 + g.plotWidth;
    const path = layout.items.map((item) => `${item.x.toFixed(2)},${item.y.toFixed(2)}`).join(" ");
    const line = g.chartType === "line" && layout.items.length > 1
      ? `<polyline points="${path}" fill="none" stroke="${g.ink}" stroke-width="${g.lineWidth}" stroke-linejoin="round" stroke-linecap="round"/>`
      : "";
    const dots = layout.items.map((item) =>
      `<circle cx="${item.x.toFixed(2)}" cy="${item.y.toFixed(2)}" r="${g.dotRadius}" fill="${item.ink}"/>`).join("");
    const labels = layout.items.map((item) => `
      <text x="${item.x.toFixed(2)}" y="${(item.y - g.valueBand * 0.35).toFixed(2)}" text-anchor="middle"
            font-size="${layout.fontPx}" font-weight="700" fill="${item.ink}">${escapeHtml(item.valueText)}</text>
      <text x="${item.x.toFixed(2)}" y="${(g.valueBand + g.plotHeight + g.labelBand * 0.75).toFixed(2)}" text-anchor="middle"
            font-size="${layout.fontPx}" fill="#111">${escapeHtml(item.label)}</text>`).join("");
    return `<div class="smart-chart smart-chart-plot">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${line}${dots}${labels}</svg>
    </div>${source}`;
  }

  const rows = layout.items.map((item) => `
    <div class="smart-chart-row" style="height:${g.rowHeight}px;font-size:${layout.fontPx}px;line-height:${g.lineHeightPx}px">
      <span class="smart-chart-label" style="width:${g.labelWidth}px">${escapeHtml(item.label)}</span>
      <span class="smart-chart-track" style="width:${g.trackWidth}px">
        <i style="width:${item.barWidth}px;height:${Math.max(2, g.lineHeightPx * 0.62)}px;background:${item.ink}"></i>
      </span>
      <b class="smart-chart-value" style="width:${g.valueWidth}px">${escapeHtml(item.valueText)}</b>
    </div>`).join("");
  return `<div class="smart-chart smart-chart-bars" style="--chart-ink:${g.ink}">${rows}</div>${source}`;
}

// ------------------------------------------------------------------ router ---

const RENDERERS = {
  sudoku: sudokuMarkup,
  "sudoku-solution": sudokuMarkup,
  panchang: (data, layout) => labelledMarkup(layout),
  rashi: rashiMarkup,
  suvichar: suvicharMarkup,
  advert: advertMarkup,
  dinvishesh: dinvisheshMarkup,
  havaman: havamanMarkup,
  market: marketMarkup,
  tender: tenderMarkup,
  chart: chartMarkup,
};

/** Whether this key has a renderer at all. */
export function canRenderSmartCard(key) {
  return Boolean(RENDERERS[String(key || "")]);
}

export const SMART_CARD_KEYS = Object.keys(RENDERERS);

// A card the block is genuinely too small for. Still drawn - never deleted,
// never silently clipped (layoutSmartCard() clamps to a legible minimum
// rather than shrinking past it) - but flagged only as a `data-fit-state`
// attribute and an `is-overset` class, both CSS-only. This sentence used to
// be printed INSIDE the card's own returned markup - the same markup the
// newspaper canvas draws with - which meant a desk diagnostic could end up
// as a line of Marathi baked into the page itself. A desk sees this instead
// as a `section-flags` badge (section-thumb.js's sectionInnerHtml(), the
// same place the overflow flag already lives), which is editor chrome, not
// content the card carries.
export const SMART_CARD_OVERSET_NOTE = "या ब्लॉकमध्ये हे कार्ड नीट बसत नाही — अधिक जागा आवश्यक आहे.";

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

  // The subtitle's own resolved lines - layoutSmartCard() already measured
  // and wrapped them against the card's real width and deducted their real
  // height before solving the body, so this prints exactly what was
  // reserved rather than asking the browser to wrap the raw string again.
  const subtitle = layout.subtitle?.lines.length
    ? `<p class="smart-card-subtitle" style="font-size:${layout.subtitle.fontPx}px">${linesMarkup(layout.subtitle.lines)}</p>`
    : "";
  const artwork = layout.artwork
    ? `<img class="smart-card-artwork${layout.artwork.stretch ? " is-stretched" : ""}" src="/${escapeHtml(layout.artwork.file)}" alt="" aria-hidden="true" style="left:${layout.artwork.x}px;top:${layout.artwork.y}px;width:${layout.artwork.width}px;height:${layout.artwork.height}px">`
    : "";
  const content = layout.contentBox || { x: 0, y: 0, width: Number(frame?.width) || 0, height: Number(frame?.height) || 0 };
  // The band's own rules run to the card's TYPE measure, not to its frame -
  // drawn from 0 to the frame's width they ran into the card's ring at both
  // ends (measured: l0 and r0 against a rule at the block's edge), which is
  // two rules meeting where a printer draws one.
  const titleRules = key === "rashi" && layout.artwork
    ? `<i class="smart-card-title-rule" style="left:${content.x}px;top:${layout.artwork.y + layout.artwork.height / 2}px;width:${Math.max(0, layout.artwork.x - content.x - 6)}px"></i><i class="smart-card-title-rule" style="left:${layout.artwork.x + layout.artwork.width + 6}px;top:${layout.artwork.y + layout.artwork.height / 2}px;width:${Math.max(0, content.x + content.width - layout.artwork.x - layout.artwork.width - 6)}px"></i>`
    : "";
  const contentStyle = `left:${content.x}px;top:${content.y}px;width:${content.width}px;height:${content.height}px`;
  // THE RING IS DRAWN FROM THE ONE CATALOGUE.
  //
  // It used to be nine hand-written rules in styles.css "mirroring" the export
  // walk's own table, and the mirror had already drifted: प्रकटपत्र and the
  // display advert each declared a border of their own as well, so both drew
  // TWO rules 2px apart - which on the right and the bottom of a clipped card
  // read as one thick smudged edge. A card's rule is ink at its frame's edge
  // and both surfaces now read cardRuleFor() for it.
  const ring = layout.borderBox ? cardRuleFor(key) : null;
  const rule = ring
    ? `<i class="smart-card-rule" style="left:${layout.borderBox.x}px;top:${layout.borderBox.y}px;width:${layout.borderBox.width}px;height:${layout.borderBox.height}px;box-shadow:inset 0 0 0 ${ring.weightPx}px ${ring.ink}"></i>`
    : "";
  // The card's head rule: the hairline that closes a nameplate or a subtitle
  // off from the box under it, which is what makes a standing feature read as
  // a standing feature now that no card carries a double band.
  const headRule = layout.headRule
    ? `<i class="smart-card-head-rule" style="left:${layout.headRule.x}px;top:${layout.headRule.y}px;width:${layout.headRule.width}px"></i>`
    : "";
  const cls = `smart-card smart-card-${escapeHtml(key)}${layout.fitState === "OVERSET" ? " is-overset" : ""}`;
  // THE FACE THE CARD WAS SOLVED IN. Every measurement in layout.js names a
  // real typeface, so drawing the card in a different one would set it to a
  // measure it was never fitted to - which is the fault this file exists to
  // prevent. Absent unless the desk chose a face, so no stored card moves.
  const face = layout.familyCss ? `font-family:${layout.familyCss};` : "";
  return `<div class="${cls}" style="${face}" data-fit-state="${escapeHtml(layout.fitState)}">${rule}${headRule}${titleRules}${artwork}<div class="smart-card-content" style="${contentStyle}">${subtitle}${inside}</div></div>`;
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

  if (key === "chart") {
    // What the card SAYS, for everything that measures a block by its copy.
    // A rendering of the data, never its source - the bars are drawn from
    // data.items and could not be parsed back out of these lines.
    const rows = Array.isArray(data.items) ? data.items : [];
    const unit = data.unit ? ` ${data.unit}` : "";
    return rows
      .filter((item) => item && item.label != null)
      .map((item) => `${item.label} : ${devanagari(item.value)}${unit}`)
      .concat(data.source ? [String(data.source)] : [])
      .join("\n");
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
    return asList(data.entries).map((e) => (typeof e === "string" ? e : e?.label || e?.text || "")).join("\n");
  }

  if (key === "panchang") {
    return asList(data.items).filter(Boolean).map((item) => `${item.label} : ${item.text}`).join("\n");
  }

  if (key === "havaman") {
    return asList(data.cities)
      .filter((city) => city?.name)
      .map((city) => `${city.name} : ${city.condition || ""} · कमाल ${devanagari(city.maxC)}° · किमान ${devanagari(city.minC)}° · पाऊस ${devanagari(city.rainMm)} मिमी (${devanagari(city.rainChance)}%)`)
      .concat(data.source ? [String(data.source)] : [])
      .join("\n");
  }

  if (key === "market") {
    return asList(data.items)
      .filter((item) => item?.label && item?.value != null)
      .map((item) => `${item.label} : ${item.value}${item.change ? ` (${item.change})` : ""}`)
      // No "कालचा बाजार" sentence: the card stopped printing that paragraph
      // (it restated the ▲▼ column in prose), and smartCardText() is a
      // RENDERING of the card, never a richer second version of it - a block
      // measured on text the card does not draw is measured wrongly.
      .concat(data.trend ? [`${data.trendLabel || "गेल्या महिन्याचा कल"} : ${data.trend.from} — ${data.trend.to} ${data.trend.changePercent || ""}`.trim()] : [])
      .concat(data.source ? [String(data.source)] : [])
      .join("\n");
  }

  if (key === "tender") {
    const table = Array.isArray(data?.table?.headers)
      ? [data.table.headers, ...asList(data.table.rows)].map((row) => asList(row).join(" | "))
      : [];
    return [data.issuer, data.office, data.reference, data.date, data.subject, data.noticeTitle,
      ...asList(data.paragraphs), ...table, data.contact, data.signatory].filter(Boolean).join("\n");
  }

  return "";
}
