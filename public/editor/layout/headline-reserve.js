// How much of a block the headline and deck will take, before either exists.
//
// An article block is never published without a headline, so "how much room
// does the body have" measured on a block that has none is an answer to a
// question nobody asks. On a real 268x248 lead with a cut-out beside the copy
// the difference is not a detail: 639 characters of body with no headline,
// 187 once a real headline and deck are set. A desk shown the first number
// and then handed 162 characters of AI copy reasonably concludes the AI
// underfilled the block by a factor of four - when in fact the copy was right
// and the read-out was measuring a block that will never exist.
//
// So the reservation lives here, in ONE place that both sides import: the
// server's planningFit() (storyWriter.service.js) and the Space panel
// (layout-panel.js) show the desk the same figure. Two copies of this would
// be two different answers to "how big is this block", which is the failure
// this codebase has already been bitten by.
//
// WHAT THIS IS NOT, ANY MORE. It is not the amount of copy the model is
// asked for. It cannot be: measured across 96 real block geometries with an
// in-spec headline AND deck, this reservation OVER-promises on 49 of them,
// and the same block's real capacity varies by a factor of 1.5-3 depending
// only on how long the headline and deck turn out to be. write() now asks
// for a RESERVOIR (see bestCaseCandidate() below and planningFit()'s own
// note) and lets the exact compositor choose the prefix that fits. What is
// left here is a rough bound with two narrow jobs - how long a headline may
// be, and whether a block has any room for copy at all. Nothing load-bearing
// rests on it; do not spend effort making it exact.

// Dual CJS/ESM, matching caption-geometry.js - the project's own idiom for a
// pure helper the server requires synchronously and browser modules import.
// briefFor() is synchronous and must not become async to read a limit.
(function installHeadlineReserve(root) {

// A headline is set across the measure at headline size, so it is roughly one
// line of body characters less the larger type. A deck runs about two.
function headlineLimit(cols) {
  return Math.max(24, Math.min(90, Math.round(cols * 0.9)));
}

// FALLBACK ONLY. `cols` is the BODY's characters per line, and a deck is not
// set in body type - so deriving the deck's length from it asks for two body
// lines' worth of characters set in larger type, which is three deck lines.
// Measured on a real 190x264 block: the deck took 46px of a 264px block, 18%
// of it, three lines deep and nearly the size of the headline above it. A
// deck is ONE line that carries the story forward; a three-line one is a
// second headline, which is what the desk reported seeing.
//
// `measuredSubheadingLimit()` below is the real answer. This survives for the
// moment before a composition exists.
function subheadingLimit(cols) {
  return Math.max(40, Math.min(140, cols * 2));
}

// How many lines of display type a block gets. A deck is one line - see
// above. A headline gets two, which is what a newspaper gives it and what
// every real headline in this database already takes (measured across 4137
// rows: 2163 set one line, 1470 two).
const DECK_LINES = 1;
const HEADLINE_LINES = 2;

/**
 * The deck's real one-line capacity, read off a composition that was given
 * more deck than could possibly fit and told to set exactly one line.
 *
 * Measured in the deck's OWN type, in this block's own measure, around this
 * block's own pictures - which is the only way to ask the question.
 */
function measuredSubheadingLimit(composed, fallbackCols) {
  const line = composed?.bands?.deck?.lines?.[0];
  if (!line || !line.text) return subheadingLimit(fallbackCols);
  // The band was filled to its own edge, so its text IS the capacity.
  return Math.max(24, line.text.trim().length);
}

/** The same question for the headline, over its own line allotment. */
function measuredHeadlineLimit(composed, fallbackCols) {
  const lines = composed?.bands?.headline?.lines || [];
  if (!lines.length) return headlineLimit(fallbackCols);
  return Math.max(20, lines.map((l) => l.text).join(' ').trim().length);
}

/** A block composed with more display type than fits, clamped to its allotment. */
function limitProbeView() {
  const fill = `${STAND_IN_WORDS} `.repeat(4);
  return {
    headline: fill,
    subheading: fill,
    headlineMaxLines: HEADLINE_LINES,
    deckMaxLines: DECK_LINES,
    // Locked, so the engine reports what does not fit rather than shrinking
    // the type to make it - the question here is capacity at the block's own
    // stated size, not what size would swallow this stand-in.
    headlineLocked: true,
    subheadingLocked: true,
  };
}

const STAND_IN_WORDS = 'पुणे शहरातील नव्या पायाभूत सुविधा प्रकल्पाचे काम वेगाने सुरू असून '
  + 'नागरिकांना लवकरच मोठा दिलासा मिळणार आहे अशी माहिती प्रशासनाने दिली आहे';

/** A stand-in of exactly `length` characters, in real words. */
function standIn(length) {
  const want = Math.max(0, Math.round(length));
  if (!want) return '';
  const source = STAND_IN_WORDS.length >= want
    ? STAND_IN_WORDS
    : `${STAND_IN_WORDS} `.repeat(Math.ceil(want / (STAND_IN_WORDS.length + 1)));
  return source.slice(0, want);
}

// The lengths to try, as a fraction of the stated limit.
//
// THIS IS THE PART THAT HAD TO CHANGE, and the reason is worth stating
// plainly because the old code carried a proof that is no longer true.
//
// The reservation used to try ONE stand-in, at the full limit, and that was
// sound while the budget came from text-flow.js: row count there is
// `ceil(text.length / charsPerLine)`, a function of LENGTH ALONE, and `ceil`
// is monotonic - so the longest legal headline necessarily took the most rows
// and reserving it could never promise the body more room than it would have.
//
// The budget now comes from the exact composition engine, which breaks lines
// at real word boundaries. Line count there is NOT monotonic in length: a
// slightly shorter headline whose last word will not fit the measure wraps to
// an extra line, and in a narrow measure - a column beside a tall cut-out -
// that happens often. Measured on the real block this was found on: the
// single full-limit stand-in reserved enough for 222 characters of body while
// the real headline left room for 187, a 19% over-ask.
//
// So several lengths are tried and the WORST (least body room) is reserved.
// Sampling rather than proving is honest about what changed: there is no
// longer a monotonicity argument to lean on, so the guarantee is bought by
// actually looking, which is the same principle as the rest of copyFit.
const RESERVE_SAMPLES = [1, 0.94, 0.88, 0.82, 0.76, 0.7];

/**
 * Every headline/deck pair worth measuring a reservation against.
 *
 * The caller composes each and keeps the smallest body budget - see
 * planningFit(). Returned rather than measured here so this module stays
 * pure: it knows what to try, not how to compose.
 */
function reservationCandidates(cols) {
  const hMax = headlineLimit(cols);
  const dMax = subheadingLimit(cols);
  return RESERVE_SAMPLES.map((f) => ({
    headline: standIn(Math.round(hMax * f)),
    subheading: standIn(Math.round(dMax * f)),
  }));
}

/**
 * The SHORTEST headline and deck the brief actually permits.
 *
 * The reservoir - how much copy to ask a model for - has to be an upper
 * bound on what the block could hold, and the tempting upper bound is "the
 * block with nothing set on it". That one is wrong, and measurably wasteful:
 * an article block is never published without a headline and this brief
 * REQUIRES a deck, so a body measured with neither is a block that will
 * never exist. Measured across 96 real block geometries, sizing the
 * reservoir from the empty block asked for up to 7x what the finished block
 * could hold.
 *
 * The honest ceiling is the block with the shortest display type the brief
 * still allows: a brief headline (a good headline is short) and a deck at
 * the bottom of its stated range. Nothing legal can leave the body more room
 * than that, so nothing legal can need more copy than it implies.
 */
function bestCaseCandidate(cols) {
  return {
    headline: standIn(Math.round(headlineLimit(cols) * 0.35)),
    // briefFor states the deck as "between half and all of" its limit.
    subheading: standIn(Math.round(subheadingLimit(cols) * 0.5)),
  };
}

  const api = Object.freeze({
    headlineLimit, subheadingLimit, standIn, RESERVE_SAMPLES, reservationCandidates, bestCaseCandidate,
    measuredHeadlineLimit, measuredSubheadingLimit, limitProbeView, DECK_LINES, HEADLINE_LINES,
  });
  root.SahasHeadlineReserve = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
