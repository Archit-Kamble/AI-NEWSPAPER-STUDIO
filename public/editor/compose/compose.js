// One composition. One answer. Every surface reads it.
//
// This is the exact authority the whole project was missing. Before it, the
// page canvas, the Block Editor, the fit action, the worklist, preflight and
// the AI brief each worked out for themselves how much copy a block holds and
// where the lines fall - from a character grid whose cell width was a
// constant. They could not help disagreeing, and the disagreements were the
// bugs: a block that reported 98% full while visibly empty at the bottom, an
// editor that broke lines somewhere the page did not, copy that escaped its
// frame.
//
// composeBlock() takes a frame, its copy, its type and its photographs and
// returns ONE object saying exactly where every line sits. It touches no DOM,
// no canvas and no layout engine: it is arithmetic over the real font's own
// SHAPED advances (shaper.js, real HarfBuzz - see that file's header for why
// summed hmtx advances are not the same number) and over interval geometry
// (intervals.js, exclusion.js). So it produces the same numbers in Node and
// in the browser, and "the editor renders the same as the page" stops being a
// property that has to be tested and becomes one that cannot fail - both
// draw the same list of positioned lines.
//
// THE VERTICAL MODEL IS DYNAMIC. Nothing reserves a fixed rectangle. The
// headline is shaped, its real line count is counted, and the deck starts
// underneath it - so a one-line headline gives the body the second line back
// instead of leaving it empty. Reserved-rectangle thinking is what produced
// the phantom rows this replaces.

import { measureWidth as hmtxWidth, minLineHeightFor, faceAscent, faceDescent, fontsReady, publicationWeight } from './font-metrics.js';
import { shapeWidthPx, isShaperReady } from './shaper.js';
import { breakPieces, clusters, trimEndClusters } from './graphemes.js';
import { planParagraphs, mayNeedPolicy, MAX_PARAGRAPH_LINES, MAX_PARAGRAPH_SENTENCES } from './paragraph-policy.js';
import { subtract, viableIntervals, MIN_CORRIDOR_EM } from './intervals.js';
import { bandObstacles, imageFingerprint } from './exclusion.js';

export const ENGINE_VERSION = 'sahas-compose/2';

// One measurement function, everywhere in this file. Real HarfBuzz shaping
// when it has loaded; the font's own hmtx advances (font-metrics.js) as a
// same-shape, slightly-wide fallback for the moment before it has - never a
// guessed constant. See shaper.js for exactly how much this matters for
// conjunct-heavy Marathi (up to +80% on a bare summed-advance measurement).
function measure(text, fontPx, family, weight, letterSpacingPx = 0) {
  const base = isShaperReady() ? shapeWidthPx(text, fontPx, family, weight) : null;
  const width = base !== null ? base : hmtxWidth(text, fontPx, family, weight);
  if (!letterSpacingPx) return width;
  // Applied between clusters, not codepoints - a matra sits on its base and
  // must not be pushed away from it by its own extra gap, the same akshara
  // boundary graphemes.js already enforces for line-breaking. N clusters have
  // N-1 gaps between them; letter-spacing is never added after the last one.
  const gaps = Math.max(0, clusters(text).length - 1);
  return width + gaps * letterSpacingPx;
}

// Headline, kicker and deck are always set in the sans face, at the weights
// the stylesheet actually declares (.section-headline/.section-kicker are
// font-weight:700, .section-subheading is 400) - this is not a per-block
// choice, it is the paper's own type system, the same way a real newspaper's
// headline face is not the reporter's to pick. Composing them in whatever
// family the body happened to be reserved room in was reserving room for the
// wrong glyphs; Latin and Devanagari faces at the same size do not agree on
// width (a Georgia body override does not touch the headline at all - see
// styles.css, which never makes that face conditional).
const DISPLAY_TYPOGRAPHY = {
  kicker: { family: 'sans', weight: 700 },
  headline: { family: 'sans', weight: 700 },
  deck: { family: 'sans', weight: 400 },
};

// Optical space between one editorial flow and the next, in ems of the
// LARGER of the two - a gap under a 34px headline and a gap under a 16px deck
// are not the same gap. These are transition-aware rather than one uniform
// margin: the space a printer leaves between a headline and its deck is
// visibly tighter than between a deck and the body, because the first pair
// belongs together and the second pair does not.
const GAP_EM = {
  'kicker>headline': 0.18,
  'headline>deck': 0.22,
  'headline>body': 0.5,
  'deck>body': 0.42,
  'kicker>body': 0.4,
};

// A headline may not eat its own block. Shared with typeScaleFor() in
// src/layout/geometry.js, which sets the default type from the block's size
// on the same principle: a full-width banner whose headline consumes the
// whole block leaves a character budget of zero, which is a hole nothing can
// be written into.
const MAX_HEADLINE_SHARE = 0.5;

// The whole display block - kicker, headline and deck together - against the
// block's own room. geometry.js has always said what this should be ("a
// headline is assumed to wrap to two lines ... and it may not take more than
// half of what the block has. The other half is the story"), but nothing
// enforced it on the DISPLAY as a whole: each flow was capped against its own
// share measured from wherever the previous one ended, so a headline at its
// 50% and a deck at its 70% of what remained could between them take far more
// than half the block. Measured across 659 real article blocks with a headline
// and copy in them: 67 spent more than 40% of the block on display type and 12
// spent more than half - which is the "headline and subheadline are half the
// block" a desk reported.
const MAX_DISPLAY_SHARE = 0.5;

// A headline runs to TWO lines - PREFERRED, not enforced (see
// fitDisplayFlow's two passes: a narrow one-column block that cannot set its
// words in two at any legible size gets its third and fourth rather than
// having words pushed off the block, because overset is always worse).
//
// This is not a new opinion - it is what
// src/layout/geometry.js has always assumed when it chose the block's default
// headline size (`HEADLINE_LINES = 2`). The engine allowed four, so the sizing
// and the setting disagreed: typeScaleFor() picked a size on the basis of two
// lines and the engine cheerfully set three, which both stole the block's
// depth and left every line of the headline short of its own measure.
//
// A headline is written to a COUNT - a sub-editor sizes it to the column, and
// a headline that stops two-fifths short of its measure reads as unfinished.
// Holding the line budget is what makes the fit happen: over the budget is a
// failure, so fitDisplayFlow() steps the size down until it sets in two, and
// the size it lands on is the one whose longest line comes closest to filling.
//
// Measured on the real 268x248 lead a desk reported: 24px set THREE lines at
// 54%, 53% and 53% of their measure, taking 50% of the block. Held to two, it
// sets at 22px - 95% and 46% - taking 33%. Across 659 real article blocks:
// 134 three-line headlines to none, mean headline fill 68.4% to 71.7%, mean
// display share 21.3% to 18.4%, and blocks spending over 40% of themselves on
// display type from 67 to 13.
//
const HEADLINE_MAX_LINES = 2;

// ------------------------------------------- the headline fills its measure ---
//
// Holding the two-line budget stopped a headline eating half the block. It
// did not make the headline FILL, and a desk photographed what was left: a
// 268x248 lead whose headline set "*वाई* मध्ये मुलांचे / वृक्षारोपण" at 85% and
// 52% of their own measures, with a hand's width of white down the right of
// both. That is not a small blemish - a ragged right edge under a column rule
// is the first thing a reader's eye finds on a front page.
//
// It is the oldest job on the desk and it has exactly one lever. A sub-editor
// writes a headline to a COUNT so that it fills the measure; the words here
// belong to the reporter and cannot be rewritten, so the lever left is the
// SIZE. Every page-layout tool has this move - InDesign ships "fit headline
// to frame" - and it is what a compositor does when the copy comes in short.
//
// fitDisplayFlow() only ever stepped DOWN, because the requested size is a
// preferred MAXIMUM (that is the contract fit.service.js shrinks type
// against, and it must not change). So a headline that came in short stayed
// short however much room the block had. This adds the other direction, and
// only in the direction of FILLING: a headline already at its measure never
// moves.
//
// Measured across 300 real article blocks carrying a headline and copy: 216
// of them set their longest line under 92% of its measure, and letting the
// size grow closes 210 of those - mean longest-line fill 74.7% -> 95.6%.
const HEADLINE_FILL_TARGET = 0.92;

// How far a headline may grow to reach that.
//
// This is a HIERARCHY bound, not a typographic one. A page reads as one page
// because the bigger block shouts louder, and geometry.js encodes that in
// `byMeasure = width/11` - the block's width IS its rung. Growth reorders the
// rungs whenever a narrow block overtakes a wider one, which happens exactly
// when the growth factor exceeds the ratio of their widths. Capped at a
// quarter, only blocks within 25% of each other's width can trade places, and
// two blocks that close in size are not carrying the page's hierarchy between
// them anyway. Uncapped, the measured factors ran to 2.0x - a single-column
// filler set larger than the lead, which is a worse fault than the gap this
// closes.
// Chosen by measuring both sides of it across all 5084 real blocks that carry
// a headline and all 429 real pages that carry more than one, not by taste.
// "lead beaten" is a page where a SMALLER block ends up shouting louder than
// the biggest block on it - the fault this bound exists to prevent:
//
//     cap    grew    at/over 92% filled    lead beaten (of 429)
//     off      -           1089                   46
//     1.15    23%          2237                   47
//     1.25    33%          2787                   50
//     1.40    41%          3186                   82
//     1.60    55%          3886                  275
//
// The knee is unmistakable. 1.25 takes two and a half times as many headlines
// to a filled measure for four more pages; 1.40 costs nine times that for one
// sixth more; 1.60 wrecks two pages in three. (46 pages are already beaten
// with growth switched off entirely - a long headline on a big block is
// auto-fitted DOWN past a short one on a small block, which is the same fault
// arriving from the other direction and is not something this cap can fix.)
const HEADLINE_GROWTH_CAP = 1.25;

// The absolute ceiling on display type, matching the clamp geometry.js
// already applies when it picks a block's default headline size: above this a
// full-width strip stops being a headline and starts shouting. One number,
// two places that must agree about it.
const MAX_DISPLAY_PX = 40;

// Display type is set flush left unless the desk says otherwise. That is what
// a Marathi daily does, and what this engine already did by accident before
// the alignment was wired through at all.
export const DEFAULT_DISPLAY_ALIGN = 'left';

// The floor preflight fails a page for: newsprint will not legibly hold
// anything under 6.5 PT. This project's logical px is 2 per mm (see
// geometry.js/pxToMm), so 6.5pt converts to 6.5 * 25.4/72 * 2 = 4.6 logical
// px - NOT 6.5 taken directly as a pixel count, which was this constant's
// actual bug: it enforced a floor 41% too high, and silently disagreed with
// fit.service.js's own separately-hand-derived 4.6, which was correct. A
// candidate size fit.service.js considered legal (say 5.0px, comfortably
// above 4.6) was being silently clamped back up to 6.5 the moment it reached
// composeBlock() - so fit's own "does 5.0px fit?" question was actually
// answered by composing at 6.5px, a different question. One shared constant,
// imported by both, so this cannot happen again.
export const MIN_LEGIBLE_PX = 4.6;

// More than this many body lines of usable room left unfilled is a hole
// somebody has to answer for rather than the natural remainder of setting
// type on a grid. Matches HOLE_LINES in storyWriter.service.js, deliberately:
// the number that triggers a second paid AI call and the number the desk sees
// flagged must be the same number.
export const HOLE_LINES = 4;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// --------------------------------------------------------------- one band ---

/**
 * Sets one flow (a headline, a deck, a kicker) as whole wrapped lines,
 * starting at `top`, keeping clear of the photographs.
 *
 * Display type is set across the measure rather than poured through the body
 * grid: a headline broken piece by piece cannot wrap, cannot carry the
 * painted word and clips its own vowel signs. What it shares with the body is
 * the exclusion geometry - it dodges a picture standing in its rows exactly
 * as the copy does.
 */
function setDisplayFlow(text, {
  top, bottomLimit, column, images, fontPx, lineHeight, family, weight, maxLines, letterSpacingPx = 0,
  align = 'left', marks = null,
}) {
  const pieces = breakPieces(text);
  if (!pieces.length) return { lines: [], height: 0, bottom: top, overset: '', lineCount: 0, violations: [] };

  const bandHeight = fontPx * lineHeight;
  const lines = [];
  const violations = [];
  let index = 0;
  // Where each line's text starts in the flow's own plain text. breakPieces()
  // TILES the source (every cluster lands in exactly one piece, whitespace
  // attached to the word it follows), so a running sum of consumed piece
  // lengths is the exact offset - the same contract `line.at` already carries
  // on a body line, and what lets render.js re-apply a sub-editor's bold or
  // italic marks to a headline broken across two lines.
  let consumed = 0;
  let y = top;
  // The band's real bottom edge, tracked from what was actually PLACED - not
  // from lines.length * bandHeight, which undercounts whenever a photograph
  // forces a band to be skipped (y advances with nothing placed in it). A
  // wrong consumed height here is not cosmetic: it is what the next flow
  // (the deck, or the body) uses to decide where IT starts, and an
  // undercounted headline bottom put the deck's first line inside the
  // headline's own last line - found by composing a headline forced down one
  // band by an image and checking where the deck landed.
  let occupiedBottom = top;

  while (index < pieces.length) {
    if (lines.length >= maxLines) break;
    if (y + bandHeight > bottomLimit + 0.5) break;

    const free = subtract([column], bandObstacles(images, y, y + bandHeight, fontPx));
    // Display type sets in ONE rectangle, not around both sides of a
    // photograph - a headline split across a picture is not a headline. The
    // widest gap on this band is the measure it gets.
    const gap = free.reduce((best, piece) => (!best || piece.end - piece.start > best.end - best.start ? piece : best), null);
    if (!gap) { y += bandHeight; continue; }

    const measure = gap.end - gap.start;
    const lineAt = consumed;
    let line = '';
    let width = 0;
    let hardOverset = false;

    while (index < pieces.length) {
      const piece = pieces[index];
      const pieceWidth = measure2(piece, consumed, fontPx, family, weight);
      if (line && width + pieceWidth > measure + 0.5) break;
      if (!line && pieceWidth > measure + 0.5) {
        // One unbreakable token wider than every legal measure. It is set
        // anyway - inventing a hyphen inside a Marathi word is the one thing
        // this engine will not do - but it is a real violation, not a quiet
        // success: the token PHYSICALLY does not fit the frame, and a caller
        // that only checked `overset` (leftover, undrawn pieces) never saw
        // this, because the token WAS drawn. `fitState` must read OVERSET
        // for a block that painted past its own measure, not FITS.
        line = piece;
        width = pieceWidth;
        hardOverset = true;
        index += 1;
        consumed += piece.length;
        break;
      }
      line += piece;
      width += pieceWidth;
      index += 1;
      consumed += piece.length;
    }

    const trimmed = trimEndClusters(line);
    if (trimmed) {
      const drawnWidth = measure2(trimmed, lineAt, fontPx, family, weight);
      lines.push({
        text: trimmed,
        at: lineAt,
        x: gap.start,
        y,
        width: drawnWidth,
        measure,
        height: bandHeight,
        baseline: y + fontPx * faceAscent(family, weight),
        fontPx,
        // Carried on the line itself so a renderer paints the SAME face this
        // was measured with, rather than re-deriving it (and risking a second,
        // drifted classification) or leaving it to CSS inheritance, which is
        // how the canonical renderer used to always paint the container's
        // default face regardless of what this flow was actually measured in.
        family,
        weight,
      });
      occupiedBottom = Math.max(occupiedBottom, y + bandHeight);
      if (hardOverset) {
        violations.push({
          code: 'UNBREAKABLE_TOKEN_OVERSET',
          detail: `"${trimmed}" is ${Math.round(drawnWidth)}px, wider than the ${Math.round(measure)}px this band offers anywhere.`,
          charsOver: clusters(trimmed).length,
        });
      }
    }
    y += bandHeight;
  }

  // ------------------------------------------------------------ alignment ---
  //
  // Display type obeys the desk's alignment exactly as the body does, and
  // until now it obeyed nothing at all: every headline, kicker and deck line
  // was placed at `gap.start` and left there, so a sub-editor pressing
  // "centre" or "flush right" with the headline selected changed only the
  // BODY - the one object they were not looking at. The control was not
  // subtly wrong, it was wired to the wrong object.
  //
  // Same rule as the body, and for the same reason: alignment never changes
  // which words are on which line - that was decided above at natural width -
  // only where the finished line sits, and, for `justify`, how the space
  // inside it is opened.
  //
  // A band's LAST line is never justified. In display type that matters more
  // than in body copy, not less: the last line of a headline is usually two
  // words, and stretching two words across a full measure is the single most
  // obvious mark of software setting type rather than a compositor. The
  // JUSTIFY_MIN_EM floor the body uses is deliberately NOT applied here -
  // that rule is about rivers in a narrow column of small type, and display
  // type is one line of large type where there is no river to make.
  if (align && align !== 'left' && lines.length) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const slack = Math.max(0, line.measure - line.width);
      if (align === 'right') line.x += slack;
      else if (align === 'center') line.x += slack / 2;
      else if (align === 'justify' && i < lines.length - 1) justifyLine(line, slack);
    }
  }

  return {
    lines,
    height: occupiedBottom - top,
    bottom: occupiedBottom,
    lineCount: lines.length,
    overset: pieces.slice(index).join(''),
    violations,
  };

  // measure2: a small local alias so this closure does not have to thread
  // `measure` through every call site above by name collision with the
  // module-level `measure()` - kept local to make the diff obvious.
  // Mark-aware, exactly as the body's pour is: a sub-editor's bold word inside
  // a headline is set in a real bold face and a real bold Devanagari word is
  // 5-8% wider than its regular ghost, so measuring the whole flow at one
  // weight would reserve the wrong measure for the line it lands on. With no
  // marks this is the plain measurement it always was.
  function measure2(t, at, px, fam, w) {
    return measurePieceWidth(t, at, px, fam, w, marks, letterSpacingPx);
  }
}

/**
 * How close a set band comes to its own measure, judged on its LONGEST line.
 *
 * The longest line and not the mean, because that is what the eye reads: a
 * two-line headline whose first line is flush and whose second is short is an
 * ordinary printed headline, and a two-line headline where BOTH lines stop
 * short is a mistake. Averaging the two cannot tell those apart.
 */
function bandFill(set) {
  if (!set || !set.lines.length) return 1;
  return Math.max(...set.lines.map((line) => (line.measure > 0 ? line.width / line.measure : 0)));
}

/**
 * The SMALLEST size, up to `maxPx`, at which this flow actually fills its
 * measure. `null` when no size within reach does.
 *
 * Two decisions, and both are the compositor's rather than the optimiser's:
 *
 * The smallest that fills, not the largest that fits. Every pixel of display
 * type is a pixel off the top of the story, so the growth buys exactly what it
 * came for and stops.
 *
 * And all or nothing. "Any improvement" was the first rule here and it is
 * wrong in a way that is obvious once seen: a one-word headline in a
 * full-width block cannot fill 296 px of measure at any legible size, so the
 * rule inflated it 30 px -> 37 px to go from 19% of its measure to 24% - a
 * quarter larger, still five-sixths empty, and the story a line shorter for
 * it. A headline whose words cannot fill the measure is set at the size the
 * page's design gave it; a short headline is a short headline, and a printed
 * newspaper does not blow one up to hide that.
 *
 * Steps up a pixel at a time and stops at the first size that will not set -
 * overset against a fixed frame is monotone in type size, so nothing legal
 * lies beyond it.
 */
function growToFill(text, options, { maxPx, fillTarget, set, failed }) {
  if (!(maxPx > options.fontPx) || !(fillTarget > 0)) return null;
  if (bandFill(set) >= fillTarget) return null;

  for (let px = Math.floor(options.fontPx) + 1; px <= maxPx; px += 1) {
    const attempt = setDisplayFlow(text, { ...options, fontPx: px });
    if (failed(attempt)) return null;
    if (bandFill(attempt) >= fillTarget) return { set: attempt, px };
  }
  return null;
}

/**
 * The same flow, but allowed to choose its own size.
 *
 * AUTO typography treats the requested size as a preferred MAXIMUM and finds
 * the largest legal size at or below it. LOCKED never shrinks: it reports
 * overset instead, because silently setting a sub-editor's 48px headline at
 * 31px is a design decision the software is not entitled to make on its own.
 */
// The size a display flow is actually set at.
//
// TWO PASSES, because the line budget is a PREFERENCE and overset is a
// failure. A headline wants to set in `preferLines` (see HEADLINE_MAX_LINES) -
// that is what makes it fill its measure instead of stopping two-fifths short
// on every line, and what stops it eating half the block. But a one-column
// 90px filler carrying six long Marathi words cannot set in two lines at any
// legible size, and forcing it there pushed words off the block entirely.
// Overset is worse than a third line, always.
//
// So: look for a size that meets the preferred budget cleanly; if no size in
// the range does, look again with only the hard limit. A narrow block gets its
// extra lines, a wide one gets its fill, and neither is decided by a constant
// that had to be right for both.
function fitDisplayFlow(text, options, { locked, minPx, maxPx = 0, fillTarget = 0, preferLines = 0, roomyBottomLimit = 0 }) {
  const failed = (attempt) => attempt.overset || attempt.violations.length > 0;

  if (locked) {
    const set = setDisplayFlow(text, options);
    return { ...set, resolvedPx: options.fontPx, shrunk: false };
  }

  // In order of what this would LIKE, ending with what it will settle for.
  // Every relaxation here exists because the thing it gives up is worth less
  // than the thing it protects, and the thing it protects in every case is
  // that no word is pushed off the block.
  const passes = [];
  if (preferLines > 0 && preferLines < options.maxLines) passes.push({ ...options, maxLines: preferLines });
  passes.push(options);
  // Last: the display's own share ceiling yields. A deck that cannot be set
  // inside half the block is a tall deck; a deck with its last words pushed
  // off the page is a mistake in print. Measured: capping the display without
  // this took DECK_OVERSET across the database from 1 block to 7.
  if (roomyBottomLimit > options.bottomLimit) passes.push({ ...options, bottomLimit: roomyBottomLimit });

  for (let pass = 0; pass < passes.length; pass += 1) {
    const attemptOptions = passes[pass];
    const first = setDisplayFlow(text, attemptOptions);
    if (!failed(first)) {
      // Only from the pass that got what it wanted. A flow already forced
      // past its preferred line budget, or already given the display share
      // ceiling's own last relaxation, is a flow with nothing to spare -
      // growing it there would be buying a straight right edge with the very
      // room those relaxations were granted to protect.
      const grown = pass === 0 ? growToFill(text, attemptOptions, { maxPx, fillTarget, set: first, failed }) : null;
      return grown
        ? { ...grown.set, resolvedPx: grown.px, shrunk: false, grew: true }
        : { ...first, resolvedPx: options.fontPx, shrunk: false };
    }
    for (let px = options.fontPx - 1; px >= minPx; px -= 1) {
      const attempt = setDisplayFlow(text, { ...attemptOptions, fontPx: px });
      if (!failed(attempt)) return { ...attempt, resolvedPx: px, shrunk: true };
    }
  }

  const floor = setDisplayFlow(text, { ...options, fontPx: minPx });
  return { ...floor, resolvedPx: minPx, shrunk: true };
}


// ------------------------------------------------------------ justification ---
//
// TWO LEVERS, IN ORDER, AND NO GIVING UP - which is what a compositor does and
// what every serious typesetting system (InDesign's word-spacing / glyph-
// scaling ranges, TeX's glue) does.
//
// The old rule had one lever and a silent surrender: stretch the word spaces,
// unless that would need more than 0.6 em each, in which case leave the line
// ragged. On a real 190x264 block that abandoned four lines of thirteen - one
// 36% short of its own measure - sitting among lines that WERE flush. A right
// edge that is sometimes straight and sometimes not is worse than one that is
// never straight: the reader sees a mistake rather than a style. That is
// exactly what the desk reported as "uneven gap ... not touching right side".
//
// So: widen the word spaces as far as is decent, then scale the glyphs by the
// small amount newspapers really do use (InDesign's own newspaper range is
// about 97-103%), and only then accept whatever is left. A line with no space
// in it cannot be justified at all and is left alone - there is nothing to
// distribute.
const MAX_EXTRA_WORD_SPACE_EM = 0.55;
const MAX_GLYPH_STRETCH = 1.03;

// The narrowest column that can be justified at all.
//
// A Latin column needs about 40 characters before justification stops
// producing rivers; Marathi sets roughly 2.5 characters to the em, so about
// 16 em. Below that a line holds two or three words and there is nowhere to
// put the slack - which is why captions, sidebars and tight columns are set
// FLUSH LEFT in every printed newspaper, not justified badly.
//
// Measured across 1200 real article blocks, the column measures fall into
// clear groups: 11 em (55% of them), 15, 20 and 26. 13 em separates the
// unjustifiable group from the rest.
//
// The decision is per BLOCK, never per line. A block whose lines were
// justified or not depending on how wide each one happened to be - narrow
// beside a picture, full below it - is precisely the inconsistent right edge
// this whole pass exists to remove.
const JUSTIFY_MIN_EM = 13;

function justifyLine(line, slack) {
  if (slack <= 0.5) return;
  const spaceCount = (line.text.match(/\s/gu) || []).length;
  if (!spaceCount) return;

  const bySpace = Math.min(slack, spaceCount * MAX_EXTRA_WORD_SPACE_EM * line.fontPx);
  line.wordSpacingPx = Number((bySpace / spaceCount).toFixed(2));

  const left = slack - bySpace;
  if (left <= 0.5 || line.width <= 0) return;
  // The glyphs themselves take the remainder, up to the newspaper range. The
  // shirorekha scales with them, which is why this is safe for Devanagari
  // where letter-spacing - the lever a Latin compositor would reach for next -
  // is not: tracking a Devanagari word pulls its head stroke apart.
  const scale = Math.min(MAX_GLYPH_STRETCH, (line.width + left) / line.width);
  if (scale > 1.001) {
    line.glyphScaleX = Number(scale.toFixed(4));
    line.width = line.width * scale;
  }
}

// ------------------------------------------------------------------- body ---

function columnsOf(content, count, gutter) {
  const n = Math.max(1, Math.round(count));
  const width = (content.right - content.left - gutter * (n - 1)) / n;
  if (width <= 0) return [{ start: content.left, end: content.right }];
  return Array.from({ length: n }, (unused, i) => ({
    start: content.left + i * (width + gutter),
    end: content.left + i * (width + gutter) + width,
  }));
}

// ------------------------------------------------------ rich-run measurement ---
//
// A piece (breakPieces()'s unit - a word plus its trailing space) is set in
// ONE style almost always, but a sub-editor's bold mark - or a selected-size
// mark, see rich-text.js's `data-sahas-size` - can start or end mid-word
// ("प्रचंड **यश**"), so a piece can straddle a mark boundary. Width has to be
// measured per RUN of one style, not per piece, or a bold phrase is reserved
// the width of its own regular-weight ghost - measured against the real
// fonts, a bold Devanagari word is 5-8% wider than the same word regular -
// and a selected larger word is reserved the width of its own SMALLER ghost,
// which is worse: that word then visibly overruns the line it was measured
// to fit on. Italic and underline do not change width (no italic face is
// bundled - see shaper.js's header; underline is a paint decision only), so
// neither participates here.
function styleRunsIn(marks, start, end) {
  return marks
    .filter((mark) => (mark.tag === 'b' || mark.tag === 'size') && mark.end > start && mark.start < end)
    .map((mark) => ({ start: Math.max(start, mark.start), end: Math.min(end, mark.end), tag: mark.tag, value: mark.value }));
}

/** The real, mark-aware width of one piece, given its offset in the flow. */
function measurePieceWidth(piece, at, fontPx, family, weight, marks, letterSpacingPx = 0) {
  if (!marks || !marks.length) return measure(piece, fontPx, family, weight, letterSpacingPx);
  const runs = styleRunsIn(marks, at, at + piece.length);
  if (!runs.length) return measure(piece, fontPx, family, weight, letterSpacingPx);

  // Split the piece at every style boundary and shape each run at its own
  // weight/size - this is the same "measure a run, not a codepoint" principle
  // font-metrics.js already used, just extended across a style change rather
  // than only across a font file.
  const cuts = new Set([0, piece.length]);
  for (const range of runs) {
    cuts.add(Math.max(0, range.start - at));
    cuts.add(Math.min(piece.length, range.end - at));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let width = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const active = runs.filter((range) => range.start - at <= from && range.end - at >= to);
    const isBold = active.some((range) => range.tag === 'b');
    const sized = active.find((range) => range.tag === 'size');
    // Letter-spacing NOT applied per sub-run here (that would double it at
    // every style seam and miss the gap exactly AT the seam) - applied once
    // below, over the whole piece's own cluster count instead.
    width += measure(piece.slice(from, to), sized ? sized.value : fontPx, family, isBold ? 700 : weight, 0);
  }
  if (letterSpacingPx) width += Math.max(0, clusters(piece).length - 1) * letterSpacingPx;
  return width;
}

// -------------------------------------------------------- forced breaks ---
//
// A paragraph is a stronger thing than a legal break opportunity: it must
// end the line even when more of the next paragraph would otherwise fit in
// the same gap, or two paragraphs read as one run-on block - exactly the
// failure a body of `plainText(story)` with a bare `\n`/`\n\n` inside it
// produced, because breakPieces() (correctly) treats a newline as ONE MORE
// optional break character among `\s`, not as a mandatory one. Splitting the
// flow into paragraphs here, before any pouring happens, is what makes a
// forced break forced: each paragraph gets its own pour, and the pour is
// never allowed to carry the next paragraph's first piece into a gap the
// previous paragraph left short.
//
// `\n\n` (a real paragraph: <p>/<div> in the source) and a bare `\n` (a
// <br> or a <li>) are both forced breaks; only the first also asks for
// `paragraphSpacingPx` of visual air before it. Splitting the vertical band
// grid to make room for that spacing precisely would break the fixed-height
// band grid every obstacle lookup in this engine relies on, so this pass
// forces the break (the correctness bug - paragraphs running together) and
// marks the resulting line `paragraphBreak: true` for a caller to style,
// without yet spending a partial band on the gap itself. That is a scoped,
// documented gap, not a silent one.
export function authoredParagraphStarts(text) {
  const raw = [0];
  const re = /\n+/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (re.lastIndex < text.length) raw.push(re.lastIndex);
  }
  // A paragraph with nothing but whitespace in it is not a paragraph - a body
  // that opens with a blank line, or carries three of them between two
  // paragraphs, must not pour an empty line for each.
  return raw.filter((start, i) => {
    const end = i + 1 < raw.length ? raw[i + 1] : text.length;
    return i === 0 || text.slice(start, end).trim().length > 0;
  });
}

// The paragraphs a given set of starting offsets describes.
//
// The offsets TILE the body: paragraph i runs from starts[i] to starts[i+1],
// so every character of the text - including the newline run that separated
// two authored paragraphs - belongs to exactly one paragraph, and every
// `line.at` a renderer later uses to re-locate a line in the original body
// is a real offset into that same string. That is why a merged paragraph is
// built by SUBSTITUTING its interior newlines with spaces rather than by
// deleting them: same length, same offsets, and the substituted space lands
// at the end of a piece (breakPieces() keeps whitespace attached to the word
// in front of it), where it is trimmed before any ink is measured.
function paragraphsFrom(text, starts) {
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : text.length;
    const raw = text.slice(start, end);
    return {
      text: raw.includes('\n') ? raw.replace(/\n/g, ' ') : raw,
      offset: start,
      forcedBreak: i > 0,
      // Whether the AUTHOR asked for air here, as opposed to a bare <br>.
      paragraphBreak: start > 0 && text.slice(Math.max(0, start - 2), start).includes('\n\n'),
    };
  });
}

/**
 * Pours the body into whatever the photographs leave, column by column.
 *
 * Reading order is down a column and then into the next, never across a
 * gutter - a gutter is forbidden ground however free its pixels are. Within a
 * column, a band's gaps are used left to right. Paragraph boundaries force a
 * fresh row; ordinary word-space boundaries do not.
 */
function pourBody(bodyInput, {
  top, bottom, columns, images, fontPx, lineHeight, family, weight, align: requestedAlign,
  paragraphSpacingPx = 0, letterSpacingPx = 0,
  italic = false, underline = false, firstLineIndentPx = 0,
  paragraphStarts = null,
}) {
  let align = requestedAlign;
  const text = typeof bodyInput === 'object' && bodyInput ? String(bodyInput.text || '') : String(bodyInput || '');
  const marks = (typeof bodyInput === 'object' && bodyInput && bodyInput.marks) || [];
  // A newspaper marks a new paragraph by INDENTING its first line, not by
  // leaving a blank one. A blank line costs a whole row of the column and no
  // printed newspaper spends one that way - measured on a real 190x264 block,
  // paragraph air was taking 0.7 of 5.83 body lines, 12% of the block,
  // standing empty while the desk was told the layout looked balanced.
  const indentPx = Math.max(0, Number(firstLineIndentPx) || 0);

  // The ORDINARY line height. `result.capacity`/`result.whitespace` are
  // measured against this constant, never against what a particular size
  // mark happens to need - capacity is what tells a writer how much room a
  // block holds BEFORE a word exists, so it cannot depend on a mark that
  // does not exist yet either. A selected size run instead grows the height
  // of the ONE ROW it actually lands on, in the real pour below - see
  // `fillRow()`.
  const bandHeight = fontPx * lineHeight;
  const minCorridor = MIN_CORRIDOR_EM * fontPx;

  // ---------------------------------------------------- capacity calibration ---
  // Every band's raw free space at the ordinary height, whatever is or is
  // not written into it - independent of `marks` on purpose (see above).
  // Only `result.capacity`/`result.whitespace` read this; the real pour
  // below never does, because a row it actually places a tall run on may
  // legitimately need more room than this grid assumes.
  const strips = columns.map((column) => {
    const bands = [];
    for (let y = top; y + bandHeight <= bottom + 0.5; y += bandHeight) {
      bands.push({ y, free: subtract([column], bandObstacles(images, y, y + bandHeight, fontPx)) });
    }
    const raw = bands.map((band) => band.free);
    const fullWidthPx = column.end - column.start;
    return bands.map((band, index) => ({ y: band.y, gaps: viableIntervals(raw, index, minCorridor, fullWidthPx), raw: band.free }));
  });
  const calibrationSequence = [];
  for (const strip of strips) for (const band of strip) for (const gap of band.gaps) calibrationSequence.push({ y: band.y, gap });
  const measures = calibrationSequence.map((s) => s.gap.end - s.gap.start);
  const usableWidth = measures.reduce((sum, width) => sum + width, 0);

  // ------------------------------------------------------------- real pour ---
  // The band grid above cannot be reused for the actual text: a row that
  // holds a selected size run needs more height than the grid assumed, and
  // once one row grows, every row AFTER it in that column has to start
  // later. There is no way to know which rows those are before the text is
  // actually placed, so - unlike the calibration grid, and unlike every
  // other geometry in this engine - rows here are generated one at a time,
  // in reading order, each queried against the real obstacle geometry only
  // once its own final height is known.

  /** The largest size mark active anywhere in [start, end), or null. */
  function maxSizeIn(start, end) {
    let found = null;
    for (const mark of marks) {
      if (mark.tag !== 'size' || mark.end <= start || mark.start >= end) continue;
      const value = Number(mark.value);
      if (Number.isFinite(value) && (found === null || value > found)) found = value;
    }
    return found;
  }

  // One row's viable gaps at a given height, at a given y - the same
  // obstacle-sampling and neighbour-persistence rule viableIntervals() has
  // always used (unchanged), just asked of the row's own real y/height
  // instead of an index into a precomputed uniform array. `isFirstRow`/
  // `isLastRow` reproduce viableIntervals()'s own block-edge exemption ("the
  // top and bottom of the block count as satisfied").
  function rowGaps(column, y, height, isFirstRow, isLastRow) {
    if (y + height > bottom + 0.5) return null;
    const here = subtract([column], bandObstacles(images, y, y + height, fontPx));
    const fullWidthPx = column.end - column.start;
    const bands = [];
    let index = 0;
    if (!isFirstRow) {
      bands.push(subtract([column], bandObstacles(images, y - height, y, fontPx)));
      index = 1;
    }
    bands.push(here);
    if (!isLastRow) {
      bands.push(subtract([column], bandObstacles(images, y + height, y + 2 * height, fontPx)));
    }
    return { y, gaps: viableIntervals(bands, index, minCorridor, fullWidthPx) };
  }

  // One column's cursor. `y` advances only by a row's own FINALIZED height
  // once that row is committed - a tall row pushes every later row in THIS
  // column down; other columns are unaffected, matching "reading order is
  // down a column and then into the next" exactly as before.
  function makeCursor(column) {
    let y = top;
    let first = true;
    return {
      probe(height) { return rowGaps(column, y, height, first, y + height + height > bottom + 0.5); },
      commit(height) { y += height; first = false; },
      hasRoom(height) { return y + height <= bottom + 0.5; },
      get y() { return y; },
    };
  }
  const cursors = columns.map(makeCursor);

  // A hard-overset piece's "is there room ANYWHERE" check, against the
  // calibration grid's real widths - a taller row changes HEIGHT, never
  // width, unless an obstacle happens to sit in exactly the extra vertical
  // room, the same rare edge case `result.capacity` already accepts by
  // being calibration-based rather than pour-exact.
  function anywhereWideEnough(pieceWidth) {
    return calibrationSequence.some((s) => s.gap.end - s.gap.start >= pieceWidth - 0.5);
  }

  /**
   * Fills one row - all of its gaps, left to right - with as much of
   * `pieces` (from `index`/`paraCharOffset`) as fits. Re-measured once at a
   * taller height if any run actually placed needs more than the row was
   * opened at (bounded: at most two passes, matching every other budget in
   * this engine).
   *
   * If the column does not have room for the height a run actually needs,
   * this row is never committed at the wrong (undersized) height - that
   * would silently paint a line box a run overflows while still reporting
   * FITS. Instead this returns `{ retryNextColumn: true }`: no text is
   * consumed, so the caller can retry the exact same unplaced text at the
   * top of the next column, or - if there is no next column - let it fall
   * through to ordinary overset accounting.
   */
  function fillRow(cursor, pieces, index, paraCharOffset, paragraphOffset, indentFirstGap = false) {
    let height = bandHeight;

    for (let pass = 0; pass < 2; pass += 1) {
      const row = cursor.probe(height);
      if (!row) return null;

      const placed = [];
      let cursorIndex = index;
      let cursorOffset = paraCharOffset;

      for (let gapIndex = 0; gapIndex < row.gaps.length; gapIndex += 1) {
        if (cursorIndex >= pieces.length) {
          for (let rest = gapIndex; rest < row.gaps.length; rest += 1) {
            const rested = row.gaps[rest].end - row.gaps[rest].start;
            placed.push({ empty: true, width: rested, measure: rested });
          }
          break;
        }
        const gap = row.gaps[gapIndex];
        // The paragraph's own first line starts inset. The gap it is set in
        // is unchanged - the row is still fully used - only the text starts
        // further in, exactly as a printed paragraph does.
        const indent = indentFirstGap && gapIndex === 0 ? Math.min(indentPx, (gap.end - gap.start) * 0.5) : 0;
        const measureWidthPx = gap.end - gap.start - indent;
        let line = '';
        let width = 0;
        const lineStartOffset = paragraphOffset + cursorOffset;
        let hardOverset = false;

        while (cursorIndex < pieces.length) {
          const piece = pieces[cursorIndex];
          const at = paragraphOffset + cursorOffset;
          const pieceWidth = measurePieceWidth(piece, at, fontPx, family, weight, marks, letterSpacingPx);
          if (line && width + pieceWidth > measureWidthPx + 0.5) break;
          if (!line && pieceWidth > measureWidthPx + 0.5) {
            // Wider than this gap. If some other gap anywhere could hold it,
            // wait rather than cutting a word in half; if nothing anywhere
            // can, set it here and report it - never silently.
            if (anywhereWideEnough(pieceWidth)) break;
            line = piece;
            width = pieceWidth;
            hardOverset = true;
            cursorOffset += piece.length;
            cursorIndex += 1;
            break;
          }
          line += piece;
          width += pieceWidth;
          cursorOffset += piece.length;
          cursorIndex += 1;
        }

        const trimmed = trimEndClusters(line);
        if (!trimmed) {
          const whole = gap.end - gap.start;
          placed.push({ empty: true, width: whole, measure: whole });
          continue;
        }
        const drawn = measurePieceWidth(trimmed, lineStartOffset, fontPx, family, weight, marks, letterSpacingPx);
        placed.push({
          text: trimmed, at: lineStartOffset, x: gap.start + indent, width: drawn,
          measure: measureWidthPx, hardOverset, pieceEnd: cursorIndex,
          // The row is occupied whatever the indent did to the text's start -
          // an indented first line is a set line, not a partly empty one.
          occupies: gap.end - gap.start,
        });
      }

      const requiredHeight = placed.reduce((max, p) => {
        if (p.empty) return max;
        const size = maxSizeIn(p.at, p.at + p.text.length);
        return size ? Math.max(max, size * lineHeight) : max;
      }, bandHeight);

      if (Math.abs(requiredHeight - height) < 0.25) {
        return { row, placed, cursorIndex, cursorOffset, height };
      }

      if (pass === 1) {
        // Bounded: no third pass. Accept the already-fitted placement only
        // if the column genuinely has room for what it needs; a row can
        // never be committed shorter than the tallest run actually placed
        // on it (see BUG 1) - `height` is stamped to `requiredHeight`
        // itself here rather than queried a third time, the same bounded
        // imprecision this engine already accepts elsewhere (GSUB/GPOS not
        // modelled, "the safe direction, deliberately").
        if (cursor.hasRoom(requiredHeight)) return { row, placed, cursorIndex, cursorOffset, height: requiredHeight };
        return { retryNextColumn: true };
      }

      if (!cursor.hasRoom(requiredHeight)) return { retryNextColumn: true };
      height = requiredHeight;
    }

    return null;
  }

  // ------------------------------------------------- paragraph re-breaking ---
  //
  // Greedy line-breaking - take words until the next one will not fit - is
  // what every line-filler does first, and on a narrow Marathi measure it
  // produces a right edge a reader can see is wrong. Measured on a real
  // 190x264 block: four of thirteen lines had so much slack that the
  // justifier gave up on them and left them ragged, in no pattern, next to
  // lines that were flush. One line was 36% short of its own measure.
  //
  // Greedy is optimal for LINE COUNT and terrible for evenness, because it
  // spends all the slack on whichever line happens to meet a long word. A
  // compositor breaks the whole paragraph at once and spreads the slack, and
  // so does this: once the paragraph has been poured, its lines' real
  // measures are known (they depend on the geometry and the pictures, not on
  // the text), so the pieces can be re-assigned across those same measures to
  // minimise total badness - the classic cubed-slack cost, as TeX uses.
  //
  // The line COUNT never changes, so no geometry moves: only which words sit
  // on which of the already-placed lines. If no assignment fits the same
  // slots, the greedy result stands.
  const BALANCE_MAX_PIECES = 400;
  // How much of its measure a paragraph's last line should carry before the
  // solver starts paying to make it longer. A third is roughly where a short
  // last line stops reading as a close and starts reading as a widow.
  const LAST_LINE_MIN_FILL = 1 / 3;
  // A last line of ONE word under a full column is a widow, and it is not a
  // matter of degree - it reads as a mistake however well the lines above it
  // are set. It has to outweigh the ordinary slack it would buy: real slack
  // badness on these blocks runs to a few thousandths (a 17% short line costs
  // 0.005), so a cubed deficit penalty is far too weak to stop the solver
  // trading a good last line for a slightly better one above it. Measured:
  // with a cubed penalty the solver pulled "भूमिका" up a line and left
  // "मांडली." standing alone.
  const WIDOW_PENALTY = 0.5;

  /**
   * What an ordinary line's slack costs.
   *
   * Slack the justifier will close is nearly free - the line ends flush and
   * the reader sees nothing. Slack it CANNOT close is the expensive kind: it
   * is the notch in the right edge, and it is what the desk sees.
   */
  function slackCost(slack, measure, width, spaces) {
    if (slack <= 0) return 0;
    const closable = spaces * MAX_EXTRA_WORD_SPACE_EM * fontPx + width * (MAX_GLYPH_STRETCH - 1);
    const residual = Math.max(0, slack - closable);
    // The residual dominates by two orders of magnitude, so the solver will
    // trade a lot of ordinary slack to avoid one notch.
    return (slack / measure) ** 3 + 100 * (residual / measure) ** 3;
  }

  /** What a paragraph's closing line costs: free unless it is a stub. */
  function lastLineCost(width, measure, pieceCount) {
    if (pieceCount < 2) return WIDOW_PENALTY;
    if (width >= measure * LAST_LINE_MIN_FILL) return 0;
    // Linear, not cubed: a short close is a real fault at every degree, and
    // cubing it made it vanish next to the slack it was competing with.
    return WIDOW_PENALTY * ((measure * LAST_LINE_MIN_FILL - width) / measure);
  }

  function balanceParagraph(allLines, pieces, slots, paragraphOffset) {
    if (slots.length < 2 || pieces.length > BALANCE_MAX_PIECES) return;

    // A piece's width does not depend on which line it lands on, so each is
    // measured once. `trimmed` is the width once its trailing space is cut,
    // which is what a line's LAST piece actually draws.
    const offsets = [];
    let at = 0;
    for (const piece of pieces) { offsets.push(at); at += piece.length; }
    const full = pieces.map((piece, i) => measurePieceWidth(piece, paragraphOffset + offsets[i], fontPx, family, weight, marks, letterSpacingPx));
    const trimmed = pieces.map((piece, i) => {
      const cut = trimEndClusters(piece);
      return cut === piece ? full[i] : measurePieceWidth(cut, paragraphOffset + offsets[i], fontPx, family, weight, marks, letterSpacingPx);
    });
    const prefix = [0];
    for (let i = 0; i < full.length; i += 1) prefix.push(prefix[i] + full[i]);
    const widthOf = (from, to) => (to <= from ? 0 : prefix[to - 1] - prefix[from] + trimmed[to - 1]);

    const L = slots.length;
    const N = pieces.length;
    const INF = Infinity;
    // cost[j][i] - best total badness placing pieces i.. onto slots j..
    const cost = Array.from({ length: L + 1 }, () => new Float64Array(N + 1).fill(INF));
    const cut = Array.from({ length: L + 1 }, () => new Int32Array(N + 1).fill(-1));
    cost[L][N] = 0;

    for (let j = L - 1; j >= 0; j -= 1) {
      const measure = slots[j].measure;
      const isLastLine = j === L - 1;
      for (let i = N - 1; i >= 0; i -= 1) {
        // Every slot must take at least one piece: an empty line would be a
        // hole the geometry never allowed for.
        for (let k = i + 1; k <= N - (L - 1 - j); k += 1) {
          const width = widthOf(i, k);
          if (width > measure + 0.5 && k > i + 1) break;
          const next = cost[j + 1][k];
          if (next === INF) continue;
          // A line that does not fit is not a candidate at all, unless it is a
          // single unbreakable piece - which the pour already accepted.
          const slack = measure - width;
          if (slack < -0.5 && k > i + 1) continue;
          // The last line of a paragraph is meant to be SHORT, not a stub. It
          // is set flush left and never justified, so its slack is free - but
          // only down to a point: with no penalty at all the solver happily
          // dumps every bit of the paragraph's slack onto it and leaves one
          // word sitting alone under a full column, which is a widow and
          // reads as a mistake. Below a third of the measure it starts to
          // cost, on the same cubed scale as ordinary slack.
          // What the JUSTIFIER can actually close, not just how short the
          // line is. A line with two spaces in a narrow measure cannot be
          // spaced out however much slack it has - both levers run out - so
          // a breaker that only counts slack will happily choose a line it
          // knows nothing can fix. Measured across a real page: every single
          // ragged line left had both levers pinned at their caps.
          const badness = isLastLine
            ? lastLineCost(width, measure, k - i)
            : slackCost(slack, measure, width, k - i - 1);
          const total = badness + next;
          if (total < cost[j][i]) { cost[j][i] = total; cut[j][i] = k; }
        }
      }
    }
    if (cost[0][0] === INF) return;

    // Only adopt it if it is genuinely better than what greedy produced -
    // equal cost means equal typography and a pointless rewrite.
    let greedy = 0;
    for (let j = 0; j < L; j += 1) {
      const measure = slots[j].measure;
      const width = widthOf(slots[j].from, slots[j].to);
      if (j === L - 1) {
        greedy += lastLineCost(width, measure, slots[j].to - slots[j].from);
        continue;
      }
      greedy += slackCost(measure - width, measure, width, slots[j].to - slots[j].from - 1);
    }
    if (cost[0][0] >= greedy - 1e-9) return;

    let from = 0;
    for (let j = 0; j < L; j += 1) {
      const to = cut[j][from];
      if (to === undefined || to < 0) return;
      const line = allLines[slots[j].index];
      const text = trimEndClusters(pieces.slice(from, to).join(''));
      line.text = text;
      line.at = paragraphOffset + offsets[from];
      line.width = widthOf(from, to);
      from = to;
    }
  }

  const lines = [];
  const violations = [];
  let usedWidth = 0;
  // Room that no line was set on AT ALL. Deliberately not the same as
  // "usable minus used": every ragged line leaves a little at its right end,
  // and summing that across a column reports two or three lines of "hole"
  // for a column that is completely full. Ragged right is how type is set,
  // not a defect. Only a gap that received nothing is unexplained.
  let emptyGapWidth = 0;

  // ------------------------------------------------------------ occupancy ---
  //
  // How full the body is, in EQUIVALENT LINES - and this is the only
  // dimensionally valid way to ask, which `lines.length` is not.
  //
  // One physical row of type around a cut-out is not one line. A subject
  // standing in the middle of the frame leaves a corridor either side of it,
  // `fillRow()` sets BOTH, and each becomes its own entry in `lines`. So a
  // block with a centre-standing cut-out reported nine "lines used" for six
  // physical rows - and each of those nine was a half-measure fragment being
  // counted as a whole line. That number was then divided into the character
  // count to calibrate the AI's repair target, so the error propagated
  // straight into what the model was asked to write.
  //
  // A gap is measured against the width of ITS OWN column, so a full-width
  // row counts 1, a row halved by a silhouette counts 0.5, and two quarter
  // corridors on one row count 0.5 between them. The image's real shape
  // therefore participates on its own, with no image-specific arithmetic
  // anywhere: it simply narrows the gaps it actually crosses.
  //
  // A gap that received text counts its whole MEASURE, not the width its
  // glyphs happened to reach - the ragged right end of a set line is how
  // type is set, never a hole (the same rule `emptyGapWidth` above already
  // followed).
  let occupiedEquivalent = 0;
  let emptyEquivalent = 0;
  // Room consumed on purpose - the air a paragraph break asks for. Counting
  // it as empty offers the desk "Fill remaining area with AI" for whitespace
  // the stylesheet deliberately inserted.
  let intentionalEquivalent = 0;
  let intentionalGapWidth = 0;
  const columnMeasureAt = (index) => Math.max(1, columns[index].end - columns[index].start);
  let overset = '';
  let colIndex = 0;
  // Which column the last COMMITTED line actually landed in - paragraph
  // spacing below is only ever meaningful as "more air in the column this
  // paragraph is already sitting in". Once `colIndex` has moved past that
  // column (the previous paragraph ran out of room there, or a tall run got
  // retried into a later column - BUG 1's path), the OLD column's absolute Y
  // means nothing in the new column's own coordinate space; carrying it
  // across silently ate the whole next column trying to reach a Y position
  // that column will never have (BUG 2).
  let lastLineColumnIndex = null;

  // The offsets this pour actually sets a paragraph at. `paragraphStarts` is
  // the second pass of the two-pass paragraph policy (see paragraph-policy.js
  // and composeBlock() below); with nothing passed, every authored break is
  // set, which is the first pass and also what a caller composing directly
  // gets.
  const starts = Array.isArray(paragraphStarts) && paragraphStarts.length
    ? paragraphStarts.slice().sort((a, b) => a - b)
    : authoredParagraphStarts(text);
  const paragraphs = paragraphsFrom(text, starts);
  // How deep each paragraph actually set, in EQUIVALENT lines - the unit the
  // occupancy record uses, and the only one the policy can be stated in. A
  // fragment count would say a row a photograph splits in two is two lines.
  const paragraphDepths = paragraphs.map(() => 0);

  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    // Paragraph spacing: this paragraph's first row must start at or after
    // the PREVIOUS row's real bottom (whatever that row's own finalized
    // height turned out to be - it may have been a tall one) plus the air a
    // real paragraph gets - but ONLY while still in the same column the
    // previous paragraph ended in. A forced break already lands on a fresh
    // row (see below), so this only ever skips whole rows, never a partial
    // one, and a column change always lands at that column's own natural
    // top, never at an imported Y from the column before it.
    if (paragraph.forcedBreak && paragraphSpacingPx > 0 && lines.length && colIndex === lastLineColumnIndex) {
      const nextY = lines[lines.length - 1].y + lines[lines.length - 1].height + paragraphSpacingPx;
      while (colIndex === lastLineColumnIndex && colIndex < cursors.length) {
        if (!cursors[colIndex].hasRoom(bandHeight)) { colIndex += 1; break; }
        if (cursors[colIndex].y >= nextY - 0.5) break;
        const row = cursors[colIndex].probe(bandHeight);
        if (!row) { colIndex += 1; break; }
        for (const gap of row.gaps) {
          const gapWidth = gap.end - gap.start;
          intentionalGapWidth += gapWidth;
          intentionalEquivalent += gapWidth / columnMeasureAt(colIndex);
        }
        cursors[colIndex].commit(bandHeight);
      }
    }

    const pieces = breakPieces(paragraph.text);
    const paragraphSlots = [];
    let index = 0;
    let firstLineOfParagraph = true;
    // Characters of paragraph.text actually consumed so far - NOT the piece
    // index. A piece is a word plus its trailing space, almost never one
    // character, so the two cannot stand in for each other: `at` (and every
    // `line.at` a caller uses to re-locate a rendered line back into the
    // original body text, which render.js's mark re-application depends on)
    // has to be a real character offset or it points at the wrong text
    // entirely once a paragraph is more than a few words long.
    let paraCharOffset = 0;

    while (index < pieces.length) {
      while (colIndex < cursors.length && !cursors[colIndex].hasRoom(bandHeight)) colIndex += 1;
      // Out of room in every column - the trailing `if (index < pieces.length)`
      // below records everything still unplaced as overset. Exiting the
      // row-filling loop here (not the paragraph loop) is what lets that
      // check still run for THIS paragraph before the paragraph loop's own
      // `break` stops the whole pour.
      if (colIndex >= cursors.length) break;

      const cursor = cursors[colIndex];
      const result = fillRow(cursor, pieces, index, paraCharOffset, paragraph.offset,
        indentPx > 0 && firstLineOfParagraph && paragraph.forcedBreak);
      // Either no room at the ordinary height at all, or a run on this row
      // needs more height than this column has left (BUG 1) - either way,
      // nothing was consumed, so the same text is retried at the next
      // column rather than committed into an undersized line box.
      if (!result || result.retryNextColumn) { colIndex += 1; continue; }

      let consumedFrom = index;
      for (const p of result.placed) {
        if (p.empty) {
          emptyGapWidth += p.width;
          emptyEquivalent += p.measure / columnMeasureAt(colIndex);
          continue;
        }
        const equivalent = (p.occupies ?? p.measure) / columnMeasureAt(colIndex);
        occupiedEquivalent += equivalent;
        paragraphDepths[paragraphIndex] += equivalent;
        // Which pieces this line took, so the paragraph can be re-broken as a
        // whole once its real measures are known - see balanceParagraph().
        paragraphSlots.push({ index: lines.length, measure: p.measure, from: consumedFrom, to: p.pieceEnd });
        consumedFrom = p.pieceEnd;
        lines.push({
          text: p.text,
          at: p.at,
          x: p.x,
          y: result.row.y,
          width: p.width,
          measure: p.measure,
          height: result.height,
          baseline: result.row.y + fontPx * faceAscent(family, weight),
          fontPx,
          // The base family/weight this line was measured in (a bold RUN inside
          // the line is carried separately, as a real <b> mark - see
          // measurePieceWidth() - and needs no per-line override; only the base
          // face a renderer would otherwise have to re-derive from `view` itself
          // does).
          family,
          weight,
          // Whole-body paint decisions (Typography panel's Italic/Underline
          // toggles), not per-mark - neither changes a glyph's advance width
          // (no italic face is bundled; underline is ink under the baseline),
          // so they ride along on every line rather than affecting `measure()`.
          italic,
          underline,
          paragraphBreak: firstLineOfParagraph && paragraph.forcedBreak,
        });
        firstLineOfParagraph = false;
        usedWidth += p.width;
        if (p.hardOverset) {
          violations.push({
            code: 'UNBREAKABLE_TOKEN_OVERSET',
            detail: `"${p.text}" is ${Math.round(p.width)}px, wider than the ${Math.round(p.measure)}px this line offers anywhere.`,
            // Structured, not just in the message: a caller reporting "cut N
            // characters" needs this number without parsing English out of
            // `detail`. This token was drawn (it is not in `overset`, the
            // leftover text), so it is the only place its own length is
            // recorded.
            charsOver: clusters(p.text).length,
          });
        }
      }

      cursor.commit(result.height);
      lastLineColumnIndex = colIndex;
      index = result.cursorIndex;
      paraCharOffset = result.cursorOffset;
    }

    // Every line of this paragraph is placed and its real measures are known,
    // so the paragraph can now be broken PROPERLY rather than greedily.
    if (index >= pieces.length) {
      balanceParagraph(lines, pieces, paragraphSlots, paragraph.offset);
    }

    if (index < pieces.length) {
      // Ran out of room inside this paragraph. Everything from here on,
      // including every later paragraph, is overset - reported, not painted.
      //
      // Taken straight off the ORIGINAL text rather than reassembled from the
      // paragraph list, because the paragraphs tile it: the pour stopped
      // after `paraCharOffset` characters of this one, so everything from
      // there to the end is unplaced, blank lines and all. Reassembling it
      // could only ever reproduce the source approximately - the old version
      // put back a single `\n` where the author had typed two.
      overset = text.slice(paragraph.offset + paraCharOffset);
      break;
    }
  }

  // Any gap the pour never reached at all - the copy ran out before the
  // frame did - is exactly as unexplained as a gap a short line left short.
  // This is what makes a genuinely short story on a wide multi-column block
  // show up as a hole in every column it left untouched, not only in the
  // last column a line happened to be set in (which is all `bottomResidual`,
  // below, can see - it is a single scalar over the whole frame).
  for (; colIndex < cursors.length; colIndex += 1) {
    while (cursors[colIndex].hasRoom(bandHeight)) {
      const row = cursors[colIndex].probe(bandHeight);
      if (!row) break;
      for (const gap of row.gaps) {
        const gapWidth = gap.end - gap.start;
        emptyGapWidth += gapWidth;
        emptyEquivalent += gapWidth / columnMeasureAt(colIndex);
      }
      cursors[colIndex].commit(bandHeight);
    }
  }

  // Apply horizontal alignment. This never changes which text is on which
  // line - line-breaking above already decided that at natural (ragged)
  // width - only where that already-decided line is placed and, for
  // `justify`, how the SPACE inside it is stretched to fill the measure.
  // The last line of a paragraph is never justified, matching ordinary
  // typesetting: a short last line stretched to the full measure reads as a
  // mistake, not as "full".
  // A column too narrow to justify is set flush left instead - one decision
  // for the whole block, so its right edge is consistently ragged rather
  // than sometimes straight. See JUSTIFY_MIN_EM.
  const columnEm = columns.length ? (columns[0].end - columns[0].start) / fontPx : 0;
  const tooNarrowToJustify = align === 'justify' && columnEm > 0 && columnEm < JUSTIFY_MIN_EM;
  if (tooNarrowToJustify) align = 'left';

  if (align && align !== 'left') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isLastOfParagraph = i === lines.length - 1 || lines[i + 1].paragraphBreak;
      const slack = Math.max(0, line.measure - line.width);
      if (align === 'right') line.x = line.x + slack;
      else if (align === 'center') line.x = line.x + slack / 2;
      else if (align === 'justify' && !isLastOfParagraph) justifyLine(line, slack);
    }
  }

  const availableEquivalent = occupiedEquivalent + emptyEquivalent;

  return {
    lines,
    overset,
    violations,
    // The authoritative answer to "how full is the body", in equivalent
    // lines. `lines.length` is a FRAGMENT count and is never this number.
    occupancy: {
      occupiedEquivalentLines: Number(occupiedEquivalent.toFixed(3)),
      emptyEquivalentLines: Number(emptyEquivalent.toFixed(3)),
      intentionalEquivalentLines: Number(intentionalEquivalent.toFixed(3)),
      availableEquivalentLines: Number(availableEquivalent.toFixed(3)),
      ratio: availableEquivalent > 0 ? Math.min(1, occupiedEquivalent / availableEquivalent) : 0,
      renderedFragments: lines.length,
    },
    intentionalGapWidth,
    // Room, expressed the way the AI brief and the worklist want it: how many
    // full-measure lines of this type the block still has. Derived from real
    // geometry rather than from a cell count.
    usableWidth,
    usedWidth,
    emptyGapWidth,
    measures,
    bandHeight,
    tooNarrowToJustify,
    columnEm: Number(columnEm.toFixed(2)),
    fullMeasureEquivalents: usableWidth / Math.max(1, columns[0].end - columns[0].start),
    paragraphStarts: starts,
    paragraphDepths: paragraphDepths.map((d) => Number(d.toFixed(3))),
  };
}

// The mean advance of one Marathi cluster, measured here rather than guessed,
// from a sentence carrying the ordinary spread of matras, conjuncts and
// spaces. Used only to turn a width budget back into a number of characters
// for the AI brief and the worklist - the composition itself never needs it,
// because it measures the real text.
const CALIBRATION = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे. ';

// The two ends of the range, and why there has to BE a range.
//
// A character is not a unit of width in Marathi, and the spread is not small.
// Poured through the same 180x620 column, calibration prose sets 36 characters
// to the line at 96.6% fill; a sentence of short plain words sets 30.2 at
// 87.1%. Conjunct-heavy copy hides many zero-width codepoints inside one
// akshara, so it packs far more CHARACTERS into the same pixels. Measured
// across four block shapes, the capacity of one block varies by 30-46%
// depending only on what is written into it.
//
// Clusters were tried as a stabler unit and are worse - 68-87% - because a
// conjunct collapses several codepoints into one wide cluster.
//
// So there is no scalar budget that is both safe and useful, and pretending
// otherwise is what produced a budget that had to be discounted 15% and then
// systematically underfilled every block on the page. What is quoted instead
// is the geometry (line equivalents, which do not vary at all) plus an honest
// character RANGE, and the guarantee is moved to where it can be kept: exact
// measurement after the copy exists.
// Both probe WORD SHAPE, and both are set at the same sentence length as
// CALIBRATION on purpose. A paragraph break costs room (see capacityChars()),
// so a sample that reaches a full stop every 27 characters is measuring its
// own punctuation as much as this block's width - which is a different
// question from the one these two exist to ask.
const WIDEST_PER_CHAR = 'कमल गगन सरल पवन नयन जल थल कमल गगन सरल पवन नयन जल थल कमल गगन सरल. ';
const NARROWEST_PER_CHAR = 'ज्ञानेश्वर श्रद्धांजली क्षेत्रफळ विद्यार्थ्यांसाठी श्रद्धांजली क्षेत्रफळ. ';

// A line never fills its measure exactly: it ends when the next word will not
// fit, so it leaves a ragged tail. That tail is not a rounding error - it is
// the difference between briefing the AI for copy that fits and briefing it
// for copy that overflows and then costs a second paid call to repair.
//
// It also cannot be estimated. Deducting a fixed share of a word per line was
// tried and measured against the true capacity of eighteen real block shapes:
// it still over-promised on fourteen of them, by between 0.2% and 12%,
// because how much a ragged edge wastes depends on how the word lengths
// happen to land in that particular measure. There is no constant that is
// right for a 140px column and a 620px one at once.
//
// So the budget is POURED rather than computed: calibration copy is run
// through this block's own real gaps - the same gaps the story will be set
// in, photographs and all - and what lands is what the block holds.
function capacityChars(measures, fontPx, family, sample = CALIBRATION, letterSpacingPx = 0, indentPx = 0) {
  const pieces = breakPieces(sample);
  if (!pieces.length) return 0;
  let chars = 0;
  let at = 0;
  // The calibration is poured in PARAGRAPHS, at the cadence this block's own
  // GEOMETRY forces - because a paragraph break costs room and the budget has
  // to know it. The last line of a paragraph ends where the copy ends rather
  // than where the next word will not fit, and the first line of the next one
  // starts an em in. Pouring one continuous run instead quoted a floor that a
  // block then overflowed the moment the compositor broke the copy up.
  //
  // BOTH ceilings are applied, because the compositor applies both, and a
  // break SAHAS itself decides to set is not the writer's to pay for. That
  // makes the samples' own sentence length load-bearing, which is why all
  // three are written at an ordinary newspaper sentence length: an earlier
  // WIDEST_PER_CHAR reaching a full stop every 27 characters was measuring
  // its own punctuation and dropped the quoted floor by 25%.
  let linesInParagraph = 0;
  let sentencesInParagraph = 0;
  const endsSentence = /[।॥.!?][)"'\u201d\u2019]*\s*$/u;
  for (const measureWidthPx of measures) {
    const room = measureWidthPx - (linesInParagraph === 0 && chars > 0 ? indentPx : 0);
    let line = '';
    let width = 0;
    let closed = false;
    while (true) {
      const piece = pieces[at % pieces.length];
      const pieceWidth = measure(piece, fontPx, family, 400, letterSpacingPx);
      if (line && width + pieceWidth > room + 0.5) break;
      if (!line && pieceWidth > room + 0.5) { line = piece; at += 1; break; }
      line += piece;
      width += pieceWidth;
      at += 1;
      if (endsSentence.test(piece)) {
        sentencesInParagraph += 1;
        if (sentencesInParagraph >= MAX_PARAGRAPH_SENTENCES) { closed = true; break; }
      }
    }
    chars += line.length;
    linesInParagraph += 1;
    if (closed || linesInParagraph >= MAX_PARAGRAPH_LINES) {
      linesInParagraph = 0;
      sentencesInParagraph = 0;
    }
  }
  return chars;
}

// Real copy's ragged edges land a little differently from the calibration's,
// even at the same word lengths. This covers that much and no more - the
// large uncertainty is expressed as a range, not buried in a discount.
const BUDGET_SAFETY = 0.97;

// ---------------------------------------------------------------- the call ---

function gapBetween(from, to, fontPx) {
  return (GAP_EM[`${from}>${to}`] ?? 0.3) * fontPx;
}

function hash(value) {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Composes one editorial block.
 *
 * Everything is in the block's own logical pixels. A surface that wants it
 * bigger scales the whole result; it must never re-run this with different
 * numbers, because that is a different composition.
 *
 * `input.body` may be a plain string (no marks, as before) or
 * `{ text, marks }` (rich-text.js's `textWithMarks()` shape) - the latter
 * lets a bold or italic run be measured at its own real width rather than
 * measured plain and painted bold afterwards.
 */
export function composeBlock(input = {}) {
  const width = num(input.width, 0);
  const height = num(input.height, 0);
  const padding = Number.isFinite(Number(input.padding)) ? Number(input.padding) : 12;
  // Body family only - headline/kicker/deck are always the paper's own sans
  // face at the paper's own weights, matching the stylesheet exactly (see
  // DISPLAY_TYPOGRAPHY above). A whole-story font-family override (the
  // Typography panel's "Georgia" etc.) is a body-only control in the actual
  // CSS too: it never touches `.section-headline`.
  const bodyFamily = input.fontFamily || 'serif';
  // Same body-only scope as bodyFamily above: the Typography panel's weight/
  // italic/underline map onto `.section-body` in the real stylesheet, never
  // `.section-headline`/`.section-subheading`, which stay the paper's own
  // fixed weights (DISPLAY_TYPOGRAPHY). Canonicalised to the two weights a
  // physical bundled face exists for - the same rule faceMetrics() enforces,
  // so a block asking for "Semibold" (600) measures and paints in the same
  // face it will actually get.
  const bodyWeight = publicationWeight(input.fontWeight);
  const bodyItalic = Boolean(input.fontItalic);
  const bodyUnderline = Boolean(input.fontUnderline);

  const content = {
    left: padding,
    top: padding,
    right: Math.max(padding, width - padding),
    bottom: Math.max(padding, height - padding),
  };
  const measureAvail = content.right - content.left;
  const room = content.bottom - content.top;

  const bodyPx = Math.max(MIN_LEGIBLE_PX, num(input.bodyFontPx, 16));
  // The line box can never be shorter than the face itself needs. Marathi
  // stacks signs above the shirorekha and below the baseline; a box tighter
  // than ascent + descent crops them, which is a property of the script and
  // not a taste setting. Read from the font rather than guessed.
  const floor = minLineHeightFor(bodyFamily, 400);
  const lineHeight = Math.max(floor, num(input.lineHeight, floor));
  // Zero is the ordinary case and a real, legal choice - never clamped to a
  // minimum the way font sizes are. A negative value (tracking IN, not out)
  // is bounded so a run cannot be measured as narrower than its own glyphs.
  const letterSpacingPx = Math.max(-2, Number(input.letterSpacingPx) || 0);
  const paragraphSpacingPx = Math.max(0, num(input.paragraphSpacingPx, 0));

  const images = (input.images || []).filter(Boolean);
  const violations = [];
  const warnings = [];

  // ------------------------------------------- the shaper is not optional ---
  //
  // Without HarfBuzz this engine falls back to summing hmtx advances, which
  // overstates a Devanagari conjunct by up to 80% (shaper.js has the
  // measurements). That is not a rougher version of the same page, it is a
  // DIFFERENT page, and it used to happen in total silence - `exactShaping`
  // was recorded on the result and nothing anywhere looked at it.
  //
  // MEASURED across 600 real article blocks, composing each one twice:
  // 29.7% set in a different number of lines, the mean fill ratio moved 3.7
  // points, three blocks reported an overset that does not exist, and one
  // block came out with a different number of paragraphs. The worst single
  // block read 93.8% full one way and 58.7% the other - same copy, same
  // frame.
  //
  // In NODE the fallback is never legitimate: harfbuzzjs is a local package
  // and the fonts are local files, so `exactShaping: false` there is always a
  // caller that forgot `ensureShaperReady()`, never a state worth rendering.
  // So it is refused, loudly, with the same error name requireShaperReady()
  // already throws. (This had already been found and fixed once by hand in
  // tests/compose.test.js, and had since come back in a script and a test -
  // which is why it is closed here rather than in the callers alone.)
  //
  // In the BROWSER it is a real, momentary state - the page composes once
  // before the WASM and the four faces have finished downloading - so there
  // it stays a warning, beside FONT_NOT_READY, which is the same situation
  // for the same reason.
  const shaperReady = isShaperReady();
  if (!shaperReady) {
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      throw new Error('EXACT_SHAPER_NOT_READY');
    }
    warnings.push({
      code: 'SHAPING_NOT_READY',
      detail: 'Composed with summed advances, not real shaping - conjunct-heavy Marathi is reserved wider than it prints, '
        + 'and line counts change once the shaper loads.',
    });
  }
  const result = {
    engineVersion: ENGINE_VERSION,
    fontReady: fontsReady(),
    exactShaping: shaperReady,
    frame: { width, height, padding },
    content: { ...content, measure: measureAvail, room },
    bands: {},
    bodyLines: [],
    columns: [],
    typography: { bodyPx, lineHeight, family: bodyFamily, weight: bodyWeight, italic: bodyItalic, underline: bodyUnderline },
    violations,
    warnings,
  };

  // No usable measure at all - a zero-width or zero-height frame, or a margin
  // wider than the block. There is no pour here and no `body`, so nothing
  // that reads one belongs in this branch: NO_LEGAL_MEASURE and
  // SET_FLUSH_LEFT were pasted in here by mistake and turned every such block
  // into a ReferenceError (`body` is declared far below, so the read hit its
  // temporal dead zone) instead of the NO_ROOM result the caller expects. In
  // the browser that is an uncaught throw in the middle of painting the
  // canvas - a blank block, with the cause nowhere on screen.
  if (measureAvail <= 0 || room <= 0) {
    result.fitState = 'NO_ROOM';
    result.whitespace = { intentional: width * height, unexplained: 0, bottomResidualPx: 0, bottomResidualLines: 0, unexplainedLines: 0, largestHoleLines: 0 };
    result.capacity = { fullMeasureEquivalents: 0, bodyClusterCapacity: 0 };
    result.overset = { headline: '', deck: '', kicker: '', body: '' };
    result.fingerprint = hash(`${width}x${height}`);
    return result;
  }

  // A block whose type is not ready to be measured must say so. A page
  // composed against a fallback measurement and then repainted when the real
  // shaper/font arrives is two different pages, and only one of them was
  // approved.
  // The shaper's own warning is raised above, where the fallback is decided -
  // it used to sit in this `else`, which made it unreachable whenever the
  // font was ALSO not ready, and the two are separate failures.
  if (!result.fontReady) warnings.push({ code: 'FONT_NOT_READY', detail: 'Composed before the publication font was measurable; sizes are estimated.' });

  // Each display object's own alignment. These are separate persisted fields
  // (schema.sql's headline_align/subheading_align) because they are separate
  // objects on the page: a centred headline over justified copy is an
  // ordinary Marathi front page, and one `text_align` for the whole block
  // could not say it. The kicker follows the headline deliberately - it is
  // the headline's own overline, not a third thing to align, and giving it a
  // control of its own would only let a desk knock it out of step.
  const headlineAlign = input.headlineAlign || DEFAULT_DISPLAY_ALIGN;
  const deckAlign = input.subheadingAlign || DEFAULT_DISPLAY_ALIGN;

  // Growth is a preference, and the one thing it must never buy is overset
  // copy - see the recomposition at the foot of this function, which is what
  // clears this flag on the way back through.
  const mayGrowHeadline = input.headlineGrowth !== false;

  // A display flow arrives either as plain text or - since a sub-editor may
  // bold a name inside a headline exactly as inside a story - as the same
  // { text, marks } pair the body already takes. `marks` are held against the
  // flow's own plain text, so a headline's offsets are its own and never the
  // body's.
  const flowOf = (value) => (value && typeof value === 'object'
    ? { text: String(value.text || ''), marks: value.marks || null }
    : { text: String(value || ''), marks: null });

  const flows = [
    { key: 'kicker', ...flowOf(input.kicker), px: Math.round(bodyPx * 1.05), min: MIN_LEGIBLE_PX, maxLines: 2, locked: true, align: headlineAlign, ...DISPLAY_TYPOGRAPHY.kicker },
    { key: 'headline', ...flowOf(input.headline), px: num(input.headlineFontPx, 34), min: Math.max(MIN_LEGIBLE_PX, bodyPx * 1.1), maxLines: num(input.headlineMaxLines, 4), preferLines: HEADLINE_MAX_LINES, locked: Boolean(input.headlineLocked), align: headlineAlign, ...DISPLAY_TYPOGRAPHY.headline },
    { key: 'deck', ...flowOf(input.subheading), px: num(input.subheadingFontPx, 20), min: Math.max(MIN_LEGIBLE_PX, bodyPx), maxLines: num(input.deckMaxLines, 3), locked: Boolean(input.subheadingLocked), align: deckAlign, ...DISPLAY_TYPOGRAPHY.deck },
  ].filter((flow) => flow.text.trim());

  let y = content.top;
  let previous = null;

  for (const flow of flows) {
    if (previous) y += gapBetween(previous, flow.key, Math.max(flow.px, result.bands[previous]?.resolvedPx || flow.px));

    // The headline is the one flow with a share limit: it is the page's
    // hierarchy, but a block that is all headline holds no story.
    const share = flow.key === 'headline' ? MAX_HEADLINE_SHARE : 0.7;
    // Two limits, and the display one is ABSOLUTE - measured from the top of
    // the content, not from wherever the previous flow happened to end. A
    // per-flow share measured from a running `y` is a share of what is LEFT,
    // which compounds: that is how a headline and a deck each inside their own
    // limit ended up taking half the block between them.
    const set = fitDisplayFlow(flow.text, {
      top: y,
      bottomLimit: Math.min(content.bottom, content.top + room * MAX_DISPLAY_SHARE, y + room * share),
      column: { start: content.left, end: content.right },
      images,
      fontPx: flow.px,
      lineHeight: Math.max(1.1, lineHeight - 0.15),
      family: flow.family,
      weight: flow.weight,
      maxLines: flow.maxLines,
      letterSpacingPx,
      align: flow.align,
      marks: flow.marks,
    }, {
      locked: flow.locked,
      minPx: flow.min,
      // Only the headline is written to a count. The deck is subordinate
      // type: growing it to fill would steal the story's room to straighten
      // the edge of a line nobody reads as the block's voice, and it would
      // close the size gap that makes the headline the headline.
      maxPx: flow.key === 'headline' && mayGrowHeadline
        ? Math.min(MAX_DISPLAY_PX, Math.floor(flow.px * HEADLINE_GROWTH_CAP))
        : 0,
      fillTarget: flow.key === 'headline' ? HEADLINE_FILL_TARGET : 0,
      preferLines: flow.preferLines || 0,
      roomyBottomLimit: Math.min(content.bottom, y + room * share),
    });

    result.bands[flow.key] = {
      top: y,
      height: set.height,
      lines: set.lines,
      lineCount: set.lineCount,
      requestedPx: flow.px,
      resolvedPx: set.resolvedPx,
      shrunk: set.shrunk,
      grew: Boolean(set.grew),
      align: flow.align,
      // The flow's own marks, carried on the band so render.js can re-apply
      // them through each line's `at` without having to re-derive which of the
      // view's fields this band came from.
      marks: flow.marks || [],
      overset: set.overset,
    };

    if (set.overset) {
      violations.push({
        code: flow.locked ? `${flow.key.toUpperCase()}_OVERSET_LOCKED` : `${flow.key.toUpperCase()}_OVERSET`,
        detail: `${set.overset.length} characters of the ${flow.key} have no legal room in this block.`,
      });
    }
    for (const v of set.violations) violations.push({ ...v, code: `${flow.key.toUpperCase()}_${v.code}` });
    if (set.shrunk) {
      warnings.push({ code: `${flow.key.toUpperCase()}_AUTO_FITTED`, detail: `Set at ${set.resolvedPx}px rather than the requested ${flow.px}px.` });
    }

    y = set.bottom;
    previous = flow.key;
  }

  // See the recomposition at the foot of this function: this block's headline
  // WOULD fill its measure at a larger size, and the only thing standing in
  // the way is that the copy is already at the foot. That is a choice between
  // a straight right edge and a sentence, it belongs to the desk, and the desk
  // can only make it if it is told the choice exists.
  const denied = input.headlineGrowthDenied;
  if (denied) {
    warnings.push({
      code: 'HEADLINE_COULD_FILL',
      detail: `This headline would fill its measure at ${denied.px}px rather than ${denied.requestedPx}px, `
        + `but the block is full: ${denied.charsOver} characters of copy would have no room. `
        + 'Cut the copy and set the headline larger, or leave it as it is.',
    });
  }

  const bodyTop = previous ? y + gapBetween(previous, 'body', result.bands[previous].resolvedPx) : content.top;
  result.bodyTop = bodyTop;

  const gutter = num(input.gutterPx, Math.round(bodyPx * 0.9));
  // An explicit column count means exactly that count, including 1 - a
  // desk's own "set this in one column" is not the same request as "no
  // opinion, work it out". Only a genuinely missing/non-finite value falls
  // through to the width-based auto-inference.
  const requestedColumns = Number(input.columnCount);
  const columnCount = Number.isFinite(requestedColumns) && requestedColumns >= 1
    ? requestedColumns
    : Math.max(1, Math.min(4, Math.floor(Math.max(0, measureAvail - 2 * (Number(input.marginPx) || 12)) / 150)));
  const columns = columnsOf(content, columnCount, gutter);
  result.columns = columns;

  const bodyInput = input.body && typeof input.body === 'object' ? input.body : String(input.body || '');
  const pourOptions = {
    top: bodyTop,
    bottom: content.bottom,
    columns,
    images,
    fontPx: bodyPx,
    lineHeight,
    family: bodyFamily,
    weight: bodyWeight,
    align: input.textAlign || 'left',
    paragraphSpacingPx,
    letterSpacingPx,
    italic: bodyItalic,
    underline: bodyUnderline,
    firstLineIndentPx: Math.max(0, num(input.firstLineIndentPx, 0)),
  };

  // ------------------------------------------------ the paragraph policy ---
  //
  // Pour once with every authored break set, look at how deep each paragraph
  // ACTUALLY came out, and pour again with the breaks this block can carry.
  //
  // Two passes and not one, because a paragraph's depth is not knowable
  // before the pour: it depends on the measure, on the photographs standing
  // in the copy, and on where the words happen to fall. Estimating it from a
  // character count is the mistake this codebase has already made, measured
  // and retired - see "the character budget is a range" in CLAUDE.md. So the
  // policy reads a real composition and the decision it makes is composed
  // exactly, rather than predicted.
  //
  // Two passes and not more, deliberately. Merging can only make a paragraph
  // deeper (it removes an indent and repacks) and splitting only shallower,
  // so a third pass would be chasing a boundary case at the cost of doubling
  // the work again on every keystroke. `result.typography.paragraphs` records
  // what the second pass did, so a surface that disagrees can say so.
  let body = pourBody(bodyInput, pourOptions);
  const bodyPlainText = typeof bodyInput === 'object' ? bodyInput.text : bodyInput;
  let paragraphPlan = null;
  if (mayNeedPolicy(bodyPlainText, body.paragraphStarts, body.paragraphDepths)) {
    paragraphPlan = planParagraphs({
      text: bodyPlainText,
      starts: body.paragraphStarts,
      depths: body.paragraphDepths,
    });
    if (paragraphPlan.changed) {
      body = pourBody(bodyInput, { ...pourOptions, paragraphStarts: paragraphPlan.starts });
    }
  }

  // ------------------------------- filling the headline never costs a word ---
  //
  // Growing the headline to its measure takes depth off the top of the copy,
  // and on a block that was already full to the foot that depth is somebody's
  // last sentence. A straight right edge is worth a great deal; it is not
  // worth a word pushed off a printed page, which is the same order this
  // engine's other preferences already yield in (HEADLINE_MAX_LINES to
  // overset, the display share to DECK_OVERSET).
  //
  // So the check is made where the answer is actually known - after the pour,
  // which is the only thing that can say whether the copy still fits - and
  // the whole block is composed once more with the growth withheld. Recursion
  // is one level deep by construction: the second pass sets
  // `headlineGrowth: false`, so it cannot grow and cannot re-enter.
  //
  // A block that is overset EITHER way keeps the ungrown headline. That is the
  // conservative reading and it costs nothing real: a block whose copy has to
  // be cut is a block the desk is about to work on anyway, and copyFit's
  // trimToFit() will re-compose it the moment it does.
  if (result.bands.headline?.grew && (body.overset || result.bands.deck?.overset)) {
    return composeBlock({
      ...input,
      headlineGrowth: false,
      // What the block gave up, carried into the second pass so it can be
      // REPORTED. A headline that stops short of its measure on a block full
      // to the foot is not a defect the software may fix on its own - the fix
      // is a sentence out of somebody's story - but it is a decision, and a
      // decision nobody was told about is one nobody can take.
      headlineGrowthDenied: {
        px: result.bands.headline.resolvedPx,
        requestedPx: result.bands.headline.requestedPx,
        charsOver: clusters(body.overset || result.bands.deck?.overset || '').length,
      },
    });
  }

  result.bodyLines = body.lines;
  // What the compositor did with the author's breaks. Authored is what the
  // reporter typed; set is what this block's own measure can carry.
  result.typography.paragraphs = {
    authored: paragraphPlan ? paragraphPlan.authoredCount : body.paragraphStarts.length,
    set: body.paragraphStarts.length,
    merged: paragraphPlan ? paragraphPlan.merged : 0,
    split: paragraphPlan ? paragraphPlan.split : 0,
    depths: body.paragraphDepths,
  };
  result.overset = {
    kicker: result.bands.kicker?.overset || '',
    headline: result.bands.headline?.overset || '',
    deck: result.bands.deck?.overset || '',
    body: body.overset,
  };
  if (body.overset) {
    violations.push({ code: 'BODY_OVERSET', detail: `${clusters(body.overset).length} clusters of copy have no room in this block.` });
  }
  for (const v of body.violations) violations.push({ ...v, code: `BODY_${v.code}` });

  // ------------------------------------------------------------ whitespace ---
  //
  // The point of separating these two is that one of them is a problem and
  // the other is how printed type works. A remainder smaller than one legal
  // line at the foot of a column cannot be filled by anything - chasing it
  // costs an AI call and buys nothing. A rectangle that would hold six lines
  // is a hole, and it is what the desk is actually complaining about.

  const bandHeight = body.bandHeight;

  // ------------------------------------------------- vertical justification ---
  //
  // A newspaper's columns bottom out level. When a story ends a little short
  // of the foot, a compositor does NOT go looking for another sentence - it
  // opens the leading by a point or two and lets the copy fill the column.
  // InDesign calls it vertical justification; every printed page uses it.
  //
  // This is the last fraction, and only the last fraction. Copy is written in
  // whole SENTENCES, so the writer can only ever get within about a line of
  // the foot: adding one more sentence overflows, and trimming it takes the
  // whole sentence back out again. That granularity is why a block kept
  // stopping at 86% however many times it was asked for more words. Nothing
  // can be written into a gap smaller than a line; the type has to close it.
  //
  // Bounded twice over, so it can never hide a real hole or visibly loosen
  // the page: at most one band's worth of residual is absorbed, and no single
  // line gap opens by more than a few percent. Anything bigger is a genuine
  // hole and stays one, for the writer to fill with words.
  const MAX_LEADING_STRETCH = 0.12;
  const MAX_ABSORBED_BANDS = 1;
  let absorbedPx = 0;
  if (body.lines.length > 1 && !body.overset) {
    const rowTops = [...new Set(body.lines.map((line) => Number(line.y.toFixed(3))))].sort((x, y) => x - y);
    const gaps = rowTops.length - 1;
    const lastLineBottom = Math.max(...body.lines.map((line) => line.y + line.height));
    const residual = Math.min(content.bottom - lastLineBottom, MAX_ABSORBED_BANDS * bandHeight);
    if (gaps > 0 && residual > 0.5) {
      const delta = Math.min(residual / gaps, MAX_LEADING_STRETCH * bandHeight);
      absorbedPx = delta * gaps;
      const shiftOf = new Map(rowTops.map((top, i) => [top, i * delta]));
      for (const line of body.lines) {
        const shift = shiftOf.get(Number(line.y.toFixed(3))) || 0;
        line.y += shift;
        line.baseline += shift;
      }
    }
  }

  const lastBottom = body.lines.length
    ? Math.max(...body.lines.map((line) => line.y + line.height))
    : bodyTop;
  const bottomResidualPx = Math.max(0, content.bottom - lastBottom);
  const bottomResidualLines = bandHeight > 0 ? bottomResidualPx / bandHeight : 0;

  // Usable room the copy did not take, counted in full-measure lines. Gaps a
  // photograph made unusable were never counted as usable in the first place
  // (viableIntervals), so they cannot show up here as a hole; and the ragged
  // right end of a line that IS set is not a hole either (see pourBody).
  const columnMeasure = columns[0].end - columns[0].start;
  const unexplainedLines = columnMeasure > 0 ? body.emptyGapWidth / columnMeasure : 0;

  // Space that is doing a job: the margins, the gutters, and the room the
  // display type and its optical transitions legitimately take off the top.
  const intentionalArea =
    width * height - measureAvail * room
    + gutter * Math.max(0, columns.length - 1) * Math.max(0, content.bottom - bodyTop)
    + measureAvail * Math.max(0, bodyTop - content.top);

  // A picture can leave a block with real vertical depth and yet no band wide
  // enough to set a line in - the corridor beside it is under one word wide,
  // so every band is refused and the whole story reports as overset while the
  // block LOOKS half empty. Measured on a real 190x264 block: 130 px of body
  // depth, zero legal bands, 199 characters with nowhere to go, and nothing on
  // screen said why. It is a layout that cannot be printed, and the desk can
  // only fix it if it is told.
  //
  // Only for a block that is MEANT to carry copy. A display advert or a photo
  // block is a picture and nothing else, and a full-bleed image on one is the
  // finished thing - telling a desk to "make a picture narrower" about it is
  // wrong, and it was wrong on 49 of the 51 blocks this fired on, which is how
  // a warning stops being read.
  const expectsCopy = input.expectsCopy !== undefined
    ? Boolean(input.expectsCopy)
    : String(bodyPlainText || '').trim().length > 0;
  if (expectsCopy && body.occupancy.availableEquivalentLines < 0.01 && content.bottom - bodyTop > bandHeight) {
    warnings.push({
      code: 'NO_LEGAL_MEASURE',
      detail: `This block has ${Math.round(content.bottom - bodyTop)}px of depth for copy, but its pictures leave no `
        + `column wide enough to set ${bodyPx}px type in. Make a picture narrower, move it, or set the body smaller.`,
    });
  }
  if (body.tooNarrowToJustify) {
    warnings.push({
      code: 'SET_FLUSH_LEFT',
      detail: `A ${body.columnEm} em column is too narrow to justify - two or three words to the line leave nowhere `
        + 'to put the space. Set flush left instead, as a printed newspaper sets a narrow column.',
    });
  }

  // Room the leading took is no longer room a writer could fill - it is set,
  // in exactly the way a printed column is set.
  const occupancy = { ...body.occupancy };
  if (absorbedPx > 0 && bandHeight > 0) {
    const absorbedLines = Math.min(occupancy.emptyEquivalentLines, absorbedPx / bandHeight);
    occupancy.emptyEquivalentLines = Number((occupancy.emptyEquivalentLines - absorbedLines).toFixed(3));
    occupancy.leadingAbsorbedLines = Number((absorbedPx / bandHeight).toFixed(3));
    occupancy.availableEquivalentLines = Number((occupancy.occupiedEquivalentLines + occupancy.emptyEquivalentLines).toFixed(3));
    occupancy.ratio = occupancy.availableEquivalentLines > 0
      ? Math.min(1, occupancy.occupiedEquivalentLines / occupancy.availableEquivalentLines)
      : 0;
  }

  result.whitespace = {
    intentional: Math.round(intentionalArea + body.intentionalGapWidth * bandHeight),
    unexplained: Math.round(body.emptyGapWidth * bandHeight),
    bottomResidualPx: Math.round(bottomResidualPx),
    // Kept as DIAGNOSTICS. Neither is the fill verdict, and taking the larger
    // of the two was a category error: `bottomResidualLines` is a single
    // scalar over the whole frame (it cannot see a hole in a column a line
    // was not last set in), while `unexplainedLines` is a width sum that
    // could not tell paragraph air from missing copy.
    bottomResidualLines: Number(bottomResidualLines.toFixed(2)),
    unexplainedLines: Number(unexplainedLines.toFixed(2)),
    // The one number the desk and the writer act on, now in the same unit as
    // everything else: equivalent lines of legal, fillable body measure that
    // received no type. Room a photograph made unusable was never counted as
    // usable, and air a paragraph break asked for is `intentional`, not this.
    largestHoleLines: occupancy.emptyEquivalentLines,
    occupancy,
  };

  const pour = (sample) => Math.floor(
    capacityChars(body.measures, bodyPx, bodyFamily, sample, letterSpacingPx, Math.max(0, num(input.firstLineIndentPx, 0))) * BUDGET_SAFETY,
  );
  const charCapacity = pour(CALIBRATION);
  // The ends of the range are whichever samples actually pack worst and best
  // in THIS measure, not whichever was expected to. In a narrow column long
  // conjunct words waste more at the line end than they save in width, so
  // which sample is the ceiling genuinely changes with the block.
  const poured = [charCapacity, pour(WIDEST_PER_CHAR), pour(NARROWEST_PER_CHAR)];
  const charFloor = Math.min(...poured);
  const charCeiling = Math.max(...poured);
  const codepointsPerCluster = CALIBRATION.length / clusters(CALIBRATION).length;
  result.capacity = {
    fullMeasureEquivalents: Number(body.fullMeasureEquivalents.toFixed(2)),
    // What the AI is briefed with and what the worklist quotes, in both
    // units. Clusters are what a reader sees; codepoints are what a model
    // counts. A Marathi word of six visible units is thirteen codepoints, so
    // the two differ by more than a factor of two and quoting the wrong one
    // asks for half or double the copy the block holds.
    bodyClusterCapacity: Math.round(charCapacity / codepointsPerCluster),
    // What to brief a writer with, for ordinary prose.
    bodyCharCapacity: charCapacity,
    // And the honest spread around it: `min` is what fits even if every word
    // turns out to be plain consonants, `max` what fits if the copy is
    // conjunct-heavy. A caller that must not be wrong quotes `min`.
    bodyCharRange: { min: Math.min(charFloor, charCeiling), max: Math.max(charFloor, charCeiling) },
    bodyCharCapacityFloor: Math.min(charFloor, charCeiling),
    bodyClustersUsed: clusters(String(bodyPlainText || '')).length,
    bodyCharsUsed: String(bodyPlainText || '').length,
  };

  // A hole is only a hole if there is something a writer could actually do
  // about it. The budget is deliberately conservative, so copy written
  // exactly to it leaves a little geometric room over - counting that as a
  // hole would flag every correctly-filled block and spend a repair call
  // chasing the safety margin.
  // Measured against the SAFE end of the range: a block is only short of copy
  // if it is short even for the least efficient prose anyone might file.
  result.capacity.shortfallChars = Math.max(0, result.capacity.bodyCharRange.min - result.capacity.bodyCharsUsed);
  // ...and a shortfall smaller than one line is not one either, for exactly
  // the reason the geometric remainder is not: nothing can be written into
  // it. Both halves of the test are therefore "at least one legal line".
  // Per equivalent LINE, not per gap. `body.measures` is the list of legal
  // gaps in the calibration grid, and around a cut-out one row contributes
  // several of them - dividing by that count is the same fragment-vs-line
  // confusion `bodyFill()` was carrying.
  const equivalents = Number(body.fullMeasureEquivalents) || 0;
  const charsPerLine = equivalents > 0 ? result.capacity.bodyCharRange.min / equivalents : 0;
  const holed = result.whitespace.largestHoleLines >= HOLE_LINES
    && result.capacity.shortfallChars > charsPerLine;

  // A block is OVERSET if any flow ran out of room for its own text
  // (`overset`, leftover pieces) OR if it painted a token wider than its
  // frame allowed anywhere (a hard violation - see setDisplayFlow/pourBody).
  // The second case used to be invisible: the token was drawn, `overset`
  // stayed empty, and the block reported FITS or UNDERFILLED while
  // physically painting outside its own measure.
  const oversetCodes = ['_OVERSET', '_OVERSET_LOCKED', 'UNBREAKABLE_TOKEN_OVERSET'];
  result.fitState = violations.some((v) => oversetCodes.some((code) => v.code.endsWith(code)))
    ? 'OVERSET'
    : (!flows.length && !body.lines.length ? 'EMPTY' : (holed ? 'UNDERFILLED' : 'FITS'));

  result.fingerprint = hash([
    ENGINE_VERSION, width, height, padding, bodyPx, lineHeight, bodyFamily, input.textAlign,
    headlineAlign, deckAlign,
    bodyWeight, bodyItalic, bodyUnderline,
    input.headlineFontPx, input.subheadingFontPx, input.columnCount,
    letterSpacingPx, paragraphSpacingPx, input.firstLineIndentPx,
    input.headlineMaxLines, input.deckMaxLines,
    flows.map((flow) => `${flow.key}:${flow.text}:${JSON.stringify(flow.marks || [])}`).join('|'), bodyPlainText,
    JSON.stringify((typeof bodyInput === 'object' && bodyInput.marks) || []),
    images.map(imageFingerprint).join('|'),
  ].join(''));

  return result;
}
