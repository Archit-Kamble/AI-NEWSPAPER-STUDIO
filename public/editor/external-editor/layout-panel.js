// The Space read-out: how much of the block is used, how much is left, and the
// two warnings a page designer actually acts on - content that will not fit, and
// boxes left half empty.
//
// This is the only place space is reported. The AI group asks for "fill the
// remaining area" and takes its numbers from `fitBrief()`, but does not print
// them again (VISION.md: avoid repeated information).

import { computeMetrics } from "../layout/layout-metrics.js";
import { buildFlowMap, flowFit, flowImageFromRow } from "../layout/text-flow.js";
import { bodyFill, composeSection } from "../compose/section-adapter.js";
import { snapPictureToLegalCorridor, leavesNoLegalColumn } from "../layout/corridor-snap.js";
import { blockExpectsCopy } from "../layout/block-kinds.js";
import { MIN_CORRIDOR_EM } from "../compose/intervals.js";
import "../layout/headline-reserve.js";

const { reservationCandidates } = globalThis.SahasHeadlineReserve;

// The block as it will be once it has a headline - or null when it already
// has one (or is not the kind of block that gets one), in which case the
// real composition is already the honest answer. The WORST candidate wins,
// exactly as planningFit() picks it: line count is not monotonic in headline
// length once the engine breaks at real word boundaries, so the longest
// stand-in is not reliably the one that leaves the body least room.
function reservedComposition(section, view, images) {
  const hasHeadline = String(view?.headline ?? section?.headline ?? "").trim().length > 0;
  const kind = section?.block_type || "article";
  if (hasHeadline || kind !== "article") return null;

  const map = buildFlowMap(section, view, images.map(flowImageFromRow));
  let worst = null;
  for (const candidate of reservationCandidates(map.cols || 1)) {
    const composed = composeSection({ ...section, images }, { ...view, ...candidate });
    if (!worst || composed.capacity.bodyCharCapacity < worst.capacity.bodyCharCapacity) worst = composed;
  }
  return worst;
}

// The desk's standard: a printed newspaper fills its columns to the foot, and
// anything under 95% set is white the reader sees. This used to be 0.45, so a
// block at 62% was reported as "Layout looks balanced" - which is how a
// visibly short column reached a screenshot with a green bar beside it. It is
// the SAME bar copyFit.ACCEPTABLE_FILL_RATIO uses, so the panel and the
// writer cannot tell a desk two different stories about one block.
//
// The old "Block is nearly full - there is no room for late corrections"
// warning is gone with it. It fired above 95%, which is now the TARGET: a
// printed column is full, and warning about the thing the whole pipeline
// exists to achieve is noise. Copy that genuinely does not fit is a
// different message, and it is still there (`metrics.overflowing`).
const WHITESPACE_THRESHOLD = 0.95;

// What the compositor did with the reporter's paragraph breaks.
//
// A paragraph is set in LINES, not written in sentences: a break the block is
// too shallow to carry is merged into its neighbour, and a paragraph that
// runs past the ceiling is set as two. The desk sees the result on the page
// either way, so this only appears when the two numbers differ - it exists so
// "I typed four paragraphs and the page shows two" has an answer on screen
// rather than being read as a bug.
function paragraphRow(composition, row) {
  const p = composition && composition.typography && composition.typography.paragraphs;
  if (!p || !p.authored || p.authored === p.set) return "";
  const how = p.merged && p.split ? "merged and split"
    : p.merged ? `${p.merged} merged - too short to read as paragraphs here`
      : `${p.split} split - too long to print as one`;
  return row("Paragraphs", `${p.set} set, ${p.authored} written (${how})`);
}

// The engine's own faults, in the desk's words.
//
// composeBlock() reports violations and warnings on every composition and
// NOTHING rendered them. On a real 190x264 block whose picture leaves no
// column wide enough to set type in, the panel said "Content overflows the
// block by about 130 px. Trim the body..." and, directly under it, "Block is
// empty." - two messages that contradict each other, and neither of them
// true. The truth ("240px of depth, but its pictures leave no column wide
// enough to set 9px type in") was computed and thrown away.
//
// Not every code belongs here. SET_FLUSH_LEFT fires on 4077 of 11153 real
// blocks because setting a narrow column flush left is how a newspaper is
// set - it is a decision, not a fault, and putting it in the fault list would
// bury the two blocks that genuinely cannot be printed.
const ENGINE_FAULTS = {
  NO_LEGAL_MEASURE: "error",
  // Not a fault - a choice the block is holding open. See compose.js.
  HEADLINE_COULD_FILL: "info",
  HEADLINE_SHORT_OF_MEASURE: "info",
  HEADLINE_AUTO_FITTED: "info",
  DECK_AUTO_FITTED: "info",
  KICKER_AUTO_FITTED: "info",
  FONT_NOT_READY: "info",
  SHAPING_NOT_READY: "info",
};

function engineWarnings(composition) {
  if (!composition) return [];
  const out = [];
  // A violation is always a fault: the copy does not fit, or a word is wider
  // than anything on the page can hold.
  for (const v of composition.violations || []) {
    out.push({ level: "error", text: v.detail, code: v.code });
  }
  for (const w of composition.warnings || []) {
    const level = ENGINE_FAULTS[w.code];
    // The engine's own numbers travel with the sentence. This rebuilt the
    // object from `detail` alone, so a warning that carries what to DO about
    // it - HEADLINE_COULD_FILL's size and character count - arrived here with
    // only the prose, and no offer could be built from it.
    if (level) out.push({ level, text: w.detail, code: w.code, px: w.px, charsOver: w.charsOver });
  }
  return out;
}

// The repair for a block that can set nothing, worked out rather than
// described.
//
// The warning already says what is wrong, and it names three things a desk
// could do about it - but SAHAS knows which picture is in the way and exactly
// where it would have to go, because corridor-snap.js computes that for every
// placement anyway. Printing advice while holding the answer is the same
// failure as printing a number nobody can act on.
//
// This is an OFFER, not an action: it is a button, the desk presses it, and it
// goes through the ordinary picture patch like a drag would. Nothing here
// moves a stored picture on its own - that is the same line the drag-time
// snap holds (it repairs a placement being made, never a saved row).
//
// Which picture, when there are several: whichever one, moved on its own,
// makes the block printable - tried in the order they are stacked. Moving one
// picture is a repair a desk can see and undo; moving three at once is a
// rearrangement nobody asked for.
export function placementRepair(section, view, images = []) {
  const rows = images || [];
  if (!rows.length || !blockExpectsCopy(section?.block_type)) return null;

  const composed = composeSection({ ...section, images: rows }, view);
  if (!leavesNoLegalColumn(composed)) return null;

  const bodyPx = composed.typography?.bodyPx || 0;
  const rule = {
    contentLeft: composed.content.left,
    contentRight: composed.content.right,
    minCorridorPx: MIN_CORRIDOR_EM * bodyPx,
    columnCount: composed.columns?.length || 1,
    bodyTop: composed.bodyTop,
    bodyBottom: composed.content.bottom,
    bandHeightPx: bodyPx * (composed.typography?.lineHeight || 0),
    expectsCopy: true,
  };

  for (const image of rows) {
    const rect = {
      x: Number(image.x_px ?? image.x) || 0,
      y: Number(image.y_px ?? image.y) || 0,
      width: Number(image.width_px ?? image.width) || 0,
      height: Number(image.height_px ?? image.height) || 0,
    };
    const standOffPx = Number(image.stand_off_px ?? image.standOffPx) || 0;
    const snapped = snapPictureToLegalCorridor(rect, { ...rule, standOffPx });
    if (!snapped.snapped) continue;

    const moved = rows.map((other) => (other === image
      ? { ...other, x_px: snapped.x, y_px: snapped.y, width_px: snapped.width, height_px: snapped.height }
      : other));
    if (leavesNoLegalColumn(composeSection({ ...section, images: moved }, view))) continue;
    return {
      imageId: Number(image.id),
      patch: { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height },
      how: snapped.how,
    };
  }
  return null;
}

const REPAIR_WORDS = {
  'flush-left': 'Move it to the left of the column',
  'flush-right': 'Move it to the right of the column',
  'inset-from-left': 'Move it clear of the column',
  'inset-from-right': 'Move it clear of the column',
  spanned: 'Set it across the full measure',
  'spanned-at-top': 'Set it across the top, full measure',
  'spanned-at-foot': 'Set it across the foot, full measure',
};

export function layoutWarnings(metrics) {
  const warnings = [];
  // The empty FOOT of the block is the whitespace a desk actually complains
  // about, and `metrics.fillRatio` cannot see it: it is
  // `(available - unexplained) / available`, and `unexplained` counts only the
  // gaps BESIDE pictures (compose.js's `emptyGapWidth * bandHeight`), never
  // the room left under the last line. So a lead block with 2 of its 4.55 body
  // lines set - 56% of the body area standing empty, plainly visible - scored
  // a high fillRatio and was reported as "Layout looks balanced".
  //
  // Where there is a real composition, the line fill is the honest number, and
  // it is the SAME one the meter above shows. Only the pre-font-load fallback
  // still has to use the area ratio, because it has no composition to read.
  const fill = metrics.composition ? bodyFill(metrics.reservedComposition || metrics.composition) : null;
  const ratio = fill ? fill.ratio : metrics.fillRatio;
  const hasCopy = Boolean(metrics.composition && metrics.composition.capacity
    && metrics.composition.capacity.bodyCharsUsed > 0);
  // Set nothing AND holding nothing. A block with copy in it that set no lines
  // is not empty, it is unprintable - and telling a desk it is empty while 220
  // characters sit in the editor is how a real fault gets closed unread.
  const isEmpty = (fill ? fill.linesUsed === 0 : !metrics.usedHeightPx) && !hasCopy;

  const engine = engineWarnings(metrics.composition);
  const unprintable = engine.some((w) => w.code === "NO_LEGAL_MEASURE");
  // The warning names three things a desk could do; where SAHAS can work out
  // which one and where, it offers it instead of only describing it.
  // THE HEADLINE THE BLOCK COULD HAVE.
  //
  // The desk's report was "the width of each line is becoming shorter". On
  // five blocks of their own front page that is exactly right and it is not a
  // typographic fault: the headline WOULD reach its measure at a larger size -
  // 29px against 23.5px on the Jarange anchor - and growth was withheld
  // because the copy is already at the foot. The engine has said so since
  // HEADLINE_COULD_FILL was added.
  //
  // Saying it is not the same as offering it. This is the same shape as the
  // placement repair below: a button, checked against the engine's own numbers
  // before it is drawn, and a person presses it.
  //
  // It sets the SIZE and nothing else. The copy that then has no room is named
  // in the sentence, and which sentence dies is an editorial decision - a far
  // larger one than moving a picture, and not this software's to take.
  const couldFill = engine.find((w) => w.code === "HEADLINE_COULD_FILL");
  if (couldFill && couldFill.px > 0) {
    couldFill.action = {
      patch: { headlineFontPx: couldFill.px, headlineLocked: true },
      label: `Set it at ${couldFill.px}px`,
    };
  }

  if (metrics.placementRepair) {
    const fault = engine.find((w) => w.code === "NO_LEGAL_MEASURE");
    if (fault) fault.action = { ...metrics.placementRepair, label: REPAIR_WORDS[metrics.placementRepair.how] || "Move it clear of the column" };
  }

  // "Trim the body, reduce the body size, or use a larger block" is advice
  // that cannot work when there is no legal column at all - no amount of
  // trimming makes a corridor narrower than one word hold a word. The engine's
  // own message says what to do instead, so this one stands down.
  if (metrics.overflowing && !unprintable) {
    warnings.push({
      level: "error",
      text: `Content overflows the block by about ${Math.abs(metrics.remainingHeightPx)} px. Trim the body, reduce the body size, or use a larger block.`,
    });
  }
  if (!metrics.overflowing && !unprintable && ratio < WHITESPACE_THRESHOLD && !isEmpty) {
    warnings.push({
      level: "warn",
      text: fill
        ? `${Math.round(ratio * 100)}% of the block is set - ${fill.holeLines} lines will print empty. A column runs to its foot; fill it, cut the block down, or make a picture larger.`
        : `Only ${Math.round(ratio * 100)}% of the block is used - ${Math.round(metrics.remainingHeightPx)} px of whitespace will print.`,
    });
  }
  if (isEmpty) warnings.push({ level: "info", text: "Block is empty." });
  return [...engine, ...warnings];
}

function row(label, value) {
  return `<div class="inspector-row"><span>${label}</span><strong>${value}</strong></div>`;
}

// Words that will fit the space still free, at the current body size. This is
// the number the AI fill is briefed with, so it is the number worth showing.
export function approxWordsThatFit(metrics, view) {
  const fontPx = Number(view?.bodyFontPx) || 0;
  if (!fontPx) return 0;
  return Math.max(0, Math.round(metrics.remainingAreaPx / (fontPx * fontPx * 0.42)));
}

// The character-budget rows, from whichever measurement computeMetrics()
// itself decided is authoritative for this paint - see layout-metrics.js's
// own "where there is a real composition, it wins" rule. Before this, the
// budget shown here was ALWAYS text-flow.js's approximate grid, even once
// the exact engine was ready and computeMetrics() had already stopped using
// it: a block with a real placed image measured its budget with the grid's
// coarse per-cell exclusion, which can overstate the exact engine's real
// exclusion-mask capacity by 2x or more (confirmed live: a 268x248px block
// with one rotated image read "422 characters" from the grid and "146-233"
// from the exact engine measuring the SAME block). A desk trusting the
// bigger number under-writes relative to what the page will actually hold,
// which reads as a block that never quite fills - exactly the "3/10, gaps
// everywhere" complaint this was found investigating.
export function spacePanelMarkup(section, view, images = []) {
  if (!section) return `<p class="muted">Select a block to see how much space it has.</p>`;
  // `images` is the LIVE picture state (callbacks.getImages() in
  // external-editor.js) - a picture just dragged or resized but not yet
  // saved. `section.images`, if present at all, is the persisted row. The
  // exact composition has to measure against the live state, the same one
  // the old grid's buildFlowMap() call below was already given, or a desk
  // mid-resize would see a budget computed against where the picture USED
  // to be.
  const m = computeMetrics({ ...section, images }, view);
  // ONCE per render. This is one composition per reservation candidate - the
  // comment below says six on an empty article block - and it was being asked
  // for three separate times in this one function, for the same answer at
  // three times the price, on the panel that redraws every time a block is
  // selected.
  const reservedComposed = reservedComposition(section, view, images);
  const warnings = layoutWarnings({
    ...m,
    reservedComposition: reservedComposed,
    placementRepair: placementRepair(section, view, images),
  });

  let ratio;
  let overflowing;
  let charRowsHtml;
  let noteHtml;

  if (m.composition) {
    // An article block is never published without a headline, so measuring
    // the body's room on a block that has none answers a question nobody
    // asks - and the gap is not a detail. On a real 268x248 lead with a
    // cut-out beside the copy: 639 characters of body with no headline, 187
    // once a real headline and deck are set. A desk shown "467-767
    // characters, 14.41 lines" on the empty block and then handed 162
    // characters of AI copy reasonably concludes the AI underfilled it four
    // times over - when the copy was right and this read-out was wrong.
    //
    // So while the block has no headline, the same reservation the model is
    // briefed against is shown here (headline-reserve.js, one definition for
    // both sides). Six compositions, ~13ms, and only on a block nobody has
    // typed into yet - never on the keystroke path.
    const composition = reservedComposed || m.composition;
    const { capacity } = composition;
    const used = capacity.bodyCharsUsed;
    const fill = bodyFill(composition);
    const reserved = composition !== m.composition;
    // LINES, not characters. Dividing by the character range's floor is what
    // made this meter read "91% of the room for copy used - layout looks
    // balanced" on a block with 3.58 of its lines standing empty: the floor
    // (539) is the least this block could hold for the worst possible prose,
    // and the copy in it was ordinary, so it was being measured against a
    // number 40% below its real capacity. The line count has no range in it -
    // see bodyFill()'s own note.
    ratio = fill.ratio;
    overflowing = m.overflowing;
    const words = Math.round(capacity.bodyCharCapacity / 6);
    charRowsHtml = `
      ${row(reserved ? "Room for copy (after a headline)" : "Room for copy", `${capacity.bodyCharRange.min}–${capacity.bodyCharRange.max} characters (~${words} words)`)}
      ${row("Written so far", `${used} characters`)}
      ${row("Lines set", `${fill.linesUsed} of ${fill.linesAvailable}`)}
      ${fill.intentionalEquivalentLines > 0 ? row("Paragraph air", `${fill.intentionalEquivalentLines} lines`) : ""}
      ${paragraphRow(m.composition, row)}
    `;
    noteHtml = `${reserved ? "This block has no headline yet, so the figures above keep room for the one it will get. " : ""}Exact composition, measured in the real publication font. The bar is the block's own body geometry, weighted: a row a picture halves counts as half a line, so these figures are fractional and exact. The character figure is a range, because Marathi's character budget cannot be a single scalar - see CLAUDE.md.`;
  } else {
    const map = buildFlowMap(section, view, images.map(flowImageFromRow));
    const fit = flowFit(map);
    ratio = fit.ratio;
    overflowing = fit.overflowing;
    charRowsHtml = `
      ${row("Character grid", `${map.cols} × ${map.rows} cells`)}
      ${row("Pictures take", map.imageCells ? `${map.imageCells} cells` : "—")}
      ${row("Room for copy", `${map.bodyCharBudget} characters (~${map.bodyWordBudget} words)`)}
      ${row("Written so far", `${fit.used} characters`)}
    `;
    noteHtml = `Estimates in editor pixels (2 px per mm of the 330 × 530 mm page) - the publication font is not measurable yet. Print composition measures text for real, in millimetres.`;
  }

  // Named in lines, because that is what the desk can see standing empty -
  // weighted lines, so a corridor beside a cut-out counts for what it is
  // worth rather than for a whole one. See bodyFill().
  const hole = m.composition ? bodyFill(reservedComposed || m.composition).holeLines : 0;
  const holeNote = !overflowing && hole >= 1 ? ` · ${hole} line${hole >= 2 ? "s" : ""} free at the foot` : "";

  return `
    ${row("Block", `${m.widthPx} × ${m.heightPx} px`)}
    ${charRowsHtml}
    <div class="fill-meter large${overflowing ? " overflowing" : ""}">
      <span style="width:${Math.min(100, Math.round(ratio * 100))}%"></span>
    </div>
    <p class="muted metrics-note">${Math.round(ratio * 100)}% of the block's lines are set${holeNote}</p>
    <div class="warning-list">${warningsMarkup(warnings)}</div>
    <p class="muted ext-note">${noteHtml}</p>
  `;
}

function warningsMarkup(warnings) {
  if (!warnings.length) return `<p class="warning-ok">Layout looks balanced.</p>`;
  return warnings.map((w) => {
    if (!w.action) return `<p class="warning-item level-${w.level}">${w.text}</p>`;
    const { imageId, patch, label } = w.action;
    // A section patch (the headline's size) rather than a picture's rectangle.
    if (imageId === undefined) {
      return `<p class="warning-item level-${w.level}">${w.text}`
        + `<button type="button" class="warning-fix" data-fix-headline="${patch.headlineFontPx}">${label}</button></p>`;
    }
    return `<p class="warning-item level-${w.level}">${w.text}`
      + `<button type="button" class="warning-fix" data-fix-placement="${imageId}"`
      + ` data-fix-rect="${patch.x},${patch.y},${patch.width},${patch.height}">${label}</button></p>`;
  }).join("");
}

export function refreshSpacePanel(section, view, images = []) {
  const group = document.getElementById("edSpaceGroup");
  if (!group) return;
  group.innerHTML = spacePanelMarkup(section, view, images);
}
