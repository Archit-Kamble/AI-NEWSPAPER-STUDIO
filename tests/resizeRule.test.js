// When is a story sent back to be resized, and when is one answer enough?
//
// The rule this holds exists because of a measured fault. The model is briefed
// on a block BEFORE it has written the headline, so the headline is reserved at
// its longest. Whatever headline it then writes is usually shorter, and a
// headline one line shorter hands its rows to the body - so the block measured
// afterwards holds more than the model was ever told to fill.
//
// Judging the copy against that larger number alone fired a second paid call on
// 69% of the article blocks of a real edition, against a model that had done
// exactly as it was asked.
//
// The reservation cannot simply be made accurate: measured across 34 blocks,
// one block holds anywhere from 192 to 396 characters depending on the headline
// chosen, because the budget moves a whole row per headline line and real
// Marathi does not wrap by character count. So the decision tolerates the
// planning error instead - while still refusing copy that will not fit, and
// still refusing to leave a hole a reader would see.

const test = require('node:test');
const assert = require('node:assert/strict');

const { resizeNeeded } = require('../src/services/storyWriter.service');

// A block 45 characters across - a broadsheet column.
const block = (bodyCharBudget, cols = 45) => ({ bodyCharBudget, cols });

test('CASE 1 — the model wrote what it was asked; the headline just came out short', () => {
  // Briefed on 192, block turned out to hold 315 because the headline took one
  // line fewer than was reserved for it. 190 characters is the brief, met.
  const verdict = resizeNeeded({ used: 190, real: block(315), briefed: 192 });
  assert.equal(verdict, false, 'a second paid call for the planner\'s conservatism is not the model\'s to pay');
});

test('CASE 2 — genuinely short, and no headline explains it', () => {
  const verdict = resizeNeeded({ used: 90, real: block(315), briefed: 192 });
  assert.ok(verdict, 'less than half the brief is the model missing, not the planner');
  assert.equal(verdict.reason, 'short');
});

test('CASE 3 — a perfect fit is never touched again', () => {
  assert.equal(resizeNeeded({ used: 315, real: block(315), briefed: 315 }), false);
});

test('CASE 4 — a small underfill is accepted', () => {
  // 290 of 315 is inside the floor the brief stated (92%), and leaves half a
  // line at the foot of the block. Nobody would see it, and it is not worth
  // thirty seconds and a second bill.
  assert.equal(resizeNeeded({ used: 290, real: block(315), briefed: 315 }), false);
});

test('CASE 5 — overflow is always repaired', () => {
  const verdict = resizeNeeded({ used: 350, real: block(315), briefed: 315 });
  assert.ok(verdict);
  assert.equal(verdict.reason, 'overflow', 'copy longer than its block is not a judgement call');

  // Even one character over: it does not fit, and the page is the arbiter.
  assert.equal(resizeNeeded({ used: 316, real: block(315), briefed: 315 }).reason, 'overflow');
});

test('CASE 6 — a very short answer is repaired', () => {
  const verdict = resizeNeeded({ used: 100, real: block(315), briefed: 315 });
  assert.ok(verdict);
  assert.equal(verdict.reason, 'short');
});

test('CASE 7 — an empty body is repaired', () => {
  const verdict = resizeNeeded({ used: 0, real: block(315), briefed: 315 });
  assert.ok(verdict);
  assert.equal(verdict.reason, 'short');
});

test('CASE 8 — a block with no room for copy is never sent to a model at all', () => {
  assert.equal(resizeNeeded({ used: 0, real: block(0), briefed: 0 }), false,
    'a block filled by its pictures has nothing to resize');
  assert.equal(resizeNeeded({ used: 50, real: null, briefed: 100 }), false);
  assert.equal(resizeNeeded({ used: 50, real: undefined, briefed: 100 }), false);
});

// ------------------------------------------------------- the hole guard ---

test('a hole a reader would see is repaired, whoever is at fault', () => {
  // Briefed on 200, the block turned out to hold 600. The model obeyed - but
  // nearly nine empty lines at the foot of a block is a hole somebody has to
  // fill at 11pm, and that is worth the second call.
  const verdict = resizeNeeded({ used: 195, real: block(600), briefed: 200 });
  assert.ok(verdict);
  assert.equal(verdict.reason, 'hole');
});

test('the boundary: up to 4 empty lines are accepted, more than 4 is a hole', () => {
  // HOLE_LINES was 3, then 4: at 3, `planningFit`'s own conservatism (headline
  // and deck reserved at their full legal limit, never a typical or trimmed
  // length) was routinely enough on its own to cross the line - 41% of writes
  // on a real edition, asking for a second call to fill a gap the model did
  // nothing to cause. Measured on the same edition, 4 brought that to 7%:
  // still a real hole, not the guarantee's own margin.
  //
  // A budget generous enough that the 92%-floor check (a SEPARATE rule) is not
  // what these numbers are testing, and a 40-column block, so N lines of gap
  // is exactly N*40 characters. The check is `>`, so 4 lines exactly still
  // passes - the threshold moved to 4, not to "4 or more".
  const budget = 3000;
  const cols = 40;

  const threeLines = resizeNeeded({ used: budget - 3 * cols, real: block(budget, cols), briefed: budget });
  assert.equal(threeLines, false, '3 empty lines is inside the tolerance');

  const fourLines = resizeNeeded({ used: budget - 4 * cols, real: block(budget, cols), briefed: budget });
  assert.equal(fourLines, false, 'exactly 4 empty lines is still inside the tolerance - the check is strictly greater-than');

  const fiveLines = resizeNeeded({ used: budget - 5 * cols, real: block(budget, cols), briefed: budget });
  assert.ok(fiveLines, 'more than 4 empty lines reads as a hole');
  assert.equal(fiveLines.reason, 'hole');
});

test('the hole is counted in lines, not in percent', () => {
  // The same shortfall, on two different measures. 90 characters is two lines
  // on a wide block and six on a narrow one - the page shows lines, so the rule
  // reads lines.
  const wide = resizeNeeded({ used: 510, real: block(600, 45), briefed: 520 });
  assert.equal(wide, false, 'two empty lines on a broadsheet column is invisible');

  const narrow = resizeNeeded({ used: 510, real: block(600, 15), briefed: 520 });
  assert.ok(narrow, 'the same gap on a narrow measure is six lines of white');
  assert.equal(narrow.reason, 'hole');
});

test('the floor is the one the brief actually stated', () => {
  // briefFor asks for 92% of the budget it quotes. The rule uses the same
  // number, so "did it do as it was asked" means the same thing in both places.
  assert.equal(resizeNeeded({ used: 184, real: block(200), briefed: 200 }), false, '92% exactly is inside the brief');
  assert.equal(resizeNeeded({ used: 183, real: block(200), briefed: 200 }).reason, 'short', 'just under it is not');
});

test('the old rule and the new one still agree wherever the planning was right', () => {
  // When the reservation happened to be exact, the two rules must not differ -
  // the change is meant to forgive the planner, not to loosen the standard.
  for (const budget of [100, 315, 600, 1080]) {
    for (const fraction of [0.5, 0.85, 0.91, 0.93, 0.99, 1.0, 1.05]) {
      const used = Math.round(budget * fraction);
      const oldRule = used < budget * 0.9 || used > budget;
      const newRule = Boolean(resizeNeeded({ used, real: block(budget), briefed: budget }));
      if (fraction < 0.9 || fraction > 1) {
        assert.equal(newRule, oldRule, `budget ${budget} at ${fraction}: both should repair`);
      }
    }
  }
});
