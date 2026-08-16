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
// advance widths (font-metrics.js) and over interval geometry (intervals.js,
// exclusion.js). So it produces the same numbers in Node and in the browser,
// and "the editor renders the same as the page" stops being a property that
// has to be tested and becomes one that cannot fail - both draw the same
// list of positioned lines.
//
// THE VERTICAL MODEL IS DYNAMIC. Nothing reserves a fixed rectangle. The
// headline is shaped, its real line count is counted, and the deck starts
// underneath it - so a one-line headline gives the body the second line back
// instead of leaving it empty. Reserved-rectangle thinking is what produced
// the phantom rows this replaces.

import { measureWidth, minLineHeightFor, faceAscent, faceDescent, fontsReady } from './font-metrics.js';
import { breakPieces, clusters, trimEndClusters } from './graphemes.js';
import { normalise, subtract, viableIntervals, widest, MIN_CORRIDOR_EM } from './intervals.js';
import { bandObstacles } from './exclusion.js';

export const ENGINE_VERSION = 'sahas-compose/1';

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

// The floor preflight fails a page for. Nothing here may go below it, however
// badly the copy wants to fit.
export const MIN_LEGIBLE_PX = 6.5;

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
  top, bottomLimit, column, images, fontPx, lineHeight, family, weight, maxLines,
}) {
  const pieces = breakPieces(text);
  if (!pieces.length) return { lines: [], height: 0, overset: '', lineCount: 0 };

  const bandHeight = fontPx * lineHeight;
  const lines = [];
  let index = 0;
  let y = top;

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

    while (index < pieces.length) {
      const piece = pieces[index];
      const pieceWidth = measureWidth(piece, fontPx, family, weight);
      if (line && width + pieceWidth > measure + 0.5) break;
      if (!line && pieceWidth > measure + 0.5) {
        // One unbreakable token wider than every legal measure. It is set
        // anyway and reported - inventing a hyphen inside a Marathi word is
        // the one thing this engine will not do.
        line = piece;
        width = pieceWidth;
        index += 1;
        break;
      }
      line += piece;
      width += pieceWidth;
      index += 1;
    }

    const trimmed = trimEndClusters(line);
    if (trimmed) {
      lines.push({
        text: trimmed,
        x: gap.start,
        y,
        width: measureWidth(trimmed, fontPx, family, weight),
        measure,
        height: bandHeight,
        baseline: y + fontPx * faceAscent(family, weight),
        fontPx,
      });
    }
    y += bandHeight;
  }

  return {
    lines,
    height: lines.length * bandHeight,
    lineCount: lines.length,
    overset: pieces.slice(index).join(''),
  };
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
  if (locked || !first.overset) return { ...first, resolvedPx: options.fontPx, shrunk: false };

  for (let px = options.fontPx - 1; px >= minPx; px -= 1) {
    const attempt = setDisplayFlow(text, { ...options, fontPx: px });
    if (!attempt.overset) return { ...attempt, resolvedPx: px, shrunk: true };
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

/**
 * Pours the body into whatever the photographs leave, column by column.
 *
 * Reading order is down a column and then into the next, never across a
 * gutter - a gutter is forbidden ground however free its pixels are. Within a
 * column, a band's gaps are used left to right.
 */
function pourBody(text, {
  top, bottom, columns, images, fontPx, lineHeight, family, weight,
}) {
  const bandHeight = fontPx * lineHeight;
  const minCorridor = MIN_CORRIDOR_EM * fontPx;
  const pieces = breakPieces(text);

  // Every band's raw free space first: whether a gap is usable depends on
  // whether it persists into its neighbours, so no band can be judged alone.
  const strips = columns.map((column) => {
    const bands = [];
    for (let y = top; y + bandHeight <= bottom + 0.5; y += bandHeight) {
      bands.push({ y, free: subtract([column], bandObstacles(images, y, y + bandHeight, fontPx)) });
    }
    const raw = bands.map((band) => band.free);
    return bands.map((band, index) => ({ y: band.y, gaps: viableIntervals(raw, index, minCorridor), raw: band.free }));
  });

  const lines = [];
  let index = 0;
  let consumed = 0;
  let usedWidth = 0;
  let usableWidth = 0;
  const measures = [];
  // Room that no line was set on AT ALL. Deliberately not the same as
  // "usable minus used": every ragged line leaves a little at its right end,
  // and summing that across a column reports two or three lines of "hole"
  // for a column that is completely full. Ragged right is how type is set,
  // not a defect. Only a gap that received nothing is unexplained.
  let emptyGapWidth = 0;

  for (const strip of strips) {
    for (const band of strip) {
      for (const gap of band.gaps) {
        const measure = gap.end - gap.start;
        usableWidth += measure;
        measures.push(measure);
        if (index >= pieces.length) { emptyGapWidth += measure; continue; }

        let line = '';
        let width = 0;
        while (index < pieces.length) {
          const piece = pieces[index];
          const pieceWidth = measureWidth(piece, fontPx, family, weight);
          if (line && width + pieceWidth > measure + 0.5) break;
          if (!line && pieceWidth > measure + 0.5) {
            // Wider than this gap. If some other gap could hold it, wait for
            // one rather than cutting a word in half; if nothing anywhere can,
            // set it here and report the violation.
            const anywhere = strips.some((other) => other.some((b) => widest(b.gaps) >= pieceWidth - 0.5));
            if (anywhere) break;
            line = piece;
            width = pieceWidth;
            index += 1;
            break;
          }
          line += piece;
          width += pieceWidth;
          index += 1;
        }

        const trimmed = trimEndClusters(line);
        if (!trimmed) { emptyGapWidth += measure; continue; }
        const drawn = measureWidth(trimmed, fontPx, family, weight);
        lines.push({
          text: trimmed,
          at: consumed,
          x: gap.start,
          y: band.y,
          width: drawn,
          measure,
          height: bandHeight,
          baseline: band.y + fontPx * faceAscent(family, weight),
          fontPx,
        });
        usedWidth += drawn;
        consumed += line.length;
      }
    }
  }

  return {
    lines,
    overset: pieces.slice(index).join(''),
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
function capacityChars(measures, fontPx, family, sample = CALIBRATION) {
  const pieces = breakPieces(sample);
  if (!pieces.length) return 0;
  let chars = 0;
  let at = 0;
  for (const measure of measures) {
    let line = '';
    let width = 0;
    while (true) {
      const piece = pieces[at % pieces.length];
      const pieceWidth = measureWidth(piece, fontPx, family, 400);
      if (line && width + pieceWidth > measure + 0.5) break;
      if (!line && pieceWidth > measure + 0.5) { line = piece; at += 1; break; }
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

// WHY THIS IS A BUDGET AND NOT A GUARANTEE, which matters because the last
// version of this file claimed to be one.
//
// How much a ragged edge wastes depends on the word lengths of the copy that
// has not been written yet. Measured across eleven block shapes x three
// column counts x five real Marathi sentences, the poured budget lands within
// 3% of the true capacity for ordinary prose - but a sentence built from long
// unbroken compounds ("ज्ञानेश्वरमहाराजांच्या", "महानगरपालिकेच्या") in a narrow
// three-column measure came in 46% under it. No single character count can
// cover both, and pricing the budget for the compound case would cost a third
// of every ordinary block's capacity to save a repair that rarely fires.
//
// So the budget is the PRACTICAL figure, and the guarantee lives where it can
// actually be kept: the copy is composed and measured exactly after it is
// written, overflow is detected with certainty, and the pipeline's one
// bounded shortening repairs it. That is the arrangement the whole engine
// exists to make possible - before it there was no exact measurement to
// repair against, so the budget had to pretend to be a promise.
const COMPOUND_RISK_FLOOR = 0.7;

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
 */
export function composeBlock(input = {}) {
  const width = num(input.width, 0);
  const height = num(input.height, 0);
  const padding = Number.isFinite(Number(input.padding)) ? Number(input.padding) : 12;
  const family = input.fontFamily || 'serif';

  const content = {
    left: padding,
    top: padding,
    right: Math.max(padding, width - padding),
    bottom: Math.max(padding, height - padding),
  };
  const measure = content.right - content.left;
  const room = content.bottom - content.top;

  const bodyPx = Math.max(MIN_LEGIBLE_PX, num(input.bodyFontPx, 16));
  // The line box can never be shorter than the face itself needs. Marathi
  // stacks signs above the shirorekha and below the baseline; a box tighter
  // than ascent + descent crops them, which is a property of the script and
  // not a taste setting. Read from the font rather than guessed.
  const floor = minLineHeightFor(family, 400);
  const lineHeight = Math.max(floor, num(input.lineHeight, floor));

  const images = (input.images || []).filter(Boolean);
  const violations = [];
  const warnings = [];

  const result = {
    engineVersion: ENGINE_VERSION,
    fontReady: fontsReady(),
    frame: { width, height, padding },
    content: { ...content, measure, room },
    bands: {},
    bodyLines: [],
    columns: [],
    typography: { bodyPx, lineHeight, family },
    violations,
    warnings,
  };

  if (measure <= 0 || room <= 0) {
    result.fitState = 'NO_ROOM';
    result.whitespace = { intentional: width * height, unexplained: 0, bottomResidualPx: 0, bottomResidualLines: 0, unexplainedLines: 0, largestHoleLines: 0 };
    result.capacity = { fullMeasureEquivalents: 0, bodyClusterCapacity: 0 };
    result.overset = { headline: '', deck: '', kicker: '', body: '' };
    result.fingerprint = hash(`${width}x${height}`);
    return result;
  }

  // A block whose type is not ready to be measured must say so. A page
  // composed against a fallback font and then repainted when the real one
  // arrives is two different pages, and only one of them was approved.
  if (!result.fontReady) warnings.push({ code: 'FONT_NOT_READY', detail: 'Composed before the publication font was measurable; sizes are estimated.' });

  const flows = [
    { key: 'kicker', text: String(input.kicker || ''), px: Math.round(bodyPx * 1.05), min: MIN_LEGIBLE_PX, maxLines: 2, locked: true, weight: 700 },
    { key: 'headline', text: String(input.headline || ''), px: num(input.headlineFontPx, 34), min: Math.max(MIN_LEGIBLE_PX, bodyPx * 1.1), maxLines: num(input.headlineMaxLines, 4), locked: Boolean(input.headlineLocked), weight: 700 },
    { key: 'deck', text: String(input.subheading || ''), px: num(input.subheadingFontPx, 20), min: Math.max(MIN_LEGIBLE_PX, bodyPx), maxLines: num(input.deckMaxLines, 3), locked: Boolean(input.subheadingLocked), weight: 400 },
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
      family,
      weight: flow.weight,
      maxLines: flow.maxLines,
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
    if (set.shrunk) {
      warnings.push({ code: `${flow.key.toUpperCase()}_AUTO_FITTED`, detail: `Set at ${set.resolvedPx}px rather than the requested ${flow.px}px.` });
    }

    y += set.height;
    previous = flow.key;
  }

  const bodyTop = previous ? y + gapBetween(previous, 'body', result.bands[previous].resolvedPx) : content.top;
  result.bodyTop = bodyTop;

  const gutter = num(input.gutterPx, Math.round(bodyPx * 0.9));
  const columns = columnsOf(content, num(input.columnCount, 1), gutter);
  result.columns = columns;

  const body = pourBody(String(input.body || ''), {
    top: bodyTop,
    bottom: content.bottom,
    columns,
    images,
    fontPx: bodyPx,
    lineHeight,
    family,
    weight: 400,
  });

  result.bodyLines = body.lines;
  result.overset = {
    kicker: result.bands.kicker?.overset || '',
    headline: result.bands.headline?.overset || '',
    deck: result.bands.deck?.overset || '',
    body: body.overset,
  };
  if (body.overset) {
    violations.push({ code: 'BODY_OVERSET', detail: `${clusters(body.overset).length} clusters of copy have no room in this block.` });
  }

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
    width * height - measure * room
    + gutter * Math.max(0, columns.length - 1) * Math.max(0, content.bottom - bodyTop)
    + measure * Math.max(0, bodyTop - content.top);

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

  const pour = (sample) => Math.floor(capacityChars(body.measures, bodyPx, family, sample) * BUDGET_SAFETY);
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
    bodyClustersUsed: clusters(String(input.body || '')).length,
    bodyCharsUsed: String(input.body || '').length,
  };

  // A hole is only a hole if there is something a writer could actually do
  // about it. The budget is deliberately conservative, so copy written
  // exactly to it leaves a little geometric room over - counting that as a
  // hole would flag every correctly-filled block and spend a repair call
  // chasing the safety margin. That is the same trap CLAUDE.md records for
  // the headline reservation: a conservative estimate does not remove a gap,
  // it relocates it, and the fix is to measure the gap in the same currency
  // the estimate was quoted in.
  // Measured against the SAFE end of the range: a block is only short of copy
  // if it is short even for the least efficient prose anyone might file.
  result.capacity.shortfallChars = Math.max(0, result.capacity.bodyCharRange.min - result.capacity.bodyCharsUsed);
  // ...and a shortfall smaller than one line is not one either, for exactly
  // the reason the geometric remainder is not: nothing can be written into
  // it. Both halves of the test are therefore "at least one legal line".
  const charsPerLine = body.measures.length ? result.capacity.bodyCharRange.min / body.measures.length : 0;
  const holed = result.whitespace.largestHoleLines >= HOLE_LINES
    && result.capacity.shortfallChars > charsPerLine;
  result.fitState = violations.some((v) => v.code.endsWith('OVERSET') || v.code.endsWith('OVERSET_LOCKED'))
    ? 'OVERSET'
    : (!flows.length && !body.lines.length ? 'EMPTY' : (holed ? 'UNDERFILLED' : 'FITS'));

  result.fingerprint = hash([
    ENGINE_VERSION, width, height, padding, bodyPx, lineHeight, family,
    input.headlineFontPx, input.subheadingFontPx, input.columnCount,
    input.kicker, input.headline, input.subheading, input.body,
    images.map((i) => `${i.x},${i.y},${i.width},${i.height},${i.shape},${i.rotation || 0},${i.mask ? `${i.mask.rows}x${i.mask.cols}` : ''}`).join('|'),
  ].join(''));

  return result;
}
