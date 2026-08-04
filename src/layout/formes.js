// Which pages print in colour.
//
// A web press does not print colour on every page. A sheet carries four pages -
// two on each side - and colour is bought a forme at a time. On a normal run the
// outer forme (the first two pages and the last two) and the centre spread take
// colour; everything between them runs black only.
//
// This is not a design preference, it is what the press will physically do. So
// the software has to know it: a colour photograph placed on a mono page is
// going to print grey, and the desk should find that out in the workspace on
// Tuesday afternoon rather than on the newsstand on Wednesday morning.
//
// The default below is the ordinary arrangement for an 8- to 16-page daily. It
// is a default: `pages.prints_colour` is stored per page, so a desk that buys
// colour on a different forme just sets it.

/**
 * True if page `n` of a `total`-page edition would normally print in colour.
 *
 * Pages come off the press in sheets of four. The first sheet carries pages
 * 1, 2 and the last two; its outer side is where colour is cheapest, which is
 * why page one and the back page are always colour. The centre spread is the
 * one other place a sheet is folded so that two facing pages are on the same
 * side, so it takes colour too.
 */
function printsColourByDefault(pageNumber, total) {
  const n = Number(pageNumber);
  const pages = Number(total) || 0;
  if (!n || n < 1) return false;

  // The outer forme: the first two pages and the last two.
  if (n <= 2) return true;
  if (pages && n > pages - 2) return true;

  // The centre spread, when the edition has an even number of pages and enough
  // of them for a centre to exist.
  if (pages >= 8 && pages % 2 === 0) {
    const centre = pages / 2;
    if (n === centre || n === centre + 1) return true;
  }
  return false;
}

/**
 * What is wrong with this page, colour-wise.
 *
 * Returns the blocks carrying a photograph on a page that will print black
 * only. An empty list means the page is safe.
 */
function colourWarnings(page) {
  if (page?.prints_colour !== false) return [];
  return (page.sections || [])
    .filter((section) => section.image_url || (section.images || []).length)
    .map((section) => ({
      sectionKey: section.section_key,
      pictures: (section.images || []).length + (section.image_url ? 1 : 0),
      message: 'This page prints black only — the photograph will come out grey.',
    }));
}

module.exports = { printsColourByDefault, colourWarnings };
