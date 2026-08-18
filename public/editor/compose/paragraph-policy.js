// A paragraph is a COMPOSITOR'S unit, measured in lines - not a writer's unit
// measured in sentences.
//
// Every newspaper style guide tells a reporter to write short paragraphs, two
// or three sentences at most, and that advice is right: a wall of type in a
// narrow column is unreadable. But the advice is about SENTENCES, and what a
// reader sees is LINES, and the two are not the same thing at all. The same
// two-sentence paragraph sets as eight lines in an 11 em city column and as
// one and a half lines across a full-width lead. The rule the writer follows
// therefore produces the right texture in one block and the wrong one in the
// other - which is exactly the fault this module exists to remove.
//
// MEASURED, on 80 real multi-paragraph article blocks in this database:
//
//     paragraphs set in 1 line   141   51.1%
//     paragraphs set in 2 lines   74   26.8%
//     paragraphs set in 3 lines   29   10.5%
//     -------------------------------------
//     three lines or fewer       244   88.4%
//
// Half of every authored paragraph in the paper was setting as a single line.
// A one-line paragraph is not a paragraph; it is a caption with an indent in
// front of it, and a column of them reads as a list of fragments. It also
// wrecks the right edge the desk had just been complaining about, because the
// closing line of a paragraph is ragged BY DESIGN (it is never justified) -
// so a column of one-line paragraphs is a column where every single line is
// a ragged closing line.
//
// So the authored break is a REQUEST, and this decides which requests are
// set. The stored copy is never edited: `page_sections.body` keeps every
// blank line the reporter typed, and a later composition at a different
// width will set a different set of them.
//
// The two bounds, both in lines because that is what a reader sees:
//
//   MIN - a paragraph shorter than three lines does not read as a paragraph.
//         Three lines is about one Marathi sentence at a city column's
//         measure, which is the floor the style guides are really describing.
//
//   MAX - a paragraph longer than about ten lines is the grey slab the same
//         style guides warn against: roughly three sentences at a city
//         column's measure, the top of the "two or three sentences" range.
//
// Below MIN two authored paragraphs are set as one. Above MAX one authored
// paragraph is set as two, and ONLY at a sentence end - the compositor may
// choose where a paragraph starts, never where a sentence does.

export const MIN_PARAGRAPH_LINES = 3;
export const MAX_PARAGRAPH_LINES = 10;
// And the ceiling the style guides actually state. A line ceiling alone is
// not enough, because how much a line CARRIES changes with the measure: the
// front page's 26 em lead sets ten lines out of eight whole sentences, which
// is inside the line bound and is still a wall of type. Measured on the real
// front page - the block reads as one undifferentiated grey mass and a reader
// has nowhere to rest.
export const MAX_PARAGRAPH_SENTENCES = 3;

// A sentence ends at a danda or a full stop (or a question/exclamation mark)
// followed by space. Marathi's sentence terminator is the danda; the full
// stop turns up in the same copy because numerals, abbreviations and quoted
// English bring it with them.
const SENTENCE_END = /[।॥.!?][)"'”’]*\s+/gu;

/**
 * Where a set paragraph may begin inside one authored paragraph.
 *
 * Offsets are absolute in the body text, and always land immediately after
 * the whitespace that follows the sentence's terminator - so the paragraph
 * that starts there starts on a word, exactly as an authored one does.
 */
function sentenceStarts(text, from, to) {
  const out = [];
  SENTENCE_END.lastIndex = 0;
  const slice = text.slice(from, to);
  let match;
  while ((match = SENTENCE_END.exec(slice)) !== null) {
    const at = from + match.index + match[0].length;
    if (at > from && at < to) out.push(at);
  }
  return out;
}

/**
 * Which of the authored paragraph breaks this block actually sets.
 *
 * `starts` and `depths` come from a real pour: `starts[i]` is the character
 * offset the i-th set paragraph began at, `depths[i]` is how many EQUIVALENT
 * lines it occupied (a row a photograph halves counts a half, exactly as
 * `occupancy` counts it - a fragment count would be wrong here for the same
 * reason it is wrong there).
 *
 * Returns the offsets to pour again at. The caller pours a second time; this
 * function never guesses what the result will be. That is the whole point of
 * running it AFTER a pour rather than estimating paragraph depth from a
 * character count, which is the mistake this codebase has already made and
 * measured its way out of once.
 */
export function planParagraphs({ text = '', starts = [], depths = [] } = {}) {
  const body = String(text || '');
  const authored = starts.length ? starts.slice() : [0];
  const set = authored.map((_, i) => Number(depths[i]) || 0);

  // ------------------------------------------------------------- merging ---
  //
  // A break is kept only when BOTH sides of it are a paragraph: what has
  // accumulated since the last kept break has reached the floor, and what is
  // still to come can reach it too. The second half of that test is what
  // closes the tail - a story ending on a one-line paragraph merges that line
  // backwards instead of leaving it stranded, because the break in front of
  // it can never be kept.
  const kept = [authored[0] ?? 0];
  const keptDepth = [];
  let running = set[0] || 0;
  for (let i = 1; i < authored.length; i += 1) {
    let remaining = 0;
    for (let j = i; j < authored.length; j += 1) remaining += set[j];
    if (running >= MIN_PARAGRAPH_LINES && remaining >= MIN_PARAGRAPH_LINES) {
      keptDepth.push(running);
      kept.push(authored[i]);
      running = set[i];
    } else {
      running += set[i];
    }
  }
  keptDepth.push(running);

  // ----------------------------------------------------------- splitting ---
  //
  // Only a paragraph past a ceiling is touched, and only at a real sentence
  // end. Which sentence end is chosen is decided by character
  // position within the paragraph - the one aesthetic judgement here that is
  // not exact, and it is safe precisely because it is a choice AMONG legal
  // boundaries rather than a prediction of fit: whichever is picked, the
  // second pour sets it exactly.
  const finalStarts = [];
  for (let i = 0; i < kept.length; i += 1) {
    const from = kept[i];
    const to = i + 1 < kept.length ? kept[i + 1] : body.length;
    finalStarts.push(from);
    const depth = keptDepth[i];

    const boundaries = sentenceStarts(body, from, to);
    // Both ceilings, because they catch different blocks: the line bound is
    // what stops a narrow column running away (one Marathi sentence sets
    // eight lines at 11 em), the sentence bound is what stops a wide one
    // (three sentences set four lines at 26 em, and eight set ten).
    const wanted = Math.max(
      Math.ceil(depth / MAX_PARAGRAPH_LINES),
      Math.ceil((boundaries.length + 1) / MAX_PARAGRAPH_SENTENCES),
    );
    // Never make a piece the merger would immediately want back.
    const affordable = Math.max(1, Math.floor(depth / MIN_PARAGRAPH_LINES));
    const pieces = Math.min(wanted, affordable);
    // Nothing to do, or nowhere legal to do it: a paragraph with no sentence
    // end inside it stays whole rather than being cut mid-sentence.
    if (pieces < 2 || !boundaries.length) continue;

    const span = to - from;
    const used = new Set();
    for (let p = 1; p < pieces; p += 1) {
      const ideal = from + (span * p) / pieces;
      let best = null;
      for (const at of boundaries) {
        if (used.has(at)) continue;
        if (best === null || Math.abs(at - ideal) < Math.abs(best - ideal)) best = at;
      }
      if (best === null) break;
      used.add(best);
      finalStarts.push(best);
    }
  }
  finalStarts.sort((a, b) => a - b);

  const changed = finalStarts.length !== authored.length
    || finalStarts.some((at, i) => at !== authored[i]);

  return {
    starts: finalStarts,
    changed,
    authoredCount: authored.length,
    setCount: finalStarts.length,
    merged: Math.max(0, authored.length - kept.length),
    split: Math.max(0, finalStarts.length - kept.length),
  };
}

/**
 * Whether a body could possibly need the policy at all.
 *
 * The policy costs a second pour, and most blocks carry one paragraph of a
 * few sentences and would not be touched. This is the cheap test that keeps
 * the second pour off those: it counts sentence ends with a regex and never
 * measures anything.
 */
export function mayNeedPolicy(text, starts = [], depths = []) {
  if (starts.length > 1) return true;
  if (depths.some((d) => d > MAX_PARAGRAPH_LINES)) return true;
  const ends = String(text || '').match(/[।॥.!?][)"'\u201d\u2019]*\s+/gu);
  return (ends ? ends.length + 1 : 1) > MAX_PARAGRAPH_SENTENCES;
}
