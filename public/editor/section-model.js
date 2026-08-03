// Translates between the three shapes a section takes:
//   * the persisted `page_sections` row (snake_case, from the API)
//   * the editor draft every view binds to (camelCase, Phase 1's field list)
//   * the PUT payload the save endpoint expects
//
// Keeping all three conversions in one file is what stops the draft's field list
// from drifting away from what actually persists - the failure mode CLAUDE.md
// records for the duplicated template catalog.

import { isExplicit } from "./status/section-status.js";

export const DRAFT_FIELDS = [
  "newsItemId",
  "headline",
  "subheading",
  "body",
  "caption",
  "author",
  "imageUrl",
  "imageRotation",
  "imageZoom",
  "imageFit",
  "status",
  "language",
  "tags",
  "category",
  "location",
  "aiNotes",
  "aiGenerated",
  "headlineFontPx",
  "subheadingFontPx",
  "bodyFontPx",
  "imageFlipH",
  "imageFlipV",
  "fontFamily",
  "fontWeight",
  "fontItalic",
  "fontUnderline",
  "textAlign",
  "columnCount",
  "marginPx",
  "lineHeight",
  "letterSpacingPx",
  "paragraphSpacingPx",
  "listStyle",
  "dropCap",
];

export function draftFromSection(section) {
  if (!section) return null;
  return {
    sectionKey: section.section_key,
    newsItemId: section.news_item_id || null,
    headline: section.headline || "",
    subheading: section.subheading || "",
    body: section.body || "",
    caption: section.caption || "",
    author: section.reporter_name || "",
    imageUrl: section.image_url || "",
    imageRotation: Number(section.image_rotation) || 0,
    imageZoom: Number(section.image_zoom) || 1,
    imageFit: section.image_fit || "cover",
    status: section.status || "empty",
    language: section.language || "",
    tags: section.tags || "",
    category: section.category || "",
    location: section.location || "",
    aiNotes: section.ai_notes || "",
    aiGenerated: section.ai_generated === true,
    headlineFontPx: Number(section.headline_font_px) || 34,
    subheadingFontPx: Number(section.subheading_font_px) || 20,
    bodyFontPx: Number(section.body_font_px) || 16,
    imageFlipH: section.image_flip_h === true,
    imageFlipV: section.image_flip_v === true,
    fontFamily: section.font_family || "",
    fontWeight: section.font_weight || "normal",
    fontItalic: section.font_italic === true,
    fontUnderline: section.font_underline === true,
    textAlign: section.text_align || "left",
    columnCount: Number(section.column_count) || 1,
    marginPx: Number.isFinite(Number(section.margin_px)) ? Number(section.margin_px) : 12,
    lineHeight: Number(section.line_height) || 1.25,
    letterSpacingPx: Number(section.letter_spacing_px) || 0,
    paragraphSpacingPx: Number.isFinite(Number(section.paragraph_spacing_px)) ? Number(section.paragraph_spacing_px) : 8,
    listStyle: section.list_style || "none",
    dropCap: section.drop_cap === true,
  };
}

// Phase 1: linking a reporter story fills the draft from that story. Fields the
// story does not carry (caption, font sizes, AI notes) are left as they are so
// an editor's existing work is not silently thrown away.
export function draftFromStory(draft, story) {
  return {
    ...draft,
    newsItemId: story.id,
    headline: story.title || "",
    subheading: story.subheading || story.subtitle || "",
    body: story.description || "",
    author: story.reporter_name || "",
    imageUrl: story.image_urls?.[0] || draft.imageUrl || "",
    category: story.category || "",
    location: story.location || "",
    tags: story.tags || "",
    language: story.language || draft.language || "",
    aiGenerated: false,
    // Freshly linked content is untouched content - back to `story_linked`,
    // unless an editor has made an explicit lifecycle call already.
    status: isExplicit(draft.status) ? draft.status : "story_linked",
  };
}

export function payloadFromDraft(draft) {
  return {
    newsItemId: draft.newsItemId,
    headline: draft.headline,
    subheading: draft.subheading,
    body: draft.body,
    caption: draft.caption,
    reporterName: draft.author,
    imageUrl: draft.imageUrl,
    imageRotation: draft.imageRotation,
    imageZoom: draft.imageZoom,
    imageFit: draft.imageFit,
    status: draft.status,
    language: draft.language,
    tags: draft.tags,
    category: draft.category,
    location: draft.location,
    aiNotes: draft.aiNotes,
    aiGenerated: draft.aiGenerated,
    headlineFontPx: draft.headlineFontPx,
    subheadingFontPx: draft.subheadingFontPx,
    bodyFontPx: draft.bodyFontPx,
    imageFlipH: draft.imageFlipH,
    imageFlipV: draft.imageFlipV,
    fontFamily: draft.fontFamily,
    fontWeight: draft.fontWeight,
    fontItalic: draft.fontItalic,
    fontUnderline: draft.fontUnderline,
    textAlign: draft.textAlign,
    columnCount: draft.columnCount,
    marginPx: draft.marginPx,
    lineHeight: draft.lineHeight,
    letterSpacingPx: draft.letterSpacingPx,
    paragraphSpacingPx: draft.paragraphSpacingPx,
    listStyle: draft.listStyle,
    dropCap: draft.dropCap,
  };
}

// The canvas renders unsaved sections too, so it needs one shape whether the
// section is the live draft or an untouched persisted row.
export function viewOfSection(section, draft, selectedSectionKey) {
  if (draft && section.section_key === selectedSectionKey) {
    return { ...draftFromSection(section), ...draft };
  }
  return draftFromSection(section);
}
