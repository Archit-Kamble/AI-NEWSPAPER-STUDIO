// Translates between the three shapes a section takes:
//   * the persisted `page_sections` row (snake_case, from the API)
//   * the editor draft every view binds to (camelCase, Phase 1's field list)
//   * the PUT payload the save endpoint expects
//
// Keeping all three conversions in one file is what stops the draft's field list
// from drifting away from what actually persists - the failure mode CLAUDE.md
// records for the duplicated template catalog.

import { isExplicit } from "./status/section-status.js";
import { DEFAULT_BODY_FONT_PX, MIN_LINE_HEIGHT } from "./layout/text-flow.js";
import { normalizeEditorialPriority, resolveStoryType } from "./layout/story-types.js";
import { sanitiseInk, sanitiseTint } from "./layout/inks.js";

export const DRAFT_FIELDS = [
  "newsItemId",
  "storyType",
  "editorialPriority",
  "kicker",
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
  "editorialPresentation",
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
  // The headline's and the deck's OWN alignment. `textAlign` is the body's -
  // see schema.sql beside the columns for why one field for the whole block
  // could not say what a newspaper page routinely does.
  "headlineAlign",
  "subheadingAlign",
  "columnCount",
  "marginPx",
  "lineHeight",
  "letterSpacingPx",
  "paragraphSpacingPx",
  "listStyle",
  "dropCap",
  // Block decoration. These persist on the row, so they have to travel with the
  // draft as well - a template that boxes the advert slot would otherwise have
  // its box wiped by the first save of that block.
  "borderStyle",
  "borderWidthPx",
  "borderColor",
  "backgroundColor",
  "headlineStyle",
  "accentColor",
  // The structured card placed in this block, if any. In the draft like every
  // other editable field, so it travels down the one channel everything else
  // does: draft -> DRAFT event -> canvas -> autosave -> database. A second
  // store for card state is exactly the duplicate state this file exists to
  // prevent.
  "smartCardKey",
  "smartCardData",
];

export function draftFromSection(section) {
  if (!section) return null;
  return {
    sectionKey: section.section_key,
    newsItemId: section.news_item_id || null,
    // What kind of block this is comes from the layout, not the desk: an advert
    // slot stays an advert slot however it is filled. Read-only in the draft.
    blockType: section.block_type || "article",
    storyType: resolveStoryType(section),
    editorialPriority: normalizeEditorialPriority(section.editorial_priority, 3),
    // Which standing daily feature fills this block, if any. Set by the layout,
    // not by the desk - read-only in the draft.
    featureKey: section.feature_key || null,
    kicker: section.kicker || "",
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
    language: section.language || "Marathi",
    tags: section.tags || "",
    category: section.category || "",
    location: section.location || "",
    aiNotes: section.ai_notes || "",
    aiGenerated: section.ai_generated === true,
    editorialPresentation: section.editorial_presentation || null,
    headlineFontPx: Number(section.headline_font_px) || 34,
    subheadingFontPx: Number(section.subheading_font_px) || 20,
    bodyFontPx: Number(section.body_font_px) || DEFAULT_BODY_FONT_PX,
    imageFlipH: section.image_flip_h === true,
    imageFlipV: section.image_flip_v === true,
    fontFamily: section.font_family || "",
    fontWeight: section.font_weight || "normal",
    fontItalic: section.font_italic === true,
    fontUnderline: section.font_underline === true,
    textAlign: section.text_align || "left",
    // Empty, not "left", when the row has never carried an opinion: the
    // engine's own display default answers for those, so a block never
    // silently acquires a desk decision nobody made.
    headlineAlign: section.headline_align || "",
    subheadingAlign: section.subheading_align || "",
    // NULL means "the desk has not said", and it is the ordinary state
    // (schema.sql) - the engine works the count out from the block's own width
    // and type. `|| 1` turned every one of those back into an explicit single
    // column, which is the whole fault this was meant to fix.
    columnCount: Number.isInteger(Number(section.column_count)) && Number(section.column_count) >= 1
      ? Number(section.column_count)
      : null,
    // The compositor requires a positive inset. Canonical newspaper blocks use
    // 1 px; normalising an imported 0 here avoids the old `0 || 12` jump that
    // made a control set to zero draw twelve pixels instead.
    marginPx: Number.isFinite(Number(section.margin_px))
      ? Math.min(60, Math.max(1, Number(section.margin_px)))
      : 1,
    // A floor, not a default (text-flow.js's MIN_LINE_HEIGHT comment explains
    // why: Devanagari vowel signs stack above and below the baseline, and a
    // shorter line height crops them). The character grid has always assumed
    // this floor when it works out how much copy fits; the real rendered
    // block used to default to 1.25 instead, so a block reported as "98%
    // used" against the grid's assumption could still finish visibly short
    // of the bottom of the box once rendered at the shorter line height.
    lineHeight: Math.max(MIN_LINE_HEIGHT, Number(section.line_height) || 1.25),
    letterSpacingPx: Number(section.letter_spacing_px) || 0,
    paragraphSpacingPx: Number.isFinite(Number(section.paragraph_spacing_px)) ? Number(section.paragraph_spacing_px) : 8,
    listStyle: section.list_style || "none",
    dropCap: section.drop_cap === true,
    borderStyle: section.border_style || "none",
    borderWidthPx: Number(section.border_width_px) || 1,
    borderColor: section.border_color || "#111111",
    // NULL is the paper's own white and is not a colour - see schema.sql.
    // The API rejects foreign colours, and this read-side guard also protects
    // editions imported before that boundary existed. A persisted value is
    // interpolated into the page's style attribute, so it must be a palette
    // value before any renderer sees it.
    backgroundColor: sanitiseTint(section.background_color),
    headlineStyle: section.headline_style || "plain",
    accentColor: sanitiseInk(section.accent_color) || "#c8102e",
    // A card is only a card when both halves are there. A key with no payload
    // is a block that says it holds a sudoku and cannot draw one, so it is
    // read as no card at all and the body text prints instead.
    smartCardKey: section.smart_card_data ? section.smart_card_key || null : null,
    smartCardData: section.smart_card_key ? section.smart_card_data || null : null,
  };
}

// Phase 1: linking a reporter story fills the draft from that story. Fields the
// story does not carry (caption, font sizes, AI notes) are left as they are so
// an editor's existing work is not silently thrown away.
export function draftFromStory(draft, story) {
  return {
    ...draft,
    newsItemId: story.id,
    storyType: resolveStoryType(story.story_type || draft.storyType || "STANDARD"),
    editorialPriority: normalizeEditorialPriority(
      story.editorial_priority ?? draft.editorialPriority,
      3,
    ),
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
    // A reporter's story replaces whatever was in the block, so a Smart Card
    // that was there is gone. Leaving the card behind would print a sudoku
    // over the top of the story that was just linked into the same block.
    smartCardKey: null,
    smartCardData: null,
    // Freshly linked content is untouched content - back to `story_linked`,
    // unless an editor has made an explicit lifecycle call already.
    status: isExplicit(draft.status) ? draft.status : "story_linked",
  };
}

export function payloadFromDraft(draft) {
  return {
    newsItemId: draft.newsItemId,
    storyType: resolveStoryType(draft.storyType),
    editorialPriority: normalizeEditorialPriority(draft.editorialPriority, 3),
    kicker: draft.kicker,
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
    headlineAlign: draft.headlineAlign,
    subheadingAlign: draft.subheadingAlign,
    // 0 is the wire's word for AUTO. It is not a legal column count, so it can
    // never collide with a real one - and it is needed because every other
    // presentational column is written with COALESCE (a payload that does not
    // mention a field leaves it alone), which on its own would make "hand this
    // decision back to the engine" impossible to express.
    columnCount: Number.isInteger(Number(draft.columnCount)) && Number(draft.columnCount) >= 1
      ? Number(draft.columnCount)
      : 0,
    marginPx: draft.marginPx,
    lineHeight: draft.lineHeight,
    letterSpacingPx: draft.letterSpacingPx,
    paragraphSpacingPx: draft.paragraphSpacingPx,
    listStyle: draft.listStyle,
    dropCap: draft.dropCap,
    borderStyle: draft.borderStyle,
    borderWidthPx: draft.borderWidthPx,
    borderColor: draft.borderColor,
    backgroundColor: sanitiseTint(draft.backgroundColor),
    headlineStyle: draft.headlineStyle,
    accentColor: sanitiseInk(draft.accentColor) || "#c8102e",
    smartCardKey: draft.smartCardKey || null,
    smartCardData: draft.smartCardData || null,
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
