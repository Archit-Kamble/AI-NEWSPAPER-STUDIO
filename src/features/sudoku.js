// शब्दकोडे / सुडोकू — the daily puzzle.
//
// Papers pay for these. They do not have to: a sudoku is pure computation, so
// this costs nothing at all - no model call, no subscription, no network.
//
// The one property that matters for a newspaper is that it is DETERMINISTIC.
// The puzzle is seeded from the edition's date, so re-opening Tuesday's edition
// next year prints Tuesday's puzzle, and the solution printed in Wednesday's
// paper still matches what Tuesday's readers were solving. A random puzzle
// generated afresh each time the page is drawn would quietly break the archive.

const DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const devanagari = (value) => String(value).replace(/\d/g, (d) => DIGITS[Number(d)]);

// How many cells are given. Fewer clues is a harder puzzle; papers run a
// different difficulty on different days, and so does this - easy at the start
// of the week, hardest at the weekend, which is the convention.
const CLUES_BY_WEEKDAY = [30, 36, 34, 32, 32, 30, 28]; // Sunday .. Saturday
const DIFFICULTY = ['मध्यम', 'सोपे', 'सोपे', 'मध्यम', 'मध्यम', 'मध्यम', 'कठीण'];

// A small deterministic generator. Seeded from the date, so the same day always
// produces the same puzzle - see the note above.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seedFor(isoDate) {
  const digits = String(isoDate).split('T')[0].replace(/\D/g, '');
  return Number(digits) % 2147483647 || 1;
}

// A completed grid, built from the canonical pattern and then shuffled in the
// ways that preserve validity: relabelling the digits, swapping rows within a
// band and columns within a stack, and swapping whole bands and stacks.
function solvedGrid(random) {
  const base = [];
  for (let row = 0; row < 9; row += 1) {
    base.push([]);
    for (let col = 0; col < 9; col += 1) {
      base[row].push(((row % 3) * 3 + Math.floor(row / 3) + col) % 9);
    }
  }

  const shuffle = (list) => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };

  const labels = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rowOrder = shuffle([0, 1, 2]).flatMap((band) => shuffle([0, 1, 2]).map((r) => band * 3 + r));
  const colOrder = shuffle([0, 1, 2]).flatMap((stack) => shuffle([0, 1, 2]).map((c) => stack * 3 + c));

  return rowOrder.map((row) => colOrder.map((col) => labels[base[row][col]]));
}

// Removes cells in a symmetric pattern, the way a printed puzzle is set - the
// grid reads better and it halves the work.
function carve(solution, clues, random) {
  const puzzle = solution.map((row) => row.slice());
  const cells = [];
  for (let i = 0; i < 81; i += 1) cells.push(i);
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  let remaining = 81;
  for (const cell of cells) {
    if (remaining <= clues) break;
    const row = Math.floor(cell / 9);
    const col = cell % 9;
    if (puzzle[row][col] === 0) continue;

    const mirrorRow = 8 - row;
    const mirrorCol = 8 - col;
    const pair = mirrorRow !== row || mirrorCol !== col;
    if (pair && remaining - 2 < clues) continue;

    puzzle[row][col] = 0;
    remaining -= 1;
    if (pair && puzzle[mirrorRow][mirrorCol] !== 0) {
      puzzle[mirrorRow][mirrorCol] = 0;
      remaining -= 1;
    }
  }
  return puzzle;
}

// Set as nine lines, blanks as a middle dot. That is printable copy - it goes
// into the block like any other feature and needs no special renderer.
function asLines(grid) {
  return grid.map((row) => row.map((n) => (n ? devanagari(n) : '·')).join(' ')).join('\n');
}

async function build(isoDate) {
  const [y, m, d] = String(isoDate).split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return { error: 'That date could not be read.' };

  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const random = seededRandom(seedFor(isoDate));
  const solution = solvedGrid(random);
  const puzzle = carve(solution, CLUES_BY_WEEKDAY[weekday], random);

  return {
    title: 'आजचे सुडोकू',
    subtitle: DIFFICULTY[weekday],
    grid: puzzle,
    solution,
    items: [{ text: asLines(puzzle) }],
  };
}

/**
 * Yesterday's answer, which is what a paper prints beside today's puzzle.
 */
async function buildSolution(isoDate) {
  const built = await build(isoDate);
  if (built.error) return built;
  return {
    title: 'कालच्या सुडोकूचे उत्तर',
    items: [{ text: asLines(built.solution) }],
  };
}

module.exports = { build, buildSolution, solvedGrid, carve, asLines, seededRandom, seedFor };
