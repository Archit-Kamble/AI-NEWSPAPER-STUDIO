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
import { textWithMarks } from '../layout/rich-text.js';
// The dateline opens the body and therefore occupies the body's room, so it
// is composed as part of the flow. One definition, in the module that has
// always owned it - a second copy here is exactly the drift this codebase
// has been bitten by before.
import { datelineText, DEFAULT_BODY_FONT_PX } from '../layout/text-flow.js';
import { columnGutterPx } from './compose.js';
import { blockExpectsCopy } from '../layout/block-kinds.js';
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
 * ...and for a long time NOTHING fell through, which is the fault the desk
 * reported ("for big news block paragraph should be vertical"). `column_count`
 * was NOT NULL DEFAULT 1, so every row in the table carried an explicit 1 and
 * this function's whole second half was unreachable: the front page's 268 px
 * anchor - 134 mm - was set as one column of type, and no newspaper prints a
 * 134 mm measure. NULL means "the desk has not said" now (schema.sql), and it
 * is the ordinary state.
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
// What one text column should measure, in editor px.
//
// Taken off the customer's own printed front page rather than reasoned about:
// 1920 px across 330 mm, five columns of 358 px separated by 22 px gutters -
// 59 mm a column. At 2 px/mm that is 118 px, and 120 rounds it to the page's
// own step. A TARGET, not a floor: the count is whichever whole number of
// columns comes nearest to it.
const TARGET_COLUMN_PX = 120;

// ...and the floor, which is in EMS because that is the unit legibility is in.
//
// The target alone is not enough, and the block that proves it is the front
// page's 190 px second lead. It is already a proper newspaper column - 11.8 em,
// 27 characters to the line, measured. Split in two by the target it becomes
// 5.4 em, and the pour sets NOTHING in it: two columns nothing can be written
// into is worse than one that is a shade wide.
//
// 10 em is a shade under this paper's own JUSTIFY_MIN_EM (13, the width below
// which justification starts producing rivers), and deliberately so: a column
// under 13 em is set flush left, which is how every printed newspaper sets a
// narrow one, but a column under about 10 em cannot hold a Marathi word and a
// half. Measured on real blocks: 10.6 em sets 23 characters to the line, which
// is a printed column; 5.4 em sets none.
const MIN_COLUMN_EM = 10;

/**
 * The most columns this block could be set in and still hold a word.
 *
 * The floor was already inside measureColumns() and could only ever protect
 * the AUTO path - an explicit count short-circuits before it. So Properties ->
 * Columns offered 1-4 on every block, and on a narrow one 2, 3 and 4 all set
 * NOTHING: measured on a real 150 x 264 lead in 12px type, every count above
 * one composes 0 body lines, NO_LEGAL_MEASURE, BODY_OVERSET, and the Space
 * panel reads "Room for copy 0-0 characters". A control that offers a choice
 * which cannot work is the same fault as the old number input that could not
 * say "auto" - so the rule is lifted out here and the control asks it.
 *
 * `MIN_COLUMN_EM` is the floor and the 190px second lead is why it exists:
 * one column is 11.8 em, and split in two it is 5.4 em and the pour sets
 * nothing. See CLAUDE.md, "A wide block sets in COLUMNS".
 */
export function maxLegibleColumns(section, view, widthPx, ceiling = 4) {
  const margin = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12);
  const bodyPx = positive(
    pick(section, view, 'bodyFontPx', 'body_font_px', DEFAULT_BODY_FONT_PX),
    DEFAULT_BODY_FONT_PX,
  );
  const usable = Math.max(0, widthPx - 2 * margin);
  const gutter = columnGutterPx(bodyPx);
  const floorPx = MIN_COLUMN_EM * bodyPx;

  let count = Math.max(1, Math.floor(ceiling));
  while (count > 1 && (usable - gutter * (count - 1)) / count < floorPx) count -= 1;
  return count;
}

function explicitColumnCount(section, view) {
  const explicit = Number(pick(section, view, 'columnCount', 'column_count', undefined));
  return Number.isInteger(explicit) && explicit >= 1 ? explicit : null;
}

export function measureColumns(section, view, widthPx) {
  const explicit = explicitColumnCount(section, view);
  if (explicit !== null) return explicit;

  const margin = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12);
  const usable = Math.max(0, widthPx - 2 * margin);

  // Nearest to the printed target, then held to the widest count that can
  // still be read - one floor rule, stated once, in maxLegibleColumns().
  const wanted = Math.max(1, Math.round(usable / TARGET_COLUMN_PX));
  return Math.min(wanted, maxLegibleColumns(section, view, widthPx, wanted));
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
// 2 mm, which with the box's own rule puts the type a little over 3 mm inside
// it - what a printed panel sets.
const BOX_INSET_PX = 4;

export function composeSection(section = {}, view = {}) {
  const width = positive(section.width_px ?? section.width, 0);
  const height = positive(section.height_px ?? section.height, 0);
  // A block that is BOXED sets its type inside the box, not against it.
  //
  // The box is ink on the page - a printed one insets its type 3-4 mm inside
  // the rule, the way a printed panel does. Composed with the block's ordinary
  // margin alone, the type sat 4 px from the block's edge and the box's own
  // ink took 1.5 of those, so a boxed brief on the front page set 1.25 mm from
  // a black rule: visibly cramped at 200%, and the one block on the page whose
  // separator is not a hairline in a gutter but a line the copy is inside.
  //
  // Only for a full box. A `rule` block carries a hairline on ONE edge and the
  // composition's padding is a single number for all four - insetting the
  // other three to clear a rule they do not have would be worse.
  const border = String(pick(section, view, 'borderStyle', 'border_style', 'none') || 'none');
  const boxInset = border === 'box'
    ? BOX_INSET_PX + positive(pick(section, view, 'borderWidthPx', 'border_width_px', 1), 1)
    : 0;
  const padding = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12) + boxInset;
  const bodyFontPx = positive(
    pick(section, view, 'bodyFontPx', 'body_font_px', DEFAULT_BODY_FONT_PX),
    DEFAULT_BODY_FONT_PX,
  );
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

  const expectsCopy = blockExpectsCopy(section.block_type ?? section.blockType ?? view.blockType);
  const preferredColumns = measureColumns(section, view, width);
  const explicitColumns = explicitColumnCount(section, view);
  const input = {
    width,
    height,
    padding,
    // Display type carries the sub-editor's marks too, and for exactly the
    // reason the body does: a bolded name in a headline is set in a real bold
    // face, and a real bold Devanagari word is 5-8% wider than its regular
    // ghost. These went through plainText() before, which threw the marks
    // away, so the one place a desk could emphasise a word - the story - was
    // also the only place it printed.
    kicker: textWithMarks(pick(section, view, 'kicker', 'kicker', '')),
    headline: textWithMarks(pick(section, view, 'headline', 'headline', '')),
    subheading: textWithMarks(pick(section, view, 'subheading', 'subheading', '')),
    // The dateline is part of the flow it opens.
    body: { text: bodyText, marks: bodyMarks },
    // Whether this block is MEANT to hold copy, from the one catalog that
    // says what each block kind is for. A full-bleed advert leaves no column
    // wide enough to set type in and that is the finished advert, not a
    // fault - see NO_LEGAL_MEASURE in compose.js.
    expectsCopy,
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
    // The display objects' own alignment (schema.sql's headline_align /
    // subheading_align). Separate from textAlign above because they are
    // separate objects: `text_align` is the BODY's, and treating it as the
    // block's is what made the desk's alignment buttons act on the copy while
    // the headline was the thing selected. Left empty when the desk has never
    // said - compose.js then sets them the paper's own way.
    headlineAlign: pick(section, view, 'headlineAlign', 'headline_align', '') || '',
    subheadingAlign: pick(section, view, 'subheadingAlign', 'subheading_align', '') || '',
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
    // Whether the headline may be set LARGER than asked in order to fill its
    // measure (compose.js's HEADLINE_FILL_TARGET). Left undefined - and so
    // on - unless a caller states otherwise; the two that do are the engine's
    // own overset fallback and the measurements that need a fixed baseline.
    headlineGrowth: pick(section, view, 'headlineGrowth', 'headline_growth', undefined),
    deckMaxLines: pick(section, view, 'deckMaxLines', 'deck_max_lines', undefined),
    letterSpacingPx: Number(pick(section, view, 'letterSpacingPx', 'letter_spacing_px', 0)) || 0,
    columnCount: preferredColumns,
    headlineLocked: Boolean(pick(section, view, 'headlineLocked', 'headline_locked', false)),
    subheadingLocked: Boolean(pick(section, view, 'subheadingLocked', 'subheading_locked', false)),
    images: obstaclesOf(section),
  };

  const preferred = composeBlock(input);
  preferred.columnDecision = {
    mode: explicitColumns === null ? 'auto' : 'explicit',
    preferred: preferredColumns,
    resolved: preferred.columns.length,
  };

  // Auto is allowed to react to the copy; an explicit count is not. Width is
  // still the professional first choice, but a photograph can make that
  // nominal count hold LESS copy than the next count down. If the preferred
  // Auto setting actually oversets, try the remaining legal settings against
  // the same words and the same image scanlines, and take the highest count
  // that prints every word. This is deliberately a fallback, not a fill
  // trick: copy that merely ends short never makes the columns jump around.
  if (explicitColumns === null && preferredColumns > 1 && expectsCopy && bodyText.trim() && bodyOverset(preferred)) {
    for (let count = preferredColumns - 1; count >= 1; count -= 1) {
      const candidate = composeBlock({ ...input, columnCount: count });
      if (bodyOverset(candidate)) continue;
      candidate.columnDecision = {
        mode: 'auto', preferred: preferredColumns, resolved: count, reason: 'copy-fit',
      };
      candidate.warnings.push({
        code: 'AUTO_COLUMNS_REDUCED_FOR_COPY',
        detail: `Auto chose ${count} ${count === 1 ? 'column' : 'columns'} instead of ${preferredColumns}: `
          + 'this is the highest count that sets every word around the pictures in this block.',
      });
      return candidate;
    }
  }

  return preferred;
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

/** Longest-line headline fill: one full line plus a short close is normal. */
export function headlineFill(result) {
  const lines = result?.bands?.headline?.lines || [];
  if (!lines.length) return 1;
  return Math.max(...lines.map((line) => (line.measure > 0 ? line.width / line.measure : 0)));
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
