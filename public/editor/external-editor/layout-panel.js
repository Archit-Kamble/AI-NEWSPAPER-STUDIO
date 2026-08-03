// Part 8: the Layout workspace. Surfaces the measurements from
// layout/layout-metrics.js plus the two warnings a page designer actually acts
// on - content that will not fit, and boxes left half empty.

import { computeMetrics } from "../layout/layout-metrics.js";

const WHITESPACE_THRESHOLD = 0.45;
const TIGHT_THRESHOLD = 0.95;

export function layoutWarnings(metrics) {
  const warnings = [];
  if (metrics.overflowing) {
    warnings.push({
      level: "error",
      text: `Content overflows the section by about ${Math.abs(metrics.remainingHeightPx)} px. Trim the body, reduce the body size, or use a larger block.`,
    });
  } else if (metrics.fillRatio > TIGHT_THRESHOLD) {
    warnings.push({ level: "warn", text: "Section is nearly full - there is no room for late corrections." });
  }
  if (!metrics.overflowing && metrics.fillRatio < WHITESPACE_THRESHOLD && metrics.usedHeightPx > 0) {
    warnings.push({
      level: "warn",
      text: `Only ${Math.round(metrics.fillRatio * 100)}% of the box is used - ${Math.round(metrics.remainingHeightPx)} px of whitespace will print.`,
    });
  }
  if (!metrics.usedHeightPx) warnings.push({ level: "info", text: "Section is empty." });
  return warnings;
}

function row(label, value) {
  return `<div class="inspector-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function area(px) {
  return `${Math.round(px / 1000).toLocaleString()}k px²`;
}

export function layoutPanelMarkup(section, view) {
  if (!section) return `<p class="muted">Select a section to see its layout metrics.</p>`;
  const m = computeMetrics(section, view);
  const warnings = layoutWarnings(m);

  return `
    <div class="ext-columns">
      <div class="ext-column">
        <label class="preview-label">Space</label>
        ${row("Section size", `${m.widthPx} × ${m.heightPx} px`)}
        ${row("Available area", area(m.availableAreaPx))}
        ${row("Used area", area(m.usedAreaPx))}
        ${row("Remaining area", area(m.remainingAreaPx))}
        ${row("Remaining height", `${m.remainingHeightPx} px`)}
      </div>
      <div class="ext-column">
        <label class="preview-label">Elements</label>
        ${row("Headline height", `${m.headlineHeightPx} px`)}
        ${row("Subheadline height", `${m.subheadingHeightPx} px`)}
        ${row("Body height", `${m.bodyHeightPx} px`)}
        ${row("Caption height", `${m.captionHeightPx} px`)}
        ${row("Image height", `${m.imageHeightPx} px`)}
        ${row("Image ratio", m.imageRatio ? `${m.imageRatio.toFixed(2)} : 1` : "—")}
      </div>
      <div class="ext-column ext-column-wide">
        <label class="preview-label">Fill</label>
        <div class="fill-meter large${m.overflowing ? " overflowing" : ""}">
          <span style="width:${Math.min(100, Math.round(m.fillRatio * 100))}%"></span>
        </div>
        <p class="muted metrics-note">${Math.round(m.fillRatio * 100)}% of the section box used</p>
        <div class="warning-list">${warningsMarkup(warnings)}</div>
        <p class="muted ext-note">Estimates in editor pixels, from character counts and font sizes. Print composition measures text for real and works in millimetres.</p>
      </div>
    </div>
  `;
}

function warningsMarkup(warnings) {
  if (!warnings.length) return `<p class="warning-ok">Layout looks balanced.</p>`;
  return warnings.map((w) => `<p class="warning-item level-${w.level}">${w.text}</p>`).join("");
}

export function refreshLayoutPanel(section, view) {
  const panel = document.querySelector('[data-tab-panel="layout"]');
  if (!panel) return;
  panel.innerHTML = layoutPanelMarkup(section, view);
}
