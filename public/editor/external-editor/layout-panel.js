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

export function spacePanelMarkup(section, view, images = []) {
  if (!section) return `<p class="muted">Select a block to see how much space it has.</p>`;
  const m = computeMetrics(section, view);
  const map = buildFlowMap(section, view, images.map(flowImageFromRow));
  const fit = flowFit(map);
  const warnings = layoutWarnings(m);

  return `
    ${row("Block", `${m.widthPx} × ${m.heightPx} px`)}
    ${row("Character grid", `${map.cols} × ${map.rows} cells`)}
    ${row("Pictures take", map.imageCells ? `${map.imageCells} cells` : "—")}
    ${row("Room for copy", `${map.bodyCharBudget} characters (~${map.bodyWordBudget} words)`)}
    ${row("Written so far", `${fit.used} characters`)}
    <div class="fill-meter large${fit.overflowing ? " overflowing" : ""}">
      <span style="width:${Math.min(100, Math.round(fit.ratio * 100))}%"></span>
    </div>
    <p class="muted metrics-note">${Math.round(fit.ratio * 100)}% of the room for copy used</p>
    <div class="warning-list">${warningsMarkup(warnings)}</div>
    <p class="muted ext-note">Estimates in editor pixels (2 px per mm of the 330 × 530 mm page). Print composition measures text for real, in millimetres.</p>
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
