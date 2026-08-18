// Does this copy fit this block, and if not, what length would?
//
// One module, because "how much room is there" had been answered four
// different ways and every one of them was a guess:
//
//   * text-flow.js's character grid  - approximate exclusion, wrong by >2x on
//     a block with a picture (storyWriter.service.js's own header records the
//     measurement: briefed 361, real 138-233).
//   * capacity.bodyCharRange.min     - the guaranteed-SAFE floor. Brief a
//     model with it and the block underfills by up to the width of the range,
//     which is 30-46% (CLAUDE.md, "the character budget is a range").
//   * capacity.bodyCharRange.max     - the same error with the sign flipped.
//   * capacity.bodyCharCapacity      - the best single estimate, and still an
//     estimate: it is calibrated on a fixed sample of Marathi, not on the
//     sentences this model actually wrote.
//
// No character count can be the answer, and this is settled rather than open:
// the same block holds 30-46% more or fewer characters depending only on what
// is written into it, because conjunct-heavy Marathi hides zero-width
// codepoints inside one akshara. Clusters were measured as a candidate
// stabler unit and are worse (68-87%).
//
// So this module does not try to predict. It COMPOSES - the same exact
// composeSection() the page canvas, the Block Editor, fit.service.js and
// preflight.service.js all measure against - and reads the verdict the engine
// already computes: `fitState`, which is OVERSET, UNDERFILLED, FITS or EMPTY.
// That verdict is the ground truth this whole file is built on, and it is the
// same one preflight will fail the page for, so "the writer said it fits" and
// "preflight says it does not" can no longer disagree.
//
// Two things follow from measuring instead of predicting, and they are the
// reason this is a permanent fix rather than a better guess:
//
//   A cut-out photograph needs no special case. Its exclusion is computed
//   from its real alpha mask (compose/exclusion.js, reached through
//   section-adapter.js's obstacleFromImage - `mask` is carried), so an
//   irregular silhouette narrows the individual scanlines it actually
//   touches. Nothing here has to model that; it only has to ask.
//
//   The block calibrates ITSELF. Once the model has written a first draft,
//   that draft's own characters-per-line in THIS block - with its real
//   exclusion, its real headline, its real type - is a far better predictor
//   of what will fill the rest than any sample-based constant, because it is
//   measured on the prose that is actually going in.

const MIN_SENTENCE_CHARS = 12;

// Two different thresholds, for two genuinely different decisions - and
// conflating them is what made "Fill remaining area with AI" refuse a block
// with a visibly empty foot.
//
//   HOLE_LINES (4) is an AUTOMATIC-repair threshold. `write()` spends a
//   second paid call on its own initiative, so it must not fire on the
//   reservation's own conservatism; 4 was tuned against a real edition (at 3
//   it fired on 41% of writes, at 4 on 7% - see CLAUDE.md). It is also what
//   `fitState` uses, so a block with a 3.58-line hole reports FITS.
//
//   MIN_FILLABLE_LINES (1) is for when the DESK PRESSED THE BUTTON. Nobody
//   has to be protected from a call they asked for, and "this block already
//   fits its space" is a false answer to give someone looking at a quarter of
//   a block standing empty. Measured on the real block this was reported
//   from: 9 lines set, 3.58 lines empty - 28% of the body area, under the
//   automatic threshold and obvious to the eye.
const MIN_FILLABLE_LINES = 1;

// A hole is a SHARE of the block's own body area, not a fixed number of
// lines - and this is the whole reason small blocks kept coming out half
// empty while the pipeline called them balanced.
//
// `HOLE_LINES` (4) is an absolute count, and an absolute count means
// completely different things on different blocks. Measured on the real lead
// block this was reported from: a 268x248 frame with a tall cut-out beside
// the copy has room for 4.55 lines of body once its headline and deck are
// set. The model filled 2 and left 2.55 - **56% of the body area standing
// empty** - and nothing repaired it, because 2.55 is less than 4. The same 4
// lines on a 14-line block is 29%, which is a sensible thing to repair. One
// threshold cannot be both.
//
// So: repair when a quarter of the body area is empty, OR when the absolute
// count is reached (whichever comes first, so big blocks behave exactly as
// they always did - 4 of 14 lines is 29%, either rule fires). Never below one
// whole line: nothing can be written into less than a line, and chasing the
// remainder every column of type leaves is what spends money for nothing.
const HOLE_LINES = 4;
const HOLE_FRACTION = 0.25;

/** Is a share of this block's body area big enough to be worth filling? */
function isUnderfilled(fill) {
  if (!fill || fill.overset) return false;
  if (fill.holeLines < MIN_FILLABLE_LINES) return false;
  if (fill.holeLines >= HOLE_LINES) return true;
  return fill.linesAvailable > 0 && (fill.holeLines / fill.linesAvailable) >= HOLE_FRACTION;
}

let adapterModule = null;
let metricsModule = null;
let shaperModule = null;

async function ensureComposeReady() {
  if (!adapterModule) adapterModule = await import('../../public/editor/compose/section-adapter.js');
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  // This is a long-lived server process, not a browser mid-page-load: there is
  // no legitimate moment after startup where the fonts or the shaper are not
  // ready. A silent fall back to the approximate grid here would be the exact
  // bug this module exists to end, wearing a different excuse.
  shaperModule.requireShaperReady();
  return adapterModule;
}

function viewFor(section, over = {}) {
  return {
    headline: over.headline ?? (section.headline || ''),
    subheading: over.subheading ?? (section.subheading || ''),
    body: over.body ?? (section.body || ''),
    marginPx: Number(section.margin_px) || 12,
    columnCount: Number(section.column_count) || 1,
    lineHeight: Number(section.line_height) || 1.45,
    headlineFontPx: Number(section.headline_font_px) || 24,
    subheadingFontPx: Number(section.subheading_font_px) || 14,
    bodyFontPx: Number(section.body_font_px) || 10,
  };
}

/** Did the headline, deck or kicker run out of room for its own text? */
function displayOversetOf(composed) {
  const leftover = composed?.overset || {};
  if (String(leftover.headline || '') || String(leftover.deck || '') || String(leftover.kicker || '')) return true;
  return (composed?.violations || []).some((v) => /^(HEADLINE|DECK|KICKER)_/.test(v.code || ''));
}

/**
 * Compose one candidate body into the block and report what the engine says.
 *
 * `state` is the engine's own `fitState` - never re-derived here, so this
 * cannot drift from what preflight enforces.
 *
 * `charsPerEquivalentLine` and `targetChars` are the calibration: measured on
 * the copy passed in, in this block, with this block's real picture
 * exclusion. They are only meaningful when the copy actually fits (an overset
 * pour has no honest measure for the text it never placed), so they are null
 * otherwise - a caller that needs a target for overset copy already knows the
 * answer is "less", and gets there by trimming rather than by predicting.
 */
async function measureFit(section, images, over = {}) {
  const adapter = await ensureComposeReady();
  const view = viewFor(section, over);
  const composed = adapter.composeSection({ ...section, images: images || [] }, view);

  const overset = adapter.bodyOverset(composed);
  const fill = adapter.bodyFill(composed);
  // The ENGINE's own count of what it actually poured, never `view.body.length`:
  // a draft arrives as Quill markup, so the raw string carries tags that are
  // not characters on the page, and it also excludes the dateline the engine
  // prepends and then has to find room for. Calibrating on the raw string
  // would therefore over-count on a marked-up draft and under-count on a
  // datelined one - in opposite directions, on the same block.
  const charsUsed = Number(composed.capacity?.bodyCharsUsed) || 0;

  // Per EQUIVALENT LINE, never per placed fragment.
  //
  // `bodyLines.length` counts text runs, and around a cut-out standing clear
  // of both edges one physical row is two of them - so dividing by it
  // reported a characters-per-line rate for half-measure corridors as though
  // they were whole lines, and then multiplied that wrong rate by the hole to
  // decide what to ask the model for next. The error did not stay in the
  // read-out; it went into the copy. See bodyFill()'s own note.
  //
  // Only calibrated from a pour that placed everything it was given: dividing
  // when part of the text never got a line would measure the block's widest
  // region only, and then over-ask for the rest.
  const occupied = fill.occupiedEquivalentLines;
  const charsPerEquivalentLine = !overset && occupied > 0 ? charsUsed / occupied : null;

  return {
    state: composed.fitState,
    // The one geometric truth every surface quotes - see bodyFill()'s own
    // note on why a character count cannot be it.
    fill,
    fits: !overset && composed.fitState !== 'OVERSET',
    overset,
    // A headline or deck with no room for its own text is a block that does
    // not fit, whatever the body did. `isAcceptablyFilled()` reads this.
    displayOverset: displayOversetOf(composed),
    oversetChars: overset ? adapter.bodyOversetChars(composed) : 0,
    holeLines: fill.emptyEquivalentLines,
    linesUsed: fill.occupiedEquivalentLines,
    renderedFragments: fill.renderedFragments,
    charsUsed,
    charsPerEquivalentLine,
    // What length would fill this block, for THIS prose. Null when it cannot
    // be measured honestly (see above).
    targetChars: charsPerEquivalentLine === null
      ? null
      : Math.round(charsUsed + fill.emptyEquivalentLines * charsPerEquivalentLine),
    // The engine's own estimates, kept for briefing a model that has not
    // written anything yet and so cannot have calibrated anything.
    capacity: composed.capacity,
    composed,
  };
}

// Floating-point tolerance ONLY - the equivalents arrive rounded to two
// decimal places, so a block that is geometrically exactly full can read
// 1.00 rather than 0.999. Not a policy knob: widening it would re-introduce
// exactly the "how empty is too empty" argument this function exists to end.
const ACCEPTANCE_EPSILON = 0.01;

/**
 * IS THIS BLOCK FINISHED? The one authority, and the only one.
 *
 * Everything else in this file - HOLE_LINES, HOLE_FRACTION,
 * MIN_FILLABLE_LINES - is POLICY: when to spend money unasked, when to offer
 * the desk a button. None of them answers "does this block fit", and treating
 * one of them as if it did is what let a repair be accepted merely for having
 * made the hole smaller. A block can go from 55% full to 70% full and still
 * be visibly, unacceptably empty.
 *
 * The condition is geometric and has no threshold in it:
 *
 *   nothing overset - not the body, not the headline, not the deck; and
 *   no whole legal line of fillable body measure left standing empty.
 *
 * Room a photograph made unusable was never fillable, and the air a paragraph
 * break asks for is intentional - neither reaches `emptyEquivalentLines`. What
 * is left is room a sentence could actually have gone in.
 */
function isAcceptablyFilled(fit) {
  if (!fit || !fit.fill) return false;
  if (fit.overset || fit.displayOverset) return false;
  return fit.fill.emptyEquivalentLines < 1 + ACCEPTANCE_EPSILON;
}

// Sentences, with their terminator kept on the front piece, and paragraph
// breaks preserved as their own pieces. Marathi ends a sentence with a danda
// (।) as often as with a full stop, and this copy is written by a model that
// uses both.
function splitSentences(text) {
  const out = [];
  const parts = String(text || '').split(/(\n{2,})/);
  for (const part of parts) {
    if (/^\n{2,}$/.test(part)) {
      out.push({ text: part, breaker: true });
      continue;
    }
    const pieces = part.match(/[^।.!?]*[।.!?]+["'”’)\]]*\s*|[^।.!?]+$/g) || [];
    for (const piece of pieces) if (piece) out.push({ text: piece, breaker: false });
  }
  return out;
}

function joinSentences(pieces) {
  return pieces.map((p) => p.text).join('').replace(/\s+$/, '');
}

/**
 * The longest prefix of this copy that actually fits, cut at a sentence end.
 *
 * Deterministic and free - no model call. This is the backstop that makes the
 * whole pipeline convergent: a repair the model declines to do correctly, or
 * does correctly but by two characters too many, still ends with a block that
 * fits, because cutting from the bottom is a sub-editor's own first move and
 * it always terminates.
 *
 * Binary search over the number of sentences kept: dropping a trailing
 * sentence can only shorten the text, so "does the first N sentences fit" is
 * monotonic in N and a search is sound. If a single sentence overruns the
 * whole block on its own, it falls back to a word-level search rather than
 * returning something that still does not fit.
 */
async function trimToFit(section, images, over = {}) {
  const body = String(over.body ?? section.body ?? '');
  const first = await measureFit(section, images, { ...over, body });
  if (!first.overset) return { body, cut: 0, trimmed: false, fit: first };

  const fitsWith = async (candidate) => {
    const result = await measureFit(section, images, { ...over, body: candidate });
    return { ok: !result.overset, result };
  };

  // The longest prefix that fits, cut at the strongest boundary that can
  // deliver it. A paragraph end is a better place to stop than a sentence
  // end - but only if stopping there does not leave a hole, because a whole
  // paragraph is a large unit to drop and the block still has to be full.
  // So both are searched and the paragraph cut wins only when it is already
  // acceptable on its own terms; otherwise the longer sentence cut is used.
  // A word cut stays what it always was: the emergency fallback for a single
  // sentence too long for the block by itself.
  const longestPrefix = async (units, join) => {
    if (units.length <= 1) return null;
    let low = 0;
    let high = units.length;
    let best = null;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const candidate = join(units.slice(0, mid));
      // eslint-disable-next-line no-await-in-loop
      const { ok, result } = await fitsWith(candidate);
      if (ok && candidate.trim().length >= MIN_SENTENCE_CHARS) {
        best = { body: candidate, fit: result };
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return best;
  };

  const paragraphs = String(body).split(/(\n{2,})/).filter((piece) => piece !== '');
  const atParagraph = await longestPrefix(paragraphs, (kept) => kept.join('').replace(/\s+$/, ''));
  if (atParagraph && isAcceptablyFilled(atParagraph.fit)) {
    return { body: atParagraph.body, cut: body.length - atParagraph.body.length, trimmed: true, fit: atParagraph.fit, boundary: 'paragraph' };
  }

  const sentences = splitSentences(body);
  const atSentence = await longestPrefix(sentences, joinSentences);
  const semantic = atSentence || atParagraph;
  if (semantic) {
    return {
      body: semantic.body,
      cut: body.length - semantic.body.length,
      trimmed: true,
      fit: semantic.fit,
      boundary: semantic === atSentence ? 'sentence' : 'paragraph',
    };
  }

  // One sentence too long for the block on its own - cut at a word instead.
  const words = body.split(/(\s+)/);
  let low = 0;
  let high = words.length;
  let best = null;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = words.slice(0, mid).join('').replace(/\s+$/, '');
    // eslint-disable-next-line no-await-in-loop
    const { ok, result } = await fitsWith(candidate);
    if (ok && candidate.length > 0) {
      best = { body: candidate, fit: result };
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  if (best) return { body: best.body, cut: body.length - best.body.length, trimmed: true, fit: best.fit, boundary: 'word' };

  return { body: '', cut: body.length, trimmed: true, fit: await measureFit(section, images, { ...over, body: '' }), boundary: 'word' };
}

/**
 * What to ask a model for, before it has written anything.
 *
 * `bodyCharCapacity` rather than `bodyCharRange.min`: the floor is what fits
 * even if every word turns out to be plain consonants, and briefing a writer
 * with it guarantees the ordinary case underfills. The estimate is the
 * engine's own "what to brief a writer with, for ordinary prose", and
 * overshooting it is now cheap - `trimToFit` cuts the excess for free and
 * without a second call, while a shortfall costs a paid call to repair and
 * may still miss.
 */
function openingTarget(capacity) {
  return Math.max(0, Math.round(Number(capacity?.bodyCharCapacity) || 0));
}

/**
 * Settle a written proposal into the block it has to fill, and report
 * honestly whether it got there.
 *
 * THIS IS THE CONTROLLER. The exact compositor decides what fits, where it
 * fits, how much is still fillable and when fitting is finished. The model
 * supplies editorial material and nothing else - it is never the geometry
 * solver, and no number it is given is treated as a measurement.
 *
 * The asymmetry is deliberate and is where the money goes:
 *
 *   TOO LONG is repaired for free. Cutting from the bottom is a sub-editor's
 *   own first move and the inverted pyramid exists so that it is safe -
 *   `trimToFit` drops trailing material until the engine says it fits,
 *   deterministically, with no model call at all, at the strongest boundary
 *   that still fills the block.
 *
 *   TOO SHORT is the only case a model can fix, because nobody else may
 *   invent the sentences. It gets a BOUNDED number of paid calls, and each
 *   asks only for ADDITIONAL material - never a rewrite, which would throw
 *   away copy the desk may already have read.
 *
 * What changed, and why it matters: the old loop accepted a repair for having
 * made the hole SMALLER. That only proves the result got less bad. A block
 * could go from 55% full to 70% full and be returned as done. Acceptance is
 * now `isAcceptablyFilled()` - the geometric condition, no thresholds - and
 * when the bounded budget runs out without reaching it, the result says so
 * (`SOURCE_LIMITED_UNDERFILL`) instead of being dressed up as a fit. A block
 * that cannot be filled from the material available is an honest production
 * state; a lie about it is what puts a half-empty block on a printed page.
 */
const MAX_FILL_CALLS = 1;

async function settleToFit({
  section, images, proposal, language, verifiedContext, askForMore, resizeBriefFor,
  maxCalls = MAX_FILL_CALLS,
}) {
  const over = { headline: proposal.headline, subheading: proposal.subheading };
  let fit = await measureFit(section, images, { ...over, body: proposal.body });
  const budget = openingTarget(fit.capacity);
  let body = proposal.body;
  let trimmed = false;
  let reason = null;
  let calls = 0;

  // Too long: free, deterministic, and always terminates.
  //
  // This does NOT return. A sentence is a chunky unit - on a tight block (a
  // big cut-out leaves one only a couple of hundred characters wide) dropping
  // one can swing the copy from slightly over to visibly short, and returning
  // here is what would leave that hole on the page. Measured live on a real
  // cut-out block: three sentences overset, and cutting to two left 3.5 lines
  // empty. So the trim falls through to the same acceptance check the
  // too-short path uses.
  if (fit.overset) {
    const cut = await trimToFit(section, images, { ...over, body });
    body = cut.body;
    fit = cut.fit;
    trimmed = true;
    reason = 'overflow';
  }

  // Not finished until the geometry says so. Bounded, because every attempt
  // is billed - and it stops early the moment a repair fails to make
  // progress, so a model that cannot fill the block is asked once, not twice.
  while (
    !isAcceptablyFilled(fit)
    && !fit.overset
    && calls < maxCalls
    && typeof askForMore === 'function'
    // Policy, not correctness: a block whose remaining hole is under the
    // desk's own "worth a call" bar is not worth spending one on unasked.
    // The RESULT still reports it honestly - see `acceptable` below.
    && isUnderfilled(fit.fill)
  ) {
    calls += 1;
    const target = fit.targetChars || budget;
    // eslint-disable-next-line no-await-in-loop
    const repaired = await askForMore(resizeBriefFor({
      proposal: { ...proposal, body }, used: fit.charsUsed, budget: target, language, verifiedContext,
    }));
    if (repaired?.error) break;

    // The model may answer with further paragraphs to append (the shape this
    // asks for - it cannot lose copy the desk has read) or with a whole
    // rewritten body. Both are accepted; only the first is requested.
    const additions = Array.isArray(repaired?.data?.additions)
      ? repaired.data.additions.map((piece) => String(piece || '').trim()).filter(Boolean)
      : [];
    let candidate = additions.length
      ? [body, ...additions].join('\n\n')
      : String(repaired?.data?.body || '').trim();
    if (!candidate) break;

    // eslint-disable-next-line no-await-in-loop
    let candidateFit = await measureFit(section, images, { ...over, body: candidate });
    let candidateTrimmed = false;
    // Overshooting is the ordinary case, not an exception - asking a model
    // for "a bit more" is asking it to estimate the one thing it cannot
    // measure. Cut it back, free, exactly as above.
    if (candidateFit.overset) {
      // eslint-disable-next-line no-await-in-loop
      const cut = await trimToFit(section, images, { ...over, body: candidate });
      candidate = cut.body;
      candidateFit = cut.fit;
      candidateTrimmed = true;
    }

    // A repair that fits WORSE is discarded: a second attempt is allowed to
    // fail, and a model that came back shorter than it started must not cost
    // the desk the copy it already had.
    if (candidateFit.fill.emptyEquivalentLines >= fit.fill.emptyEquivalentLines) break;

    body = candidate;
    fit = candidateFit;
    trimmed = trimmed || candidateTrimmed;
    reason = reason || 'hole';
  }

  const acceptable = isAcceptablyFilled(fit);
  return {
    body,
    fit,
    resized: calls > 0 ? (reason || 'hole') : reason,
    trimmed,
    budget,
    calls,
    // The honest verdict, and the only one a caller may quote as "done".
    acceptable,
    state: acceptable
      ? 'FITS'
      : (fit.overset ? 'OVERSET' : 'SOURCE_LIMITED_UNDERFILL'),
  };
}

/**
 * Is there room a desk could actually ask to have filled?
 *
 * Deliberately NOT `fitState !== 'FITS'`: that carries the automatic-repair
 * threshold (see MIN_FILLABLE_LINES above), and answering an explicit request
 * with "this block already fits its space" while a quarter of it stands empty
 * is simply untrue.
 */
function hasRoomToFill(fit) {
  return !fit.overset && fit.fill.holeLines >= MIN_FILLABLE_LINES;
}

module.exports = {
  measureFit, trimToFit, settleToFit, openingTarget, hasRoomToFill, isUnderfilled,
  isAcceptablyFilled, splitSentences, joinSentences, ensureComposeReady,
  MIN_FILLABLE_LINES, MAX_FILL_CALLS,
};
