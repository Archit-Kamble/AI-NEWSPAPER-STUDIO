// The only catalog of page layouts. Served to the client over GET /api/templates;
// never re-typed in frontend JS (see CLAUDE.md on the template-drift incident).
//
// Every block is now expressed as a span on the column grid rather than as a
// freehand rectangle. That is the difference between a page that merely fills
// its area and one that reads like a national daily: text lines up across
// columns because every block starts and ends on the same vertical rules.
//
// Grid: 16 columns across the 310 mm matter with 3 mm gutters, and a 4 mm
// baseline. Sixteen rather than eight so a block can be placed in half-column
// steps; a story still spans several of them, the way a printed column does. All of it derives from geometry.js - the numbers are computed here,
// never typed twice.

const { geometryOf, DEFAULTS } = require('./geometry');

const G = geometryOf({});

const PAGE_WIDTH = G.pageWidthPx;
const PAGE_HEIGHT = G.pageHeightPx;

// Vertical anchors, in editor px.
//
// Page one is not laid out from the top of the matter: the nameplate band sits
// there, and it is page furniture rather than an editorial block - the canvas
// draws it from the edition's own date and src/layout/identity.js. Making it a
// block would invite an editor to type a story into the masthead. Content
// therefore starts below it. Inside pages carry a slim folio, drawn the same
// way, so they start only a little lower than the matter's top edge.
const MASTHEAD_HEIGHT = 136;
const MASTHEAD_BOTTOM = G.marginYPx + MASTHEAD_HEIGHT + 8;
const INSIDE_TOP = G.marginYPx + 40;
const MATTER_BOTTOM = G.marginYPx + G.matterHeightPx;

// x of a block starting at column `col`, and the width of a block spanning
// `span` columns. Rounding happens once, at the edge, so a full-width span is
// always exactly the matter width.
function colX(col) {
  return Math.round(G.marginXPx + col * (G.columnPx + G.gutterPx));
}
// Width is measured to the right edge of the last column spanned, not summed
// from column widths - summing lets rounding accumulate and pushes a full-width
// block one pixel past the matter.
function colW(col, span) {
  const rightEdge = Math.round(G.marginXPx + (col + span - 1) * (G.columnPx + G.gutterPx) + G.columnPx);
  return rightEdge - colX(col);
}
// Heights snap down to the baseline so text rows align between neighbouring
// blocks and a block never grows past the space the layout allotted it.
function baseline(px) {
  return Math.max(G.baselinePx, Math.floor(px / G.baselinePx) * G.baselinePx);
}

// A block: which column it starts at, how many columns it spans, its top edge
// and its height. `options` carries the few things a layout genuinely decides
// about a block rather than leaving to the desk - what kind of block it is (an
// advert slot is not an article), and whether it is boxed or ruled off. They
// are written onto the section when the page is created, so a page comes out of
// the template already looking like a page.
function block(key, col, span, y, height, options = {}) {
  const top = Math.round(y);
  const maxHeight = MATTER_BOTTOM - top;
  return {
    key,
    x: colX(col),
    y: top,
    width: colW(col, span),
    height: baseline(Math.min(height, maxHeight)),
    blockType: options.type || 'article',
    borderStyle: options.border || 'none',
    headlineStyle: options.headline || 'plain',
    // A standing daily feature: the software fills this block for the
    // edition's date rather than a reporter filing into it.
    featureKey: options.feature || null,
  };
}

const templates = {
  // Page one, laid out the way a Marathi broadsheet daily lays out page one:
  // a lead package across the top under the nameplate with its own picture
  // strip, two heavy stories in the second band, a display advertisement
  // holding the bottom-right quadrant, and the rest of the day's file worked
  // into three- and four-column reports and briefs beneath. Fourteen items,
  // every one on the column grid.
  front: {
    key: 'front',
    name: 'Front Page',
    description: 'Nameplate band, a lead package with its picture strip, a display advert and eleven reports.',
    sections: [
      // Band one - the day's lead, flanked by pictures, with an advert ear.
      block('lead-pictures', 0, 2, MASTHEAD_BOTTOM, 248, { type: 'photo' }),
      block('lead', 2, 7, MASTHEAD_BOTTOM, 248, { headline: 'accent' }),
      block('lead-side', 9, 2, MASTHEAD_BOTTOM, 248, { type: 'photo' }),
      block('top-advert', 11, 5, MASTHEAD_BOTTOM, 248, { type: 'advert', border: 'box' }),

      // Band two - two heavy stories, and the right-hand column above the
      // display advert.
      block('second-lead', 0, 5, MASTHEAD_BOTTOM + 256, 264, { headline: 'accent' }),
      block('third-lead', 5, 4, MASTHEAD_BOTTOM + 256, 264),
      block('anchor', 9, 7, MASTHEAD_BOTTOM + 256, 128),
      block('display-advert', 9, 7, MASTHEAD_BOTTOM + 392, 500, { type: 'advert', border: 'box' }),

      // Band three - the day's reports.
      block('report-one', 0, 3, MASTHEAD_BOTTOM + 528, 168),
      block('report-two', 3, 3, MASTHEAD_BOTTOM + 528, 168),
      block('report-three', 6, 3, MASTHEAD_BOTTOM + 528, 168),

      // Band four - short items along the foot.
      block('brief-one', 0, 3, MASTHEAD_BOTTOM + 704, 172),
      block('brief-two', 3, 3, MASTHEAD_BOTTOM + 704, 172),
      block('short-news', 6, 3, MASTHEAD_BOTTOM + 704, 172, { type: 'briefs', border: 'box' }),
    ],
  },

  local: {
    key: 'local',
    name: 'Local News',
    description: 'Full-width banner over three news columns and a footer strip.',
    sections: [
      // The banner is a story, not a strapline: a wide headline over an intro
      // that carries the top of the page. At 170px it was too shallow to hold
      // both - the headline consumed it and the block's character budget came
      // out at zero. It gets the depth an intro needs, and the columns below
      // move down to meet it.
      block('banner', 0, 16, INSIDE_TOP, 225),
      block('left-column', 0, 6, INSIDE_TOP + 235, 480),
      block('centre-column', 6, 6, INSIDE_TOP + 235, 480),
      block('right-top', 12, 4, INSIDE_TOP + 235, 235),
      block('right-bottom', 12, 4, INSIDE_TOP + 480, 235),
      block('footer', 0, 16, INSIDE_TOP + 725, 235),
    ],
  },

  opinion: {
    key: 'opinion',
    name: 'Opinion',
    description: 'Leader across the top, three signed columns beneath.',
    sections: [
      block('editorial', 0, 16, INSIDE_TOP, 270),
      block('opinion-one', 0, 6, INSIDE_TOP + 280, 645),
      block('opinion-two', 6, 6, INSIDE_TOP + 280, 645),
      block('opinion-three', 12, 4, INSIDE_TOP + 280, 645),
    ],
  },

  photo: {
    key: 'photo',
    name: 'Photo Feature',
    description: 'One dominant picture, two supporting pictures, a story below.',
    sections: [
      block('photo-lead', 0, 10, INSIDE_TOP, 500),
      block('photo-top', 10, 6, INSIDE_TOP, 240),
      block('photo-bottom', 10, 6, INSIDE_TOP + 250, 250),
      block('caption-story', 0, 16, INSIDE_TOP + 510, 415),
    ],
  },

  // A real inside page carries far more than six items. This is the dense
  // layout an editor starts from when the day's file is many short reports -
  // sixteen blocks, all on the grid, all individually fillable.
  dense: {
    key: 'dense',
    name: 'Dense Inside Page',
    description: 'Sixteen blocks for a page of short local reports.',
    sections: [
      block('anchor', 0, 8, INSIDE_TOP, 300),
      block('second-lead', 8, 8, INSIDE_TOP, 180),
      // 90px was too shallow to be a story slot at all: a headline filled it
      // and the block held no copy. The pair still adds up to the anchor's
      // depth beside it, so the page still lines up across the grid.
      block('shoulder', 8, 8, INSIDE_TOP + 190, 110),
      block('col-one-a', 0, 4, INSIDE_TOP + 310, 180),
      block('col-one-b', 0, 4, INSIDE_TOP + 500, 180),
      block('col-two-a', 4, 4, INSIDE_TOP + 310, 180),
      block('col-two-b', 4, 4, INSIDE_TOP + 500, 180),
      block('col-three-a', 8, 4, INSIDE_TOP + 310, 180),
      block('col-three-b', 8, 4, INSIDE_TOP + 500, 180),
      block('col-four-a', 12, 4, INSIDE_TOP + 310, 180),
      block('col-four-b', 12, 4, INSIDE_TOP + 500, 180),
      block('strip-left', 0, 6, INSIDE_TOP + 690, 120),
      block('strip-centre', 6, 6, INSIDE_TOP + 690, 120),
      block('strip-right', 12, 4, INSIDE_TOP + 690, 120),
      block('foot-left', 0, 8, INSIDE_TOP + 820, 105),
      block('foot-right', 8, 8, INSIDE_TOP + 820, 105),
    ],
  },

  // The features page. Every Marathi daily runs one: राशिभविष्य, the almanac
  // box, दिनविशेष, a thought for the day, and whatever short copy fills round
  // them. Not one word of it needs a reporter - which is the point. The blocks
  // marked with a feature are filled for the edition's date by
  // src/features/, and remain fully editable afterwards.
  features: {
    key: 'features',
    name: 'Daily Features',
    description: 'राशिभविष्य, the almanac box, दिनविशेष and a thought for the day.',
    sections: [
      block('rashi', 0, 8, INSIDE_TOP, 640, { type: 'feature', border: 'box', feature: 'rashi' }),
      block('panchang', 8, 4, INSIDE_TOP, 200, { type: 'feature', border: 'box', feature: 'panchang' }),
      block('dinvishesh', 12, 4, INSIDE_TOP, 200, { type: 'feature', border: 'box', feature: 'dinvishesh' }),
      block('suvichar', 8, 8, INSIDE_TOP + 210, 120, { type: 'feature', border: 'box', feature: 'suvichar' }),
      block('feature-one', 8, 8, INSIDE_TOP + 340, 300, { headline: 'accent' }),
      block('feature-advert', 8, 8, INSIDE_TOP + 650, 275, { type: 'advert', border: 'box' }),
      block('feature-two', 0, 4, INSIDE_TOP + 650, 275),
      block('feature-three', 4, 4, INSIDE_TOP + 650, 275),
    ],
  },
};

function getTemplate(templateKey) {
  return templates[templateKey] || templates.front;
}

module.exports = {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  GRID_COLUMNS: DEFAULTS.gridColumns,
  getTemplate,
  templates,
  colX,
  colW,
  baseline,
};
