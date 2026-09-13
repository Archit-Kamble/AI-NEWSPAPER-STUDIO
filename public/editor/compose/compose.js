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
import { breakPieces, clusters, trimEndClusters, setSpaces } from './graphemes.js';
import {
  planParagraphs, mayNeedPolicy, MIN_PARAGRAPH_LINES, MAX_PARAGRAPH_LINES, MAX_PARAGRAPH_SENTENCES,
} from './paragraph-policy.js';
import { subtract, viableIntervals, MIN_CORRIDOR_EM } from './intervals.js';
import { bandObstacles, imageFingerprint } from './exclusion.js';
import '../layout/publication-type.js';
// The marker vocabulary, shared with the panel that sets a list inside a box -
// `page_sections.list_style` and a panel's `marker` are the same three choices
// and must not become two catalogues that drift. Reached the same way the
// character grid and the type catalogue already are.
import '../layout/inset-panels.js';

const DEFAULT_BODY_FONT_PX = globalThis.SahasPublicationType.DEFAULT_BODY_FONT_PX;
const { markerText } = globalThis.SahasInsetPanels;

export const ENGINE_VERSION = 'sahas-compose/2';

// One measurement function, everywhere in this file. Real HarfBuzz shaping
// when it has loaded; the font's own hmtx advances (font-metrics.js) as a
// same-shape, slightly-wide fallback for the moment before it has - never a
// guessed constant. See shaper.js for exactly how much this matters for
// conjunct-heavy Marathi (up to +80% on a bare summed-advance measurement).
function measure(rawText, fontPx, family, weight, letterSpacingPx = 0) {
  // Set as it will PRINT: a run of whitespace is one space (graphemes.js's
  // setSpaces). Measuring the raw run instead reserved a double word space in
  // the middle of a line wherever the paragraph policy had merged two
  // paragraphs - and then the justifier distributed the slack around it, so
  // one gap on the line was twice its neighbours.
  const text = setSpaces(rawText).text;
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

/**
 * The face the display flows are set in.
 *
 * The paper's own sans by default - everything above this stays exactly true,
 * and every block that has not asked for anything else composes byte for byte
 * as it did. What is new is that a block CAN ask, through its own field.
 *
 * It is a separate field from the body's `fontFamily` and must stay one. The
 * comment above records what happens when the two are the same control:
 * composing a headline in whatever family the body happened to be reserved
 * room in reserves room for the wrong glyphs. This does not reopen that - it
 * is an explicit display choice that the display flows read and the body never
 * touches, which is how a newspaper's type system actually works. A sub-editor
 * does not pick the headline face per story; the paper picks it, and a
 * condensed cut exists precisely so a splash with too many words in it can be
 * set without shrinking.
 *
 * The WEIGHTS are deliberately not overridable. They are the stylesheet's
 * (.section-headline is 700, .section-subheading is 400) and a face with only
 * one cut maps both to the same file anyway (layout/typefaces.js).
 */
function displayTypography(key, displayFamily) {
  const base = DISPLAY_TYPOGRAPHY[key];
  const family = String(displayFamily || '').trim();
  return family ? { ...base, family } : base;
}

// Space between one editorial flow and the next, BASELINE TO BASELINE, in the
// line of the flow BELOW.
//
// Both halves of that sentence are the correction. This used to be
// `y = previousBand.bottom + share * max(fontPx)` - a gap measured from the
// previous flow's BOX and scaled by the DISPLAY size - and it produced a page
// whose sinks were all different. Measured across one real front page:
//
//     headline -> deck   1.30, 1.44, 1.60, 1.68 body-lines   (29% spread)
//     display  -> body   1.33, 1.37, 1.54, 1.61, 1.75        (31% spread)
//
// Two things compound to make that. A display band's box is a full line box
// tall, and the ink sits in the upper part of it, so the box's bottom is
// already further below the ink on a 26px headline than on a 13px one - and
// then a share of that same font size is added on top. So the bigger the
// headline, the more space under it, twice over. A reader never measures the
// white under a headline, but an uneven one is exactly why a page looks
// homemade - the same argument the block gutter was already fixed by
// (templates.js's GAP, which had drifted to seven values).
//
// A compositor does not specify space this way. Space is specified BASELINE TO
// BASELINE, because that is what a grid is made of, and it is specified in the
// leading of the type that follows, because that is the rhythm the reader is
// reading in. A deck sits 1.35 deck-lines under the headline whether the
// headline is 13px or 40px; the copy sits 1.5 body-lines under the display on
// every block on the page.
const BASELINE_GAP = {
  // A kicker is the headline's own overline and belongs to it: tight.
  'kicker>headline': 0.95,
  // The deck belongs to the headline too, but reads as a separate line.
  'headline>deck': 1.35,
  // The sink: what separates the display from the story. Slightly wider with
  // no deck to bridge the two.
  'headline>body': 1.55,
  'deck>body': 1.50,
  'kicker>body': 1.50,
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
// the size it lands on is the one whose working lines fill without creating a
// one-word closing widow.
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
// The desk's production bar is 95%. This is deliberately the same visible
// standard as the body, though the measurements are different: every working
// headline line must reach it, while a legal two-word-or-longer closing line
// may be naturally shorter. Body copy is judged by occupied equivalent area.
const HEADLINE_FILL_TARGET = 0.95;

// A full second line does not redeem a stranded first line. The old metric
// took only the longest line, so 49% / 100% was reported as a 100%-filled
// headline and then grown into exactly that bad break. Every line except the
// natural closing line must fill the measure; the close may be shorter, but
// it must still be at least two words and substantial enough to read as a
// line rather than a widow.
const HEADLINE_CLOSE_MIN_FILL = 0.30;
const HEADLINE_CLOSE_MIN_WORDS = 2;

// The shrink bound, and it is the mirror of HEADLINE_GROWTH_CAP - a HIERARCHY
// bound, not a typographic one.
//
// Growth has been capped since it was written, because a page reads as one
// page when the bigger block shouts louder. Shrinking had no such bound, and
// once the closing line is charged the fill search runs on nearly every
// two-line headline and walks all the way down to the legibility floor
// looking for a size that fills. Measured on a real front page: the 268x296
// anchor, designed at 24px, came back at 14.5px in one line - 60% of the size
// its own block was built around, and no longer the loudest thing on the page.
//
// 0.8 is deliberately tighter than growth's 1.25. Type that shrinks loses
// hierarchy faster than type that grows gains it, and a headline is the one
// object on the page whose size IS its meaning.
//
// It bounds the FILL search only. Shrinking to escape overset is unbounded and
// must stay so: a word pushed off the block is worse than any of this.
const HEADLINE_SHRINK_CAP = 0.8;

// What counts as a professional right edge when 95% is physically out of
// reach - the words of a headline are fixed, and no size makes four long
// Marathi words divide evenly.
//
// growToFill() has used a bar like this since it was written ("a hierarchy cap
// can make 95% unreachable"), and the fill search now shares it rather than
// keeping a second opinion. The NUMBER had to come down with the metric: it
// was 0.90 against a working-line minimum, and the same shapes score lower
// when every line is charged - a 97%/74% descending headline is 0.97 by the
// old measure and 0.74 by this one, and it is the same headline.
//
// Swept over 700 real blocks against the ten recorded geometries:
//
//   0.85  mean size 1.029 of design, 14 blocks shrunk >15%
//   0.80  mean size 1.037,           14
//   0.75  mean size 1.065,           13
//   0.70  mean size 1.069,           11   <- knee
//   0.65  mean size 1.074,            8   but uneven 12 -> 17, and it takes
//                                          four of the ten geometries with it
//
// Stub closes stay at zero at every value: what keeps them out is the balancer
// and the close guard, not this.
export const HEADLINE_NEAR_FULL = 0.70;

// How much more an early line's slack costs than a late one's, per line.
// Small on purpose: it decides ties between shapes the words made equally
// good, and must never outweigh real evenness. See balanceDisplayLines().
const DESCENT_BIAS = 0.05;

// How much fuller a line may be than the one above it before the band reads as
// a stranded first line rather than an evenly broken one. See headlineBandFit().
const HEADLINE_ASCENT_TOLERANCE = 0.08;
const DISPLAY_FIT_STEP_PX = 0.5;

// Sizes are quantised to a tenth on the way out of the search.
//
// The steps are taken as `requested - d` with `d` accumulated by addition, so
// a base like 14 reached 8.700000000000001 - and that noisy number is what the
// band reported, what a read-out printed and what a test comparing sizes had to
// match. `headline_font_px` is NUMERIC(5,1); a tenth is the real resolution of
// this whole decision.
const stepPx = (px) => Math.round(px * 10) / 10;

// A deck explains the headline; it must not become another headline after the
// headline auto-fits down. The catalog starts decks near 0.55 of headline
// size. This is the outside hierarchy guard for an explicit/custom size.
const DECK_MAX_HEADLINE_RATIO = 0.65;

// And the floor, which was missing. The deck has had a hierarchy CEILING since
// it was written - it must not become a second headline - but nothing kept it
// from being squeezed the other way, and the display share is a fixed half of
// the block, so every pixel the headline takes comes out of the deck.
//
// Measured on the 620x224 banner: at a 33px headline the deck sets 14.5px, at
// 37px it sets 8px - 22% of the headline and 1.25x the body it sits above.
// Type that close to the body is not display type; it reads as a caption, and
// the block loses the middle rung of its own hierarchy.
//
// Stated against the BODY because that is what a deck has to be
// distinguishable FROM. It is a preference like every other one here: the
// reserve comes out of the headline's absolute share, and the relaxation
// passes in fitDisplayFlow() give it back rather than let a word overset.
const DECK_MIN_OF_BODY = 1.5;

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

/**
 * A display band's lines, broken EVENLY rather than greedily.
 *
 * `pourBody` has balanced its lines since balanceParagraph() was written, and
 * that function's own header says why greedy filling is wrong: it is optimal
 * for LINE COUNT and terrible for evenness, because it spends all the slack on
 * whichever line happens to meet a long word. Display type never got the same
 * treatment, and a desk photographed the result - headlines set 97% / 42%,
 * 97% / 41%, 97% / 43% across a real front page. A first line full to its
 * measure over a stub is not a two-line headline; it is a one-line headline
 * with a word fallen off the end, and it is what a sub-editor fixes by hand.
 *
 * The same guarantee as the body balancer, for the same reason: THE SLOT COUNT
 * NEVER CHANGES. Pieces are re-assigned across the lines the greedy pass
 * already fixed, so no band moves, no geometry shifts, and nothing below this
 * flow is placed anywhere different.
 *
 * The cost is squared NORMALISED slack, not the body's `slackCost`. That one
 * is built around what the justifier can close, and display type is never
 * justified (JUSTIFY_MIN_EM is deliberately not applied to it) - there is no
 * lever here, so what the eye sees is simply the ragged edge, and the even
 * edge is the one to find. Normalised because a picture can narrow one band
 * and two slots of different measures must still compare fairly.
 *
 * @param {string[]} pieces   the flow's own pieces, in order
 * @param {number} used       how many of them the greedy pass consumed
 * @param {number[]} measures the measure of each line, in order
 * @param {(from:number,to:number)=>number} widthOf  drawn width of a run
 * @returns {number[]|null}   piece index where each slot starts, or null when
 *   no legal assignment exists (a piece wider than a slot it must land in) -
 *   in which case the greedy lines stand, exactly as they did before.
 */
function balanceDisplayLines(pieces, used, measures, widthOf) {
  const L = measures.length;
  if (L < 2 || used < L) return null;

  const INF = Infinity;
  // cost[j][i] - best total badness placing pieces i.. onto slots j..
  const cost = Array.from({ length: L + 1 }, () => new Float64Array(used + 1).fill(INF));
  const cut = Array.from({ length: L + 1 }, () => new Int32Array(used + 1).fill(-1));
  cost[L][used] = 0;

  for (let j = L - 1; j >= 0; j -= 1) {
    const measure = measures[j];
    for (let i = used - 1; i >= 0; i -= 1) {
      // Every remaining slot needs at least one piece, so this slot may take
      // at most `used - i - (L - j - 1)` of them.
      const maxTake = used - i - (L - j - 1);
      if (maxTake < 1) continue;
      let best = INF;
      let bestCut = -1;
      for (let take = 1; take <= maxTake; take += 1) {
        const to = i + take;
        const width = widthOf(i, to);
        // A line may never be drawn past its own measure. Wider pieces only
        // get wider, so the search for this slot ends here.
        if (width > measure + 0.5) break;
        const rest = cost[j + 1][to];
        if (rest === INF) continue;
        const slack = measure > 0 ? (measure - width) / measure : 0;
        // DESCENDING, when the words will not divide evenly.
        //
        // Squared slack alone treats 49%/100% and 100%/49% as the SAME cost,
        // so the solver picked whichever it reached first - and it reached the
        // ascending one. A stranded short FIRST line is the very shape
        // headlineBandFit()'s own header condemns ("a max cannot distinguish
        // 49%/100% from the professional 98%/45%"), and greedy filling at
        // least never produced it.
        //
        // So slack costs slightly more the earlier it falls. Where the pieces
        // divide evenly this is far too small to change the answer; where they
        // cannot, it sends the short line to the bottom, which is where a
        // compositor puts it.
        const total = rest + slack * slack * (1 + DESCENT_BIAS * (L - 1 - j));
        if (total < best) { best = total; bestCut = to; }
      }
      cost[j][i] = best;
      cut[j][i] = bestCut;
    }
  }

  if (cost[0][0] === INF) return null;
  const starts = [];
  let at = 0;
  for (let j = 0; j < L; j += 1) {
    starts.push(at);
    at = cut[j][at];
    if (at < 0) return null;
  }
  return starts;
}

function setDisplayFlow(text, {
  top, bottomLimit, column, images, fontPx, lineHeight, family, weight, maxLines, letterSpacingPx = 0,
  align = 'left', marks = null, previousBaseline = null, flowKey = '', floor = null,
  mayStraddle = false,
}) {
  const pieces = breakPieces(text);
  if (!pieces.length) return { lines: [], height: 0, bottom: top, overset: '', lineCount: 0, violations: [] };

  const bandHeight = fontPx * lineHeight;
  // How finely a fully blocked band is stepped past - see the `!gap` branch.
  // An eighth of a line box leaves at most ~2px of unasked-for white under a
  // picture while costing probes only on the bands a picture actually fills.
  const clearanceProbe = Math.max(1, bandHeight / 8);
  // Placed by its first BASELINE when one is asked for, not by its box top.
  // This has to happen HERE rather than at the call site because the size is
  // not settled until this function runs: fitDisplayFlow() tries several, and
  // where a line box has to start to put its baseline in a given place depends
  // on the size it is finally set at. Computing the top outside would place
  // every shrunk or grown flow at the ascent of a size it was not set in.
  const baselineAt = previousBaseline
    ? baselineAfter(previousBaseline, {
      key: flowKey,
      fontPx,
      family,
      weight,
      lineBox: fontPx * lineHeight,
    })
    : null;
  if (baselineAt !== null) {
    top = baselineAt - fontPx * faceAscent(family, weight);
    if (floor !== null && top < floor) top = floor;
  }
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
    // A band with no legal gap at all is a band a photograph fills. It is
    // advanced to where the picture ENDS, not by a whole line box.
    //
    // Stepping a full band from the block's top lands the display type
    // anywhere from nothing to one entire line box below the picture,
    // depending only on whether the picture's own depth happens to be a
    // multiple of a band - so the white under a top picture is a different
    // size on every block and nobody specified any of it. Measured across the
    // picture fixture: 17px on a 190x264 second lead (more than a body line
    // and a half), 10px on a 150x240, 4px on a 150x264 - same rule, same
    // gesture, three different results.
    //
    // The advance is a fraction of the band rather than the obstacle's own
    // bottom edge because a cut-out does not HAVE one bottom edge: its
    // blocking extent is per-column, the silhouette rather than the frame.
    // Probing converges on the real edge for every shape without a second
    // copy of the exclusion geometry to keep in step with this one.
    //
    // The BODY deliberately keeps its whole-row step (pourBody's cursor): a
    // body column has a baseline rhythm to hold against its neighbours, and
    // resuming off-grid under a picture is what breaks it. Display type at
    // the head of a block has no rhythm above it to keep.
    if (!gap) {
      // A photograph standing in the middle of a display flow would break the
      // headline in TWO - half of it above the picture, half below - and a
      // headline a picture runs through reads as two separate stories, which
      // is the same fault as a headline split across a picture sideways that
      // the widest-gap rule above already refuses. So the flow does not carry
      // on past it: it begins again underneath, and the whole headline sets in
      // one place.
      //
      // `y` only ever increases, so restarting terminates - each restart is
      // strictly further down the block than the last, and the loop's own
      // bottomLimit break ends it.
      //
      // It is a PREFERENCE, and it yields to overset like every other one:
      // fitDisplayFlow's last pass sets `mayStraddle`, so a block with room
      // above a picture and none below still sets its words rather than
      // pushing them off the page.
      if (lines.length && !mayStraddle) {
        lines.length = 0;
        violations.length = 0;
        index = 0;
        consumed = 0;
        y += clearanceProbe;
        top = y;
        occupiedBottom = y;
        continue;
      }
      y += clearanceProbe;
      continue;
    }

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

  // ------------------------------------------------------------- balance ---
  //
  // The loop above filled each line greedily, and greedy is what produced the
  // 97% / 42% headlines a desk photographed. Re-assign the same pieces across
  // the same slots so the ragged edge is EVEN - see balanceDisplayLines() for
  // why the slot count may never change, and why the body's own cost function
  // is the wrong one here.
  //
  // Skipped whenever the flow already overset an unbreakable token: that line
  // is drawn past its measure by construction, so every candidate assignment
  // is illegal and the balancer would only fall through to null anyway.
  if (lines.length >= 2 && !violations.length) {
    const offsets = [];
    let runningAt = 0;
    for (const piece of pieces) { offsets.push(runningAt); runningAt += piece.length; }

    // Widths of the flow's own pieces, measured once. `trimmed` is what a
    // line's LAST piece actually draws, once its trailing space is cut.
    const full = pieces.map((piece, i) => measure2(piece, offsets[i], fontPx, family, weight));
    const cutWidth = pieces.map((piece, i) => {
      const cutPiece = trimEndClusters(piece);
      return cutPiece === piece ? full[i] : measure2(cutPiece, offsets[i], fontPx, family, weight);
    });
    const prefix = [0];
    for (let i = 0; i < full.length; i += 1) prefix.push(prefix[i] + full[i]);
    const widthOf = (from, to) => (to <= from ? 0 : prefix[to - 1] - prefix[from] + cutWidth[to - 1]);

    const starts = balanceDisplayLines(pieces, index, lines.map((line) => line.measure), widthOf);
    if (starts) {
      for (let j = 0; j < lines.length; j += 1) {
        const from = starts[j];
        const to = j + 1 < starts.length ? starts[j + 1] : index;
        const text = trimEndClusters(pieces.slice(from, to).join(''));
        const at = offsets[from];
        lines[j].text = text;
        lines[j].at = at;
        lines[j].width = measure2(text, at, fontPx, family, weight);
      }
    }
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
      else if (justifies(align) && i < lines.length - 1) {
        justifyLine(line, slack, wordSpaceCeilingEm(align));
      }
    }
  }

  return {
    lines,
    // The top this flow actually resolved to - which is NOT the caller's, once
    // a baseline target is in play (the size decides where the box has to
    // start). `top + height` must still be the band's real bottom, so the band
    // has to be told which top its height was measured from.
    top,
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
  //
  // AND THE ACCENT MARKS ARE NOT INK. `*word*` is the headline's one
  // hand-marked emphasis, and `accent.js` strips the asterisks before
  // anything is drawn - render.js, the .sla and the PDF all paint the
  // SEGMENTS, never the marks. This measured them as ordinary characters, so
  // the band was broken, SIZED and centred around two glyphs the reader never
  // sees. Measured on a 400 px block, the same headline: 26.5 px without the
  // marks, 24.5 px with them - an accented headline was set two pixels
  // smaller than the identical plain one - and a centred line sat off its own
  // words, by more wherever the invisible width pushed a word to the next
  // line. That is the desk's "making headline align center is counting * too".
  //
  // Only the WIDTH ignores them. `text` and `at` keep the asterisks, so
  // render.js still finds the phrase across a line break and a display mark
  // still lands on the character it was set on.
  function measure2(t, at, px, fam, w) {
    const drawn = t.includes('*') ? t.replace(/\*/g, '') : t;
    return measurePieceWidth(drawn, at, px, fam, w, marks, letterSpacingPx);
  }
}

/**
 * How close the headline's complete line shape comes to a printable setting.
 * Working lines must fill; a natural closing line may be shorter, but never a
 * stranded one-word widow. A max or mean cannot distinguish 49% / 100% from
 * the professional 98% / 45% descending shape.
 */
export function headlineBandFit(set) {
  const lines = set?.lines || [];
  if (!lines.length) return { fill: 1, closeAcceptable: true, fills: [] };
  const fills = lines.map((line) => (line.measure > 0 ? line.width / line.measure : 0));
  if (lines.length === 1) return { fill: fills[0], closeAcceptable: true, fills };

  const close = lines[lines.length - 1];
  const closeWords = String(close.text || '').trim().split(/\s+/u).filter(Boolean).length;
  const closeFill = fills[fills.length - 1];
  const closeAcceptable = closeWords >= HEADLINE_CLOSE_MIN_WORDS
    && closeFill >= HEADLINE_CLOSE_MIN_FILL;
  // EVERY line, including the close - and this is only correct because
  // setDisplayFlow BALANCES its lines now.
  //
  // It used to be the minimum of the WORKING lines, which has the mirror flaw
  // of the max it replaced: a max could not tell 49%/100% from a professional
  // 98%/45%, and a working-line minimum cannot see a short close at all, so
  // 97%/42% scored 0.97 and the size search stopped dead on it. A desk
  // photographed the result - eight of eleven headlines on a real front page
  // set 97%/41-43%, every one reported as a 97%-filled headline.
  //
  // The two changes are one change and must not be separated. Under greedy
  // filling a short close is the NORMAL shape, so charging it alone condemns
  // nearly every two-line headline; balanced, a short close means the band
  // genuinely does not fill, and the search should keep looking - upward as
  // well as down, which is how a headline grows to fill two lines instead of
  // shrinking into one. Measured the other way round too: balancing alone,
  // with this metric left as it was, took hard shrinks from 42 to 70, because
  // an even 79%/79% scores worse on working lines than a stubbed 97%/42%.
  // A HEADLINE'S LINES DESCEND. A line fuller than the one above it is a
  // stranded first line, and it is the worse of the two faults this function
  // has to tell apart: the header above condemns 49%/100% by name, and neither
  // a max, a working-line minimum nor a whole-band minimum can see it - all
  // three score 49%/100% at least as well as the professional 98%/45% it
  // should lose to.
  //
  // The balancer already prefers the descending shape where the words allow
  // (DESCENT_BIAS). This is for where they do not: on a 307px block at 28px
  // the two long words will not share a line at all, so the ONLY two-line
  // split is the ascending one - and half a pixel down, at 27px, they do share
  // it and the headline sets 98%/45%. Failing the ascending shape outright is
  // what sends the size search that half pixel.
  //
  // The tolerance is what keeps a balanced band legal: 79%/79% wobbles by a
  // point or two either way and must not be condemned for it.
  const ascends = fills.some((f, i) => i > 0 && f > fills[i - 1] + HEADLINE_ASCENT_TOLERANCE);
  const fill = ascends ? 0 : Math.min(...fills);
  return {
    ascends,
    // A bad close must fail the same scalar gate every caller already uses;
    // this keeps headline choice, the AI panel and the compositor on one rule.
    fill: closeAcceptable ? fill : 0,
    closeAcceptable,
    closeWords,
    fills,
  };
}

const bandFill = (set) => headlineBandFit(set).fill;

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

  let best = null;
  for (let px = options.fontPx + DISPLAY_FIT_STEP_PX; px <= maxPx + 0.001; px += DISPLAY_FIT_STEP_PX) {
    const attempt = setDisplayFlow(text, { ...options, fontPx: px });
    if (failed(attempt)) break;
    const fill = bandFill(attempt);
    if (!best || fill > best.fill) best = { set: attempt, px, fill };
    if (fill >= fillTarget) return { set: attempt, px };
  }
  // A hierarchy cap can make 95% physically unreachable. Keep a near-full
  // result when it is already professional rather than falling all the way
  // back to a visibly short design size; never inflate a genuinely short
  // headline merely because 31% is marginally better than 24%.
  return best && best.fill >= 0.9 ? { set: best.set, px: best.px } : null;
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
  // `options.top` is only the fallback for a flow with no baseline target
  // (the first one on the block); every attempt below carries `baselineAt`
  // through untouched, so each size positions itself.

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
  // Last of all: the flow may be broken across a photograph. Worse than a tall
  // display band - a headline a picture runs through reads as two stories -
  // so it comes after every other relaxation, and still only ahead of overset.
  passes.push({
    ...options,
    bottomLimit: Math.max(options.bottomLimit, roomyBottomLimit || 0),
    mayStraddle: true,
  });

  for (let pass = 0; pass < passes.length; pass += 1) {
    const attemptOptions = passes[pass];
    const first = setDisplayFlow(text, attemptOptions);
    if (!failed(first)) {
      // Line breaks are discontinuous. Making type larger can turn a good
      // descending two-line head into a stranded one-word first line, while
      // half a pixel down restores the professional break. Search down from
      // the requested hierarchy rung before considering growth, and accept
      // only the first (largest) size whose complete line shape passes.
      // OUTWARD from the requested rung, not downward first.
      //
      // This searched down to minPx before growth was ever considered and
      // returned the first size that passed - so the answer was always the
      // SMALLEST size that fills. Survivable while the metric could not see a
      // short close (the band passed at the requested size immediately, so the
      // search rarely ran); once the close is charged it runs on nearly every
      // two-line headline, and downward-first collapsed a real front page -
      // the anchor went from 21px in two lines to 14.5px in one, 60% of the
      // size its own block was designed around. A headline that no longer
      // shouts is not a fixed headline.
      //
      // Both directions genuinely fill, and differently: shrinking takes a
      // two-line head towards ONE full line, growing takes it towards TWO.
      // Which is nearer the design's own hierarchy rung is the question worth
      // asking, so the search asks it - and at equal distance the smaller
      // wins, because every pixel of display type is a pixel off the story.
      if (pass === 0 && fillTarget > 0 && bandFill(first) < fillTarget) {
        const ceiling = maxPx > options.fontPx ? maxPx : options.fontPx;
        const floorPx = Math.max(minPx, options.fontPx * HEADLINE_SHRINK_CAP);
        const reach = Math.max(options.fontPx - floorPx, ceiling - options.fontPx);
        let best = null;
        for (let d = DISPLAY_FIT_STEP_PX; d <= reach + 0.001; d += DISPLAY_FIT_STEP_PX) {
          for (const px of [stepPx(options.fontPx - d), stepPx(options.fontPx + d)]) {
            if (px < floorPx - 0.001 || px > ceiling + 0.001) continue;
            const attempt = setDisplayFlow(text, { ...attemptOptions, fontPx: px });
            if (failed(attempt)) continue;
            const fill = bandFill(attempt);
            if (fill >= fillTarget) {
              return { ...attempt, resolvedPx: px, shrunk: px < options.fontPx, grew: px > options.fontPx };
            }
            if (!best || fill > best.fill) best = { set: attempt, px, fill };
          }
        }
        // Nothing fills. A near-full band at the block's own hierarchy makes a
        // better page than a full one two rungs below it - the argument
        // growToFill() has always made for growth, applied to the whole search
        // rather than to half of it.
        if (best && best.fill >= HEADLINE_NEAR_FULL) {
          return { ...best.set, resolvedPx: best.px, shrunk: best.px < options.fontPx, grew: best.px > options.fontPx };
        }
        // THE BOUND IS ON CHASING POINTS, NOT ON ESCAPING A BAD BAND.
        //
        // Two things are worth leaving the hierarchy range for, and both are
        // all-or-nothing rather than a matter of degree:
        //
        //   a band that ASCENDS - a stranded first line is a fault, not a
        //   shape; and
        //   a band that reaches nothing like full inside the range, when a
        //   size outside it sets the headline in ONE FULL LINE.
        //
        // Measured on the desk's own page: a 17px brief set 64%/68% inside the
        // range and 99% on one line at 12.5px, and the bound was keeping the
        // worse of the two. Loosening the bound itself was tried and is the
        // wrong lever - it costs hierarchy on every block to fix the few: at
        // 0.70 the blocks shrinking more than 15% below their design size go
        // from 16 to 47, for one point of evenness.
        //
        // So the extended search accepts ONLY a genuinely full band. It cannot
        // trade real size for a couple of points, which is the fault the
        // narrow rule above exists to prevent.
        const wantsEscape = headlineBandFit(first).ascends || !best || best.fill < HEADLINE_NEAR_FULL;
        if (wantsEscape && floorPx > minPx) {
          for (let raw = floorPx - DISPLAY_FIT_STEP_PX; raw >= minPx - 0.001; raw -= DISPLAY_FIT_STEP_PX) {
            const px = stepPx(raw);
            const attempt = setDisplayFlow(text, { ...attemptOptions, fontPx: px });
            if (failed(attempt)) continue;
            if (bandFill(attempt) >= fillTarget) {
              return { ...attempt, resolvedPx: px, shrunk: true };
            }
          }
        }

        // Nothing reached even that, so the design size stands - "a headline
        // whose words cannot fill is set at the size the design gave it", and
        // chasing an improvement for its own sake is the "any improvement"
        // fault this engine already measured its way out of once.
        //
        // ONE exception, and it is structural rather than a matter of degree:
        // a band whose lines ASCEND is a stranded first line, which is a fault
        // and not a shape. On a 307px block the two long words will not share
        // a line at 28px, so the design size sets 49%/100%; half a pixel down
        // they do share it and it sets 98%/45%. Escaping that is worth a size
        // change. Two points of fill is not.
        if (best && headlineBandFit(first).ascends && !headlineBandFit(best.set).ascends) {
          return { ...best.set, resolvedPx: best.px, shrunk: best.px < options.fontPx, grew: best.px > options.fontPx };
        }
      }
      // Only from the pass that got what it wanted. A flow already forced
      // past its preferred line budget, or already given the display share
      // ceiling's own last relaxation, is a flow with nothing to spare -
      // growing it there would be buying a straight right edge with the very
      // room those relaxations were granted to protect.
      const grown = pass === 0
        ? growToFill(text, attemptOptions, { maxPx, fillTarget, set: first, failed })
        : null;
      return grown
        ? { ...grown.set, resolvedPx: grown.px, shrunk: false, grew: true }
        : { ...first, resolvedPx: options.fontPx, shrunk: false };
    }
    // The flow OVERSET at the requested size, so it must come down until it
    // sets. This walk is deliberately unbounded - a word pushed off the block
    // is worse than any loss of hierarchy - but it must still stop at the
    // first size that is good enough, and "good enough" is the same near-full
    // standard the fill search uses.
    //
    // Without that it walked past a professional setting to chase an exact
    // number. Measured on the golden 268x248 lead: 20.5px sets two lines at
    // 97%/94%, misses the 95% bar by a hair, and the loop carried on down to
    // 10.5px - HALF the size the block was designed around, for one point of
    // fill. Every one of the ten recorded geometries collapsed the same way.
    let firstClean = null;
    let best = null;
    for (let raw = options.fontPx - DISPLAY_FIT_STEP_PX; raw >= minPx - 0.001; raw -= DISPLAY_FIT_STEP_PX) {
      const px = stepPx(raw);
      const attempt = setDisplayFlow(text, { ...attemptOptions, fontPx: px });
      if (failed(attempt)) continue;
      firstClean ||= { set: attempt, px };
      if (!(pass === 0 && fillTarget > 0) || bandFill(attempt) >= fillTarget) {
        return { ...attempt, resolvedPx: px, shrunk: true };
      }
      const fill = bandFill(attempt);
      if (!best || fill > best.fill) best = { set: attempt, px, fill };
      // Largest-first walk, so the first near-full size met is also the
      // biggest one: take it rather than trading real hierarchy for a point.
      if (fill >= HEADLINE_NEAR_FULL) {
        return { ...attempt, resolvedPx: px, shrunk: true };
      }
    }
    if (best && best.fill >= HEADLINE_NEAR_FULL) {
      return { ...best.set, resolvedPx: best.px, shrunk: true };
    }
    if (firstClean) return { ...firstClean.set, resolvedPx: firstClean.px, shrunk: true };
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

// JUSTIFY ALL LINES - what a printed Marathi daily actually does.
//
// The caps above are a house style: close the line if it can be closed
// decently, and accept a slightly short one rather than open a river. The
// Lokmat reference block the desk supplied does not make that trade. Every
// line but a paragraph's last reaches BOTH edges exactly, and the word gaps
// differ visibly from line to line - wide on one, tight on the next - because
// reaching the edge is worth more to that page than an even grey.
//
// So `justify-all` raises the word-space ceiling far enough that the line can
// always be closed, and takes the two rules that make `justify` stand down:
// JUSTIFY_MIN_EM (a narrow column is set flush left) and the residual the
// breaker is otherwise charged 100x for.
//
// 3 em is the ceiling and it is a real one, not "no limit". A gap wider than
// three aksharas stops reading as a word space and starts reading as a column
// break - and at that point the line is one word short of being setnable at
// all, which is the breaker's business, not the justifier's. Measured across
// 1751 justified lines of two real editions, the widest slack any line had to
// close was 2.1 em per space.
//
// GLYPH SCALING IS NOT RAISED. Word spaces are invisible until they are very
// wide; condensed or expanded Devanagari is visible immediately, and 1.03 is
// already InDesign's newspaper range. The Lokmat block's own lines vary in
// their SPACES, not in their letterforms.
const FORCE_MAX_EXTRA_WORD_SPACE_EM = 3;
const JUSTIFY_ALL = 'justify-all';

/** Is this alignment one of the two that fills the measure? */
const justifies = (align) => align === 'justify' || align === JUSTIFY_ALL;

/** How far one word space may open, for the alignment in force. */
const wordSpaceCeilingEm = (align) => (align === JUSTIFY_ALL
  ? FORCE_MAX_EXTRA_WORD_SPACE_EM : MAX_EXTRA_WORD_SPACE_EM);

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

// THE THIRD LEVER: SETTING A LINE TIGHT.
//
// The justifier could only ever ADD space. That is half of what a compositor
// does, and it is the half that cannot fix the lines a desk actually
// complains about. Measured across a real four-page edition: 58 of 444
// interior lines fell short of their measure, and EVERY ONE OF THEM already
// had both expanding levers pinned at their caps. No amount of further
// stretching could close them, because the word that would have filled them
// is on the next line and nothing could pull it up.
//
// Pulling it up means setting the line it comes from very slightly tight,
// which is exactly what a printed newspaper does and what InDesign's
// "minimum word spacing" and minimum glyph scaling exist for. The bounds
// here are the conservative end of that range:
//
//   * a word space may lose 0.10 em - about a tenth of a Devanagari akshara,
//     and the space is the one place a reader does not measure;
//   * the glyphs may condense to 0.98, half of what they are allowed to
//     stretch, because condensed type is more visible than expanded type at
//     the same percentage - the shirorekha thickens against its counters.
//
// It is deliberately weaker than the expansion range. A tight line should be
// the compositor's last resort, not its habit.
// MEASURED, on a real four-page edition and on a sweep of the database.
//
//                          edition 40294        819 blocks
//                       (444 interior lines)  (3026 interior lines)
//   without compression   58 ragged  13.06%    1405 ragged  46.43%
//   with compression      44 ragged   9.91%    1360 ragged  44.94%
//   worst shortfall       16.7% -> 14.5%
//   lines set tight        -                    108   3.57%
//
// (The sweep's 46% counts flush-left blocks, whose every line is ragged by
// design, so the edition's 9.91% is the number that means anything. The sweep
// is there to show nothing broke at scale.)
//
// And the things that must NOT move did not: interior line count identical at
// 3026, mean fill identical at 32.18%, overset identical. The balancer only
// reassigns pieces across the slots the pour already fixed, so none of this
// can change how deep a paragraph sets or move any geometry - which is the
// whole reason it was safe to do at all.
//
// Widening the range earns nothing: 0.97 gives 1189 and 0.96 gives 1190
// against 0.98's 1195 on the same sweep - six lines in three thousand for
// another percent of visible condensation. The conservative bound is also the
// one that works, which is the best argument a constant can have.
const MIN_GLYPH_SCALE = 0.98;
const MAX_SQUEEZE_WORD_SPACE_EM = 0.10;
// How much a line is charged for spending its whole stretching budget - see
// slackCost(). Chosen by measurement, not by taste: see PROJECT_STATUS.md for
// the sweep across 1751 justified lines of two real editions.
const STRAIN_WEIGHT = 0.12;

/**
 * How much wider than its measure a line may be set and still be closed by
 * compression alone.
 *
 * THE SPACE COUNT MUST BE THE JUSTIFIER'S OWN, not the breaker's piece count.
 * The two are not the same - a piece can be punctuation, and the line's
 * trailing space is trimmed before it is set - and when the breaker's number
 * was the larger one it promised room the justifier could not deliver, clamped
 * at MIN_GLYPH_SCALE, and left the line hanging into the gutter.
 * tests/compose.test.js caught it in one run: `a line crosses a gutter:
 * x=12 w=199.02`. Dropping the word-space term entirely fixed that and threw
 * away most of the gain with it - measured, 210 lines down to 4 - because the
 * spaces are where most of the give is. So the breaker counts them exactly,
 * from a prefix sum built once per paragraph.
 */
function compressibleBy(width, spaces = 0, fontPx = 0) {
  if (!(width > 0)) return 0;
  return spaces * MAX_SQUEEZE_WORD_SPACE_EM * fontPx + width * (1 - MIN_GLYPH_SCALE);
}

function justifyLine(line, slack, ceilingEm = MAX_EXTRA_WORD_SPACE_EM) {
  const spaceCount = (line.text.match(/\s/gu) || []).length;

  // The line is set TIGHT: it carries a word the measure cannot quite hold,
  // and the alternative is the notch in the right edge that word would have
  // left behind on the line above.
  if (slack < -0.5) {
    if (line.width <= 0) return;
    const over = -slack;
    const bySpace = spaceCount
      ? Math.min(over, spaceCount * MAX_SQUEEZE_WORD_SPACE_EM * line.fontPx)
      : 0;
    if (bySpace > 0) {
      line.wordSpacingPx = Number((-bySpace / spaceCount).toFixed(2));
      // The line really IS narrower now, so its geometry has to say so.
      // Leaving line.width at its natural value made a squeezed line claim to
      // reach past the column it was set in, and the overflow guarantee - the
      // one thing composeBlock() promises absolutely - is checked against
      // exactly that number. tests/compose.test.js caught it:
      // `line.x + line.width <= content.right` failed on a line that drew
      // perfectly well.
      //
      // The expanding path deliberately does NOT do this, and must not start:
      // there line.width understates the drawn width, which is the safe
      // direction, and every existing measurement is calibrated against it.
      line.width = Math.max(0, line.width - bySpace);
    }
    const left = over - bySpace;
    if (left <= 0.5) return;
    const scale = Math.max(MIN_GLYPH_SCALE, (line.width - left) / line.width);
    if (scale < 0.999) {
      line.glyphScaleX = Number(scale.toFixed(4));
      line.width = line.width * scale;
    }
    return;
  }

  if (slack <= 0.5) return;
  if (!spaceCount) return;

  const bySpace = Math.min(slack, spaceCount * ceilingEm * line.fontPx);
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

/**
 * The space between two text columns INSIDE one block, in editor px.
 *
 * Proportional to the type, the way a printed gutter is: 0.9 em is what a
 * newspaper leaves between columns of its own body size. Exported because
 * section-adapter.js's measureColumns() has to know it to work out whether a
 * given number of columns would leave anything worth setting in - two places
 * computing the same gutter is how they come to disagree.
 */
export function columnGutterPx(bodyPx) {
  return Math.round((Number(bodyPx) || 16) * 0.9);
}

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
// THE DROP CAP - an initial letter set over several lines, with the copy
// running round it.
//
// A sub-editor's instinct is to select the first character and press a bigger
// size, and until now that is all the editor could do. The result is not a
// drop cap: a 28px run inside an 8px line simply makes that ONE row 3.5 times
// taller, so the opening letter sits on a stilt with a band of white under it
// and the paragraph resumes four lines down. Photographed on a real block; it
// is the fault the size button was always going to produce, because a size
// mark is a property of a RUN and a drop cap is a property of the FRAME.
//
// It is not a special case in the pour, and deliberately so. A drop cap is a
// rectangle at the top of the first column that type may not enter - which is
// exactly what a photograph is, and this engine has run type round those since
// it was written. So the cap contributes one more interval to the obstacle set
// and nothing else in `fillRow`, `viableIntervals` or the balancer changes at
// all.
//
// Its size is derived, never asked for: the cap's own design box is made to
// span DROP_CAP_LINES body line boxes, so "3 lines" means three lines whatever
// the block's body size is. The gutter beside it is the character's own side
// bearing plus a hair; a printed drop cap does not stand off further than that.
const DROP_CAP_MAX_LINES = 6;
// The air between the cap and the copy beside it, in the BODY's em rather
// than the cap's: it is the copy that has to clear the letter, so the gap
// should read the same whether the cap is two lines deep or four. Half an em
// is what a printed initial leaves.
const DROP_CAP_GUTTER_EM = 0.5;

// THE FACE'S REAL NUMBERS, measured in the browser against the publication
// serif at 200px and recorded here rather than guessed - the same way this
// project arrived at MIN_LINE_HEIGHT.
//
// `measureText().actualBoundingBoxAscent` over twenty aksharas:
//
//     क म ग ट पा रा ना हा सु ल क्ष सा   0.625 em   <- shirorekha to baseline
//     भा थ ध अ                          0.63-0.64
//     श्री वि दे जि                       0.895-0.905  (an above-base matra)
//
// So an ordinary letter's BODY - the part a drop cap is aligned by, from the
// head stroke down to the baseline - is 0.625 em, and it is that height, not
// the design box, that has to span the lines. Sizing by the design box (1.555
// em) drew a letter a little over half the depth it had reserved, sitting in
// its own hole; that is the same fault the size button already had, only
// tidier.
export const SHIROREKHA_EM = 0.625;

// A LIST IN RUNNING COPY. The marker's own column is the widest marker plus
// this gutter - half a body em, the same gap the drop cap leaves, and for the
// same reason: it is the COPY that has to clear the mark, so the space reads
// the same whether the marker is a bullet or "१२.".
const LIST_GUTTER_EM = 0.5;
// And a hard ceiling on it, in ems for the reason MIN_COLUMN_EM is: a list a
// hundred items long would otherwise hang "१००." and take a fifth of a narrow
// column away from the words. Past this the markers simply stop aligning,
// which is a far smaller fault than a measure nothing can be set in.
const LIST_MAX_HANG_EM = 3;
// And what the BROWSER lays the face out with - `fontBoundingBoxAscent` /
// `Descent`, which is what decides where a baseline lands inside a line box.
// Deliberately separate from faceAscent()/faceDescent(): those are this
// engine's own measured INK extremes and are not the numbers CSS uses.
export const FACE_BOX_ASCENT_EM = 0.930;
export const FACE_BOX_DESCENT_EM = 0.625;

/**
 * The cap's own geometry, or null when the block has not asked for one.
 *
 * `text` is taken in CLUSTERS, never characters - a Marathi initial is an
 * akshara (क्ष is one letter, not three), and slicing by code unit would set
 * a bare consonant in 40px type and leave its matra behind in the copy.
 *
 * Aligned as a compositor aligns one: the cap's head stroke on the FIRST
 * line's head stroke, and its baseline on the LAST line it spans.
 */
// WHAT A DEVANAGARI VOWEL SIGN DOES TO THE SIZE OF AN INITIAL LETTER.
//
// The desk's report: the drop cap "is not overlapping with other letters when
// it has velanti, ukaar like complex things". It was right, and it is two
// different faults with two different fixes, because the two kinds of sign go
// in two different directions.
//
// A sign ABOVE the head stroke (ी, े, ै, ो, ौ, ं, ँ) rises above where the cap
// was placed - the cap's head stroke is set level with the body's first line,
// so anything above it lands OUTSIDE the block's copy area, over the deck.
// A sign BELOW the baseline (ु, ू, ृ, ॄ, ्, ़) hangs past the last line the cap
// was reserved room for, and straight into the line under it - which is the
// collision that was photographed.
//
// The face's own numbers say how far: hhea reports 930 up and 625 down at
// 1000/em for the publication serif (font-metrics.js), and the head stroke is
// at 625 up. So an above-sign can occupy 0.305 em over the head stroke, and a
// below-sign 0.625 em under the baseline. Those are the face's claims about
// its own worst case, which is exactly what a reservation should use - the
// alternative is measuring the ink of one particular glyph, and this engine
// has no glyph-extent path.
const CAP_MARK_ABOVE = /[\u0900-\u0902\u093A\u0940\u0945-\u094C\u0951\u0953\u0954]/;
const CAP_MARK_BELOW = /[\u093B\u093C\u0941-\u0944\u094D\u0952\u0962\u0963]/;

function dropCapOf(text, { lines, chars, bandHeight, fontPx, family, weight, skip = 0 }) {
  const count = Math.round(Number(lines) || 0);
  if (!(count >= 2) || !text) return null;
  const wanted = Math.max(1, Math.round(Number(chars) || 1));
  // FROM AFTER THE DATELINE, when there is one. The dateline is prepended to
  // the body by the adapter, so `text` opens with "■ सातारा, प्रतिनिधी : " and
  // the cap's first cluster used to be that U+25A0 - a mark the publication
  // faces have no letter for, drawn three lines deep as a solid black square.
  const from = Math.max(0, Math.round(Number(skip) || 0));
  const capText = clusters(text.slice(from)).slice(0, wanted).join('');
  if (!capText.trim()) return null;

  const deep = Math.min(count, DROP_CAP_MAX_LINES);
  // Where the body's own first line puts its baseline and its head stroke.
  const bodyBaseline = fontPx * faceAscent(family, weight);
  const headStroke = bodyBaseline - fontPx * SHIROREKHA_EM;
  // The cap's body has to reach from that head stroke down to the baseline of
  // the last line it spans, which is (deep - 1) rows lower.
  const capBody = (deep - 1) * bandHeight + fontPx * SHIROREKHA_EM;
  // A cluster carrying a sign above the head stroke has less room for its
  // BODY, because the sign has to fit between the block's top and the head
  // stroke. The baseline does not move - it is the baseline of the last line
  // the cap spans, and moving it would take the cap off the grid - so the cap
  // is set smaller instead, which is what a compositor does with a ी.
  const aboveEm = CAP_MARK_ABOVE.test(capText) ? FACE_BOX_ASCENT_EM - SHIROREKHA_EM : 0;
  const capFontPx = aboveEm > 0
    ? Math.min(capBody / SHIROREKHA_EM, (bodyBaseline + (deep - 1) * bandHeight) / (SHIROREKHA_EM + aboveEm))
    : capBody / SHIROREKHA_EM;
  // A glyph is centred in its line box by half-leading, so the line box that
  // puts the head stroke exactly on the box top is the one where that leading
  // cancels the difference between the face's box ascent and its head stroke.
  const lineBoxPx = capFontPx * (FACE_BOX_ASCENT_EM + FACE_BOX_DESCENT_EM
    - 2 * (FACE_BOX_ASCENT_EM - SHIROREKHA_EM));
  return {
    text: capText,
    length: capText.length,
    lines: deep,
    fontPx: capFontPx,
    lineBoxPx,
    // Down from the body's top by whatever keeps the cap's BASELINE on the
    // last line it spans. With no sign above the head stroke that is exactly
    // the body's own head stroke, as it always was; with one, the cap is
    // smaller and therefore starts lower.
    offsetY: bodyBaseline + (deep - 1) * bandHeight - capFontPx * SHIROREKHA_EM,
    width: measure(capText, capFontPx, family, weight),
    // How far this cap's ink hangs BELOW its baseline. Zero for an ordinary
    // consonant, which is why an ordinary drop cap reserves exactly what it
    // always did and no composition changes.
    descentPx: CAP_MARK_BELOW.test(capText) ? capFontPx * faceDescent(family, weight) : 0,
    gutter: fontPx * DROP_CAP_GUTTER_EM,
  };
}

function pourBody(bodyInput, {
  top, bottom, columns, images, fontPx, lineHeight, family, weight, align: requestedAlign,
  paragraphSpacingPx = 0, letterSpacingPx = 0,
  italic = false, underline = false, firstLineIndentPx = 0,
  paragraphStarts = null, dropCapLines = 0, dropCapChars = 1,
  listStyle = 'none', datelineLength = 0,
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

  // The initial letter, and the rectangle it keeps type out of. It stands in
  // the FIRST column only - a drop cap belongs to the opening of the story,
  // and one at the top of every column would read as three stories.
  //
  // AND IT MAY OPEN THE STORY RATHER THAN THE BLOCK. A block carrying a
  // location or a reporter opens with "■ सातारा, प्रतिनिधी : " - the adapter
  // prepends it, so it is the body's own first characters - and a drop cap was
  // therefore REFUSED on every such block. That is most of them: measured on
  // this newsroom's own editions, a drop cap silently did nothing wherever a
  // desk had filled in the story's place, which is the whole reason the report
  // was "it does not work for many news blocks".
  //
  // A printed Marathi paper sets the dateline on its own line and starts the
  // story under it with the initial letter, so that is what this does: the
  // dateline becomes its own paragraph (see `starts` below) and the cap is
  // taken from the story that follows it and placed on the first row under it.
  const capSkip = datelineLength > 0 ? datelineLength : 0;
  const cap = dropCapOf(text, {
    lines: dropCapLines, chars: dropCapChars, bandHeight, fontPx, family, weight, skip: capSkip,
  });
  // HOW MANY ROWS THE DATELINE ITSELF TAKES, so the cap starts under it rather
  // than beside it. Measured against the first column's own measure with the
  // same measure() the breaker uses; a dateline is one short run of words and
  // in the ordinary case this is exactly one row.
  //
  // Read by the capacity calibration AND by the real pour, from this one
  // value, so the two cannot disagree about where the cap is - which is the
  // invariant holesAt() exists to hold.
  const firstMeasure = columns.length ? columns[0].end - columns[0].start : 0;
  const datelineRows = cap && capSkip > 0 && firstMeasure > 0
    ? Math.max(1, Math.ceil(measure(text.slice(0, capSkip), fontPx, family, weight) / firstMeasure))
    : 0;
  const capTop = top + datelineRows * bandHeight;
  // The rectangle the copy keeps out of - the cap's reserved lines, plus
  // whatever its own ink hangs below them, rounded UP to a whole band so the
  // copy under it stays on the grid. `descentPx` is zero for a cluster with no
  // sign below the baseline, so an ordinary cap reserves exactly what it did.
  const capBottom = cap
    ? capTop + cap.lines * bandHeight
      + (cap.descentPx > 0 ? Math.ceil(cap.descentPx / bandHeight) * bandHeight : 0)
    : 0;
  const capRight = cap && columns.length ? columns[0].start + cap.width + cap.gutter : 0;

  // WILL THIS BLOCK ACTUALLY BE JUSTIFIED? Resolved here, before the pour,
  // because the line breaker needs to know.
  //
  // Only a line that will be justified may be set tight: compression is the
  // JUSTIFIER's lever, so on a flush-left block nothing would ever close an
  // overhang the breaker had allowed and the line would simply hang past its
  // column. Found exactly that way - a 620x420 block with no alignment set had
  // a body line 3.83 px past its measure carrying no glyph scale at all,
  // because justifyLine had never run on it. tests/compose.test.js's overflow
  // guarantee caught it, which is what that guarantee is for.
  //
  // It is the same pair of conditions the alignment resolves with further
  // down, computed once here and read there rather than worked out twice.
  const columnEm = columns.length ? (columns[0].end - columns[0].start) / fontPx : 0;
  // JUSTIFY_MIN_EM is `justify`'s rule and deliberately not `justify-all`'s:
  // a desk that asks for every line to reach both edges has already made the
  // trade that rule exists to refuse.
  const tooNarrowToJustify = align === 'justify' && columnEm > 0 && columnEm < JUSTIFY_MIN_EM;
  const willJustify = justifies(align) && !tooNarrowToJustify;
  // Every obstacle at a given band: the pictures, and the cap. One function so
  // the calibration grid and the real pour cannot disagree about it - the
  // capacity a desk is quoted has to be the capacity the copy actually pours
  // into, and a cap the calibration could not see would overstate it by three
  // lines' worth of measure.
  const holesAt = (columnIndex, y0, y1) => {
    const holes = bandObstacles(images, y0, y1, fontPx);
    // Between the cap's own top and bottom - not simply "above the bottom".
    // With a dateline the cap starts a row down, and the dateline's own row
    // has the full measure to set in.
    if (cap && columnIndex === 0 && y0 >= capTop - 0.5 && y0 < capBottom - 0.5) {
      holes.push({ start: columns[0].start, end: capRight });
    }
    return holes;
  };

  // ---------------------------------------------------- capacity calibration ---
  // Every band's raw free space at the ordinary height, whatever is or is
  // not written into it - independent of `marks` on purpose (see above).
  // Only `result.capacity`/`result.whitespace` read this; the real pour
  // below never does, because a row it actually places a tall run on may
  // legitimately need more room than this grid assumes.
  const strips = columns.map((column, columnIndex) => {
    const bands = [];
    for (let y = top; y + bandHeight <= bottom + 0.5; y += bandHeight) {
      bands.push({ y, free: subtract([column], holesAt(columnIndex, y, y + bandHeight)) });
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

  /**
   * The height a row must be to carry a run set larger than the body.
   *
   * `size * lineHeight` - the larger run's own full design box - sounds
   * sufficient and is not. Measured by making one word 18pt inside 9pt copy
   * and photographing it: the row grew as that formula says, and the big
   * word's ink still climbed about 0.7 block px into the line above, which on
   * newsprint is close enough to touch its descenders.
   *
   * The reason is that a row's BASELINE is not in the middle of the row. The
   * line is painted as one span set in the BODY size with `line-height` equal
   * to the row's height, so the browser centres the body's own strut in it and
   * puts the baseline at `(height - strut) / 2 + bodyPx * FACE_BOX_ASCENT_EM`.
   * Growing the row therefore lifts the baseline by only HALF of what was
   * added, while the larger run needs its whole ascent above it. Hence the
   * factor of two:
   *
   *   height >= bandHeight + 2 * FACE_BOX_ASCENT_EM * (size - bodyPx)
   *
   * which puts the baseline at exactly `FACE_BOX_ASCENT_EM * size` - the big
   * run's own box ascent - and leaves its descent satisfied for every size at
   * or above the body's. It is exactly `bandHeight` when the run IS body size,
   * so a block carrying no size mark composes byte for byte as before.
   */
  const rowHeightFor = (size) => Math.max(
    size * lineHeight,
    bandHeight + 2 * FACE_BOX_ASCENT_EM * (size - fontPx),
  );

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
  function rowGaps(column, columnIndex, y, height, isFirstRow, isLastRow) {
    if (y + height > bottom + 0.5) return null;
    const here = subtract([column], holesAt(columnIndex, y, y + height));
    const fullWidthPx = column.end - column.start;
    const bands = [];
    let index = 0;
    if (!isFirstRow) {
      bands.push(subtract([column], holesAt(columnIndex, y - height, y)));
      index = 1;
    }
    bands.push(here);
    if (!isLastRow) {
      bands.push(subtract([column], holesAt(columnIndex, y + height, y + 2 * height)));
    }
    return { y, gaps: viableIntervals(bands, index, minCorridor, fullWidthPx) };
  }

  // One column's cursor. `y` advances only by a row's own FINALIZED height
  // once that row is committed - a tall row pushes every later row in THIS
  // column down; other columns are unaffected, matching "reading order is
  // down a column and then into the next" exactly as before.
  function makeCursor(column, columnIndex) {
    let y = top;
    let first = true;
    return {
      probe(height) { return rowGaps(column, columnIndex, y, height, first, y + height + height > bottom + 0.5); },
      commit(height) { y += height; first = false; },
      hasRoom(height) { return y + height <= bottom + 0.5; },
      get y() { return y; },
    };
  }
  const cursors = columns.map((column, columnIndex) => makeCursor(column, columnIndex));

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
  function fillRow(cursor, pieces, index, paraCharOffset, paragraphOffset, leadPx = 0) {
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
        // The room kept clear at the START of this row's leftmost gap, and the
        // two things that ask for it are the same gesture measured differently:
        //
        //  - a paragraph's own FIRST line starts inset (`indentPx`), the way a
        //    printed paragraph opens;
        //  - a list item HANGS (`hangingPx`), so every one of its lines starts
        //    inset and the marker stands in the column that leaves.
        //
        // The gap it is set in is unchanged either way - the row is still fully
        // used - only the text starts further in. Never more than half the gap:
        // below that there is no measure left to set in.
        const indent = gapIndex === 0 ? Math.min(leadPx, (gap.end - gap.start) * 0.5) : 0;
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
          // How far in this line actually starts, so a list marker can be hung
          // at the gap's own left edge without re-deriving the clamp above.
          lead: indent,
          // The row is occupied whatever the indent did to the text's start -
          // an indented first line is a set line, not a partly empty one.
          occupies: gap.end - gap.start,
        });
      }

      const requiredHeight = placed.reduce((max, p) => {
        if (p.empty) return max;
        const size = maxSizeIn(p.at, p.at + p.text.length);
        return size ? Math.max(max, rowHeightFor(size)) : max;
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
    // A TIGHT line - one set a shade narrower than it wants to be. It ends
    // flush, so the reader sees no notch; what they could see is the type
    // being a touch close, so it is charged for on the same cubed scale but
    // at four times the rate. That makes the solver prefer a slightly loose
    // line to a slightly tight one at equal magnitude, and reach for tight
    // only when the alternative is slack nothing can close.
    if (slack < 0) {
      const over = -slack;
      const closable = compressibleBy(width, spaces, fontPx);
      const residual = Math.max(0, over - closable);
      return 4 * (over / measure) ** 3 + 100 * (residual / measure) ** 3;
    }
    if (slack === 0) return 0;
    const closable = spaces * wordSpaceCeilingEm(align) * fontPx + width * (MAX_GLYPH_STRETCH - 1);
    const residual = Math.max(0, slack - closable);
    // AND HOW HARD THE LINE HAS TO BE STRETCHED TO CLOSE IT.
    //
    // Slack measured against the MEASURE says how much space there is to
    // absorb; it says nothing about whether absorbing it will look like
    // anything. A narrow line with eight word gaps closes 17 px without
    // comment; the same 17 px across two gaps opens both of them to three
    // times a normal word space, and that is what a reader sees.
    //
    // The desk's report was "if we increase only one character/word in body
    // whole line's margin get impacted", and the measurement behind this is
    // 1751 justified lines across two real editions: 28.2% of them were at the
    // 0.55 em word-space cap while 18% needed no extra space at all. The
    // solver had no reason to even that out - both are closable, and
    // `(slack/measure)^3` for a closable line is on the order of 0.002.
    //
    // So the cost is on the fraction of the line's OWN closing budget it
    // spends. Cubed, like everything else here, so a line at a fifth of its
    // budget is nearly free and one at the cap is not - which is what makes
    // the solver move a word rather than open eight gaps.
    const strain = closable > 0 ? Math.min(1, slack / closable) : 1;
    // The residual dominates by two orders of magnitude, so the solver will
    // trade a lot of ordinary slack to avoid one notch. Strain sits between
    // the two: worth moving a word for, never worth a notch for.
    return (slack / measure) ** 3 + STRAIN_WEIGHT * strain ** 3 + 100 * (residual / measure) ** 3;
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

    // The spaces the JUSTIFIER will find in the finished line, counted the way
    // it counts them: over the joined pieces, less whatever trimEndClusters
    // cuts off the last one. A prefix sum, so the breaker's inner loop stays
    // O(1) per candidate.
    const spacesIn = pieces.map((piece) => (piece.match(/\s/gu) || []).length);
    const tailSpaces = pieces.map((piece) => {
      const cut = trimEndClusters(piece);
      return (piece.match(/\s/gu) || []).length - (cut.match(/\s/gu) || []).length;
    });
    const spacePrefix = [0];
    for (let i = 0; i < spacesIn.length; i += 1) spacePrefix.push(spacePrefix[i] + spacesIn[i]);
    const spacesOf = (from, to) => (to <= from ? 0
      : Math.max(0, spacePrefix[to] - spacePrefix[from] - tailSpaces[to - 1]));

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
          // A line may now run PAST its measure by as much as compression can
          // take back - the third lever, added because every ragged line left
          // on a real page had both expanding levers already at their caps and
          // the word that would have filled them was stranded on the line
          // below. Beyond that it is not a candidate, exactly as before.
          //
          // The slot count is fixed by the pour and this only reassigns pieces
          // across those same slots, so nothing here can change how deep the
          // paragraph sets or move any geometry.
          const room = willJustify ? compressibleBy(width, spacesOf(i, k), fontPx) : 0;
          if (width > measure + room + 0.5 && k > i + 1) break;
          const next = cost[j + 1][k];
          if (next === INF) continue;
          const slack = measure - width;
          if (slack < -room - 0.5 && k > i + 1) continue;
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
  // THE DATELINE, ON ITS OWN LINE, when this block sets an initial letter.
  //
  // One extra paragraph start, and nothing else in the engine learns anything:
  // a forced break already lands on a fresh row, which is exactly what puts
  // the story - and its cap - under the dateline rather than beside it.
  const capStarts = cap && capSkip > 0 && !starts.includes(capSkip)
    ? starts.concat(capSkip).sort((a, b) => a - b)
    : starts;
  const paragraphs = paragraphsFrom(text, capStarts);
  // Which paragraph the cap's letter was taken out of - the story's first,
  // which is the second paragraph when a dateline precedes it.
  const capParagraphIndex = cap
    ? Math.max(0, paragraphs.findIndex((paragraph) => paragraph.offset === capSkip))
    : -1;

  // ------------------------------------------------ a list in running copy ---
  //
  // `page_sections.list_style` has been a column since the schema was written
  // and the compositor had never read it: the Typography control set it, it
  // persisted, and the only thing it reached was a CSS class on that panel's
  // own PREVIEW paragraph. The composed block set no list at all - the same
  // shape of fault the `drop_cap` BOOLEAN had before it became `drop_cap_lines`.
  //
  // A list item is one authored PARAGRAPH, and it HANGS: the marker stands in
  // its own column and every line of the item - not just the first - is set
  // inset past it, which is what makes the markers line up down the page and
  // the copy line up with them. That is the whole difference from a panel's
  // list, where the marker goes into the line because a panel has no second
  // measure to break against.
  //
  // The engine learns nothing new to do it. The hanging indent is the FIRST
  // LINE INDENT this pour has always applied, asked for on every row instead
  // of one, and the marker is drawn beside the copy exactly as the drop cap
  // is - its own box, its own baseline, no place in `lines` and therefore no
  // effect on `line.at`, on a sub-editor's marks, or on anything that reads
  // them. Not one character of the stored copy is touched: a marker is
  // furniture, and it is never in the text.
  const listMode = listStyle === 'bullet' || listStyle === 'number' ? listStyle : 'none';
  const markerTexts = listMode === 'none' ? [] : paragraphs.map((_, i) => markerText(listMode, i));
  // The column the markers stand in is as wide as the WIDEST of them plus the
  // gutter, so "९." and "१०." align on their own left edge and the copy beside
  // them is flush down the whole list. Sized once for the block: a per-item
  // width would make the copy's left edge step in and out.
  const markerColumnPx = markerTexts.reduce(
    (widest, mark) => Math.max(widest, measure(mark, fontPx, family, weight)), 0,
  );
  const hangingPx = listMode === 'none' ? 0
    : Math.min(markerColumnPx + fontPx * LIST_GUTTER_EM, fontPx * LIST_MAX_HANG_EM);
  const listMarkers = [];

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

    // The cap's own letter is SET SEPARATELY, so the pour must not set it
    // again - but every mark a sub-editor put on this copy is held against the
    // authored text by offset, so nothing may shift. The first piece therefore
    // loses its opening clusters and the paragraph's offset gains exactly the
    // same number: `at` for every remaining piece is unchanged, to the
    // character.
    const capHere = cap && paragraphIndex === capParagraphIndex ? cap.length : 0;
    const paragraphOffset = paragraph.offset + capHere;
    const pieces = breakPieces(capHere ? paragraph.text.slice(capHere) : paragraph.text);
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
      // A list item hangs on EVERY row; an ordinary paragraph indents its own
      // first line only. The two are exclusive - an item that both hung and
      // indented would start its first line twice as far in as the rest of
      // itself, which is a fault a compositor would never set.
      const leadPx = hangingPx > 0
        ? hangingPx
        : (indentPx > 0 && firstLineOfParagraph && paragraph.forcedBreak ? indentPx : 0);
      const result = fillRow(cursor, pieces, index, paraCharOffset, paragraphOffset, leadPx);
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
        // The item's marker, hung at the left edge of the gap this first line
        // was set in - which is where the copy would have started had it not
        // been asked to hang. On the same baseline as that line, because a
        // marker beside a line of type sits on it.
        if (firstLineOfParagraph && hangingPx > 0 && markerTexts[paragraphIndex]) {
          listMarkers.push({
            text: markerTexts[paragraphIndex],
            x: p.x - (p.lead || 0),
            y: result.row.y,
            width: markerColumnPx,
            height: result.height,
            baseline: result.row.y + fontPx * faceAscent(family, weight),
            fontPx, family, weight,
          });
        }
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
      balanceParagraph(lines, pieces, paragraphSlots, paragraphOffset);
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
      overset = text.slice(paragraphOffset + paraCharOffset);
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
  if (tooNarrowToJustify) align = 'left';

  if (align && align !== 'left') {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const isLastOfParagraph = i === lines.length - 1 || lines[i + 1].paragraphBreak;
      // Justification needs the SIGNED slack: a negative one is a line the
      // balancer chose to set tight, and clamping it to zero here would leave
      // that line simply overhanging its measure. Right and centre still take
      // the clamped one - there is nothing to distribute on an overfull line.
      const slack = line.measure - line.width;
      const positive = Math.max(0, slack);
      if (align === 'right') line.x = line.x + positive;
      else if (align === 'center') line.x = line.x + positive / 2;
      else if (justifies(align) && !isLastOfParagraph) {
        justifyLine(line, slack, wordSpaceCeilingEm(align));
      }
    }
  }

  const availableEquivalent = occupiedEquivalent + emptyEquivalent;

  return {
    lines,
    overset,
    violations,
    // Where each item's marker is hung. Drawn like the drop cap - beside the
    // copy, never inside it - so nothing here can move a line or shift an
    // offset.
    listMarkers,
    // Where the initial letter goes and how big it is. Drawn by render.js
    // rather than composed as a line: it is one glyph in its own box, not a
    // flow, and nothing follows it that needs a baseline from it.
    dropCap: cap && columns.length ? {
      text: cap.text,
      at: 0,
      x: columns[0].start,
      y: capTop + cap.offsetY,
      width: cap.width,
      height: cap.lines * bandHeight,
      lineBoxPx: cap.lineBoxPx,
      fontPx: cap.fontPx,
      lines: cap.lines,
      // WHERE THE CAP SITS ON THE PAGE, stated once and by the only thing that
      // knows. The browser never needed it - `lineBoxPx` is a CSS line-height
      // and the browser works the half-leading out itself - so it was never
      // said, and every export therefore had to re-derive it or, as all four
      // of them did, simply not draw the cap at all. It resolves to the
      // baseline of the LAST body line the cap spans, which is the rule
      // dropCapOf() sizes it by.
      baseline: capTop + cap.offsetY + cap.fontPx * SHIROREKHA_EM,
      family,
      weight,
    } : null,
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
        // Two ceilings and a FLOOR, because the policy that will really set
        // this copy has all three (paragraph-policy.js). The ceilings say when
        // a paragraph must end; the floor says how shallow the shallowest
        // piece may be - and because planParagraphs() divides a long paragraph
        // EVENLY rather than closing it at the first ceiling it meets, the
        // break lands near that floor, not near the sentence ceiling.
        //
        // Modelling only the ceilings put the break two lines later than the
        // compositor really takes it, and a break costs the tail of the line
        // it closes: measured on a 240x180 block, 271 characters quoted
        // against 247 actually set - a floor 10% optimistic, which is the one
        // direction this number may not be wrong in.
        if (sentencesInParagraph >= MAX_PARAGRAPH_SENTENCES
          || linesInParagraph + 1 >= MIN_PARAGRAPH_LINES) { closed = true; break; }
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

// And a little more on the FLOOR alone, because the floor is the one end of
// the range that may not be wrong: the worklist prints it as "this block holds
// N characters" and fit.service.js sets type against it.
//
// The calibration pours the sample through this block's real gaps, which is
// exact, and then has to GUESS where the paragraph policy will break it -
// planParagraphs() divides a long paragraph evenly, and evenly depends on a
// total depth the calibration does not know because it is generating the copy
// as it goes. Measured against the true, character-granular capacity of 208
// real block shapes x column counts x word shapes: the floor is 25%
// conservative at the median and over-promises on 4 of them, worst by 4.9%.
// This covers that and nothing else - it is not a discount on the budget
// (which is what was tried once and underfilled every block on the page), it
// is the measured error of one estimator, applied where that estimator's
// promise is made.
const FLOOR_SAFETY = 0.95;

// ---------------------------------------------------------------- the call ---

/**
 * Where the next flow's first BASELINE goes, given where the last one's ended.
 *
 * Two numbers, and the larger wins:
 *
 *   * the specified gap - BASELINE_GAP, in the line of the flow below;
 *   * and the clearance the two faces physically need, from their own
 *     metrics: the flow above's descent plus the flow below's ascent. A
 *     40px headline over 9px copy asks for a wider clearance than 1.5 body
 *     lines, and type that collides is not a spacing preference.
 */
function baselineAfter(previous, next) {
  const specified = (BASELINE_GAP[`${previous.key}>${next.key}`] ?? 1.5) * next.lineBox;
  const clearance = previous.fontPx * faceDescent(previous.family, previous.weight)
    + next.fontPx * faceAscent(next.family, next.weight);
  return previous.baseline + Math.max(specified, clearance);
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

  const bodyPx = Math.max(MIN_LEGIBLE_PX, num(input.bodyFontPx, DEFAULT_BODY_FONT_PX));
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
    // THE RECTANGLES THE TYPE WAS SET CLEAR OF - the pictures, the panels set
    // inside the story and any page overlay crossing this block, in the
    // block's own pixels. Running copy needs no such list (it meets an
    // obstacle a scanline at a time), but a Smart Card is solved as a GRID and
    // cannot flow round anything, so it has to be given a clear rectangle to
    // solve in. Stated here rather than re-derived, so what the card avoids is
    // exactly what the pour avoided.
    obstacles: images,
    bands: {},
    bodyLines: [],
    dropCap: null,
    listMarkers: [],
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
    { key: 'kicker', ...flowOf(input.kicker), px: Math.round(bodyPx * (Number(input.kickerScale) > 0 ? Number(input.kickerScale) : 1.05)), min: MIN_LEGIBLE_PX, maxLines: 2, locked: true, align: headlineAlign, ...displayTypography('kicker', input.displayFamily) },
    { key: 'headline', ...flowOf(input.headline), px: num(input.headlineFontPx, 34), min: Math.max(MIN_LEGIBLE_PX, bodyPx * 1.1), maxLines: num(input.headlineMaxLines, 4), preferLines: HEADLINE_MAX_LINES, locked: Boolean(input.headlineLocked), align: headlineAlign, ...displayTypography('headline', input.displayFamily) },
    { key: 'deck', ...flowOf(input.subheading), px: num(input.subheadingFontPx, 20), min: Math.max(MIN_LEGIBLE_PX, bodyPx), maxLines: num(input.deckMaxLines, 3), preferLines: 1, locked: Boolean(input.subheadingLocked), align: deckAlign, ...displayTypography('deck', input.displayFamily) },
  ].filter((flow) => flow.text.trim());

  let y = content.top;
  let previous = null;

  // The last baseline set, and what set it - all the next flow needs to know
  // where its own first baseline goes (baselineAfter()).
  let lastBaseline = null;

  // What the deck needs at its smallest, reserved out of the headline's own
  // ceiling. Zero when there is no deck, so a block without one composes byte
  // for byte as before.
  const deckFlow = flows.find((flow) => flow.key === 'deck');
  const deckReserve = deckFlow && !deckFlow.locked
    ? Math.max(deckFlow.min, bodyPx * DECK_MIN_OF_BODY) * Math.max(1.1, lineHeight - 0.15)
    : 0;

  for (const flow of flows) {
    const displayLineHeight = Math.max(1.1, lineHeight - 0.15);
    const headlinePx = Number(result.bands.headline?.resolvedPx) || 0;
    const effectivePx = flow.key === 'deck' && headlinePx > 0 && !flow.locked
      ? Math.max(flow.min, Math.min(flow.px, Math.round(headlinePx * DECK_MAX_HEADLINE_RATIO * 10) / 10))
      : flow.px;
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
      // A candidate's own RESOLVED size defines the baseline gap above it.
      // fitDisplayFlow() may try several sizes, so this cannot be reduced to
      // one number here from the requested size without making auto-fitted
      // decks/headlines carry the wrong vertical rhythm.
      previousBaseline: lastBaseline,
      flowKey: flow.key,
      // The only hard floor is the block's own content edge. A band's BOX may
      // legitimately begin above the previous band's box bottom - that box
      // carries a full line's slack below its ink, and closing that slack is
      // the whole point of spacing by baseline. What may not collide is the
      // INK, and baselineAfter()'s clearance term is what guarantees that,
      // from the two faces' own metrics.
      floor: content.top,
      // The headline may not take the whole display share when a deck has to
      // follow it: the deck's own minimum band is reserved out of the ceiling
      // first. Without this the headline holds its design size and the deck is
      // squeezed to whatever is left - see DECK_MIN_OF_BODY.
      bottomLimit: Math.min(
        content.bottom,
        content.top + room * MAX_DISPLAY_SHARE - (flow.key === 'headline' ? deckReserve : 0),
        y + room * share,
      ),
      column: { start: content.left, end: content.right },
      images,
      fontPx: effectivePx,
      lineHeight: displayLineHeight,
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

    const hierarchyShrunk = set.resolvedPx < flow.px - 0.05;
    result.bands[flow.key] = {
      top: set.top,
      height: set.height,
      lines: set.lines,
      lineCount: set.lineCount,
      requestedPx: flow.px,
      resolvedPx: set.resolvedPx,
      shrunk: set.shrunk || hierarchyShrunk,
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
    if (set.shrunk || hierarchyShrunk) {
      warnings.push({ code: `${flow.key.toUpperCase()}_AUTO_FITTED`, detail: `Set at ${set.resolvedPx}px rather than the requested ${flow.px}px.` });
    }

    y = set.bottom;
    if (set.lines.length) {

      const last = set.lines[set.lines.length - 1];
      lastBaseline = {
        key: flow.key,
        baseline: last.baseline,
        fontPx: last.fontPx,
        family: last.family,
        weight: last.weight,
      };
    }
    previous = flow.key;
  }

  // See the recomposition at the foot of this function: this block's headline
  // WOULD fill its measure at a larger size, and the only thing standing in
  // the way is that the copy is already at the foot. That is a choice between
  // a straight right edge and a sentence, it belongs to the desk, and the desk
  // can only make it if it is told the choice exists.
  const denied = input.headlineGrowthDenied;
  // Only when it really would fill. Where growth would merely improve the band
  // there is nothing here worth cutting a sentence for, and
  // HEADLINE_SHORT_OF_MEASURE below already says the headline is short.
  if (denied && denied.fill >= HEADLINE_FILL_TARGET) {
    warnings.push({
      code: 'HEADLINE_COULD_FILL',
      // Stated as FIELDS as well as inside the sentence. A desk that is told
      // the size cannot press the size; the panel turns these into the offer,
      // exactly as it does for a picture that has to move.
      px: denied.px,
      requestedPx: denied.requestedPx,
      charsOver: denied.charsOver,
      detail: `This headline would fill its measure at ${denied.px}px rather than ${denied.requestedPx}px, `
        + `but the block is full: ${denied.charsOver} clusters of copy would have no room. `
        + 'Cut the copy and set the headline larger, or leave it as it is.',
    });
  }

  // And the commoner case by far, which said NOTHING AT ALL until now.
  //
  // HEADLINE_COULD_FILL above only fires when a bigger size WOULD have filled
  // the measure and was withheld because the copy is already at the foot. The
  // ordinary short headline - too few words to fill at any legible size, so
  // fitDisplayFlow() correctly leaves it at the size the design gave it (see
  // "all or nothing" on fillTo()) - produced no report of any kind. Measured
  // across a properly filled fixture edition: eight headlines under the 95%
  // bar, setting at 58-75% of their own measure, and SEVEN of them silent.
  //
  // That silence is the whole defect. A one-line headline lying two-fifths
  // short of the column is the single most obvious thing that makes a made-up
  // page read as a mock-up rather than a newspaper, and a sub-editor who is
  // never told cannot write the three words that would fix it. Growing the
  // type is deliberately NOT the answer here and must not be reintroduced: a
  // short headline blown up is still short, and it costs the story a line.
  //
  // So the block is told what it is short BY, in the unit a sub-editor writes
  // in - characters. The estimate is the honest one available: at this size
  // the words reach `fill` of the measure, so filling it needs about
  // `chars * (target/fill - 1)` more. It is a guide for writing, never
  // geometry - real Marathi words of the same count set materially wider or
  // narrower, which is exactly why the exact compositor, not the count, is
  // what finally judges a headline (see settleGeneratedHeadline).
  const headlineBand = result.bands.headline;
  if (!denied && headlineBand && !headlineBand.overset) {
    const band = headlineBandFit(headlineBand);
    if (band.fills.length && band.fill > 0 && band.fill < HEADLINE_FILL_TARGET) {
      const chars = (headlineBand.lines || [])
        .reduce((total, line) => total + clusters(String(line.text || '')).length, 0);
      const extra = Math.max(1, Math.round(chars * (HEADLINE_FILL_TARGET / band.fill - 1)));
      warnings.push({
        code: 'HEADLINE_SHORT_OF_MEASURE',
        detail: `The headline fills ${Math.round(band.fill * 100)}% of its column. `
          + `About ${extra} more characters would fill it. `
          + 'No size change can repair this - the words are short, not the type.',
      });
    }
  }

  // The copy starts where its FIRST BASELINE belongs, worked back to the top
  // of its line box - the same rule the display flows above are placed by, so
  // the sink under the display is one number on every block of the page rather
  // than a function of how big that block's headline happened to be.
  const bodyLineBox = bodyPx * lineHeight;
  const bodyTop = lastBaseline
    ? Math.max(content.top, baselineAfter(lastBaseline, {
      key: 'body', fontPx: bodyPx, family: bodyFamily, weight: bodyWeight, lineBox: bodyLineBox,
    }) - bodyPx * faceAscent(bodyFamily, bodyWeight))
    : content.top;
  result.bodyTop = bodyTop;

  const gutter = num(input.gutterPx, columnGutterPx(bodyPx));
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
    // Off unless the block asks for it, so no stored row's composition can
    // change: 0 is "no drop cap" and is what every existing block carries.
    //
    // AND IT NOW WORKS ON A BLOCK THAT HAS A DATELINE, which is most of them.
    //
    // The dateline is furniture prepended to the copy (section-adapter's
    // `prefix + withMarks.text`), so dropCapOf() took ITS clusters: the cap was
    // the dateline's own U+25A0, which the publication faces have no letter for
    // and the canvas drew as a solid black square three lines deep -
    // photographed on a real 268x296 anchor. The answer then was to refuse, and
    // to say so; measured afterwards, that meant the control did nothing on
    // every block where a desk had filled in the story's place, which is what
    // "it does not work for many news blocks" was reporting.
    //
    // A printed Marathi paper does not choose between the two: it sets the
    // dateline on its own line and opens the story under it with the initial
    // letter. pourBody() does that now - the dateline becomes its own
    // paragraph and the cap is taken from, and set under, the story that
    // follows.
    dropCapLines: Math.max(0, num(input.dropCapLines, 0)),
    // The pour needs to know where the dateline ends: it is what the cap is
    // taken from AFTER, and what the cap is set UNDER.
    datelineLength: Math.max(0, num(input.datelineLength, 0)),
    dropCapChars: Math.max(1, num(input.dropCapChars, 1)),
    // 'none' unless the block asks, so no stored row's composition changes.
    listStyle: String(input.listStyle || 'none'),
  };
  const setsList = pourOptions.listStyle === 'bullet' || pourOptions.listStyle === 'number';

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
  // A LIST IS NOT PROSE, so the paragraph policy stands down for one.
  //
  // The policy merges a paragraph too shallow to stand alone and splits one
  // that runs away, and both are right for running copy - a one-line paragraph
  // is a caption with an indent in front of it. An item of a list is a
  // one-line paragraph ON PURPOSE, and it is numbered: merging two items would
  // silently print three undertakings as two, and splitting one would print
  // four where the reporter wrote three. The desk's own breaks are the list.
  if (!setsList && mayNeedPolicy(bodyPlainText, body.paragraphStarts, body.paragraphDepths)) {
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
        // What the grown band ACTUALLY reached. The warning is called
        // COULD_FILL and promises a filled measure, and the growth search does
        // not always deliver one - it accepts a near-full band when nothing in
        // range fills. Measured: a block whose offer read "would fill at 24px"
        // set 96%/73% at 24px. An offer that over-promises is worse than no
        // offer, because a desk cuts a sentence for it.
        fill: headlineBandFit(result.bands.headline).fill,
      },
    });
  }

  result.bodyLines = body.lines;
  result.dropCap = body.dropCap || null;
  result.listMarkers = body.listMarkers || [];
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
      // AND EVERYTHING HUNG BESIDE A LINE MOVES WITH IT. A list marker sits on
      // its item's first line and is not IN `body.lines`, so opening the
      // leading left the copy stepping down the column while the markers
      // stayed where they were poured - measured on a three-item list, item
      // two's number ended 2.4 px above its own first line and item three's
      // 4.8 px above. Found by printing the two sets of y values side by side,
      // which is the only way a drift this small shows up.
      for (const marker of body.listMarkers || []) {
        const shift = shiftOf.get(Number(marker.y.toFixed(3))) || 0;
        marker.y += shift;
        marker.baseline += shift;
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
  const charFloor = Math.floor(Math.min(...poured) * FLOOR_SAFETY);
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
