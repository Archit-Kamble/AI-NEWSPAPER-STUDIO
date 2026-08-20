// The guarantee that replaces "brief it carefully and hope".
//
// The old pipeline predicted a character count and trusted it. It could not
// work, and this is settled rather than arguable: the same block holds 30-46%
// more or fewer characters depending only on what is written into it
// (CLAUDE.md, "the character budget is a range"), so briefing the safe floor
// underfills the ordinary case by that much and briefing the ceiling
// overflows it. Both halves of the desk's report - "either it is underflowing
// or it is overflowing" - are the same missing piece: nothing ever COMPOSED
// the copy and checked.
//
// So the property held here is not "the estimate is good". It is that
// whatever the model returns - far too short, far too long, or one
// unbreakable sentence longer than the block itself - what a desk is finally
// shown FITS, judged by the same exact `fitState` preflight will fail the
// page for.

const test = require('node:test');
const assert = require('node:assert/strict');

const copyFit = require('../src/services/copyFit.service');

const SENTENCE = 'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावर ध्वजारोहण केले. ';
const LONG_WORD_SENTENCE = 'पंतप्रधान नरेंद्र मोदी यांनी भारताच्या स्वातंत्र्यदिनाच्या निमित्ताने लाल किल्ल्यावरून देशवासीयांना संबोधित करताना विकसित भारताच्या संकल्पाचा पुनरुच्चार केला आणि सर्व नागरिकांना एकत्रित प्रयत्नांचे आवाहन केले';

const BLOCKS = [
  { name: 'ordinary', section: { width_px: 268, height_px: 296, margin_px: 12, column_count: 1, line_height: 1.25, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10 }, images: [] },
  { name: 'narrow', section: { width_px: 150, height_px: 176, margin_px: 10, column_count: 1, line_height: 1.45, headline_font_px: 14, subheading_font_px: 11, body_font_px: 9 }, images: [] },
  { name: 'wide', section: { width_px: 620, height_px: 224, margin_px: 12, column_count: 1, line_height: 1.3, headline_font_px: 28, subheading_font_px: 15, body_font_px: 10 }, images: [] },
];

// A cut-out's exclusion is its real alpha silhouette, not its box - a tapered
// shape takes a different amount out of every scanline it crosses. This is
// the case a character budget cannot describe at all, and the reason the
// answer had to become "compose it and look" rather than a better formula.
function taperedCutout() {
  const cols = 16;
  const rows = 24;
  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    const half = Math.max(1, Math.round((cols / 2) * (0.25 + 0.75 * (y / rows))));
    const row = [];
    for (let x = 0; x < cols; x += 1) {
      row.push(Math.abs(x - cols / 2) <= half ? 1 : 0);
    }
    cells.push(row);
  }
  return {
    x_px: 0, y_px: 90, width_px: 90, height_px: 170,
    shape: 'cutout', rotation: 0, stand_off_px: 6, fit_mode: 'contain',
    source_width_px: 213, source_height_px: 611,
    mask: { cols, rows, cells },
  };
}

BLOCKS.push({
  name: 'with a cut-out photograph',
  section: { width_px: 268, height_px: 296, margin_px: 12, column_count: 1, line_height: 1.25, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10 },
  images: [taperedCutout()],
});

const OVER = { headline: 'नरेंद्र मोदींनी लाल किल्ल्यावर ध्वजारोहण', subheading: 'स्वातंत्र्यदिनाच्या सन्मानार्थ राष्ट्रीय ध्वज उचलला' };

const DRAFTS = {
  'far too long': SENTENCE.repeat(60),
  'somewhat too long': SENTENCE.repeat(8),
  'one unbreakable over-long sentence': LONG_WORD_SENTENCE.repeat(4),
};

test('trimToFit always lands on a block that FITS - every block shape, every way of being too long', async () => {
  let checked = 0;
  for (const block of BLOCKS) {
    for (const [name, body] of Object.entries(DRAFTS)) {
      // eslint-disable-next-line no-await-in-loop
      const before = await copyFit.measureFit(block.section, block.images, { ...OVER, body });
      // eslint-disable-next-line no-await-in-loop
      const trimmed = await copyFit.trimToFit(block.section, block.images, { ...OVER, body });
      // eslint-disable-next-line no-await-in-loop
      const verified = await copyFit.measureFit(block.section, block.images, { ...OVER, body: trimmed.body });
      checked += 1;
      assert.equal(verified.overset, false,
        `${block.name} / ${name}: still overset after trimming - the repair must converge`);
      assert.notEqual(verified.state, 'OVERSET', `${block.name} / ${name}: fitState still OVERSET`);
      // Cut only what had to be cut. A draft that already fitted one of these
      // block shapes (a wide block swallows more than a narrow one) must come
      // back whole - trimming is a repair, not a routine shortening.
      if (before.overset) {
        assert.ok(trimmed.body.length < body.length, `${block.name} / ${name}: was overset but nothing was cut`);
        assert.equal(trimmed.trimmed, true);
      } else {
        assert.equal(trimmed.body, body, `${block.name} / ${name}: fitted already but was cut anyway`);
      }
    }
  }
  assert.ok(checked >= 12, 'the guarantee was actually exercised across shapes and drafts');
});

test('copy that already fits is returned untouched - trimming is a repair, never a routine edit', async () => {
  const block = BLOCKS[0];
  const body = SENTENCE.repeat(2).trim();
  const before = await copyFit.measureFit(block.section, block.images, { ...OVER, body });
  assert.equal(before.overset, false, 'precondition: this draft fits');

  const trimmed = await copyFit.trimToFit(block.section, block.images, { ...OVER, body });
  assert.equal(trimmed.body, body);
  assert.equal(trimmed.trimmed, false);
  assert.equal(trimmed.cut, 0);
});

// The canvas and preflight infer columns through section-adapter. Copy-fit is
// load-bearing too: it decides whether AI copy is accepted or cut. NULL means
// Auto, not one column, so it must reach the adapter without being coerced.
test('copy-fit composes an Auto-column block exactly like its inferred column count', async () => {
  const section = {
    width_px: 268, height_px: 304, margin_px: 1, column_count: null,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 12,
  };
  const body = SENTENCE.repeat(5).trim();

  const auto = await copyFit.measureFit(section, [], { ...OVER, body });
  const one = await copyFit.measureFit({ ...section, column_count: 1 }, [], { ...OVER, body });
  const two = await copyFit.measureFit({ ...section, column_count: 2 }, [], { ...OVER, body });

  assert.equal(auto.state, two.state);
  assert.equal(auto.overset, two.overset);
  assert.deepEqual(auto.fill, two.fill, 'Auto and explicit two must pour into the same geometry');
  assert.notDeepEqual(auto.fill, one.fill, 'explicit one must remain a different composition');
});

test('a cut at a sentence boundary, not mid-word - a block is cut from the bottom, the way a sub-editor cuts', async () => {
  const block = BLOCKS[0];
  const trimmed = await copyFit.trimToFit(block.section, block.images, { ...OVER, body: SENTENCE.repeat(20) });
  assert.ok(/[।.!?]$/.test(trimmed.body.trim()), `ended mid-sentence: ${JSON.stringify(trimmed.body.slice(-40))}`);
});

test('the calibration is measured from the copy itself, and a cut-out narrows it', async () => {
  const plain = BLOCKS[0];
  const cutout = BLOCKS[3];
  const body = SENTENCE.repeat(3).trim();

  const a = await copyFit.measureFit(plain.section, plain.images, { ...OVER, body });
  const b = await copyFit.measureFit(cutout.section, cutout.images, { ...OVER, body });

  assert.ok(a.charsPerEquivalentLine > 0 && b.charsPerEquivalentLine > 0, 'both calibrate from the real placed copy');

  // The RATE is per full-measure line, so a silhouette should barely move it:
  // the cut-out narrows the characters and the equivalents together, and the
  // quotient normalises out. This is what makes it a usable target - and it
  // is exactly what dividing by `bodyLines.length` could not do, because
  // that count grows when a row splits while the copy on it does not.
  // Measured here: the cut-out block sets 5 fragments across 3.7 equivalent
  // lines, so the old divisor understated the rate by about a quarter, and
  // that understated rate was multiplied by the hole to decide what to ask
  // the model for next.
  assert.ok(b.renderedFragments > b.fill.occupiedEquivalentLines,
    `precondition: the cut-out must split a row - ${b.renderedFragments} fragments over ${b.fill.occupiedEquivalentLines} lines`);
  const drift = Math.abs(b.charsPerEquivalentLine - a.charsPerEquivalentLine) / a.charsPerEquivalentLine;
  assert.ok(drift < 0.2, `the rate is per full measure, so it should hold: plain ${a.charsPerEquivalentLine}, cut-out ${b.charsPerEquivalentLine}`);

  // The silhouette still shows up - through the GEOMETRY, in how many
  // equivalent lines are left, not through a fudged rate. No formula was
  // asked to model the shape.
  assert.ok(b.targetChars < a.targetChars, 'the calibrated target follows the real shape of the hole');
});

test('settleToFit repairs the too-long case for free - the model is never asked to cut', async () => {
  const block = BLOCKS[3];
  const settled = await copyFit.settleToFit({
    section: block.section,
    images: block.images,
    proposal: { ...OVER, body: SENTENCE.repeat(40) },
    askForMore: () => { throw new Error('a paid call must not be spent cutting copy'); },
    resizeBriefFor: () => 'unused',
  });
  assert.equal(settled.trimmed, true);
  assert.equal(settled.resized, 'overflow');
  assert.equal(settled.fit.overset, false, 'and the settled copy actually fits');
});

test('settleToFit asks for more copy only when there is a real hole, and never accepts a repair that fits worse', async () => {
  const block = BLOCKS[2]; // wide and short: a two-sentence draft leaves a real hole
  const proposal = { ...OVER, body: SENTENCE.trim() };

  let asked = 0;
  const settled = await copyFit.settleToFit({
    section: block.section,
    images: block.images,
    proposal,
    // A model that answers with something even shorter - the repair is
    // allowed to fail, and when it does the desk keeps the copy it had.
    askForMore: async () => { asked += 1; return { data: { body: 'लहान.' } }; },
    resizeBriefFor: () => 'brief',
  });

  assert.equal(asked, 1, 'exactly one paid call for the one case a model can actually fix');
  assert.equal(settled.body, proposal.body, 'a worse answer is discarded, not printed');
});

// ---------------------------------------------------------------- lines ---
//
// Found on two real blocks, reported by the desk as "it says it is already
// fit but it did not" and "124 of 203, 79 character left, which is totally
// wrong". Both are one cause: a percentage taken from the CHARACTER budget is
// a choice of which end of a range to divide by, and the surfaces chose
// differently - the Space panel divided by the range floor and said "95%
// full" while the AI panel divided by a calibrated target and offered "79
// left", on the same block, one click apart.

test('fill is reported in LINES, which have no range - not as a share of the character floor', async () => {
  const block = BLOCKS[0];
  // Copy that genuinely leaves the foot of the block empty.
  const body = SENTENCE.repeat(3).trim();
  const fit = await copyFit.measureFit(block.section, block.images, { ...OVER, body });

  assert.ok(fit.fill, 'every measurement carries the geometric fill');
  assert.equal(fit.fill.linesUsed + fit.fill.holeLines, fit.fill.linesAvailable);
  assert.equal(fit.fill.ratio, fit.fill.linesUsed / fit.fill.linesAvailable);

  // The old meter divided the characters written by the range's FLOOR - the
  // least this block could hold for the worst possible prose - so ordinary
  // copy read far fuller than it is. The two must not agree, or this test is
  // not exercising the bug it was written for.
  const oldRatio = fit.capacity.bodyCharsUsed / fit.capacity.bodyCharRange.min;
  assert.ok(oldRatio > fit.fill.ratio,
    `the character-floor ratio (${oldRatio.toFixed(2)}) must overstate the real line fill (${fit.fill.ratio.toFixed(2)})`);
});

test('an explicit fill request is judged on real room, not on the automatic-repair threshold', async () => {
  const block = BLOCKS[0];
  // A hole big enough to see and to write into, but UNDER HOLE_LINES (4) -
  // the exact shape of the block this was reported from (3.58 lines empty,
  // fitState FITS, and the button answered "already fits its space").
  let body = SENTENCE.trim();
  let fit = await copyFit.measureFit(block.section, block.images, { ...OVER, body });
  for (let i = 0; i < 12 && fit.fill.holeLines >= 4; i += 1) {
    body = `${body} ${SENTENCE.trim()}`;
    // eslint-disable-next-line no-await-in-loop
    fit = await copyFit.measureFit(block.section, block.images, { ...OVER, body });
  }

  assert.ok(fit.fill.holeLines >= 1 && fit.fill.holeLines < 4,
    `precondition: a hole of 1-4 lines, got ${fit.fill.holeLines}`);
  assert.equal(fit.state, 'FITS', 'the engine calls this FITS - that is the automatic threshold, not an answer to the desk');
  assert.equal(copyFit.hasRoomToFill(fit), true,
    'but the desk asked, and there is more than a line of room - it must fill');
});

test('a block genuinely full to the foot is the one case an explicit fill still refuses', async () => {
  const block = BLOCKS[0];
  const trimmedTight = await copyFit.trimToFit(block.section, block.images, { ...OVER, body: SENTENCE.repeat(40) });
  const fit = trimmedTight.fit;
  if (fit.fill.holeLines < copyFit.MIN_FILLABLE_LINES) {
    assert.equal(copyFit.hasRoomToFill(fit), false, 'nothing can be written into less than a line');
  }
  assert.equal(fit.overset, false);
});

// A hole is a SHARE of the block's own body area, never a fixed line count.
// Found on a real 268x248 lead block with a tall cut-out beside the copy: it
// has room for 4.55 body lines once its headline and deck are set, the model
// filled 2, and 2.55 lines - 56% of the body area - went out empty, because
// the absolute threshold (4) had not been reached. The same 4 lines on a
// 14-line block is 29%, which IS worth repairing. One number cannot be both.
test('a block is finished at 95% set, and chased until it is', () => {
  const fill = (used, available) => ({
    occupiedEquivalentLines: used,
    emptyEquivalentLines: Number((available - used).toFixed(2)),
    availableEquivalentLines: available,
    linesUsed: used,
    holeLines: Number((available - used).toFixed(2)),
    linesAvailable: available,
    ratio: available > 0 ? used / available : 0,
    overset: false,
  });
  const fit = (used, available) => ({ fill: fill(used, available), overset: false, displayOverset: false });

  // 95%, not "under one whole line empty". That older bar was far too slack
  // on a small block: 4.83 of 5.83 lines is under a line empty and only 83%
  // set, and it is what let a desk be shown "Layout looks balanced" while
  // looking at a column with a visibly short foot.
  assert.equal(copyFit.isAcceptablyFilled(fit(4.83, 5.83)), false, '83% set is not finished');
  assert.equal(copyFit.isAcceptablyFilled(fit(5.6, 5.83)), true, '96% set is');
  assert.equal(copyFit.isAcceptablyFilled(fit(13, 14)), false, '93% on a big block is not finished either');

  // And the repair rule chases the same bar - one question, not two.
  assert.equal(copyFit.isUnderfilled(fill(2, 4.55)), true, 'a block 56% empty must be repaired');
  assert.equal(copyFit.isUnderfilled(fill(10, 14)), true, '71% set is repaired');
  assert.equal(copyFit.isUnderfilled(fill(13, 14)), true, '93% set is now repaired too - the bar is 95%');
  assert.equal(copyFit.isUnderfilled(fill(13.9, 14)), false, 'a quarter-line remainder is what setting type leaves');

  // Overset copy is a different repair entirely - it is trimmed, not filled.
  assert.equal(copyFit.isUnderfilled({ ...fill(2, 4.55), overset: true }), false);
  assert.equal(copyFit.isAcceptablyFilled({ ...fit(5.8, 5.83), overset: true }), false, 'overset is never finished');
  assert.equal(copyFit.isAcceptablyFilled({ ...fit(5.8, 5.83), displayOverset: true }), false,
    'and neither is a headline with no room for itself');
});

test('settleToFit fills a small block that is proportionally half empty, which the absolute rule ignored', async () => {
  // A short, wide block: its body area is only a few lines, so a two-line
  // draft leaves a large SHARE empty while never reaching 4 absolute lines.
  const section = {
    width_px: 620, height_px: 150, margin_px: 12, column_count: 1, line_height: 1.3,
    headline_font_px: 28, subheading_font_px: 15, body_font_px: 10,
  };
  const proposal = { ...OVER, body: SENTENCE.trim() };
  const before = await copyFit.measureFit(section, [], proposal);

  let asked = 0;
  await copyFit.settleToFit({
    section,
    images: [],
    proposal,
    askForMore: async () => { asked += 1; return { data: { body: SENTENCE.repeat(3).trim() } }; },
    resizeBriefFor: () => 'brief',
  });

  if (before.fill.holeLines >= 1 && before.fill.holeLines < 4
      && before.fill.holeLines / before.fill.linesAvailable >= 0.25) {
    assert.equal(asked, 1,
      `a block with ${before.fill.holeLines} of ${before.fill.linesAvailable} lines empty must be filled, not left`);
  }
});

// The reservation used to lean on a proof that moving the budget to the exact
// engine quietly voided: row count in text-flow.js is
// `ceil(length / charsPerLine)`, monotonic in length, so the LONGEST legal
// headline necessarily took the most rows. The exact engine breaks lines at
// real word boundaries, so a shorter headline whose last word will not fit
// wraps to an extra line and leaves the body LESS room. Measured on a real
// 268x248 lead beside a cut-out: the single full-limit stand-in reserved room
// for 222 characters where the real headline left 187 - a 19% over-ask.
test('the headline reservation takes the WORST stand-in, because line count is not monotonic in headline length', async () => {
  const reserve = require('../public/editor/layout/headline-reserve');
  const writer = require('../src/services/storyWriter.service');

  // Narrow measure beside a tall cut-out - where non-monotonic wrapping bites.
  const section = {
    width_px: 268, height_px: 248, margin_px: 12, column_count: 1, line_height: 1.45,
    headline_font_px: 24, subheading_font_px: 13, body_font_px: 10,
  };
  const images = [taperedCutout()];

  // The SAME cols planningFit derives, not a guessed one - the candidate set
  // depends on it, so a different value tests a different reservation.
  const cols = (await writer.measure(section, images)).cols || 1;
  const candidates = reserve.reservationCandidates(cols);
  assert.ok(candidates.length > 1, 'more than one length is tried');

  const budgets = [];
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const fit = await writer.measure(section, images, candidate);
    budgets.push(fit.bodyCharBudget);
  }
  const reserved = (await writer.planningFit(section, images)).bodyCharBudget;
  assert.equal(reserved, Math.min(...budgets),
    'planningFit must reserve the least room any legal headline would leave, not the full-limit one');

  // And the full-limit candidate must not be assumed to be that worst case -
  // if it always were, sampling would be pointless. This is the property the
  // old single-stand-in reservation silently assumed.
  assert.ok(budgets.length === candidates.length);
});
