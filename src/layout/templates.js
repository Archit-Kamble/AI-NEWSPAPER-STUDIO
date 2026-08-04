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
const MATTER_BOTTOM = G.marginYPx + G.matterHeightPx;

// Where content starts, snapped UP to the baseline.
//
// This matters more than it looks. The matter's bottom edge is a whole number
// of baselines from the top of the page, so if content starts on a baseline
// too, then the depth available to fill is also a whole number of baselines -
// and bands divide into it exactly. Starting four pixels off the grid instead
// left a remainder in every division, and the remainder came out as a fatter
// gap above the last band on the page. That is where the uneven spacing was
// coming from.
const up = (px) => Math.ceil(px / G.baselinePx) * G.baselinePx;
const MASTHEAD_BOTTOM = up(G.marginYPx + MASTHEAD_HEIGHT + 8);
const INSIDE_TOP = up(G.marginYPx + 40);

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

// The gap between blocks — ONE number, used on both axes.
//
// Horizontally the gap has always been right, because it is the column gutter
// and the grid enforces it. Vertically it was typed by hand into every
// template, and had drifted to seven different values: 8, 10, 11, 12, 13, 14
// and 16px, sometimes three of them on one page. A reader does not consciously
// measure the white between two stories, but an uneven one is why a page looks
// homemade - the eye reads inconsistent space as a mistake even when it cannot
// name it.
//
// It is a whole baseline, so the rhythm survives: every block still starts and
// ends on the same 4mm grid the text lines up to, and the gap is the same 4mm
// everywhere. Nothing below types a y-coordinate any more; `row()` computes it.
const GAP = G.baselinePx;

/**
 * Stacks bands down a page from a starting edge, with one gap between each.
 *
 * `rows(top, [h1, h2, ...])` returns `{ y, height, end }` per band, so a
 * template says how DEEP its bands are and never where they start. That is the
 * whole point: a hand-typed offset can be wrong by two pixels and nobody
 * notices for a year.
 *
 * `height` is the SNAPPED height and `end` is the real bottom edge - both
 * matter, because block() snaps a height down to the baseline and a template
 * that then measured from its own un-snapped number left a gap a few pixels
 * too wide. That was two of the seven gap sizes on its own.
 */
function rows(top, heights) {
  const out = [];
  let y = top;
  for (const declared of heights) {
    const height = baseline(declared);
    out.push({ y, height, end: y + height });
    y += height + GAP;
  }
  return out;
}

/**
 * Divides the depth from `top` to `bottom` into `count` bands with one gap
 * between each, filling it EXACTLY.
 *
 * The last band takes whatever the division left over, so the stack always
 * reaches the bottom edge. Handing every band the same rounded-down height
 * instead leaves a few pixels of slack at the foot, which shows up as a wider
 * gap above the last band - one of the three uneven gaps this replaced.
 */
function split(top, bottom, count) {
  const available = bottom - top - GAP * (count - 1);
  const each = baseline(available / count);
  const bands = [];
  let y = top;
  for (let index = 0; index < count; index += 1) {
    const height = index === count - 1 ? available - each * (count - 1) : each;
    bands.push({ y, height });
    y += height + GAP;
  }
  return bands;
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

// The bands of each page, top to bottom. A template declares how DEEP its
// bands are; `rows()` works out where they start, so the gap between them is
// the same everywhere and no y-coordinate is typed by hand.
const FRONT = rows(MASTHEAD_BOTTOM, [248, 264, 168, 172]);
const INSIDE_BOTTOM = MATTER_BOTTOM;

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
    sections: (() => {
      // The right-hand column runs from the top of band two to the foot of the
      // page, carrying the anchor over a display advert - so it ends level with
      // the four bands of news beside it rather than stopping short.
      const [anchor, advert] = split(FRONT[1].y, FRONT[3].end, 2);
      return [
        // Band one - the day's lead, flanked by pictures, with an advert ear.
        block('lead-pictures', 0, 2, FRONT[0].y, FRONT[0].height, { type: 'photo' }),
        block('lead', 2, 7, FRONT[0].y, FRONT[0].height, { headline: 'accent' }),
        block('lead-side', 9, 2, FRONT[0].y, FRONT[0].height, { type: 'photo' }),
        block('top-advert', 11, 5, FRONT[0].y, FRONT[0].height, { type: 'advert', border: 'box' }),

        // Band two - two heavy stories.
        block('second-lead', 0, 5, FRONT[1].y, FRONT[1].height, { headline: 'accent' }),
        block('third-lead', 5, 4, FRONT[1].y, FRONT[1].height),
        block('anchor', 9, 7, anchor.y, anchor.height),
        block('display-advert', 9, 7, advert.y, advert.height, { type: 'advert', border: 'box' }),

        // Band three - the day's reports.
        block('report-one', 0, 3, FRONT[2].y, FRONT[2].height),
        block('report-two', 3, 3, FRONT[2].y, FRONT[2].height),
        block('report-three', 6, 3, FRONT[2].y, FRONT[2].height),

        // Band four - short items along the foot.
        block('brief-one', 0, 3, FRONT[3].y, FRONT[3].height),
        block('brief-two', 3, 3, FRONT[3].y, FRONT[3].height),
        block('short-news', 6, 3, FRONT[3].y, FRONT[3].height, { type: 'briefs', border: 'box' }),
      ];
    })(),
  },

  local: {
    key: 'local',
    name: 'Local News',
    description: 'Full-width banner over three news columns and a footer strip.',
    sections: (() => {
      // The banner is a story, not a strapline: a wide headline over an intro
      // that carries the top of the page. At 170px it was too shallow to hold
      // both - the headline consumed it and the block's character budget came
      // out at zero.
      const band = rows(INSIDE_TOP, [225, 480]);
      const footer = band[1].end + GAP;
      // The right-hand pair fills the same depth as the columns beside it, so
      // all three end level.
      const [top, bottom] = split(band[1].y, band[1].end, 2);
      return [
        block('banner', 0, 16, band[0].y, band[0].height),
        block('left-column', 0, 6, band[1].y, band[1].height),
        block('centre-column', 6, 6, band[1].y, band[1].height),
        block('right-top', 12, 4, top.y, top.height),
        block('right-bottom', 12, 4, bottom.y, bottom.height),
        block('footer', 0, 16, footer, INSIDE_BOTTOM - footer),
      ];
    })(),
  },

  opinion: {
    key: 'opinion',
    name: 'Opinion',
    description: 'Leader across the top, three signed columns beneath.',
    sections: (() => {
      const band = rows(INSIDE_TOP, [270]);
      const columnsTop = band[0].end + GAP;
      return [
        block('editorial', 0, 16, band[0].y, band[0].height),
        block('opinion-one', 0, 6, columnsTop, INSIDE_BOTTOM - columnsTop),
        block('opinion-two', 6, 6, columnsTop, INSIDE_BOTTOM - columnsTop),
        block('opinion-three', 12, 4, columnsTop, INSIDE_BOTTOM - columnsTop),
      ];
    })(),
  },

  photo: {
    key: 'photo',
    name: 'Photo Feature',
    description: 'One dominant picture, two supporting pictures, a story below.',
    sections: (() => {
      const band = rows(INSIDE_TOP, [500]);
      const storyTop = band[0].end + GAP;
      // The two supporting pictures fill the dominant one's depth between them.
      const [top, bottom] = split(band[0].y, band[0].end, 2);
      return [
        block('photo-lead', 0, 10, band[0].y, band[0].height, { type: 'photo' }),
        block('photo-top', 10, 6, top.y, top.height, { type: 'photo' }),
        block('photo-bottom', 10, 6, bottom.y, bottom.height, { type: 'photo' }),
        block('caption-story', 0, 16, storyTop, INSIDE_BOTTOM - storyTop),
      ];
    })(),
  },

  // A real inside page carries far more than six items. This is the dense
  // layout an editor starts from when the day's file is many short reports -
  // sixteen blocks, all on the grid, all individually fillable.
  dense: {
    key: 'dense',
    name: 'Dense Inside Page',
    description: 'Sixteen blocks for a page of short local reports.',
    sections: (() => {
      const band = rows(INSIDE_TOP, [300, 180, 180, 120]);
      const foot = band[3].end + GAP;
      // The second-lead and the shoulder beside the anchor split its depth, so
      // the two halves of the top band end level. 90px was too shallow to be a
      // story slot at all - a headline filled it and no copy fitted.
      const [lead, shoulder] = split(band[0].y, band[0].end, 2);
      return [
        block('anchor', 0, 8, band[0].y, band[0].height),
        block('second-lead', 8, 8, lead.y, lead.height),
        block('shoulder', 8, 8, shoulder.y, shoulder.height),

        block('col-one-a', 0, 4, band[1].y, band[1].height),
        block('col-one-b', 0, 4, band[2].y, band[2].height),
        block('col-two-a', 4, 4, band[1].y, band[1].height),
        block('col-two-b', 4, 4, band[2].y, band[2].height),
        block('col-three-a', 8, 4, band[1].y, band[1].height),
        block('col-three-b', 8, 4, band[2].y, band[2].height),
        block('col-four-a', 12, 4, band[1].y, band[1].height),
        block('col-four-b', 12, 4, band[2].y, band[2].height),

        block('strip-left', 0, 6, band[3].y, band[3].height),
        block('strip-centre', 6, 6, band[3].y, band[3].height),
        block('strip-right', 12, 4, band[3].y, band[3].height),

        block('foot-left', 0, 8, foot, INSIDE_BOTTOM - foot),
        block('foot-right', 8, 8, foot, INSIDE_BOTTOM - foot),
      ];
    })(),
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
    sections: (() => {
      const right = rows(INSIDE_TOP, [200, 120, 296]);
      const bottom = right[2].end + GAP;
      // The horoscope runs the full depth of the three boxes beside it.
      const rashiDepth = bottom - GAP - INSIDE_TOP;
      return [
        block('rashi', 0, 8, INSIDE_TOP, rashiDepth, { type: 'feature', border: 'box', feature: 'rashi' }),
        block('panchang', 8, 4, right[0].y, right[0].height, { type: 'feature', border: 'box', feature: 'panchang' }),
        block('dinvishesh', 12, 4, right[0].y, right[0].height, { type: 'feature', border: 'box', feature: 'dinvishesh' }),
        block('suvichar', 8, 8, right[1].y, right[1].height, { type: 'feature', border: 'box', feature: 'suvichar' }),
        block('feature-one', 8, 8, right[2].y, right[2].height, { headline: 'accent' }),

        block('feature-two', 0, 4, bottom, INSIDE_BOTTOM - bottom),
        block('feature-three', 4, 4, bottom, INSIDE_BOTTOM - bottom),
        block('feature-advert', 8, 8, bottom, INSIDE_BOTTOM - bottom, { type: 'advert', border: 'box' }),
      ];
    })(),
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
