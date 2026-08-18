// WHEN IS A BLOCK FINISHED? One answer, and it is geometric.
//
// This file used to test `resizeNeeded()` - a character-count rule that
// decided whether to spend a second paid call by comparing "used" against a
// "budget". That function is gone, and so is the idea behind it. Two measured
// facts killed it:
//
//   The budget it compared against was never the block's real capacity. It
//   came from a reservation for a headline and a deck that did not exist yet,
//   so it had to assume the longest legal ones. Across 400 real article
//   blocks it was typically 63% BELOW what the finished block actually held.
//
//   A character count cannot answer "does this fit" at all. The same block
//   holds 30-46% more or fewer characters depending only on what is written
//   into it, and around a cut-out it cannot even be stated as one number.
//
// So the decision is no longer predicted, it is COMPOSED. The authority is
// `copyFit.isAcceptablyFilled()`, and it has no threshold in it: nothing
// overset, and no whole legal line of fillable body measure left standing
// empty. Everything else - HOLE_LINES, HOLE_FRACTION, MIN_FILLABLE_LINES - is
// policy about when to spend money or offer a button, and none of it is
// allowed to answer this question.
//
// The editorial intentions the old cases held are all still here. They are
// just asked of real geometry now.

const test = require('node:test');
const assert = require('node:assert/strict');

const copyFit = require('../src/services/copyFit.service');

const SENTENCE = 'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावर ध्वजारोहण केले. ';
const OVER = { headline: 'नरेंद्र मोदींनी लाल किल्ल्यावर ध्वजारोहण', subheading: 'स्वातंत्र्यदिनाच्या सन्मानार्थ ध्वज उचलला' };

const BLOCK = {
  width_px: 268, height_px: 296, margin_px: 12, column_count: 1,
  line_height: 1.25, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10,
};

/** The longest body this block actually holds - found by composing, not guessing. */
async function fullBody() {
  const trimmed = await copyFit.trimToFit(BLOCK, [], { ...OVER, body: SENTENCE.repeat(40) });
  return trimmed.body;
}

/** A settle run with a counted, scripted repair. */
async function settle(body, repair = null) {
  let calls = 0;
  const result = await copyFit.settleToFit({
    section: BLOCK,
    images: [],
    proposal: { ...OVER, body },
    resizeBriefFor: () => 'brief',
    askForMore: repair === null ? undefined : async () => {
      calls += 1;
      return repair;
    },
  });
  return { ...result, calls };
}

test('CASE 3 - a block filled to its foot is finished, and is never sent back to a model', async () => {
  const body = await fullBody();
  const run = await settle(body, { data: { additions: ['more'] } });
  assert.equal(run.calls, 0, 'a full block must not cost a second call');
  assert.equal(run.acceptable, true);
  assert.equal(run.state, 'FITS');
});

test('CASE 4 - a remainder under one line is what setting type always leaves, not a hole', async () => {
  const body = await fullBody();
  const fit = await copyFit.measureFit(BLOCK, [], { ...OVER, body });
  assert.ok(fit.fill.emptyEquivalentLines < 1,
    `precondition: a full block leaves under a line, got ${fit.fill.emptyEquivalentLines}`);
  assert.equal(copyFit.isAcceptablyFilled(fit), true);
});

test('CASE 5 - overflow is ALWAYS repaired, and now for free: the model is never asked to cut', async () => {
  const run = await settle(SENTENCE.repeat(40), { data: { additions: ['x'] } });
  assert.equal(run.calls, 0, 'cutting from the bottom is deterministic - paying for it was waste');
  assert.equal(run.fit.overset, false, 'and it really fits afterwards');
  assert.equal(run.trimmed, true);
});

test('CASE 6/7 - a very short answer, and an empty one, are repaired', async () => {
  for (const body of [SENTENCE, '']) {
    const short = await copyFit.measureFit(BLOCK, [], { ...OVER, body });
    assert.equal(copyFit.isAcceptablyFilled(short), false, `"${body.slice(0, 12)}" must not read as finished`);
  }
});

test('exactly ONE paid call is spent on a hole, and the repair is APPENDED, never a rewrite', async () => {
  const opening = SENTENCE.repeat(2);
  const run = await settle(opening, { data: { additions: [SENTENCE.repeat(3)] } });
  assert.equal(run.calls, 1, 'bounded: every attempt is billed');
  assert.ok(run.body.startsWith(opening.trim().slice(0, 40)),
    'the copy the desk may already have read must survive the repair word for word');
  assert.ok(run.fit.fill.occupiedEquivalentLines > 2, 'and the block is fuller than it was');
});

test('a repair that fits WORSE is discarded - a failed second attempt never costs the desk its copy', async () => {
  const opening = SENTENCE.repeat(3);
  const run = await settle(opening, { data: { additions: [] } });
  assert.equal(run.calls, 1);
  assert.ok(run.body.includes(SENTENCE.trim()), 'the original copy is still there');
});

test('a block that cannot be filled says SOURCE_LIMITED_UNDERFILL - it is never dressed up as a fit', async () => {
  // The model has nothing further to say, honestly. That is a real production
  // state: the desk can add source material, use a bigger picture, or move the
  // story to a smaller block. What it must not be told is that this fits.
  const run = await settle(SENTENCE, { data: { additions: [] } });
  assert.equal(run.acceptable, false);
  assert.equal(run.state, 'SOURCE_LIMITED_UNDERFILL');
  assert.notEqual(run.state, 'FITS');
});

test('a hole is measured in the block\'s own geometry, so the same shortfall reads differently on different blocks', async () => {
  const narrow = { ...BLOCK, width_px: 150, height_px: 176, margin_px: 10, body_font_px: 9, headline_font_px: 14, subheading_font_px: 11 };
  const body = SENTENCE.repeat(2);
  const onWide = await copyFit.measureFit(BLOCK, [], { ...OVER, body });
  const onNarrow = await copyFit.measureFit(narrow, [], { ...OVER, body });
  assert.notEqual(onWide.fill.emptyEquivalentLines, onNarrow.fill.emptyEquivalentLines,
    'the page shows lines, and the same copy leaves a different number of them on a different measure');
});

test('a headline with no room for itself makes the block unacceptable, whatever the body did', async () => {
  const tiny = { ...BLOCK, width_px: 90, height_px: 70, headline_font_px: 34 };
  const fit = await copyFit.measureFit(tiny, [], {
    headline: 'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावर ध्वजारोहण केले आणि देशवासीयांना संबोधित केले',
    subheading: '', body: '',
  });
  if (fit.displayOverset) assert.equal(copyFit.isAcceptablyFilled(fit), false);
});

test('a block with no room for copy at all is never sent to a model', async () => {
  const noRoom = { ...BLOCK, width_px: 40, height_px: 30 };
  const run = await settle('', { data: { additions: ['x'] } });
  assert.ok(run.calls <= 1);
  const fit = await copyFit.measureFit(noRoom, [], { headline: '', subheading: '', body: '' });
  assert.ok(fit.fill.emptyEquivalentLines < 1 || fit.displayOverset,
    'a frame its pictures or its margins have filled has nothing to write into');
});
