// EVERY PAGE MEASURED OFF A SCAN, named once.
//
// A measured page is two things to the rest of the product - a template
// (templates.js) and a recipe (design-recipes.js) - and both used to carry
// their own hand-written copy of this list. That is the duplicated-catalogue
// failure this project has already been bitten by twice, and it fails in the
// worst way here: a page added to one list and not the other has a layout with
// no dressing, or a dressing no layout can reach, and nothing errors. It is
// silent until somebody opens the page and wonders why it is undressed.
//
// So the list lives here, once. Adding a measured page is one line in
// `KEYS` plus the spec file beside it; nothing else in the product is touched.
//
// `PAPERS` is the grouping a desk thinks in: which reference paper a page was
// measured from. Nothing composes differently because of it - it is what lets
// a script, a test or a person say "every Sakal page" without a second list.

const { buildMeasuredPage } = require('./scan');

const PAPERS = {
  // The Pune broadsheet the first twelve pages were measured from.
  lokmat: [
    'broadsheet-front', 'broadsheet-city', 'broadsheet-state', 'broadsheet-local',
    'broadsheet-opinion', 'broadsheet-advertorial', 'broadsheet-local-sport',
    'broadsheet-miscellany', 'broadsheet-business', 'broadsheet-sport',
    'broadsheet-world', 'broadsheet-jacket',
  ],
  // Measured from Sakal. Add a key here and the spec file beside it; the
  // template and the recipe both follow with no further registration.
  sakal: [],
};

const KEYS = Object.values(PAPERS).flat();

/** Every measured page, built once: `{ [key]: { template, recipe } }`. */
function measuredPages() {
  return Object.fromEntries(KEYS.map((key) => [key, buildMeasuredPage(require(`./${key}`))]));
}

/** Which reference paper a measured page was taken from, or null. */
function paperOf(key) {
  return Object.keys(PAPERS).find((paper) => PAPERS[paper].includes(key)) || null;
}

module.exports = { KEYS, PAPERS, measuredPages, paperOf };
