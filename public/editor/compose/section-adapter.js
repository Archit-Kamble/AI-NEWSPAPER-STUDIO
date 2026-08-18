// One translation from a block into a composition, used by everything.
//
// A persisted `page_sections` row is snake_case and arrives with its numerics
// as strings (they are NUMERIC(5,1) columns); the editor's live view of the
// same block is camelCase and already coerced. Every consumer used to do this
// conversion itself, with its own defaults - which is how the canvas and the
// fit action ended up disagreeing about a block nobody had touched.
//
// This is the only place that decision is made, so there is exactly one
// answer to "what composition does this block have", whether it is asked by
// the page canvas, the Block Editor, the worklist, preflight or the AI brief.

import { composeBlock } from './compose.js';
import { clusters } from './graphemes.js';
import { plainText, textWithMarks } from '../layout/rich-text.js';
// The dateline opens the body and therefore occupies the body's room, so it
// is composed as part of the flow. One definition, in the module that has
// always owned it - a second copy here is exactly the drift this codebase
// has been bitten by before.
import { datelineText } from '../layout/text-flow.js';
// A side-effect module shared with Scribus, so it installs onto globalThis
// rather than exporting - the canvas and the print path must use one caption
// geometry, and that predates this engine.
import '../layout/caption-geometry.js';

const { captionBox } = globalThis.SahasCaptionGeometry;

function pick(section, view, camel, snake, fallback) {
  for (const source of [view, section]) {
    if (!source) continue;
    if (source[camel] !== undefined && source[camel] !== null && source[camel] !== '') return source[camel];
    if (source[snake] !== undefined && source[snake] !== null && source[snake] !== '') return source[snake];
  }
  return fallback;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * How many columns the copy is set in.
 *
 * A newspaper column is about 40mm; at 2px/mm that is 80px. A block three or
 * four grid columns wide carries one text column, a seven-column lead carries
 * three - a 620px line of 11px type is unreadable and no paper prints one.
 *
 * An EXPLICIT column count is honoured exactly, including 1 - a sub-editor
 * setting a block to one column is a real instruction, not "no opinion, work
 * it out". The old `explicit > 1` guard silently threw an explicit 1 away and
 * fell through to auto-inference, which could (and, on a wide single-column
 * block, did) infer more than one column for a block the desk had explicitly
 * locked to one - text the desk was looking at as a single unbroken column
 * composed as two. Only a genuinely missing/non-integer value now falls
 * through.
 *
 * Reads `view` first and `section` (the persisted row) second, exactly like
 * every other field this adapter picks - NOT `view` alone. A caller that
 * passes a small overrides object rather than a fully-hydrated draft (every
 * server-side caller: worklist, fit, preflight) would otherwise have a
 * persisted `column_count` silently vanish and fall through to width-based
 * guessing, which is the same class of bug as the `explicit > 1` guard this
 * sits beside - an explicit choice discarded because the code only looked in
 * one of the two places it can legally live.
 */
export function measureColumns(section, view, widthPx) {
  const explicit = Number(pick(section, view, 'columnCount', 'column_count', undefined));
  if (Number.isInteger(explicit) && explicit >= 1) return explicit;
  const usable = Math.max(0, widthPx - 2 * positive(pick(section, view, 'marginPx', 'margin_px', 12), 12));
  return Math.max(1, Math.min(4, Math.floor(usable / 150)));
}

/** A `section_images` row (or an already-converted one) as an obstacle. */
export function obstacleFromImage(row) {
  return {
    x: Number(row.x_px ?? row.x) || 0,
    y: Number(row.y_px ?? row.y) || 0,
    width: Number(row.width_px ?? row.width) || 0,
    height: Number(row.height_px ?? row.height) || 0,
    shape: row.shape || 'rect',
    rotation: Number(row.rotation) || 0,
    standOffPx: Number(row.stand_off_px ?? row.standOffPx) || 0,
    mask: row.mask || null,
    // Only read by the 'cutout' branch of obstacleIntervals(), which resolves
    // these through the SAME image-geometry.js transform paint and resize
    // already use - a rectangle or ellipse's exclusion is legitimately its
    // whole frame regardless of fit mode (a picture's box is reserved even
    // where 'contain' leaves it blank), so those two never read these.
    fitMode: row.fit_mode ?? row.fitMode,
    flipH: row.flip_h ?? row.flipH,
    flipV: row.flip_v ?? row.flipV,
    sourceWidth: row.source_width_px ?? row.sourceWidth,
    sourceHeight: row.source_height_px ?? row.sourceHeight,
    cropX: row.crop_x_px ?? row.cropX,
    cropY: row.crop_y_px ?? row.cropY,
    cropWidth: row.crop_width_px ?? row.cropWidth,
    cropHeight: row.crop_height_px ?? row.cropHeight,
  };
}

/**
 * Every obstacle a block's photographs put in the way of its copy.
 *
 * A caption is one of them. It is set in the picture's own measure under the
 * picture, so it occupies room the story cannot have - counting the
 * photograph but not its caption is how copy ends up printed underneath a
 * caption.
 */
export function obstaclesOf(section) {
  const out = [];
  for (const row of section?.images || []) {
    out.push(obstacleFromImage(row));
    const caption = captionBox(row);
    if (caption) {
      out.push({
        x: caption.x, y: caption.y, width: caption.width, height: caption.height,
        shape: 'rect', rotation: 0, standOffPx: caption.standOffPx || 0, mask: null,
      });
    }
  }
  return out;
}

/**
 * The composition of one block.
 *
 * `section` is the persisted row (for its geometry and its images); `view` is
 * what the desk currently has on screen, which may be an unsaved draft. The
 * draft wins, so the canvas shows what is being typed.
 */
export function composeSection(section = {}, view = {}) {
  const width = positive(section.width_px ?? section.width, 0);
  const height = positive(section.height_px ?? section.height, 0);
  const padding = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12);
  const bodyFontPx = positive(pick(section, view, 'bodyFontPx', 'body_font_px', 16), 16);
  const prefix = datelineText(view);

  // Bold/italic/underline runs, not flattened away before composition sees
  // them. `plainText()` and `textWithMarks()` share the same tag/newline/
  // entity normalisation pipeline (rich-text.js), so `withMarks.text` is
  // character-for-character the same string `plainText()` would have
  // produced - only marks are additionally carried. The dateline prefix has
  // no marks of its own, so every mark's offset shifts forward by exactly
  // its length.
  const withMarks = textWithMarks(pick(section, view, 'body', 'body', ''));
  const bodyText = prefix + withMarks.text;
  const bodyMarks = withMarks.marks.map((mark) => ({
    ...mark,
    start: mark.start + prefix.length,
    end: mark.end + prefix.length,
  }));

  return composeBlock({
    width,
    height,
    padding,
    kicker: plainText(pick(section, view, 'kicker', 'kicker', '')),
    headline: plainText(pick(section, view, 'headline', 'headline', '')),
    subheading: plainText(pick(section, view, 'subheading', 'subheading', '')),
    // The dateline is part of the flow it opens.
    body: { text: bodyText, marks: bodyMarks },
    headlineFontPx: positive(pick(section, view, 'headlineFontPx', 'headline_font_px', 34), 34),
    subheadingFontPx: positive(pick(section, view, 'subheadingFontPx', 'subheading_font_px', 20), 20),
    bodyFontPx,
    lineHeight: Number(pick(section, view, 'lineHeight', 'line_height', 0)) || 0,
    fontFamily: pick(section, view, 'fontFamily', 'font_family', 'serif'),
    // Body-only, matching fontFamily above: these map onto `.section-body` in
    // the real stylesheet, never the headline/subheading (compose.js's
    // DISPLAY_TYPOGRAPHY keeps those at the paper's own fixed weights). Real,
    // persisted, desk-facing Typography-panel controls (schema.sql's
    // font_weight/font_italic/font_underline) that composeBlock() previously
    // never read at all - not a measure/paint mismatch but a fully inert
    // control, on both counts.
    fontWeight: pick(section, view, 'fontWeight', 'font_weight', 'normal'),
    fontItalic: Boolean(pick(section, view, 'fontItalic', 'font_italic', false)),
    fontUnderline: Boolean(pick(section, view, 'fontUnderline', 'font_underline', false)),
    // The persisted alignment field (typography-panel.js's ALIGNMENTS,
    // page.repository.js's text_align column) - previously read by nothing
    // in this engine, because composed lines render as standalone spans
    // outside the `.section-body{text-align:justify}` container the CSS rule
    // assumes. Wiring it here is what makes a desk's "justify" choice
    // actually change the geometry rather than being silently ignored.
    textAlign: pick(section, view, 'textAlign', 'text_align', 'left'),
    // The persisted paragraph gap (schema.sql: paragraph_spacing_px, default
    // 8) - previously read by nothing in this engine, the same class of gap
    // as textAlign above: a real, already-wired desk control with no effect
    // on the actual geometry.
    paragraphSpacingPx: positive(pick(section, view, 'paragraphSpacingPx', 'paragraph_spacing_px', 0), 0),
    // The newspaper's own paragraph mark: an indented first line rather than
    // a blank one. A blank line costs a whole row of the column, and no
    // printed newspaper spends one that way. One em, which is what a
    // compositor sets.
    firstLineIndentPx: positive(pick(section, view, 'firstLineIndentPx', 'first_line_indent_px', bodyFontPx), bodyFontPx),
    // How many lines the display type may take. Left at the engine's own
    // defaults unless a caller states them - `headline-reserve.js` does, so
    // that the reservation and the real block are measured the same way.
    headlineMaxLines: pick(section, view, 'headlineMaxLines', 'headline_max_lines', undefined),
    deckMaxLines: pick(section, view, 'deckMaxLines', 'deck_max_lines', undefined),
    letterSpacingPx: Number(pick(section, view, 'letterSpacingPx', 'letter_spacing_px', 0)) || 0,
    columnCount: measureColumns(section, view, width),
    headlineLocked: Boolean(pick(section, view, 'headlineLocked', 'headline_locked', false)),
    subheadingLocked: Boolean(pick(section, view, 'subheadingLocked', 'subheading_locked', false)),
    images: obstaclesOf(section),
  });
}

/**
 * Is the BODY specifically overset - not the block as a whole.
 *
 * `result.overset.body` alone is not the whole answer: it is the LEFTOVER
 * text a pour never reached, but a single word wider than every legal gap in
 * the frame (Marathi has no hyphenation - see graphemes.js) is drawn anyway,
 * never left over, and shows up only as a violation. `result.fitState` sees
 * both correctly, but it is whole-block: a headline that cannot fit is also
 * OVERSET, and that is not a reason to shrink the BODY. This is the one
 * check fit.service.js, worklist.service.js and preflight.service.js all
 * need and must ask identically, or "fit approved this" and "preflight still
 * fails it" can disagree again over exactly this edge case.
 */
export function bodyOverset(result) {
  return Boolean(result?.overset?.body)
    || Boolean(result?.violations?.some((v) => v.code === 'BODY_UNBREAKABLE_TOKEN_OVERSET'));
}

/**
 * How full this block actually is, in LINES - the one honest answer to "is
 * there room left", and the only one every surface may quote.
 *
 * Characters cannot answer it. The engine's own character budget is a RANGE
 * (`capacity.bodyCharRange`), and on a real block it is wide: 539-918 on the
 * 307x312 advert this was found on, a factor of 1.7. Any two callers that
 * pick different ends of that range tell the desk opposite stories about the
 * same block, and that is exactly what happened - the Space panel divided by
 * the range's FLOOR and reported "91% of the room for copy used, layout looks
 * balanced" on a block whose foot was visibly empty, while the AI panel
 * divided by a calibrated target and offered "79 left" on a block the same
 * panel called "nearly full" one click later.
 *
 * Lines have no range. The compositor placed 9 of them and left 3.58 lines of
 * room under the last one; that is a measurement, not an estimate, and it is
 * what the eye is already reading. So this is the number the meter, the
 * warnings, the AI read-out and the fill decision all share.
 */
export function bodyFill(result) {
  const occupancy = result?.whitespace?.occupancy;
  const renderedFragments = (result?.bodyLines || []).length;

  // `bodyLines.length` is a FRAGMENT count, and it is not the number of lines
  // set. Around a cut-out standing clear of both edges, one physical row of
  // type is two corridors, `pourBody()` sets both, and each becomes its own
  // entry in `bodyLines`. Measured on a centre-standing silhouette: nine
  // entries for six physical rows, each entry a half-measure fragment. The
  // old reading divided that fragment count by a width-derived hole and
  // called the quotient a percentage - two different units, so the answer
  // could not be right except by accident. On that block it read 44% full
  // where the geometry says 29%.
  const occupiedEquivalentLines = occupancy
    ? Math.max(0, Number(occupancy.occupiedEquivalentLines) || 0)
    : renderedFragments;
  const emptyEquivalentLines = occupancy
    ? Math.max(0, Number(occupancy.emptyEquivalentLines) || 0)
    : Math.max(0, Number(result?.whitespace?.largestHoleLines) || 0);
  const intentionalEquivalentLines = occupancy ? Math.max(0, Number(occupancy.intentionalEquivalentLines) || 0) : 0;
  const availableEquivalentLines = occupiedEquivalentLines + emptyEquivalentLines;

  const round = (n) => Number(n.toFixed(2));
  return {
    occupiedEquivalentLines: round(occupiedEquivalentLines),
    emptyEquivalentLines: round(emptyEquivalentLines),
    intentionalEquivalentLines: round(intentionalEquivalentLines),
    availableEquivalentLines: round(availableEquivalentLines),
    // Diagnostic only. Never a line count, never a divisor.
    renderedFragments,
    // The same three numbers under the names every surface already quotes -
    // now carrying the weighted geometry rather than a fragment tally. They
    // are fractional, because a row a silhouette halves really is half a line.
    linesUsed: round(occupiedEquivalentLines),
    holeLines: round(emptyEquivalentLines),
    linesAvailable: round(availableEquivalentLines),
    // 1 means the block is full to the foot. Overset copy is reported as full
    // rather than as more-than-full: how far past the edge it ran is
    // `bodyOversetChars()`, a different question with its own exact answer.
    ratio: availableEquivalentLines > 0 ? Math.min(1, occupiedEquivalentLines / availableEquivalentLines) : 0,
    overset: bodyOverset(result),
    state: result?.fitState || 'EMPTY',
  };
}

/**
 * How many visible units of the body have no room - real leftover text plus
 * any unbreakable token that was drawn past its own measure (see
 * `bodyOverset()`). "Cut about N characters" only means something if N
 * accounts for both, not just whichever one happens to be the leftover.
 */
export function bodyOversetChars(result) {
  const leftover = clusters(result?.overset?.body || '').length;
  const hard = (result?.violations || [])
    .filter((v) => v.code === 'BODY_UNBREAKABLE_TOKEN_OVERSET')
    .reduce((sum, v) => sum + (v.charsOver || 0), 0);
  return leftover + hard;
}
