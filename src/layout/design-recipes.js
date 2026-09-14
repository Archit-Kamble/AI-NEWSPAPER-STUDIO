// What each frame of a measured layout WEARS.
//
// templates.js says where a frame is and what it is for; a template has never
// said how a block is dressed, because that is a desk decision taken per block.
// A recipe is that decision written down once for a borrowed layout: the faces,
// the locked display sizes, the grounds, the rules and the panels a reference
// page's blocks carry, so a desk does not re-make thirty choices by hand.
//
// MEASURED, NOT INVENTED. Every number was read off the desk's 300 ppi scan of
// the reference page (scripts/apply-design-recipe.js states the scale). Sizes
// are LOCKED on purpose: the reference's look is its hierarchy, and an auto-fit
// that grows or shrinks a headline to fill its measure is exactly what would
// make the copy stop looking like the page it was measured from.
//
// NOTHING OF THE REFERENCE'S WORDS IS HERE. Panel titles and lines are fixture
// placeholders a writer replaces; the reference's nameplate, section labels,
// disclaimers and copy are not carried and must not be.
//
// Values are the shared catalogues' own keys and hexes (inks.js, borders.js,
// typefaces.js, inset-panels.js), so the service's palette boundary checks them
// like any other save.
//
// Panel and picture rectangles are in the block's own pixels. Every page is
// measured off its scan now (measured-pages/), so the hand-written builders and
// the fixture advertisers the first pass used are gone.

// A page measured exactly off a scan carries its recipe in its own spec
// (measured-pages/), beside the rectangles it was measured with.
const { buildMeasuredPage } = require('./measured-pages/scan');
const MEASURED_RECIPES = Object.fromEntries(['broadsheet-front', 'broadsheet-city', 'broadsheet-state', 'broadsheet-local', 'broadsheet-opinion', 'broadsheet-advertorial', 'broadsheet-local-sport', 'broadsheet-miscellany', 'broadsheet-business', 'broadsheet-sport', 'broadsheet-world', 'broadsheet-jacket']
  .map((key) => [key, buildMeasuredPage(require(`./measured-pages/${key}`)).recipe]));

const RECIPES = {
  ...MEASURED_RECIPES,
};

// THE SECTION A PAGE NAMES IN ITS FOLIO. The reference carries its section in
// every inside page's head - आपला महाराष्ट्र, आपले मैदान, आपला पैसा - and this
// paper's folio already draws a section name from the page's theme
// (page-styles.js). Only the theme COLUMN is set: dressing the page through the
// styler would re-dress every block the recipe has just dressed. A layout the
// catalogue has no section for (opinion, notices, the jacket) names none, which
// is better than naming a wrong one.
const PAGE_THEME = {
  'broadsheet-city': 'city',
  'broadsheet-local': 'city',
  'broadsheet-state': 'state',
  'broadsheet-business': 'business',
  'broadsheet-sport': 'sport',
  'broadsheet-local-sport': 'sport',
  'broadsheet-world': 'world',
};

function pageThemeFor(templateKey) {
  return PAGE_THEME[templateKey] || null;
}

function recipeFor(templateKey) {
  return RECIPES[templateKey] || null;
}

module.exports = { RECIPES, recipeFor, PAGE_THEME, pageThemeFor };
