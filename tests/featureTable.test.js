// A sudoku is a grid a reader solves, not nine lines of copy.
//
// The table is built from the copy that is already stored rather than from a
// second copy of the generator: src/features/sudoku.js is deterministic and is
// the one place a puzzle is made. These tests run the real builder and then
// parse its real output, so the two cannot drift apart.

const test = require('node:test');
const assert = require('node:assert/strict');

const sudoku = require('../src/features/sudoku');

let featureTableMarkup = null;
test.before(async () => {
  ({ featureTableMarkup } = await import('../public/editor/layout/feature-table.js'));
});

test('a real sudoku becomes a 9 x 9 table of squares', async () => {
  const built = await sudoku.build('2026-08-10');
  const body = built.items[0].text;

  // What the desk was seeing: nine lines of digits and dots.
  assert.match(body, /·/, 'the stored copy uses a middle dot for a blank');

  const table = featureTableMarkup('sudoku', body);
  assert.ok(table, 'a sudoku is recognised');
  assert.equal((table.match(/<tr>/g) || []).length, 9, 'nine rows');
  assert.equal((table.match(/<td/g) || []).length, 81, 'eighty-one squares');
  assert.doesNotMatch(table, /·/, 'a blank square is empty, not a dot');

  // The 3x3 boxes are what make a puzzle readable.
  assert.match(table, /box-right/);
  assert.match(table, /box-bottom/);

  // Every clue the builder gave is still on the grid.
  const clues = body.split(/\s+/).filter((cell) => cell && cell !== '·').length;
  const printed = (table.match(/>([^<]+)<\/td>/g) || []).length;
  assert.equal(printed, clues, `every clue is printed: ${clues}`);
});

test('yesterday\'s solution is a full grid', async () => {
  const built = await sudoku.buildSolution('2026-08-10');
  const table = featureTableMarkup('sudoku-solution', built.items[0].text);
  assert.equal((table.match(/<td/g) || []).length, 81);
  assert.equal((table.match(/class="[^"]*blank/g) || []).length, 0, 'a solution has no blanks');
});

test('label-and-text features become two-column tables', () => {
  const body = 'मेष : आजचा दिवस चांगला\nवृषभ : प्रवास टाळा';
  const table = featureTableMarkup('rashi', body);
  assert.ok(table);
  assert.equal((table.match(/<tr>/g) || []).length, 2);
  assert.match(table, /<th>मेष<\/th>/);
  assert.match(table, /<td>आजचा दिवस चांगला<\/td>/);
});

test('anything else stays prose, and never disappears', () => {
  // A quotation is read as a sentence, so it must fall through to copy.
  assert.equal(featureTableMarkup('suvichar', 'जे काम करायचे ते मनापासून करा.'), null);
  // A feature nobody wrote a renderer for must not vanish off the page.
  assert.equal(featureTableMarkup('something-new', 'x : y'), null);
  assert.equal(featureTableMarkup('sudoku', 'not a grid at all'), null);
  assert.equal(featureTableMarkup(null, 'x'), null);
});
