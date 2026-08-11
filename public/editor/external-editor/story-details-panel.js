// Story facts live beside the one writing surface, not in a second form. The
// panel is deliberately folded away because editors spend their time writing.

import { escapeHtml } from "../format.js";
import { statusOf, statusLabel, explicitStatusOptions, isExplicit } from "../status/section-status.js";

const LANGUAGES = ["Marathi", "Hindi", "English"];
const FIELDS = [
  { id: "edCaption", field: "caption", label: "Caption", limit: 160 },
  { id: "edAuthor", field: "author", label: "Reporter" },
  { id: "edCategory", field: "category", label: "Category" },
  { id: "edLocation", field: "location", label: "Location" },
  { id: "edTags", field: "tags", label: "Tags" },
];

function input(field, view) {
  const count = field.limit ? `<span class="field-counter" id="${field.id}Counter">${(view[field.field] || "").length}/${field.limit}</span>` : "";
  return `<div class="form-group"><label for="${field.id}">${field.label}${count}</label><input id="${field.id}" value="${escapeHtml(view[field.field])}"></div>`;
}

export function storyDetailsMarkup(view, hasImages = false) {
  const status = statusOf(view, hasImages);
  return `<div class="story-details-grid">
    ${FIELDS.map((field) => input(field, view)).join("")}
    <div class="form-group"><label for="edLanguage">Language</label><select id="edLanguage">${LANGUAGES.map((language) => `<option value="${language}"${view.language === language ? " selected" : ""}>${language}</option>`).join("")}</select></div>
    <div class="form-group"><label for="edStatusSelect">Editorial status</label><select id="edStatusSelect"><option value="">Automatic (${statusLabel(status)})</option>${explicitStatusOptions().map((option) => `<option value="${option.key}"${view.status === option.key ? " selected" : ""}>${option.label}</option>`).join("")}</select></div>
  </div>`;
}

export function bindStoryDetails(onPatch) {
  FIELDS.forEach((field) => document.getElementById(field.id)?.addEventListener("input", (event) => onPatch({ [field.field]: event.target.value }, "story-details")));
  document.getElementById("edLanguage")?.addEventListener("change", (event) => onPatch({ language: event.target.value }, "story-details"));
  document.getElementById("edStatusSelect")?.addEventListener("change", (event) => onPatch({ status: event.target.value || "editing" }, "story-details"));
}

export function refreshStoryDetails(view, source) {
  FIELDS.forEach((field) => {
    const inputElement = document.getElementById(field.id);
    if (inputElement && document.activeElement !== inputElement && inputElement.value !== view[field.field]) inputElement.value = view[field.field] || "";
    const counter = document.getElementById(`${field.id}Counter`);
    if (counter) {
      const length = (view[field.field] || "").length;
      counter.textContent = `${length}/${field.limit}`;
      counter.classList.toggle("over", length > field.limit);
    }
  });
  if (source !== "story-details") {
    const language = document.getElementById("edLanguage");
    if (language && document.activeElement !== language) language.value = view.language || "Marathi";
    const status = document.getElementById("edStatusSelect");
    if (status) status.value = isExplicit(view.status) ? view.status : "";
  }
}
