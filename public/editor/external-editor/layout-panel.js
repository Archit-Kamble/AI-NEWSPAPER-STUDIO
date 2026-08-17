// The Space read-out: how much of the block is used, how much is left, and the
// two warnings a page designer actually acts on - content that will not fit, and
// boxes left half empty.
//
// This is the only place space is reported. The AI group asks for "fill the
// remaining area" and takes its numbers from `fitBrief()`, but does not print
// them again (VISION.md: avoid repeated information).

import { computeMetrics } from "../layout/layout-metrics.js";
import { buildFlowMap, flowFit, flowImageFromRow } from "../layout/text-flow.js";

const WHITESPACE_THRESHOLD = 0.45;
const TIGHT_THRESHOLD = 0.95;

export function layoutWarnings(metrics) {
  const warnings = [];
  if (metrics.overflowing) {
    warnings.push({
      level: "error",
      text: `Content overflows the block by about ${Math.abs(metrics.remainingHeightPx)} px. Trim the body, reduce the body size, or use a larger block.`,
    });
  } else if (metrics.fillRatio > TIGHT_THRESHOLD) {
    warnings.push({ level: "warn", text: "Block is nearly full - there is no room for late corrections." });
  }
  if (!metrics.overflowing && metrics.fillRatio < WHITESPACE_THRESHOLD && metrics.usedHeightPx > 0) {
    warnings.push({
      level: "warn",
      text: `Only ${Math.round(metrics.fillRatio * 100)}% of the block is used - ${Math.round(metrics.remainingHeightPx)} px of whitespace will print.`,
    });
  }
  if (!metrics.usedHeightPx) warnings.push({ level: "info", text: "Block is empty." });
  return warnings;
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
  const warnings = layoutWarnings(m);

  let ratio;
  let overflowing;
  let charRowsHtml;
  let noteHtml;

  if (m.composition) {
    const { capacity } = m.composition;
    const floor = capacity.bodyCharCapacityFloor;
    const used = capacity.bodyCharsUsed;
    ratio = floor ? Math.min(1, used / floor) : 0;
    overflowing = m.overflowing;
    const words = Math.round(floor / 6);
    charRowsHtml = `
      ${row("Room for copy", `${capacity.bodyCharRange.min}–${capacity.bodyCharRange.max} characters (~${words} words)`)}
      ${row("Written so far", `${used} characters`)}
    `;
    noteHtml = `Exact composition, measured in the real publication font. A range, not one number - see CLAUDE.md on why Marathi's character budget cannot be a single scalar.`;
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

  return `
    ${row("Block", `${m.widthPx} × ${m.heightPx} px`)}
    ${charRowsHtml}
    <div class="fill-meter large${overflowing ? " overflowing" : ""}">
      <span style="width:${Math.min(100, Math.round(ratio * 100))}%"></span>
    </div>
    <p class="muted metrics-note">${Math.round(ratio * 100)}% of the room for copy used</p>
    <div class="warning-list">${warningsMarkup(warnings)}</div>
    <p class="muted ext-note">${noteHtml}</p>
  `;
}

function warningsMarkup(warnings) {
  if (!warnings.length) return `<p class="warning-ok">Layout looks balanced.</p>`;
  return warnings.map((w) => `<p class="warning-item level-${w.level}">${w.text}</p>`).join("");
}

export function refreshSpacePanel(section, view, images = []) {
  const group = document.getElementById("edSpaceGroup");
  if (!group) return;
  group.innerHTML = spacePanelMarkup(section, view, images);
}
