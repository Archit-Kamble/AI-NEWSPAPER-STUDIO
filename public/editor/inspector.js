// The Context Inspector: everything about the selected section that is *not*
// the article text itself. The article text (headline/subheading/body/caption/
// author) is owned by the External Editor's Story panel - deliberately not
// duplicated here, so no field has two editable inputs bound to the same draft
// (Phase 10). What stays here is classification metadata, typography, the
// lifecycle control, the image summary and the layout metrics.

import { escapeHtml } from "./format.js";
import { statusOf, statusLabel, statusClass, explicitStatusOptions, isExplicit } from "./status/section-status.js";
import { computeMetrics } from "./layout/layout-metrics.js";

const TEXT_FIELDS = [
  { id: "insCategory", field: "category", label: "Category" },
  { id: "insLocation", field: "location", label: "Location" },
  { id: "insTags", field: "tags", label: "Tags" },
  { id: "insLanguage", field: "language", label: "Language" },
];

const FONT_FIELDS = [
  { id: "insHeadlineFont", field: "headlineFontPx", label: "Headline size (px)" },
  { id: "insSubheadingFont", field: "subheadingFontPx", label: "Subheading size (px)" },
  { id: "insBodyFont", field: "bodyFontPx", label: "Body size (px)" },
];

function metricRow(label, value) {
  return `<div class="inspector-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function metricsMarkup(metrics) {
  if (!metrics) return "";
  return `
    ${metricRow("Headline height", `${metrics.headlineHeightPx} px`)}
    ${metricRow("Body height", `${metrics.bodyHeightPx} px`)}
    ${metricRow("Caption height", `${metrics.captionHeightPx} px`)}
    ${metricRow("Image ratio", metrics.imageRatio ? `${metrics.imageRatio.toFixed(2)} : 1` : "—")}
    ${metricRow("Available area", `${Math.round(metrics.availableAreaPx / 1000)}k px²`)}
    ${metricRow("Remaining area", `${Math.round(metrics.remainingAreaPx / 1000)}k px²`)}
    <div class="fill-meter${metrics.overflowing ? " overflowing" : ""}" title="${Math.round(metrics.fillRatio * 100)}% of the section box used">
      <span style="width:${Math.min(100, Math.round(metrics.fillRatio * 100))}%"></span>
    </div>
    <p class="muted metrics-note">${metrics.overflowing ? "Content overflows the section box." : `${Math.round(metrics.fillRatio * 100)}% filled`}</p>
  `;
}

export function renderInspector(section, view, story, onPatch) {
  const body = document.getElementById("inspector");
  if (!body) return;

  if (!section || !view) {
    body.innerHTML = `<p class="muted">Select a section on the page to inspect it.</p>`;
    return;
  }

  const status = statusOf(view);
  const metrics = computeMetrics(section, view);

  body.innerHTML = `
    <div class="inspector-group">
      <h4>Metadata</h4>
      <div class="inspector-row"><span>Section</span><strong>${escapeHtml(section.section_key)}</strong></div>
      <div class="inspector-row"><span>Linked story</span><strong id="insLinkedStory">${story ? escapeHtml(story.title) : "None"}</strong></div>
      <div class="inspector-row"><span>Status</span><strong><span id="insStatusBadge" class="section-status-badge ${statusClass(status)}">${statusLabel(status)}</span></strong></div>
      <div class="inspector-row"><span>Last saved</span><strong>${section.updated_at ? new Date(section.updated_at).toLocaleString() : "—"}</strong></div>
      <div class="form-group">
        <label>Editorial status</label>
        <select id="insStatusSelect">
          <option value="">Automatic (${statusLabel(status)})</option>
          ${explicitStatusOptions()
            .map(
              (option) =>
                `<option value="${option.key}"${view.status === option.key ? " selected" : ""}>${option.label}</option>`,
            )
            .join("")}
        </select>
      </div>
    </div>

    <div class="inspector-group">
      <h4>Classification</h4>
      ${TEXT_FIELDS.map(
        (f) =>
          `<div class="form-group"><label>${f.label}</label><input id="${f.id}" value="${escapeHtml(view[f.field])}" /></div>`,
      ).join("")}
    </div>

    <div class="inspector-group">
      <h4>Typography</h4>
      ${FONT_FIELDS.map(
        (f) =>
          `<div class="form-group"><label>${f.label}</label><input id="${f.id}" type="number" min="8" value="${view[f.field]}" /></div>`,
      ).join("")}
    </div>

    <div class="inspector-group">
      <h4>Image information</h4>
      <div class="inspector-row"><span>Primary image</span><strong id="insImageName">${view.imageUrl ? escapeHtml(view.imageUrl.split("/").pop()) : "None"}</strong></div>
      <div class="inspector-row"><span>Rotation</span><strong id="insImageRotation">${view.imageRotation}°</strong></div>
      <div class="inspector-row"><span>Zoom</span><strong id="insImageZoom">${Number(view.imageZoom).toFixed(2)}×</strong></div>
      <div class="inspector-row"><span>Fit</span><strong id="insImageFit">${escapeHtml(view.imageFit)}</strong></div>
    </div>

    <div class="inspector-group">
      <h4>Section properties</h4>
      <div class="inspector-row"><span>Block type</span><strong>${escapeHtml(section.block_type || "article")}</strong></div>
      <div class="inspector-row"><span>Position</span><strong>${section.x_px}, ${section.y_px} px</strong></div>
      <div class="inspector-row"><span>Size</span><strong>${section.width_px} &times; ${section.height_px} px</strong></div>
    </div>

    <div class="inspector-group" id="insMetrics">
      <h4>Layout metrics</h4>
      ${metricsMarkup(metrics)}
    </div>

    <div class="inspector-group">
      <h4>AI notes</h4>
      <div class="form-group"><textarea id="insAiNotes" placeholder="Notes for future AI assist...">${escapeHtml(view.aiNotes)}</textarea></div>
    </div>
  `;

  TEXT_FIELDS.forEach((f) => {
    document.getElementById(f.id).addEventListener("input", (event) => {
      onPatch({ [f.field]: event.target.value }, "inspector");
    });
  });

  FONT_FIELDS.forEach((f) => {
    document.getElementById(f.id).addEventListener("input", (event) => {
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value > 0) onPatch({ [f.field]: value }, "inspector");
    });
  });

  document.getElementById("insAiNotes").addEventListener("input", (event) => {
    onPatch({ aiNotes: event.target.value }, "inspector");
  });

  document.getElementById("insStatusSelect").addEventListener("change", (event) => {
    // An empty value hands the section back to automatic derivation.
    onPatch({ status: event.target.value || deriveResetStatus(view) }, "inspector");
  });
}

function deriveResetStatus(view) {
  return view.newsItemId ? "story_linked" : "empty";
}

// Live update (Phase 3): the Inspector's read-only rows follow every keystroke
// made anywhere, but its own inputs are left alone so the caret never jumps.
export function refreshInspectorReadouts(section, view, story, source) {
  const statusBadge = document.getElementById("insStatusBadge");
  if (!statusBadge) return;

  const status = statusOf(view);
  statusBadge.textContent = statusLabel(status);
  statusBadge.className = `section-status-badge ${statusClass(status)}`;

  const linked = document.getElementById("insLinkedStory");
  if (linked) linked.textContent = story ? story.title : "None";

  const imageName = document.getElementById("insImageName");
  if (imageName) imageName.textContent = view.imageUrl ? view.imageUrl.split("/").pop() : "None";
  const rotation = document.getElementById("insImageRotation");
  if (rotation) rotation.textContent = `${view.imageRotation}°`;
  const zoom = document.getElementById("insImageZoom");
  if (zoom) zoom.textContent = `${Number(view.imageZoom).toFixed(2)}×`;
  const fit = document.getElementById("insImageFit");
  if (fit) fit.textContent = view.imageFit;

  const metricsGroup = document.getElementById("insMetrics");
  if (metricsGroup) {
    metricsGroup.innerHTML = `<h4>Layout metrics</h4>${metricsMarkup(computeMetrics(section, view))}`;
  }

  refreshAutomaticOptionLabel(view);
  if (source !== "inspector") repaintInspectorInputs(view);
}

// Undo/redo and story-linking change fields this panel owns, so its inputs do
// need repainting then - but only when the change came from somewhere else.
function repaintInspectorInputs(view) {
  [...TEXT_FIELDS, ...FONT_FIELDS].forEach((f) => {
    const input = document.getElementById(f.id);
    if (input && document.activeElement !== input && input.value !== String(view[f.field])) {
      input.value = view[f.field];
    }
  });
  const notes = document.getElementById("insAiNotes");
  if (notes && document.activeElement !== notes && notes.value !== view.aiNotes) {
    notes.value = view.aiNotes;
  }
  const statusSelect = document.getElementById("insStatusSelect");
  if (statusSelect) statusSelect.value = isExplicit(view.status) ? view.status : "";
}

// The "Automatic (...)" option names whatever the derivation currently resolves
// to, so it has to follow live edits like every other read-out.
function refreshAutomaticOptionLabel(view) {
  const automatic = document.querySelector('#insStatusSelect option[value=""]');
  if (automatic) automatic.textContent = `Automatic (${statusLabel(statusOf(view))})`;
}
