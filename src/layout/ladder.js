// The page ladder: which layout each page of an edition gets.
//
// In a newsroom the "ladder" (or the dummy) is the sheet pinned to the wall
// showing what every page of tonight's paper is: page one, city, state, the
// editorial page, features, sport, the back page. It is decided once for the
// title and then followed every single day. Nobody stands at the ladder each
// morning wondering whether page three should be a features page.
//
// The software was making the desk do exactly that. Creating a four-page
// edition gave all four pages the FRONT PAGE layout - four nameplates, four
// lead packages - and the desk then had to click through every page picking a
// layout by hand, every day, for a decision that never changes.
//
// So the ladder is derived from one number: how many pages the edition has.
// These are the rules a Marathi daily actually follows:
//
//   page 1        the front page. Always.
//   page 2        city and district news - the page a local reader turns to.
//   the last page the back page: heavy display advertising and the short items
//                 that fill round it.
//   one page      the editorial and opinion page. In a four-page paper there is
//                 no room for one, so it starts at six.
//   one page      the daily features - राशिभविष्य, पंचांग, दिनविशेष, सुविचार.
//                 A four-page paper still carries these; they go on page three.
//   the rest      general news, alternating a lighter and a denser layout so
//                 consecutive pages do not read identically.
//
// The desk can still change any page's layout afterwards - this decides what
// the page STARTS as, which is the difference between a paper that is ready to
// fill and a paper that has to be built first.

const { templates } = require('./templates');
const PAGE_ROLE = Object.freeze({ FRONT: 'FRONT', LOCAL: 'LOCAL', GENERAL: 'GENERAL', OPINION: 'OPINION', FEATURES: 'FEATURES', BACK: 'BACK' });

const SUPPORTED_EDITION_PAGE_COUNTS = Object.freeze(
  Array.from({ length: 31 }, (_, index) => (index + 2) * 2),
);

function getSupportedEditionPageCounts() { return [...SUPPORTED_EDITION_PAGE_COUNTS]; }
function isSupportedEditionPageCount(value) { return SUPPORTED_EDITION_PAGE_COUNTS.includes(Number(value)); }

/**
 * The layout key for every page of an edition of `pageCount` pages.
 * Returns an array of { pageNumber, templateKey, why } in page order.
 */
function ladderFor(pageCount) {
  const total = Math.max(1, Math.min(64, Math.floor(Number(pageCount) || 1)));
  const rungs = [];

  // The features page: page three in a small paper, otherwise the page before
  // the back page - where an inside reader finds it in most Marathi dailies.
  const featuresPage = total >= 4 ? (total <= 5 ? 3 : total - 1) : null;
  // The editorial page only exists once there is room for it.
  const opinionPage = total >= 6 ? 4 : null;

  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    let templateKey; let role;
    let why;

    if (pageNumber === 1) {
      templateKey = 'front'; role = PAGE_ROLE.FRONT;
      why = 'Page one.';
    } else if (pageNumber === total && total > 1) {
      templateKey = 'dense'; role = PAGE_ROLE.BACK;
      why = 'The back page - display advertising and short items.';
    } else if (pageNumber === 2) {
      templateKey = 'local'; role = PAGE_ROLE.LOCAL;
      why = 'City and district news.';
    } else if (pageNumber === featuresPage) {
      templateKey = 'features'; role = PAGE_ROLE.FEATURES;
      why = 'The daily features page.';
    } else if (pageNumber === opinionPage) {
      templateKey = 'opinion'; role = PAGE_ROLE.OPINION;
      why = 'The editorial and opinion page.';
    } else {
      // General news. Alternating keeps consecutive inside pages from looking
      // like the same page printed twice.
      templateKey = pageNumber % 2 === 1 ? 'local' : 'dense'; role = PAGE_ROLE.GENERAL;
      why = 'General news.';
    }

    rungs.push({ pageNumber, role, templateKey, templateName: templates[templateKey]?.name || templateKey, why });
  }

  return rungs;
}

/** A one-line description of the ladder, for the desk to read before it commits. */
function describeLadder(pageCount) {
  return ladderFor(pageCount)
    .map((rung) => `${rung.pageNumber}. ${rung.templateName}`)
    .join('   ');
}

module.exports = { PAGE_ROLE, ladderFor, describeLadder, getSupportedEditionPageCounts, isSupportedEditionPageCount };
