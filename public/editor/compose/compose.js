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
import { subtract, viableIntervals, MIN_CORRIDOR_EM } from './intervals.js';
import { bandObstacles, maskHash } from './exclusion.js';

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
}) {
  const pieces = breakPieces(text);
  if (!pieces.length) return { lines: [], height: 0, bottom: top, overset: '', lineCount: 0, violations: [] };

  const bandHeight = fontPx * lineHeight;
  const lines = [];
  const violations = [];
  let index = 0;
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
    let line = '';
    let width = 0;
    let hardOverset = false;

    while (index < pieces.length) {
      const piece = pieces[index];
      const pieceWidth = measure2(piece, fontPx, family, weight);
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
        break;
      }
      line += piece;
      width += pieceWidth;
      index += 1;
    }

    const trimmed = trimEndClusters(line);
    if (trimmed) {
      const drawnWidth = measure2(trimmed, fontPx, family, weight);
      lines.push({
        text: trimmed,
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
  function measure2(t, px, fam, w) { return measure(t, px, fam, w, letterSpacingPx); }
}

/**
 * The same flow, but allowed to choose its own size.
 *
 * AUTO typography treats the requested size as a preferred MAXIMUM and finds
 * the largest legal size at or below it. LOCKED never shrinks: it reports
 * overset instead, because silently setting a sub-editor's 48px headline at
 * 31px is a design decision the software is not entitled to make on its own.
 */
function fitDisplayFlow(text, options, { locked, minPx }) {
  const first = setDisplayFlow(text, options);
  const failed = (attempt) => attempt.overset || attempt.violations.length > 0;
  if (locked || !failed(first)) return { ...first, resolvedPx: options.fontPx, shrunk: false };

  for (let px = options.fontPx - 1; px >= minPx; px -= 1) {
    const attempt = setDisplayFlow(text, { ...options, fontPx: px });
    if (!failed(attempt)) return { ...attempt, resolvedPx: px, shrunk: true };
  }
  const floor = setDisplayFlow(text, { ...options, fontPx: minPx });
  return { ...floor, resolvedPx: minPx, shrunk: true };
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
function splitParagraphs(text, marks) {
  const paragraphs = [];
  const re = /\n+/g;
  let start = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    paragraphs.push({
      text: text.slice(start, match.index),
      offset: start,
      paragraphBreak: match[0].length >= 2,
    });
    start = re.lastIndex;
  }
  paragraphs.push({ text: text.slice(start), offset: start, paragraphBreak: false });
  return paragraphs.filter((p, i) => p.text.length > 0 || i === 0).map((p, i) => ({
    ...p,
    // The break BEFORE this paragraph (irrelevant for the first).
    forcedBreak: i > 0,
  }));
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
  top, bottom, columns, images, fontPx, lineHeight, family, weight, align, paragraphSpacingPx = 0, letterSpacingPx = 0,
  italic = false, underline = false,
}) {
  const text = typeof bodyInput === 'object' && bodyInput ? String(bodyInput.text || '') : String(bodyInput || '');
  const marks = (typeof bodyInput === 'object' && bodyInput && bodyInput.marks) || [];

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
   * this engine). If there is no room for the taller height, the first
   * pass's placement is kept rather than discarded - the text it already
   * fit is real and correct; only the reported line box may be a little
   * short in that narrow, bottom-of-frame corner case.
   */
  function fillRow(cursor, pieces, index, paraCharOffset, paragraphOffset) {
    let height = bandHeight;
    let attempt = null;

    for (let pass = 0; pass < 2; pass += 1) {
      const row = cursor.probe(height);
      if (!row) return attempt;

      const placed = [];
      let cursorIndex = index;
      let cursorOffset = paraCharOffset;

      for (let gapIndex = 0; gapIndex < row.gaps.length; gapIndex += 1) {
        if (cursorIndex >= pieces.length) {
          for (let rest = gapIndex; rest < row.gaps.length; rest += 1) {
            placed.push({ empty: true, width: row.gaps[rest].end - row.gaps[rest].start });
          }
          break;
        }
        const gap = row.gaps[gapIndex];
        const measureWidthPx = gap.end - gap.start;
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
        if (!trimmed) { placed.push({ empty: true, width: measureWidthPx }); continue; }
        const drawn = measurePieceWidth(trimmed, lineStartOffset, fontPx, family, weight, marks, letterSpacingPx);
        placed.push({ text: trimmed, at: lineStartOffset, x: gap.start, width: drawn, measure: measureWidthPx, hardOverset });
      }

      attempt = { row, placed, cursorIndex, cursorOffset, height };

      const requiredHeight = placed.reduce((max, p) => {
        if (p.empty) return max;
        const size = maxSizeIn(p.at, p.at + p.text.length);
        return size ? Math.max(max, size * lineHeight) : max;
      }, bandHeight);

      if (Math.abs(requiredHeight - height) < 0.25 || pass === 1 || !cursor.hasRoom(requiredHeight)) break;
      height = requiredHeight;
    }

    return attempt;
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
  let overset = '';
  let colIndex = 0;

  const paragraphs = splitParagraphs(text, marks);

  for (const paragraph of paragraphs) {
    // Paragraph spacing: this paragraph's first row must start at or after
    // the PREVIOUS row's real bottom (whatever that row's own finalized
    // height turned out to be - it may have been a tall one) plus the air a
    // real paragraph gets. A forced break already lands on a fresh row (see
    // below), so this only ever skips whole rows, never a partial one.
    if (paragraph.forcedBreak && paragraphSpacingPx > 0 && lines.length) {
      const nextY = lines[lines.length - 1].y + lines[lines.length - 1].height + paragraphSpacingPx;
      while (colIndex < cursors.length) {
        if (!cursors[colIndex].hasRoom(bandHeight)) { colIndex += 1; continue; }
        if (cursors[colIndex].y >= nextY - 0.5) break;
        const row = cursors[colIndex].probe(bandHeight);
        if (!row) { colIndex += 1; continue; }
        for (const gap of row.gaps) emptyGapWidth += gap.end - gap.start;
        cursors[colIndex].commit(bandHeight);
      }
    }

    const pieces = breakPieces(paragraph.text);
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
      const result = fillRow(cursor, pieces, index, paraCharOffset, paragraph.offset);
      if (!result) { colIndex += 1; continue; }

      for (const p of result.placed) {
        if (p.empty) { emptyGapWidth += p.width; continue; }
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
      index = result.cursorIndex;
      paraCharOffset = result.cursorOffset;
    }

    if (index < pieces.length) {
      // Ran out of room inside this paragraph. Everything from here on,
      // including every later paragraph, is overset - reported, not painted.
      overset = paragraphs
        .slice(paragraphs.indexOf(paragraph))
        .map((p, i) => (i === 0 ? pieces.slice(index).join('') : (p.forcedBreak ? '\n' : '') + p.text))
        .join('');
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
      for (const gap of row.gaps) emptyGapWidth += gap.end - gap.start;
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
  if (align && align !== 'left') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isLastOfParagraph = i === lines.length - 1 || lines[i + 1].paragraphBreak;
      const slack = Math.max(0, line.measure - line.width);
      if (align === 'right') line.x = line.x + slack;
      else if (align === 'center') line.x = line.x + slack / 2;
      else if (align === 'justify' && !isLastOfParagraph) {
        const spaceCount = (line.text.match(/\s/gu) || []).length;
        // Never stretch a single-word line (nothing to distribute space
        // across) and never stretch past a typographically sane amount -
        // both are the "keep ragged rather than distort" rule the brief
        // asks for, applied as a bound rather than a separate code path.
        if (spaceCount > 0 && slack / spaceCount <= fontPx * 0.6) {
          line.wordSpacingPx = Number((slack / spaceCount).toFixed(2));
        }
      }
    }
  }

  return {
    lines,
    overset,
    violations,
    // Room, expressed the way the AI brief and the worklist want it: how many
    // full-measure lines of this type the block still has. Derived from real
    // geometry rather than from a cell count.
    usableWidth,
    usedWidth,
    emptyGapWidth,
    measures,
    bandHeight,
    fullMeasureEquivalents: usableWidth / Math.max(1, columns[0].end - columns[0].start),
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
const WIDEST_PER_CHAR = 'कमल गगन सरल पवन नयन जल थल. ';
const NARROWEST_PER_CHAR = 'ज्ञानेश्वर श्रद्धांजली क्षेत्रफळ विद्यार्थ्यांसाठी. ';

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
function capacityChars(measures, fontPx, family, sample = CALIBRATION, letterSpacingPx = 0) {
  const pieces = breakPieces(sample);
  if (!pieces.length) return 0;
  let chars = 0;
  let at = 0;
  for (const measureWidthPx of measures) {
    let line = '';
    let width = 0;
    while (true) {
      const piece = pieces[at % pieces.length];
      const pieceWidth = measure(piece, fontPx, family, 400, letterSpacingPx);
      if (line && width + pieceWidth > measureWidthPx + 0.5) break;
      if (!line && pieceWidth > measureWidthPx + 0.5) { line = piece; at += 1; break; }
      line += piece;
      width += pieceWidth;
      at += 1;
    }
    chars += line.length;
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

  const shaperReady = isShaperReady();
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
  if (!result.fontReady) warnings.push({ code: 'FONT_NOT_READY', detail: 'Composed before the publication font was measurable; sizes are estimated.' });
  else if (!shaperReady) warnings.push({ code: 'SHAPING_NOT_READY', detail: 'Composed with summed advances, not real shaping - conjunct-heavy Marathi may be reserved wider than it prints.' });

  const flows = [
    { key: 'kicker', text: String(input.kicker || ''), px: Math.round(bodyPx * 1.05), min: MIN_LEGIBLE_PX, maxLines: 2, locked: true, ...DISPLAY_TYPOGRAPHY.kicker },
    { key: 'headline', text: String(input.headline || ''), px: num(input.headlineFontPx, 34), min: Math.max(MIN_LEGIBLE_PX, bodyPx * 1.1), maxLines: num(input.headlineMaxLines, 4), locked: Boolean(input.headlineLocked), ...DISPLAY_TYPOGRAPHY.headline },
    { key: 'deck', text: String(input.subheading || ''), px: num(input.subheadingFontPx, 20), min: Math.max(MIN_LEGIBLE_PX, bodyPx), maxLines: num(input.deckMaxLines, 3), locked: Boolean(input.subheadingLocked), ...DISPLAY_TYPOGRAPHY.deck },
  ].filter((flow) => flow.text.trim());

  let y = content.top;
  let previous = null;

  for (const flow of flows) {
    if (previous) y += gapBetween(previous, flow.key, Math.max(flow.px, result.bands[previous]?.resolvedPx || flow.px));

    // The headline is the one flow with a share limit: it is the page's
    // hierarchy, but a block that is all headline holds no story.
    const share = flow.key === 'headline' ? MAX_HEADLINE_SHARE : 0.7;
    const set = fitDisplayFlow(flow.text, {
      top: y,
      bottomLimit: Math.min(content.bottom, y + room * share),
      column: { start: content.left, end: content.right },
      images,
      fontPx: flow.px,
      lineHeight: Math.max(1.1, lineHeight - 0.15),
      family: flow.family,
      weight: flow.weight,
      maxLines: flow.maxLines,
      letterSpacingPx,
    }, { locked: flow.locked, minPx: flow.min });

    result.bands[flow.key] = {
      top: y,
      height: set.height,
      lines: set.lines,
      lineCount: set.lineCount,
      requestedPx: flow.px,
      resolvedPx: set.resolvedPx,
      shrunk: set.shrunk,
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
  const body = pourBody(bodyInput, {
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
  });

  result.bodyLines = body.lines;
  const bodyPlainText = typeof bodyInput === 'object' ? bodyInput.text : bodyInput;
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

  result.whitespace = {
    intentional: Math.round(intentionalArea),
    unexplained: Math.round(body.emptyGapWidth * bandHeight),
    bottomResidualPx: Math.round(bottomResidualPx),
    bottomResidualLines: Number(bottomResidualLines.toFixed(2)),
    unexplainedLines: Number(unexplainedLines.toFixed(2)),
    // The single number the desk and the writer both act on. A remainder
    // under one line is what setting type on a grid always leaves and is
    // never worth an AI call.
    largestHoleLines: Number(Math.max(bottomResidualLines, unexplainedLines).toFixed(2)),
  };

  const pour = (sample) => Math.floor(capacityChars(body.measures, bodyPx, bodyFamily, sample, letterSpacingPx) * BUDGET_SAFETY);
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
  const charsPerLine = body.measures.length ? result.capacity.bodyCharRange.min / body.measures.length : 0;
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
    bodyWeight, bodyItalic, bodyUnderline,
    input.headlineFontPx, input.subheadingFontPx, input.columnCount,
    letterSpacingPx, paragraphSpacingPx,
    input.kicker, input.headline, input.subheading, bodyPlainText,
    JSON.stringify((typeof bodyInput === 'object' && bodyInput.marks) || []),
    images.map((i) => `${i.x},${i.y},${i.width},${i.height},${i.shape},${i.rotation || 0},${maskHash(i.mask)},${i.standOffPx || 0}`).join('|'),
  ].join(''));

  return result;
}
