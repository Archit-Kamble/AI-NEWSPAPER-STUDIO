// Semantic story types and the composition promises each one makes.
//
// `block_type` says what physical work a frame was cut for (article, briefs,
// photo, advert, feature).  It does not say how the journalism inside that
// frame should read.  A lead and an analysis can both live in an article
// frame, but they should not receive the same headline, image or continuation
// treatment.  This catalog is that independent semantic layer.
//
// Keep this module free of DOM and database concerns.  Both browser and server
// composition code import the catalogs in this folder, so one policy must be
// able to govern assignment, analysis, fitting and final rendering.

export const STORY_TYPE = Object.freeze({
  LEAD: "LEAD",
  SECONDARY: "SECONDARY",
  STANDARD: "STANDARD",
  BRIEF: "BRIEF",
  PHOTO_FEATURE: "PHOTO_FEATURE",
  OPINION: "OPINION",
  ANALYSIS: "ANALYSIS",
  QUOTE: "QUOTE",
  DATA: "DATA",
  SIDEBAR: "SIDEBAR",
  SMART_CARD: "SMART_CARD",
  ADVERTISEMENT: "ADVERTISEMENT",
});

const freezePolicy = (policy) => Object.freeze({
  ...policy,
  compatibleBlockTypes: Object.freeze([...policy.compatibleBlockTypes]),
  headline: Object.freeze({ ...policy.headline }),
  deck: Object.freeze({ ...policy.deck }),
  bodyFill: Object.freeze({ ...policy.bodyFill }),
  image: Object.freeze({
    ...policy.image,
    treatments: Object.freeze([...policy.image.treatments]),
  }),
  columns: Object.freeze({ ...policy.columns }),
});

const policy = ({
  type,
  label,
  priority,
  compatibleBlockTypes,
  headline,
  deck,
  bodyFill,
  image,
  columns,
  continuationAllowed,
}) => freezePolicy({
  type,
  label,
  priority,
  compatibleBlockTypes,
  headline,
  deck,
  bodyFill,
  image,
  columns,
  continuationAllowed,
});

// Priorities are editorial hierarchy, not z-index or a score. Five is the
// edition's dominant story and one is supporting furniture or a paid slot.
// An advertisement can be visually large without becoming editorially primary.
export const STORY_TYPES = Object.freeze({
  [STORY_TYPE.LEAD]: policy({
    type: STORY_TYPE.LEAD,
    label: "Lead",
    priority: 5,
    compatibleBlockTypes: ["article"],
    headline: { minPx: 38, preferredPx: 56, maxPx: 72, minLines: 1, maxLines: 3, maxShare: 0.34 },
    deck: { allowed: true, preferred: true },
    bodyFill: { min: 0.58, target: 0.82, max: 0.98 },
    image: {
      minShare: 0,
      maxShare: 0.58,
      treatment: "hero",
      treatments: ["none", "hero", "wide", "inset"],
    },
    columns: { min: 2, max: 5 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.SECONDARY]: policy({
    type: STORY_TYPE.SECONDARY,
    label: "Secondary",
    priority: 4,
    compatibleBlockTypes: ["article"],
    headline: { minPx: 28, preferredPx: 40, maxPx: 52, minLines: 1, maxLines: 3, maxShare: 0.3 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.64, target: 0.84, max: 0.98 },
    image: {
      minShare: 0,
      maxShare: 0.46,
      treatment: "wide",
      treatments: ["none", "wide", "inset", "portrait"],
    },
    columns: { min: 1, max: 3 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.STANDARD]: policy({
    type: STORY_TYPE.STANDARD,
    label: "Standard",
    priority: 3,
    compatibleBlockTypes: ["article"],
    headline: { minPx: 20, preferredPx: 28, maxPx: 38, minLines: 1, maxLines: 3, maxShare: 0.27 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.68, target: 0.86, max: 0.98 },
    image: {
      minShare: 0,
      maxShare: 0.38,
      treatment: "inset",
      treatments: ["none", "inset", "wide", "portrait"],
    },
    columns: { min: 1, max: 3 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.BRIEF]: policy({
    type: STORY_TYPE.BRIEF,
    label: "Brief",
    priority: 2,
    compatibleBlockTypes: ["briefs", "article"],
    headline: { minPx: 15, preferredPx: 20, maxPx: 25, minLines: 1, maxLines: 2, maxShare: 0.22 },
    deck: { allowed: false, preferred: false },
    bodyFill: { min: 0.76, target: 0.9, max: 1 },
    image: {
      minShare: 0,
      maxShare: 0.14,
      treatment: "none",
      treatments: ["none", "thumbnail"],
    },
    columns: { min: 1, max: 1 },
    continuationAllowed: false,
  }),

  [STORY_TYPE.PHOTO_FEATURE]: policy({
    type: STORY_TYPE.PHOTO_FEATURE,
    label: "Photo feature",
    priority: 4,
    compatibleBlockTypes: ["photo", "article"],
    headline: { minPx: 24, preferredPx: 34, maxPx: 48, minLines: 1, maxLines: 3, maxShare: 0.25 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.25, target: 0.5, max: 0.78 },
    image: {
      minShare: 0.5,
      maxShare: 0.84,
      treatment: "dominant",
      treatments: ["dominant", "full_bleed", "wide"],
    },
    columns: { min: 1, max: 2 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.OPINION]: policy({
    type: STORY_TYPE.OPINION,
    label: "Opinion",
    priority: 3,
    compatibleBlockTypes: ["article"],
    headline: { minPx: 22, preferredPx: 30, maxPx: 38, minLines: 1, maxLines: 3, maxShare: 0.26 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.74, target: 0.9, max: 1 },
    image: {
      minShare: 0,
      maxShare: 0.22,
      treatment: "author_portrait",
      treatments: ["none", "author_portrait"],
    },
    columns: { min: 1, max: 2 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.ANALYSIS]: policy({
    type: STORY_TYPE.ANALYSIS,
    label: "Analysis",
    priority: 4,
    compatibleBlockTypes: ["article"],
    headline: { minPx: 24, preferredPx: 32, maxPx: 42, minLines: 1, maxLines: 3, maxShare: 0.27 },
    deck: { allowed: true, preferred: true },
    bodyFill: { min: 0.7, target: 0.88, max: 0.98 },
    image: {
      minShare: 0,
      maxShare: 0.32,
      treatment: "inset",
      treatments: ["none", "inset", "wide", "chart"],
    },
    columns: { min: 1, max: 3 },
    continuationAllowed: true,
  }),

  [STORY_TYPE.QUOTE]: policy({
    type: STORY_TYPE.QUOTE,
    label: "Quote",
    priority: 2,
    compatibleBlockTypes: ["article", "feature"],
    headline: { minPx: 20, preferredPx: 28, maxPx: 36, minLines: 1, maxLines: 4, maxShare: 0.5 },
    deck: { allowed: false, preferred: false },
    bodyFill: { min: 0.18, target: 0.42, max: 0.7 },
    image: {
      minShare: 0,
      maxShare: 0.25,
      treatment: "none",
      treatments: ["none", "portrait"],
    },
    columns: { min: 1, max: 1 },
    continuationAllowed: false,
  }),

  [STORY_TYPE.DATA]: policy({
    type: STORY_TYPE.DATA,
    label: "Data",
    priority: 3,
    compatibleBlockTypes: ["article", "feature"],
    headline: { minPx: 18, preferredPx: 24, maxPx: 32, minLines: 1, maxLines: 2, maxShare: 0.22 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.5, target: 0.78, max: 0.94 },
    image: {
      minShare: 0.24,
      maxShare: 0.72,
      treatment: "chart",
      treatments: ["chart", "table", "number", "map"],
    },
    columns: { min: 1, max: 2 },
    continuationAllowed: false,
  }),

  [STORY_TYPE.SIDEBAR]: policy({
    type: STORY_TYPE.SIDEBAR,
    label: "Sidebar",
    priority: 2,
    compatibleBlockTypes: ["article", "briefs", "feature"],
    headline: { minPx: 17, preferredPx: 22, maxPx: 30, minLines: 1, maxLines: 3, maxShare: 0.29 },
    deck: { allowed: false, preferred: false },
    bodyFill: { min: 0.64, target: 0.84, max: 1 },
    image: {
      minShare: 0,
      maxShare: 0.2,
      treatment: "none",
      treatments: ["none", "thumbnail", "icon"],
    },
    columns: { min: 1, max: 1 },
    continuationAllowed: false,
  }),

  [STORY_TYPE.SMART_CARD]: policy({
    type: STORY_TYPE.SMART_CARD,
    label: "Smart card",
    priority: 1,
    compatibleBlockTypes: ["feature"],
    headline: { minPx: 14, preferredPx: 18, maxPx: 24, minLines: 1, maxLines: 2, maxShare: 0.18 },
    deck: { allowed: false, preferred: false },
    bodyFill: { min: 0.72, target: 0.92, max: 1 },
    image: {
      minShare: 0,
      maxShare: 0.28,
      treatment: "structured",
      treatments: ["structured", "icon"],
    },
    columns: { min: 1, max: 4 },
    continuationAllowed: false,
  }),

  [STORY_TYPE.ADVERTISEMENT]: policy({
    type: STORY_TYPE.ADVERTISEMENT,
    label: "Advertisement",
    priority: 1,
    compatibleBlockTypes: ["advert"],
    headline: { minPx: 16, preferredPx: 28, maxPx: 42, minLines: 1, maxLines: 3, maxShare: 0.26 },
    deck: { allowed: true, preferred: false },
    bodyFill: { min: 0.2, target: 0.55, max: 0.9 },
    image: {
      minShare: 0.25,
      maxShare: 0.88,
      treatment: "artwork",
      treatments: ["artwork", "product", "full_bleed"],
    },
    columns: { min: 1, max: 1 },
    continuationAllowed: false,
  }),
});

export const STORY_TYPE_KEYS = Object.freeze(Object.values(STORY_TYPE));
const NORMALIZED = new Set(STORY_TYPE_KEYS);

const ALIASES = Object.freeze({
  article: STORY_TYPE.STANDARD,
  news: STORY_TYPE.STANDARD,
  story: STORY_TYPE.STANDARD,
  briefs: STORY_TYPE.BRIEF,
  lead_story: STORY_TYPE.LEAD,
  secondary_story: STORY_TYPE.SECONDARY,
  photo: STORY_TYPE.PHOTO_FEATURE,
  photo_story: STORY_TYPE.PHOTO_FEATURE,
  feature: STORY_TYPE.PHOTO_FEATURE,
  editorial: STORY_TYPE.OPINION,
  op_ed: STORY_TYPE.OPINION,
  oped: STORY_TYPE.OPINION,
  infographic: STORY_TYPE.DATA,
  smartcard: STORY_TYPE.SMART_CARD,
  card: STORY_TYPE.SMART_CARD,
  advert: STORY_TYPE.ADVERTISEMENT,
  ad: STORY_TYPE.ADVERTISEMENT,
});

/**
 * Canonicalises user/API spellings.  Unknown values are deliberately ordinary
 * STANDARD stories: an unrecognised value must never accidentally gain lead
 * prominence or the special rendering of an advert/Smart Card.
 */
export function normalizeStoryType(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");

  const canonical = key.toUpperCase();
  if (NORMALIZED.has(canonical)) return canonical;
  return ALIASES[key] || STORY_TYPE.STANDARD;
}

/** True only for a catalog value or a documented input alias. */
export function isKnownStoryType(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
  return NORMALIZED.has(key.toUpperCase()) || Object.hasOwn(ALIASES, key);
}

/**
 * Priorities are deliberately a small, stable editorial scale.  Clamping is
 * useful for imported legacy data; request services still reject non-numeric
 * explicit input so accidental strings never become a hidden priority change.
 */
export function normalizeEditorialPriority(value, fallback = 3) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(5, Math.max(1, Math.round(parsed)));
}

const hasCard = (section) => Boolean(
  section?.smart_card_key
  || section?.smartCardKey
  || section?.smart_card_data
  || section?.smartCardData,
);

const TYPE_FROM_BLOCK = Object.freeze({
  article: STORY_TYPE.STANDARD,
  briefs: STORY_TYPE.BRIEF,
  photo: STORY_TYPE.PHOTO_FEATURE,
  advert: STORY_TYPE.ADVERTISEMENT,
  feature: STORY_TYPE.SMART_CARD,
});

/**
 * Resolves semantics from stored data without guessing from a template key.
 *
 * `section_key` is intentionally never read here.  Keys such as "lead" or
 * "foot-right" are layout identity, and inferring editorial meaning from them
 * was one of Project B's root causes.  An explicit semantic type wins; legacy
 * rows fall back only to real block/card data.
 */
export function resolveStoryType(section) {
  if (typeof section === "string") return normalizeStoryType(section);

  const explicit = section?.story_type ?? section?.storyType;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return normalizeStoryType(explicit);
  }

  if (hasCard(section)) return STORY_TYPE.SMART_CARD;

  const blockType = String(section?.block_type ?? section?.blockType ?? "")
    .trim()
    .toLowerCase();
  return TYPE_FROM_BLOCK[blockType] || STORY_TYPE.STANDARD;
}

/** Returns the immutable composition policy for a semantic type or section. */
export function storyPolicy(input) {
  const type = typeof input === "string" ? normalizeStoryType(input) : resolveStoryType(input);
  return STORY_TYPES[type] || STORY_TYPES[STORY_TYPE.STANDARD];
}
