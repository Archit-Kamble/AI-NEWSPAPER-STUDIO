// Phase 2, Story section. Owns the article text - the only place these five
// fields are editable, so the draft never has two inputs fighting over it.

import { escapeHtml } from "../format.js";

const FIELDS = [
  { id: "edHeadline", field: "headline", label: "Headline", type: "input" },
  { id: "edSubheading", field: "subheading", label: "Subheading", type: "input" },
  { id: "edBody", field: "body", label: "Body", type: "textarea", rows: 8 },
  { id: "edCaption", field: "caption", label: "Caption", type: "input" },
  { id: "edAuthor", field: "author", label: "Author", type: "input" },
];

export function storyPanelMarkup(view, story) {
  // Phase 1: a section with no story attached says so, and offers the one
  // action that fixes it.
  const storyBar = view.newsItemId
    ? `<div class="story-link-bar linked">
         <span>Linked to <strong>${escapeHtml(story?.title || "reporter story")}</strong></span>
         <button type="button" class="ext-editor-btn" id="edChangeStory">Change</button>
       </div>`
    : `<div class="story-link-bar">
         <span class="muted">No story attached</span>
         <button type="button" class="ext-editor-btn ext-editor-btn-primary" id="edChooseStory">Choose Reporter Story</button>
       </div>`;

  return `
    ${storyBar}
    ${FIELDS.map((f) =>
      f.type === "textarea"
        ? `<div class="form-group"><label>${f.label}</label><textarea id="${f.id}" rows="${f.rows}">${escapeHtml(view[f.field])}</textarea></div>`
        : `<div class="form-group"><label>${f.label}</label><input id="${f.id}" value="${escapeHtml(view[f.field])}" /></div>`,
    ).join("")}
  `;
}

export function bindStoryPanel(onPatch, onChooseStory) {
  FIELDS.forEach((f) => {
    const element = document.getElementById(f.id);
    if (!element) return;
    element.addEventListener("input", (event) => {
      onPatch({ [f.field]: event.target.value }, "story-panel");
    });
  });

  document.getElementById("edChooseStory")?.addEventListener("click", onChooseStory);
  document.getElementById("edChangeStory")?.addEventListener("click", onChooseStory);
}

// Live sync from elsewhere (undo, story linking, AI). Skips the field being
// typed into so the caret is never moved out from under the user.
export function refreshStoryPanel(view, source) {
  if (source === "story-panel") return;
  FIELDS.forEach((f) => {
    const element = document.getElementById(f.id);
    if (!element || document.activeElement === element) return;
    if (element.value !== view[f.field]) element.value = view[f.field];
  });
}
