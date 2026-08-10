// The daily features, set as tables instead of as runs of text.
//
// A sudoku reached the page as nine lines of "१ २ · · · ४", because a feature
// becomes a headline and a body like any other block and the body is copy. That
// is fine for a quotation and wrong for a puzzle: a reader solves a GRID, and
// the paper has to print squares.
//
// The tables are built from the copy that is already stored, not from a second
// copy of the generator. src/features/sudoku.js is deterministic and it is the
// one place a puzzle is made; parsing the nine lines back keeps it that way,
// and a block whose feature this does not know still prints its text.

import { escapeHtml } from "../format.js";

const BLANK = /^[·.\-_]$/;

/** The nine rows of a sudoku, or null if this copy is not one. */
function sudokuGrid(text) {
  const rows = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/));

  if (rows.length !== 9 || rows.some((row) => row.length !== 9)) return null;
  return rows;
}

function sudokuMarkup(grid) {
  return `<table class="feature-grid sudoku-grid">${grid
    .map(
      (row, y) => `<tr>${row
        .map((cell, x) => {
          // The 3x3 boxes are what make a sudoku readable, so the rules between
          // them are heavier - exactly as a printed puzzle sets them.
          const edges = [x % 3 === 2 && x !== 8 ? "box-right" : "", y % 3 === 2 && y !== 8 ? "box-bottom" : ""]
            .filter(Boolean)
            .join(" ");
          const blank = BLANK.test(cell);
          return `<td class="${edges}${blank ? " blank" : ""}">${blank ? "" : escapeHtml(cell)}</td>`;
        })
        .join("")}</tr>`,
    )
    .join("")}</table>`;
}

/** `label : text` down a column - the twelve signs, the almanac's lines. */
function labelledRows(text) {
  const rows = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(" : ");
      return at === -1 ? null : [line.slice(0, at), line.slice(at + 3)];
    });

  return rows.length && rows.every(Boolean) ? rows : null;
}

function labelledMarkup(rows) {
  return `<table class="feature-table">${rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("")}</table>`;
}

/**
 * The feature's copy as a table, or null when it is prose.
 *
 * `null` is the normal answer for a quotation or a weather note, and the caller
 * then sets the text as copy - a feature this does not recognise must never
 * disappear off the page.
 */
export function featureTableMarkup(featureKey, body) {
  if (!featureKey || !body) return null;

  if (featureKey === "sudoku" || featureKey === "sudoku-solution") {
    const grid = sudokuGrid(body);
    return grid ? sudokuMarkup(grid) : null;
  }

  if (featureKey === "rashi" || featureKey === "panchang" || featureKey === "bajarbhav"
      || featureKey === "sone-chandi" || featureKey === "havaman") {
    const rows = labelledRows(body);
    return rows ? labelledMarkup(rows) : null;
  }

  return null;
}
