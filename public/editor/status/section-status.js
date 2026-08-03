// Phase 5: the section lifecycle.
//
// Two of these states are derived from content (a section with nothing in it is
// `empty`; one with a linked story but no editing yet is `story_linked`), and
// the rest are explicit editorial decisions that have to persist, which is why
// `page_sections.status` exists. `statusOf` resolves the two together so every
// view - canvas badge, inspector, toolbar - shows the same answer.

export const STATUSES = [
  { key: "empty", label: "Empty", explicit: false },
  { key: "story_linked", label: "Story linked", explicit: false },
  { key: "editing", label: "Editing", explicit: false },
  { key: "ai_generated", label: "AI generated", explicit: false },
  { key: "needs_review", label: "Needs review", explicit: true },
  { key: "ready", label: "Ready", explicit: true },
  { key: "published", label: "Published", explicit: true },
];

const EXPLICIT_KEYS = new Set(STATUSES.filter((s) => s.explicit).map((s) => s.key));
const BY_KEY = new Map(STATUSES.map((s) => [s.key, s]));

export function isExplicit(statusKey) {
  return EXPLICIT_KEYS.has(statusKey);
}

// Content fields - touching any of these is what moves a section into `editing`.
// Classification (category/location/tags/language) and typography do not: they
// are metadata about the article, not the article.
export const CONTENT_FIELDS = ["headline", "subheading", "body", "caption", "imageUrl"];

export function isContentEdit(patch) {
  return Object.keys(patch).some((key) => CONTENT_FIELDS.includes(key));
}

export function statusOf(view) {
  if (!view) return "empty";
  // An editor who marked a section "ready" keeps that answer until they change
  // it - derivation must never silently overwrite an explicit decision.
  if (isExplicit(view.status)) return view.status;
  if (view.aiGenerated) return "ai_generated";
  if (!view.headline && !view.body && !view.imageUrl) {
    return view.newsItemId ? "story_linked" : "empty";
  }
  // A section straight off a linked story is still `story_linked`; it becomes
  // `editing` once someone actually changes the words, which the workspace
  // records on the draft so it survives a reload.
  if (view.status === "editing") return "editing";
  return view.newsItemId ? "story_linked" : "editing";
}

export function statusLabel(statusKey) {
  return BY_KEY.get(statusKey)?.label || statusKey;
}

export function statusClass(statusKey) {
  return `status-${String(statusKey).replace(/_/g, "-")}`;
}

export function explicitStatusOptions() {
  return STATUSES.filter((s) => s.explicit);
}
