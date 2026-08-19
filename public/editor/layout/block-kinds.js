// What kind of block this is, and what work it wants.
//
// A page is not forty of the same box. A lead is copy to write; an advert slot
// is space the advertising side sells and a night editor must not treat as an
// unwritten story; a photo block wants a photograph and a caption; a feature
// carries the day's standing furniture. The desk knows the difference, and the
// software has known it too - `page_sections.block_type` has always been there,
// and the worklist has always used it to say what each block needs.
//
// It was only ever said on the worklist, though. The block itself opened as
// "LEAD, 268 × 248 px" and nothing more, so the one screen where the work
// actually happens was the one screen that did not say what the work WAS.
//
// This is the catalog, and it is the only one. The server imports this module
// exactly as it imports the character grid in text-flow.js - a second copy of a
// catalog is how the template keys drifted (CLAUDE.md), and these words appear
// on a night editor's worklist, so two lists would mean the worklist and the
// block disagreeing about what a block is for.

// `panel` is what the writing panel calls itself for this kind of block. The
// panel is the same panel - the same surface, the same pictures, the same
// controls - but "Write the story" over an advert slot is simply untrue, and a
// heading that lies about what a box is for is worse than no heading.
// `copy` says whether this kind is MEANT to carry body text. A display advert
// and a photo block are a picture and nothing else - a full-bleed image on one
// is the finished thing, not a mistake - so a complaint about "no column wide
// enough to set type in" is simply wrong about them. Measured: that complaint
// was firing on 51 real blocks and 49 of them were full-bleed adverts and
// photos with no copy and none intended, which is how a desk learns to ignore
// a warning and misses the two that are real.
export const BLOCK_KINDS = {
  article: { label: "Article", work: "copy to write", panel: "Write the story", copy: true },
  briefs: { label: "Briefs", work: "briefs to gather", panel: "Write the briefs", copy: true },
  photo: { label: "Photo", work: "a photograph to place", panel: "Place the photograph", copy: false },
  advert: { label: "Advert", work: "advertising space", panel: "Advertising space", copy: false },
  feature: { label: "Feature", work: "a standing feature", panel: "The day's feature", copy: true },
};

const FALLBACK = BLOCK_KINDS.article;

/** The kind of a block, never null - an unknown type reads as an article. */
export function blockKind(blockType) {
  return BLOCK_KINDS[String(blockType || "article")] || FALLBACK;
}

/** Whether this kind is meant to carry body copy at all. */
export function blockExpectsCopy(blockType) {
  return blockKind(blockType).copy !== false;
}

/** What this block needs, in the words the worklist uses. */
export function blockWork(blockType) {
  return blockKind(blockType).work;
}

// "the", "a" and the rest carry no meaning here; two phrases that differ only in
// them are the same phrase.
const FILLER = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "and"]);
const meaning = (phrase) =>
  new Set(String(phrase).toLowerCase().split(/[^a-z']+/).filter((word) => word && !FILLER.has(word)));

/**
 * The work, as a note beside the panel's heading - or nothing, when the heading
 * already says it.
 *
 * "ADVERTISING SPACE  advertising space" and "PLACE THE PHOTOGRAPH  a
 * photograph to place" tell a desk the same thing twice, which is noise
 * (VISION.md: avoid repeated information). The words are still on the block -
 * the kind chip carries them - and they are still the worklist's words.
 */
export function blockNote(blockType) {
  const kind = blockKind(blockType);
  const work = meaning(kind.work);
  const panel = meaning(kind.panel);
  if (work.size === panel.size && [...work].every((word) => panel.has(word))) return "";
  return kind.work;
}
