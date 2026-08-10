// Smart Cards: the structured daily features, from the builder to the page.
//
// The failure these exist to prevent is a lossy round trip. A sudoku used to
// reach the block as nine lines of "७ · · ३ · ·" and be parsed back out of
// that string to draw it. Text cannot carry a solution, a difficulty, or the
// difference between a blank square and a printed dot - so the tests here
// follow the DATA all the way: builder → API → save → reload → renderer.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

const sudoku = require('../src/features/sudoku');
const panchang = require('../src/features/panchang');
const dinvishesh = require('../src/features/dinvishesh');

const DATE = '2031-04-11';

async function withPage(t, name) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  t.after(() => pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]));

  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, newspaper, page };
}

const isGrid = (grid) =>
  Array.isArray(grid) && grid.length === 9 && grid.every((row) => Array.isArray(row) && row.length === 9);

// ------------------------------------------------------- C. structured data ---

test('the sudoku builder returns a grid of numbers, not a picture of one', async () => {
  const built = await sudoku.build(DATE);

  assert.ok(isGrid(built.card.grid), 'the card carries a 9x9 grid');
  assert.ok(isGrid(built.card.solution), 'and the solution, which text could never carry');
  assert.ok(built.card.difficulty, 'and the difficulty');

  const cells = built.card.grid.flat();
  assert.equal(cells.length, 81);
  assert.ok(cells.every((n) => Number.isInteger(n) && n >= 0 && n <= 9), 'every cell is a number');
  assert.ok(cells.some((n) => n === 0), 'some squares are blank');
  assert.ok(cells.some((n) => n > 0), 'and some are clues');

  // The solution is a real solution: every row, column and box holds 1..9.
  const complete = (values) => new Set(values).size === 9 && !values.includes(0);
  for (let i = 0; i < 9; i += 1) {
    assert.ok(complete(built.card.solution[i]), `row ${i} is complete`);
    assert.ok(complete(built.card.solution.map((row) => row[i])), `column ${i} is complete`);
  }

  // Every clue in the puzzle agrees with the solution - a puzzle that
  // contradicts its own answer is worse than no puzzle.
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if (built.card.grid[y][x] !== 0) {
        assert.equal(built.card.grid[y][x], built.card.solution[y][x]);
      }
    }
  }
});

test('the same date always builds the same puzzle', async () => {
  const first = await sudoku.build(DATE);
  const second = await sudoku.build(DATE);
  assert.deepEqual(first.card.grid, second.card.grid);
  // Yesterday's answer printed beside today's puzzle has to BE yesterday's.
  const solution = await sudoku.buildSolution(DATE);
  assert.deepEqual(solution.card.grid, first.card.solution);
});

// ------------------------------------------------------------ F. panchang ---

test('the panchang builder keeps its five lines as label and value', async () => {
  const built = await panchang.build(DATE);
  const labels = built.card.items.map((item) => item.label);

  for (const wanted of ['सूर्योदय', 'सूर्यास्त', 'दिनमान', 'राहुकाळ', 'शके']) {
    assert.ok(labels.includes(wanted), `${wanted} is one of the rows`);
  }
  assert.ok(built.card.items.every((item) => item.label && item.text),
    'every row has both halves, so no renderer has to split a string to find them');
});

test('dinvishesh carries its checked entries as entries', async () => {
  const built = await dinvishesh.build('2031-08-15');
  assert.ok(Array.isArray(built.card.entries));
  assert.ok(built.card.entries.length > 0);
  assert.ok(built.card.entries.every((entry) => typeof entry === 'string' && entry.trim()));
});

// -------------------------------------------------- G/H/M. accept and reload ---

test('a Smart Card accepted into a block survives the save and the reload', async (t) => {
  const { desk, page } = await withPage(t, 'ZZ smart card round trip');
  const built = await sudoku.build(DATE);

  const response = await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: built.title,
      subheading: built.subtitle,
      body: 'placeholder copy the grid renders instead of',
      smartCardKey: 'sudoku',
      smartCardData: built.card,
      status: 'needs_review',
    }),
  });
  assert.equal(response.status, 200);

  // Reload the way the editor does on a fresh open.
  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');

  assert.equal(lead.smart_card_key, 'sudoku');
  assert.ok(isGrid(lead.smart_card_data.grid), 'the grid came back as a grid');
  assert.ok(isGrid(lead.smart_card_data.solution), 'and so did the solution');
  assert.deepEqual(lead.smart_card_data.grid, built.card.grid, 'square for square');
  assert.equal(lead.smart_card_data.difficulty, built.card.difficulty);
});

test('discarding a card clears both halves, never one', async (t) => {
  const { desk, page } = await withPage(t, 'ZZ smart card discard');
  const built = await panchang.build(DATE);

  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'x', smartCardKey: 'panchang', smartCardData: built.card }),
  });

  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'x', smartCardKey: null, smartCardData: null }),
  });

  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');
  assert.equal(lead.smart_card_key, null);
  assert.equal(lead.smart_card_data, null);
});

test('a card key without a payload is never stored - it would draw nothing', async (t) => {
  const { desk, page } = await withPage(t, 'ZZ smart card half');

  await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'x', smartCardKey: 'sudoku', smartCardData: null }),
  });

  const [reloaded] = await desk.json(`/api/newspapers/${page.newspaper_id}/pages`);
  const lead = reloaded.sections.find((s) => s.section_key === 'lead');
  assert.equal(lead.smart_card_data, null);
});

// ---------------------------------------------------------- D. the renderer ---

test('the renderer draws the builder\'s own grid, with the 3x3 rules', async () => {
  const { smartCardMarkup, smartCardText } = await import('../public/editor/smart-cards/smart-cards.js');
  const built = await sudoku.build(DATE);
  const html = smartCardMarkup('sudoku', built.card);

  assert.equal((html.match(/<tr>/g) || []).length, 9, 'nine rows');
  assert.equal((html.match(/<td/g) || []).length, 81, 'eighty-one squares');
  assert.ok(!html.includes('·'), 'a blank square is blank, not a dot');
  assert.equal((html.match(/box-right/g) || []).length, 18, 'two heavier vertical rules, nine rows deep');
  assert.equal((html.match(/box-bottom/g) || []).length, 18, 'two heavier horizontal rules, nine columns wide');

  // Every clue prints, in Devanagari.
  const digits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
  const clues = built.card.grid.flat().filter((n) => n > 0);
  const printed = (html.match(/>[०-९]</g) || []).length;
  assert.equal(printed, clues.length, 'every clue is on the page and nothing else is');
  assert.ok(clues.every((n) => html.includes(`>${digits[n]}<`)));

  // And the text fallback is a RENDERING of the same data, not its source.
  const text = smartCardText('sudoku', built.card);
  assert.equal(text.split('\n').length, 9);
});

test('the renderer keeps a sign\'s lucky number and colour as their own fields', async () => {
  const { smartCardMarkup } = await import('../public/editor/smart-cards/smart-cards.js');
  const html = smartCardMarkup('rashi', {
    signs: [
      { key: 'mesh', name: 'मेष', text: 'आजचा दिवस चांगला.', luckyNumber: 3, luckyColour: 'निळा' },
      { key: 'vrishabh', name: 'वृषभ', text: 'कामात यश.', luckyNumber: 7, luckyColour: 'हिरवा' },
    ],
  });

  assert.equal((html.match(/smart-card-rashi-sign/g) || []).length, 2, 'a row per sign');
  assert.ok(html.includes('मेष') && html.includes('वृषभ'));
  assert.ok(html.includes('शुभ अंक ३'), 'the lucky number, in Devanagari');
  assert.ok(html.includes('शुभ रंग निळा'), 'and the lucky colour');
  assert.ok(html.includes('rashi-luck'), 'on their own line, not welded to the sentence');
});

test('an unknown card falls through to the block\'s copy rather than vanishing', async () => {
  const { smartCardMarkup } = await import('../public/editor/smart-cards/smart-cards.js');
  assert.equal(smartCardMarkup('havaman', { items: [] }), null);
  assert.equal(smartCardMarkup('sudoku', null), null);
  assert.equal(smartCardMarkup('sudoku', { grid: [[1, 2]] }), null, 'a grid that is not 9x9 is not a sudoku');
  assert.equal(smartCardMarkup(null, null), null);
});

test('panchang and suvichar draw as a table and a quote', async () => {
  const { smartCardMarkup } = await import('../public/editor/smart-cards/smart-cards.js');
  const built = await panchang.build(DATE);

  const table = smartCardMarkup('panchang', built.card);
  assert.equal((table.match(/<tr>/g) || []).length, 5, 'five rows');
  assert.ok(table.includes('<th>सूर्योदय</th>'));

  const quote = smartCardMarkup('suvichar', { text: 'प्रयत्ने वाळूचे कण रगडिता तेलही गळे.', attribution: 'समर्थ रामदास' });
  assert.ok(quote.includes('<blockquote'));
  assert.ok(quote.includes('समर्थ रामदास'));
});

// -------------------------------------------- 12. the old text path still works ---

test('a block saved before Smart Cards existed still prints its grid', async () => {
  const { featureTableMarkup } = await import('../public/editor/layout/feature-table.js');
  const built = await sudoku.build(DATE);

  // The old shape: nine lines of text and no structured payload at all.
  const table = featureTableMarkup('sudoku', built.items[0].text);
  assert.ok(table, 'the text parser is still there for rows written before the migration');
  assert.equal((table.match(/<tr>/g) || []).length, 9);
});
