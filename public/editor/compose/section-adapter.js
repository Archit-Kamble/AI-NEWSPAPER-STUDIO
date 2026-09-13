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

import { composeBlock, headlineBandFit } from './compose.js';
import { clusters } from './graphemes.js';
import { textWithMarks } from '../layout/rich-text.js';
// The dateline opens the body and therefore occupies the body's room, so it
// is composed as part of the flow. One definition, in the module that has
// always owned it - a second copy here is exactly the drift this codebase
// has been bitten by before.
import { datelineText, DEFAULT_BODY_FONT_PX } from '../layout/text-flow.js';
import { columnGutterPx } from './compose.js';
import { blockExpectsCopy } from '../layout/block-kinds.js';
// Which headline treatments lay a coloured panel down - the same lookup
// render.js and print-model.js use to decide whether to draw one, reached
// here to decide whether the block needs to give that panel room.
import { groundedBands, headlineTreatment } from '../layout/inks.js';
// A side-effect module shared with Scribus, so it installs onto globalThis
// rather than exporting - the canvas and the print path must use one caption
// geometry, and that predates this engine.
import '../layout/caption-geometry.js';

const { captionBox } = globalThis.SahasCaptionGeometry;
import '../layout/borders.js';
const { isBoxed, borderThicknessPx, canRound, borderRadiusPx } = globalThis.SahasBorders;
import '../layout/inset-panels.js';
const { panelsOf, obstacleFromPanel } = globalThis.SahasInsetPanels;
import '../layout/page-overlays.js';
import { cornerObstacles, roundedCornerObstacles } from '../layout/block-shapes.js';
const { overlaysOf, overlayObstaclesFor } = globalThis.SahasPageOverlays;

function pick(section, view, camel, snake, fallback) {
  for (const source of [view, section]) {
    if (!source) continue;
    if (source[camel] !== undefined && source[camel] !== null && source[camel] !== '') return source[camel];
    if (source[snake] !== undefined && source[snake] !== null && source[snake] !== '') return source[snake];
  }
  return fallback;
}

/**
 * THE SAME LOOKUP FOR COPY, where an empty string is a VALUE and not a silence.
 *
 * pick() treats '' as "the desk has not said", which is right for a font
 * family or an alignment and wrong for the words. Measured on a real block:
 * a sub-editor puts the caret in the story, presses Ctrl+A and Delete, and
 * the draft's body goes 490 characters to 0 and saves - and the Block Editor's
 * own page went on setting all thirteen lines of the deleted copy, because ''
 * fell through to the row it still held. The canvas was right only by luck:
 * it composes against the store's row, which autosave had already replaced.
 *
 * Taking a reporter's story that carries no body does it too, and that is how
 * this was found - the canvas set the dateline alone while the Block Editor
 * set the previous story underneath it.
 *
 * So: absent means absent, and empty means empty. A view that does not carry
 * the key at all still reads the row, which is what every server-side caller
 * relies on (composeSection(row, {}) in preflight, worklist and copyFit).
 */
function pickText(section, view, camel, snake, fallback) {
  for (const source of [view, section]) {
    if (!source) continue;
    if (source[camel] !== undefined && source[camel] !== null) return source[camel];
    if (source[snake] !== undefined && source[snake] !== null) return source[snake];
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

// ...and the CEILING, which is what the overset fallback below is held to.
//
// The fallback walks the count down until the copy stops oversetting, and it
// had no floor at all - so on a 620 px banner whose copy oversets at 2, 3, 4
// and 5 columns it went all the way to ONE, and set a 310 mm line. That is the
// exact fault this file's own header calls out for the 268 px anchor ("no
// newspaper prints a 134 mm measure"), arriving by the back door: not from a
// stored count, but from a fallback with nowhere to stop.
//
// Twice the printed target is a broadsheet's widest defensible measure. Beyond
// it the eye loses the line's start on the way back from its end, which is the
// thing column rules exist to prevent.
//
// The trade this makes is deliberate and it is the honest one. Overset is a
// COPY problem: the desk trims it, or the fit action sets it tighter, and both
// of those are ordinary work that the block reports for. A 310 mm measure is a
// DESIGN failure that no amount of editing fixes - the words are all on the
// page and the page is still wrong. So the fallback is allowed to give up on
// avoiding overset, and is not allowed to give up on the measure.
//
// IN EMS, exactly like MIN_COLUMN_EM above and for exactly the same reason:
// that is the unit legibility is in, and a pixel bound cannot tell the two
// cases apart. Written in pixels first (2 x TARGET_COLUMN_PX), it broke the
// cut-out fixture in copyFit.test.js, which is a 268 px block set in 12 px
// type - 22 em, a perfectly printable measure that legitimately falls back to
// ONE column around its silhouette. The 620 px banner is 97 em in one column
// because its type is 6.4 px. Same pixel width bound, opposite verdicts
// needed; only the em bound gets both right.
//
// 30 em, and the number is pinned from both sides by things already written
// down here. TARGET_COLUMN_PX is 120 px, which at the 6.4 px running body is
// 18.75 em - a normal column, and the bound must sit well above it. And this
// file's own header condemns the 268 px anchor at "134 mm... 48 characters to
// the line", which is 41.5 em - so the bound must sit below THAT, or the
// fallback is still allowed to produce the exact measure the header calls
// unprintable. 30 em is between them: about 75 characters of Marathi, the top
// of the comfortable range.
//
// Measured across 141 wide Auto blocks carrying copy: 4 were setting at 48-97
// em, and the other 137 are untouched because the fallback never reaches the
// floor on them.
const MAX_COLUMN_EM = 30;

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
export function obstaclesOf(section, view = {}) {
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
  // A panel set inside the story - the चौकट a printed paper puts a fact box or
  // a pull quote in. To the compositor it is a rectangle and nothing else, so
  // it costs exactly one more entry here and no other line of the engine
  // changes: fillRow, viableIntervals and the balancer all already run type
  // round rectangles, because that is what a photograph is to them.
  // The draft's panels when there is a draft, exactly as every other field is
  // resolved. Reading the row alone meant the copy did not run round a panel
  // the desk had just placed until the edition was reloaded - so the block on
  // screen and the block that would print were two different blocks for as
  // long as the desk was looking at it.
  for (const panel of panelsOf({ ...section, inset_panels: view?.insetPanels ?? section?.inset_panels })) {
    out.push(obstacleFromPanel(panel));
  }
  // A picture placed on the PAGE that crosses into this block. It is the page's
  // (layout/page-overlays.js explains why it cannot be the block's), but a
  // block it overlaps still has to set its type clear of it - a photograph laid
  // over a column without the column moving is a photograph printed on top of
  // the news. Blocks the rectangle does not touch get nothing, which is the
  // condition that keeps one overlay from reaching a story it does not cover.
  out.push(...overlayObstaclesFor(section, overlaysOf({
    overlay_images: section.page_overlays ?? section.pageOverlays,
  })));
  // THE BLOCK'S OWN CORNERS, when its frame is not a plain rectangle
  // (block-shapes.js). Coordinates are BLOCK-LOCAL - (0,0) at the block's own
  // top-left, exactly the space every image obstacle above is already in
  // (a placed picture's x_px/y_px are an offset within its block, never a
  // page-absolute position) - so a cut corner needs no translation, only the
  // block's own width and height.
  const shapeKey = view?.frameShape ?? section?.frame_shape;
  if (shapeKey) {
    out.push(...cornerObstacles(shapeKey, 0, 0, Number(section.width_px) || 0, Number(section.height_px) || 0));
  } else {
    // A ROUNDED corner is the same fault a cut one already had a fix for,
    // one level softer: canvas.js's own --block-radius rounds the block's
    // real overflow clip (.newspaper-section is overflow:hidden and must
    // be), so a Pill block that composed as a plain rectangle set type
    // straight into the curve and the browser silently clipped it away -
    // visible only as a story that read as complete on screen and printed
    // with its last words missing. THE SHAPE TAKES PRECEDENCE (the `else`):
    // print-model.js's blockRules() already ignores the radius the moment a
    // frame_shape is set, so a cut corner and a rounded one are never both
    // in effect on the one block.
    const borderStyle = String(pick(section, view, 'borderStyle', 'border_style', 'none') || 'none');
    if (canRound(borderStyle)) {
      const radius = borderRadiusPx(pick(section, view, 'borderRadiusPx', 'border_radius_px', 0));
      out.push(...roundedCornerObstacles(radius, 0, 0, Number(section.width_px) || 0, Number(section.height_px) || 0));
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
  // The whole thickness, which for a double rule is two rules and the gap
  // between them. Insetting by one rule's width puts the inner rule of a
  // double box on the story's first line.
  //
  // AND IT IS A FLOOR, NOT AN ADDITION. Added to the block's own margin, which
  // is what this did, ruling a block RE-SET ITS COPY: the desk's report was
  // "if we are adding border it should not make impact on inside text but it
  // is making". It was right, and the arithmetic says why. The default margin
  // is 12 px - 6 mm - and a box needs its type about 3 mm inside the rule, so
  // the room a printer wants was ALREADY THERE twice over; adding 5.5 more
  // narrowed the measure by 11 px, rebroke every line and could push a block
  // that fitted into overset for no typographic reason at all.
  //
  // So the box asks for a MINIMUM and the margin usually already meets it.
  // A block set tight - margin 1 or 2, which the control allows - still gets
  // its type pushed clear of the rule, because there the box's need really is
  // the larger number. Ruling a block now changes its composition only when
  // leaving it alone would print type on ink.
  const margin = positive(pick(section, view, 'marginPx', 'margin_px', 12), 12);
  const boxInset = isBoxed(border)
    ? BOX_INSET_PX + borderThicknessPx(border, pick(section, view, 'borderWidthPx', 'border_width_px', 1))
    : 0;
  // A COLOURED HEADLINE PANEL wants the same room a box does, and for the
  // same reason: a panel with no gap from the block's bare edge reads as
  // touching it, where a bare 1 px margin never has to answer for that with
  // ordinary text - a printed word has white space inside its own glyphs, a
  // solid fill has none. `reverse` and the three `band` treatments
  // (inks.js's HEADLINE_STYLES) all paint one. A block already boxed gets no
  // more than the box already gave it - Math.max below is the whole rule.
  const headlineStyle = String(pick(section, view, 'headlineStyle', 'headline_style', 'plain') || 'plain');
  const panelInset = headlineStyle === 'reverse' || groundedBands(headlineStyle).length
    ? BOX_INSET_PX
    : 0;
  const padding = Math.max(margin, boxInset, panelInset);
  const bodyFontPx = positive(
    pick(section, view, 'bodyFontPx', 'body_font_px', DEFAULT_BODY_FONT_PX),
    DEFAULT_BODY_FONT_PX,
  );
  // The dateline is read the same way every other field is - the view first,
  // then the row - and it is the ONLY field that used to read `view` alone.
  //
  // That made composeBlock()'s "one answer" untrue across callers: the page
  // canvas builds its view with flowViewFromSection(), which carries location
  // and author, so the page set the dateline and found room for it; every
  // server-side caller that composes a STORED row with an empty view
  // (preflight, the worklist's quoted capacity, copyFit's settle loop, the
  // placement repair) measured the same block with no dateline at all - one
  // whole body line shorter than what prints. Measured on this edition's own
  // 150x176 blocks: 11 lines against 12, and a block the settle loop called
  // 100% set really sets 90%.
  const prefix = datelineText({
    // THE DATELINE'S OWN FIELDS ARE COPY TOO, and go through pickText for the
    // same reason the story does: a block whose location has been cleared -
    // or a reporter's story that carries none - must set the dateline it
    // actually has, not the one the row used to hold. Found the same way,
    // one field further on: after the body was fixed, taking a story with no
    // location left the canvas setting "■ reporter" and the Block Editor
    // "■ पाटण, reporter", which is a different dateline, a different measure
    // and a different number of lines on the two surfaces.
    //
    // `author` reads a different key on each side (the view's `author`, the
    // row's `reporter_name`), so it needs both names.
    location: pickText(section, view, 'location', 'location', ''),
    author: pickText(section, view, 'author', 'reporter_name', ''),
    // Read the same way every other field is - the view first, then the row -
    // and it has to be carried into this literal, because datelineText() can
    // only decline a dateline for an object that tells it it may.
    showDateline: pick(section, view, 'showDateline', 'show_dateline', true) !== false,
    datelineStyle: pick(section, view, 'datelineStyle', 'dateline_style', null),
  });

  // Bold/italic/underline runs, not flattened away before composition sees
  // them. `plainText()` and `textWithMarks()` share the same tag/newline/
  // entity normalisation pipeline (rich-text.js), so `withMarks.text` is
  // character-for-character the same string `plainText()` would have
  // produced - only marks are additionally carried. The dateline prefix has
  // no marks of its own, so every mark's offset shifts forward by exactly
  // its length.
  const withMarks = textWithMarks(pickText(section, view, 'body', 'body', ''));
  const bodyText = prefix + withMarks.text;
  const bodyMarks = withMarks.marks.map((mark) => ({
    ...mark,
    start: mark.start + prefix.length,
    end: mark.end + prefix.length,
  }));
  // THE DATELINE IS SET BOLD, SO IT IS MEASURED BOLD.
  //
  // The comment above ("the dateline prefix has no marks of its own") stopped
  // being true when the dateline became furniture the three PAINT surfaces set
  // in a real bold face - render.js, print-model.js and scribus.service.js all
  // add it through `marksWithDateline()`. Nothing added it here, which is the
  // measuring side, so the compositor reserved the width of the dateline's own
  // regular-weight ghost: measured through the shaper at the running 6.4px
  // body, a real dateline sets **2.4-3.4px wider than that**, 6.5-6.9%.
  //
  // On a justified first line that is an overhang into a 6px gutter, and it is
  // exactly the fault this file's own neighbours already record - "a bold
  // phrase is reserved the width of its own regular-weight ghost"
  // (measurePieceWidth), and "a weight the solver did not measure is a second
  // geometry" (the almanac's 600-weight cell, 7.6%).
  //
  // The mark is stated in the ADAPTER's own coordinates, which put the prefix
  // at [0, prefix.length) - deliberately not `marksWithDateline()`, whose
  // negative range belongs to the paint surfaces' convention, where authored
  // marks keep their stored offsets. The two spaces differ; the ink does not.
  if (prefix.length) bodyMarks.unshift({ tag: 'b', start: 0, end: prefix.length });

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
    kicker: textWithMarks(pickText(section, view, 'kicker', 'kicker', '')),
    headline: textWithMarks(pickText(section, view, 'headline', 'headline', '')),
    subheading: textWithMarks(pickText(section, view, 'subheading', 'subheading', '')),
    // The dateline is part of the flow it opens.
    body: { text: bodyText, marks: bodyMarks },
    // How much of that flow is furniture rather than the reporter's copy. The
    // engine needs it for one decision - a drop cap cannot be taken out of a
    // dateline (compose.js says why) - and for nothing else.
    datelineLength: prefix.length,
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
    // The DISPLAY face, which is a separate decision from the body's and
    // reads a separate column. Empty/absent means the paper's own sans, so
    // every existing row composes exactly as it did.
    displayFamily: pick(section, view, 'displayFamily', 'display_family', ''),
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
    // A treatment may set the kicker larger than the body (a separator chip, a
    // section label). Absent is the compositor's own 1.05, byte for byte.
    kickerScale: Number(headlineTreatment(headlineStyle)?.kickerScale) || null,
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
    // The initial letter, in LINES (schema.sql's drop_cap_lines). 0 - which is
    // what every existing row carries - is no drop cap, so no stored block's
    // composition changes by this existing at all.
    dropCapLines: Math.max(0, Number(pick(section, view, 'dropCapLines', 'drop_cap_lines', 0)) || 0),
    // A numbered or bulleted list in RUNNING COPY. Read from the row like
    // every other field - it is the desk's own setting and 'none' is what
    // every existing block carries, so nothing recomposes on the strength of
    // this existing.
    listStyle: pick(section, view, 'listStyle', 'list_style', 'none') || 'none',
    // 'as-written' keeps the reporter's paragraphs exactly; NULL is the
    // compositor's own merging and splitting (paragraph-policy.js).
    paragraphPolicy: pick(section, view, 'paragraphPolicy', 'paragraph_policy', null),
    // How many lines the display type may take. Left at the engine's own
    // defaults unless a caller states them - `headline-reserve.js` does, so
    // that the reservation and the real block are measured the same way.
    headlineMaxLines: pick(section, view, 'headlineMaxLines', 'headline_max_lines', undefined),
    // The display flows' leading when the block states one (a page measured
    // off a scan does); absent is the engine's own, so nothing else moves.
    displayLineHeight: Number(pick(section, view, 'displayLineHeight', 'display_line_height', 0)) || undefined,
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
    images: obstaclesOf(section, view),
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
    // Never below the count that keeps the measure printable - see
    // MAX_COLUMN_EM. `ceil`, not `round`: the floor is a hard bound on how wide
    // a column may get, and rounding down would step past it.
    const usable = Math.max(0, width - 2 * padding);
    const floorCount = Math.max(1, Math.ceil(usable / (MAX_COLUMN_EM * bodyFontPx)));
    for (let count = preferredColumns - 1; count >= floorCount; count -= 1) {
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
    // Nothing in the legal range printed every word. The block keeps its
    // PREFERRED count and reports the overset, which is the honest answer: the
    // copy is too long and the desk trims it or sets it tighter, both of which
    // are ordinary work. Returning a wider arrangement instead would let copy
    // LENGTH change the block's design - the mirror image of the rule this
    // fallback already holds in the other direction ("copy that merely ends
    // short never makes the columns jump around"), and the reason the two
    // halves are stated together.
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

/** Complete headline-line fit: full working lines plus a legal short close. */
export function headlineFill(result) {
  return headlineBandFit(result?.bands?.headline).fill;
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
