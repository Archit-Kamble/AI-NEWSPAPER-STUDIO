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

const { geometryOf, DEFAULTS, regionsFor, regionForPage } = require('./geometry');

const G = geometryOf({});

const PAGE_WIDTH = G.pageWidthPx;
const PAGE_HEIGHT = G.pageHeightPx;

// Vertical anchors, in editor px - all derived from the one page-region model
// (geometry.js's regionsFor). Page one is not laid out from the top of the
// matter: the nameplate band sits there, and it is page furniture rather than
// an editorial block - the canvas draws it from the edition's own date and
// src/layout/identity.js. Making it a block would invite an editor to type a
// story into the masthead. Content therefore starts below it. Inside pages
// carry a slim folio, drawn the same way, so they start only a little lower
// than the matter's top edge. And EVERY page's content stops short of the
// matter's true bottom edge, leaving room for the footer band (the printline
// strip, and on the imprint page the Act declaration) that masthead.js draws
// there - see geometry.js's own comment on why that reservation used to be
// missing (Bug #7/#8/#9).
const FRONT_REGIONS = regionsFor(G, 'front');
const INSIDE_REGIONS = regionsFor(G, 'inside');
const MATTER_BOTTOM = G.marginYPx + G.matterHeightPx;
const MASTHEAD_BOTTOM = FRONT_REGIONS.content.top;
const INSIDE_TOP = INSIDE_REGIONS.content.top;
const INSIDE_BOTTOM = INSIDE_REGIONS.content.bottom;

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
  const blockType = options.type || 'article';
  // Physical slots and editorial meaning are deliberately different axes.
  // Every built-in frame declares an explicit recommendation below. A custom
  // frame starts as an ordinary story until the desk/composition system gives
  // it a semantic identity; this file does not maintain a second policy map.
  const storyType = options.story || 'STANDARD';
  const priority = Number.isInteger(options.priority)
    ? Math.min(5, Math.max(1, options.priority))
    : 3;
  // Publication ownership is a different axis from both physical block kind
  // and the semantic recommendation for the story that may occupy it.  The
  // safe defaults cover only unambiguous prose and sold-space primitives;
  // feature/photo frames must declare their purpose because either physical
  // kind can represent several very different responsibilities.
  const framePurpose = options.purpose
    || (['article', 'briefs'].includes(blockType) ? 'EDITORIAL_STORY' : null)
    || (blockType === 'advert' ? 'ADVERT' : null);
  const publicationRequirement = options.requirement
    || (framePurpose === 'EDITORIAL_STORY' ? 'REQUIRED_CONTENT' : null)
    || (framePurpose === 'ADVERT' ? 'EXTERNALLY_SUPPLIED' : null);
  return {
    key,
    x: colX(col),
    y: top,
    width: colW(col, span),
    height: baseline(Math.min(height, maxHeight)),
    blockType,
    storyType,
    editorialPriority: priority,
    // A block prints no box unless a person asked for one.
    //
    // Adverts, briefs and the standing features used to ship `border: 'box'`
    // from here, so a made-up page came out of the press view ruled into
    // panels nobody had chosen - and there was no control anywhere in the
    // product to turn one off. The box is now the desk's own decision, taken
    // per block in the Block Editor's Properties panel; the template's job is
    // to say where a frame is and what it is for, not how it is ruled.
    borderStyle: options.border || 'none',
    headlineStyle: options.headline || 'plain',
    // A standing daily feature: the software fills this block for the
    // edition's date rather than a reporter filing into it.
    featureKey: options.feature || null,
    framePurpose,
    publicationRequirement,
    packageOwnerKey: options.packageOwner || null,
    utilityKey: options.utility || null,
    advertPolicy: options.advertPolicy || (framePurpose === 'ADVERT' ? 'REQUIRED_EXTERNAL' : null),
  };
}

// A LAYOUT MEASURED OFF A PRINTED PAGE KEEPS THAT PAGE'S OWN COLUMN GRID.
//
// The reference broadsheet is seven columns with a 4.5 mm gutter - measured off
// the scan: 349 px columns and 38 px gutters across a 2678 px matter, which at
// this page's scale is 81 px and 9 px. No span of the default 16 columns lands
// on it (the nearest are out by up to 20 px, and a column 20 px short sets a
// different line on every line). A newspaper already carries its own grid
// (`newspapers.grid_columns`, `grid_gutter_mm`) and geometry.js already derives
// every snap point from it, so the template simply declares the grid it was
// measured on and places blocks on THAT grid's own snap points.
const REFERENCE_GRID = Object.freeze({ columns: 7, gutterMm: 4.5 });
const REF_GEOMETRY = geometryOf({ grid_columns: REFERENCE_GRID.columns, grid_gutter_mm: REFERENCE_GRID.gutterMm });
function frame(key, col, span, y, height, options = {}) {
  const x = REF_GEOMETRY.snapLeftPx[col];
  return { ...block(key, 0, 1, y, height, options), x, width: REF_GEOMETRY.snapRightPx[col + span - 1] - x };
}

// Baseline-snap a raw pixel value upward. Used only for the masthead advert's
// own corner, which sits inside the header band rather than the content
// region the region model governs.
const up = (px) => Math.ceil(px / G.baselinePx) * G.baselinePx;

// The bands of each page, top to bottom. A template declares how DEEP its
// bands are; `rows()` works out where they start, so the gap between them is
// the same everywhere and no y-coordinate is typed by hand. The first three
// are hand-tuned depths; the fourth takes whatever is left down to the content
// region's real bottom edge (above the reserved footer band), the same
// last-band-absorbs-the-remainder idiom `split()` uses elsewhere - not a
// fourth hand-typed number that has to be re-tuned by hand every time the
// footer reservation changes.
const FRONT = rows(MASTHEAD_BOTTOM, [248, 264, 168]);
FRONT.push({
  y: FRONT[2].end + GAP,
  height: baseline(FRONT_REGIONS.content.bottom - (FRONT[2].end + GAP)),
  end: FRONT_REGIONS.content.bottom,
});

// The top-left corner of page one is sold.
//
// In the printed paper an advertisement sits beside the nameplate, and it is
// not furniture - it is bought space, it is priced by the column-centimetre
// like any other advert, and a desk has to be able to put artwork in it. So it
// is a BLOCK, in the masthead band, and the nameplate is drawn beside it.
// Its top is snapped to the baseline like everything else, and its foot sits
// one gap above the first band - so the sold corner keeps the page's rhythm
// rather than being the one thing on page one that ignores it.
const MASTHEAD_ADVERT = {
  col: 0,
  span: 4,
  y: up(G.marginYPx),
  // The sold corner ends at the editorial boundary; it must not extend into
  // the compact four-pixel masthead-to-news gutter.
  height: FRONT_REGIONS.content.top - GAP - up(G.marginYPx),
};

// PAGES MEASURED EXACTLY OFF A SCAN - measured-pages/. Their blocks are the
// scan's own rectangles scaled onto this page, not spans of a column grid, so
// the frame is block()'s with the measured x, width and height put back.
const { buildMeasuredPage } = require('./measured-pages/scan');
const MEASURED_PAGES = Object.fromEntries(['broadsheet-front', 'broadsheet-city', 'broadsheet-state']
  .map((key) => [key, buildMeasuredPage(require(`./measured-pages/${key}`))]));
function measuredTemplate(key) {
  const { template } = MEASURED_PAGES[key];
  return {
    key: template.key,
    name: template.name,
    description: template.description,
    measured: true,
    sections: template.sections.map(({ key: sectionKey, x, y, width, height, options }) => ({
      ...block(sectionKey, 0, 1, y, height, options), x, y, width, height,
    })),
  };
}

const templates = {
  // Page one, laid out the way a Marathi broadsheet daily lays out page one:
  // a lead package across the top under the nameplate with its own picture
  // strip, two heavy stories in the second band, a display advertisement
  // holding the bottom-right quadrant, and the rest of the day's file worked
  // into three- and four-column reports and briefs beneath. Every item on the
  // column grid.
  //
  // A TEMPLATE SAYS WHERE A FRAME IS AND WHAT IT IS FOR. It used to also say
  // that page one carries the thought for the day, the anniversary and the
  // almanac, and page two the horoscope - four standing cards on every edition
  // this software has ever made, whether or not the desk wanted them that
  // morning. The desk's report was exactly that: take the ready-made card
  // boxes out and let an editor add one when they want it.
  //
  // They are not lost, and there was never a third thing to build: the Cards
  // tab creates the block a card asks for at the size the catalogue gives it,
  // and Properties -> Standing feature turns any block on the page into one
  // and fills it for the edition's date. What went is the reservation, not the
  // card - and the room it freed is news. Page one gains a three-column
  // report beside the lead package and a lead that runs the full band; page
  // two gains two city stories where the horoscope's leg was.
  front: {
    key: 'front',
    name: 'Front Page',
    description: 'Nameplate band, a lead package, the daily service strip, adverts and reports.',
    sections: (() => {
      // These stacks reproduce the desk-approved page exactly. Because every
      // next row is derived from the previous row's foot, all vertical spaces
      // remain the same one-baseline gap used by the column grid.
      const [storyRow, reportRow, footRow] = rows(FRONT[1].y, [264, 176, 152]);
      const [anchorRow, topAdvertRow, displayAdvertRow] = rows(FRONT[1].y, [296, 144, 152]);
      return [
        // The sold corner of page one, beside the nameplate.
        block('masthead-advert', MASTHEAD_ADVERT.col, MASTHEAD_ADVERT.span,
          MASTHEAD_ADVERT.y, MASTHEAD_ADVERT.height,
          { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),

        // Band one - the lead package, across the whole measure.
        block('lead-pictures', 0, 4, FRONT[0].y, FRONT[0].height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 4, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT', packageOwner: 'lead' }),
        block('lead', 4, 5, FRONT[0].y, FRONT[0].height,
          { story: 'LEAD', priority: 5, headline: 'accent' }),
        block('lead-side', 9, 4, FRONT[0].y, FRONT[0].height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 3, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT', packageOwner: 'lead' }),
        block('front-column', 13, 3, FRONT[0].y, FRONT[0].height,
          { story: 'STANDARD', priority: 3 }),

        // Band two - two heavy stories.
        block('second-lead', 0, 5, storyRow.y, storyRow.height,
          { story: 'SECONDARY', priority: 4, headline: 'accent' }),
        block('third-lead', 5, 4, storyRow.y, storyRow.height,
          { story: 'SECONDARY', priority: 4 }),
        block('anchor', 9, 7, anchorRow.y, anchorRow.height,
          { story: 'SECONDARY', priority: 4 }),
        block('top-advert', 9, 7, topAdvertRow.y, topAdvertRow.height,
          { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
        block('display-advert', 10, 6, displayAdvertRow.y, displayAdvertRow.height,
          { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),

        // Band three - the day's reports.
        block('report-one', 0, 3, reportRow.y, reportRow.height, { story: 'STANDARD', priority: 3 }),
        block('report-two', 3, 3, reportRow.y, reportRow.height, { story: 'STANDARD', priority: 3 }),
        block('report-three', 6, 3, reportRow.y, reportRow.height, { story: 'STANDARD', priority: 3 }),

        // Band four - short items along the foot.
        block('brief-one', 0, 5, footRow.y, footRow.height, { story: 'BRIEF', priority: 2 }),
        block('brief-two', 5, 5, footRow.y, footRow.height, { story: 'BRIEF', priority: 2 }),
      ];
    })(),
  },

  local: {
    key: 'local',
    name: 'Local News',
    description: 'Full-width banner over a half-page horoscope and four city-news blocks.',
    sections: (() => {
      // The banner is a story, not a strapline: a wide headline over an intro
      // that carries the top of the page. At 170px it was too shallow to hold
      // both - the headline consumed it and the block's character budget came
      // out at zero.
      const band = rows(INSIDE_TOP, [225]);
      const lowerTop = band[0].end + GAP;
      const [top, middle, bottom] = split(lowerTop, INSIDE_BOTTOM, 3);
      // The left half used to be the horoscope's whole leg with a brief under
      // it. It is two city stories now - the same depth, carrying news.
      const [cityTop, cityBottom] = split(lowerTop, INSIDE_BOTTOM, 2);
      return [
        block('banner', 0, 16, band[0].y, band[0].height, { story: 'LEAD', priority: 5 }),
        block('city-lead', 0, 8, cityTop.y, cityTop.height, { story: 'SECONDARY', priority: 4 }),
        block('city-two', 0, 8, cityBottom.y, cityBottom.height, { story: 'STANDARD', priority: 3 }),
        block('right-top', 8, 8, top.y, top.height, { story: 'ANALYSIS', priority: 4 }),
        block('right-middle-left', 8, 4, middle.y, middle.height, { story: 'BRIEF', priority: 2 }),
        block('right-middle-right', 12, 4, middle.y, middle.height, { story: 'BRIEF', priority: 2 }),
        block('right-bottom', 8, 8, bottom.y, bottom.height, { story: 'STANDARD', priority: 3 }),
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
        block('editorial', 0, 16, band[0].y, band[0].height, { story: 'OPINION', priority: 4 }),
        block('opinion-one', 0, 6, columnsTop, INSIDE_BOTTOM - columnsTop, { story: 'OPINION', priority: 3 }),
        block('opinion-two', 6, 6, columnsTop, INSIDE_BOTTOM - columnsTop, { story: 'OPINION', priority: 3 }),
        block('opinion-three', 12, 4, columnsTop, INSIDE_BOTTOM - columnsTop, { story: 'OPINION', priority: 3 }),
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
        block('photo-lead', 0, 10, band[0].y, band[0].height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 5, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT', packageOwner: 'caption-story' }),
        block('photo-top', 10, 6, top.y, top.height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 3, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT', packageOwner: 'caption-story' }),
        block('photo-bottom', 10, 6, bottom.y, bottom.height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 3, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT', packageOwner: 'caption-story' }),
        block('caption-story', 0, 16, storyTop, INSIDE_BOTTOM - storyTop,
          { story: 'PHOTO_FEATURE', priority: 4 }),
      ];
    })(),
  },

  // A real inside page carries far more than six items. This is the dense
  // layout an editor starts from when the day's file is many short reports,
  // all on the grid and individually fillable.
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
        block('anchor', 0, 8, band[0].y, band[0].height, { story: 'LEAD', priority: 5 }),
        block('second-lead', 8, 8, lead.y, lead.height, { story: 'SECONDARY', priority: 4 }),
        block('shoulder', 8, 8, shoulder.y, shoulder.height, { story: 'STANDARD', priority: 3 }),

        block('col-one-a', 0, 4, band[1].y, band[1].height, { story: 'BRIEF', priority: 2 }),
        block('col-one-b', 0, 4, band[2].y, band[2].height, { story: 'BRIEF', priority: 2 }),
        block('col-two-a', 4, 4, band[1].y, band[1].height, { story: 'BRIEF', priority: 2 }),
        block('col-two-b', 4, 4, band[2].y, band[2].height, { story: 'BRIEF', priority: 2 }),
        block('col-three-b', 8, 8, band[1].y, band[2].end - band[1].y, { story: 'BRIEF', priority: 2 }),

        block('strip-left', 0, 6, band[3].y, band[3].height, { story: 'SIDEBAR', priority: 2 }),
        block('strip-centre', 6, 6, band[3].y, band[3].height, { story: 'SIDEBAR', priority: 2 }),
        block('strip-right', 12, 4, band[3].y, band[3].height, { story: 'SIDEBAR', priority: 2 }),

        block('foot-left', 0, 8, foot, INSIDE_BOTTOM - foot, { story: 'ANALYSIS', priority: 3 }),
        block('foot-right', 8, 8, foot, INSIDE_BOTTOM - foot, { story: 'STANDARD', priority: 3 }),
      ];
    })(),
  },

  // NO TEMPLATE SHIPS A STANDING CARD ANY MORE, and this page is where that
  // rule was hardest to give up: it existed to hold the Sudoku at a size
  // somebody could actually solve. But a frame reserved for a card the desk
  // did not ask for is a frame the desk has to empty before it can use it,
  // and this page then printed a puzzle on a day nobody wanted one.
  //
  // Every card has two doors of its own and neither of them is a template: the
  // Cards tab BRINGS ITS OWN BLOCK at the size the catalogue says that card
  // wants (layout.js's SMART_CARD_BLOCK_SIZE - the Sudoku's is square,
  // because the puzzle is), and Properties -> Standing feature turns any block
  // into one and fills it. So the cards did not lose a way in; they lost a
  // frame that was there whether or not they were wanted.
  // MEASURED FROM A REFERENCE BROADSHEET, not designed here. The desk supplied
  // a printed Marathi daily's own page as a 300 ppi scan and asked for its
  // layout to be carried across with only the words changed. Every rectangle
  // below was read off that scan, scaled into this page (x by 0.646, y by
  // 0.626) and then snapped onto the 16-column grid - so the frames sit where
  // the reference's do, to within one grid step, and the gutters are this
  // page's own rather than the scan's.
  //
  // Keys are neutral on purpose. The layout is borrowed; another paper's name
  // is not something this product may print in its own layout picker.
  //
  // No `masthead-advert`: the reference's front page sells no ear, so the
  // nameplate takes the whole measure - which is also the desk's own request
  // for a nameplate set as large as the reference's.
  //
  // The styles each frame wears (faces, locked sizes, grounds, rules, panels)
  // are not a template's business. They live in design-recipes.js beside this
  // file and are applied to a page's blocks, like any desk decision.
  'broadsheet-front': measuredTemplate('broadsheet-front'),

  'broadsheet-sport': {
    key: 'broadsheet-sport',
    name: 'Broadsheet sport (reference)',
    grid: REFERENCE_GRID,
    description: 'A one-column rail of five items, a four-column picture lead, a two-column second story, two reports, a separator-led feature and a ruled team box.',
    // MEASURED EXACTLY, not snapped to the 16 columns: the reference's seven
    // columns at this page's scale (81 px, 9 px gutters), every block edge read
    // off the scan, tops on the baseline and closed to the one 8 px gap.
    // Generated from the reference spec, so the numbers are literals on purpose.
    sections: [
      frame('rail-today', 0, 1, 56, 72, { type: 'briefs', story: 'BRIEF', priority: 2 }),
      frame('rail-update', 0, 1, 136, 216, { type: 'briefs', story: 'BRIEF', priority: 2 }),
      frame('rail-three', 0, 1, 360, 208, { story: 'BRIEF', priority: 2 }),
      frame('rail-four', 0, 1, 576, 224, { story: 'BRIEF', priority: 2 }),
      frame('rail-five', 0, 1, 808, 200, { story: 'BRIEF', priority: 2 }),
      frame('lead', 1, 4, 56, 464, { story: 'LEAD', priority: 5 }),
      frame('second', 5, 2, 56, 464, { story: 'SECONDARY', priority: 4 }),
      frame('report-left', 1, 2, 528, 272, { story: 'STANDARD', priority: 3 }),
      frame('report-right', 3, 4, 528, 272, { story: 'SECONDARY', priority: 4 }),
      frame('feature-strip', 1, 4, 808, 200, { story: 'ANALYSIS', priority: 3 }),
      frame('squad-box', 5, 2, 808, 200, { story: 'SIDEBAR', priority: 2 }),
    ],
  },

  // THE REST OF THE REFERENCE PAPER, measured the same way as the two above:
  // each rectangle read off the scan, scaled into this page and snapped onto the
  // 16-column grid and the 8 px baseline, with every vertical gap closed to the
  // one GAP. Rows are literal numbers here rather than rows() stacks because
  // they are MEASUREMENTS - a stack would re-derive positions the reference
  // already decided.
  'broadsheet-jacket': {
    key: 'broadsheet-jacket',
    name: 'Broadsheet jacket (reference)',
    grid: REFERENCE_GRID,
    description: 'A page wrapped in adverts: a rail advert, a lead with a numbered panel, a shorts rail, two stacked display adverts, a tall advert and a weather column.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('rail-advert', 0, 1, 56, 280, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('top-brief', 1, 2, 56, 88, { story: 'BRIEF', priority: 3 }),
      frame('lead', 1, 2, 152, 432, { story: 'LEAD', priority: 5 }),
      frame('rail-shorts', 0, 1, 344, 240, { type: 'briefs', story: 'BRIEF', priority: 2 }),
      frame('advert-top', 3, 4, 56, 472, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('advert-foot', 3, 4, 536, 472, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('advert-left', 0, 2, 592, 416, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('weather-column', 2, 1, 592, 416, { story: 'BRIEF', priority: 2 }),
    ],
  },

  'broadsheet-city': measuredTemplate('broadsheet-city'),

  'broadsheet-state': measuredTemplate('broadsheet-state'),

  'broadsheet-local': {
    key: 'broadsheet-local',
    name: 'Broadsheet local (reference)',
    grid: REFERENCE_GRID,
    description: 'A narrow column, a three-column picture lead with sidebars, a short story beside a corner advert, a wide report, a report with a tinted box, a photo story, a half-page advert and a separator-led feature.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('left-column', 0, 1, 56, 336, { story: 'STANDARD', priority: 3 }),
      frame('lead', 1, 3, 56, 336, { story: 'LEAD', priority: 5 }),
      frame('short-story', 4, 1, 56, 152, { story: 'BRIEF', priority: 2 }),
      frame('corner-advert', 5, 2, 56, 152, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('wide-report', 4, 3, 216, 176, { story: 'SECONDARY', priority: 4 }),
      frame('report-panel', 0, 4, 400, 200, { story: 'SECONDARY', priority: 4 }),
      frame('photo-story', 0, 2, 608, 152, { story: 'PHOTO_FEATURE', priority: 3 }),
      frame('report-small', 2, 2, 608, 152, { story: 'STANDARD', priority: 3 }),
      frame('half-advert', 4, 3, 400, 608, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('feature-strip', 0, 4, 768, 240, { story: 'ANALYSIS', priority: 3 }),
    ],
  },

  'broadsheet-opinion': {
    key: 'broadsheet-opinion',
    name: 'Broadsheet opinion (reference)',
    grid: REFERENCE_GRID,
    description: 'The editorial column, two signed articles across the measure, a column, a commentary and a cartoon.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('editorial', 0, 2, 56, 520, { story: 'OPINION', priority: 5 }),
      frame('opinion-lead', 2, 5, 56, 280, { story: 'OPINION', priority: 4 }),
      frame('opinion-two', 2, 5, 344, 232, { story: 'OPINION', priority: 4 }),
      frame('column', 0, 5, 584, 184, { story: 'ANALYSIS', priority: 3 }),
      frame('commentary', 5, 2, 584, 256, { story: 'OPINION', priority: 3 }),
      frame('opinion-three', 0, 5, 776, 232, { story: 'OPINION', priority: 3 }),
      frame('cartoon', 5, 2, 848, 160, { story: 'PHOTO_FEATURE', priority: 2 }),
    ],
  },

  'broadsheet-advertorial': {
    key: 'broadsheet-advertorial',
    name: 'Broadsheet advertorial (reference)',
    grid: REFERENCE_GRID,
    description: 'A whole page sold as one advertisement.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('page-advert', 0, 7, 56, 952, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
    ],
  },

  'broadsheet-local-sport': {
    key: 'broadsheet-local-sport',
    name: 'Broadsheet local sport and notices (reference)',
    grid: REFERENCE_GRID,
    description: 'Three sport stories over a column of public notices, a sport report, a scorecard rail and a result box.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('sport-left', 0, 2, 56, 272, { story: 'STANDARD', priority: 3 }),
      frame('sport-lead', 2, 3, 56, 320, { story: 'LEAD', priority: 5 }),
      frame('sport-right', 5, 2, 56, 320, { story: 'SECONDARY', priority: 4 }),
      frame('notice-left', 0, 2, 336, 464, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('notice-mid', 2, 2, 384, 416, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('sport-report', 4, 2, 384, 168, { story: 'STANDARD', priority: 3 }),
      frame('scorecard', 6, 1, 384, 168, { type: 'briefs', story: 'BRIEF', priority: 2 }),
      frame('notice-right', 4, 2, 560, 240, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('sport-brief', 6, 1, 560, 280, { story: 'BRIEF', priority: 2 }),
      frame('notice-foot', 0, 4, 808, 200, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('notice-foot-right', 4, 2, 808, 200, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('result-box', 6, 1, 848, 160, { type: 'briefs', story: 'BRIEF', priority: 2 }),
    ],
  },

  'broadsheet-miscellany': {
    key: 'broadsheet-miscellany',
    name: 'Broadsheet miscellany (reference)',
    grid: REFERENCE_GRID,
    description: 'A ruled profile feature, a national lead with sidebars, a world brief, cabinet and court reports, recruitment adverts, a strip advert, a world report and a separator-led feature.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('profile-feature', 0, 3, 56, 504, { story: 'PHOTO_FEATURE', priority: 4 }),
      frame('lead', 3, 2, 56, 200, { story: 'LEAD', priority: 5 }),
      frame('world-brief', 5, 2, 56, 200, { story: 'BRIEF', priority: 2 }),
      frame('cabinet-report', 3, 2, 264, 96, { story: 'STANDARD', priority: 3 }),
      frame('tender-advert', 5, 2, 264, 96, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('court-report', 3, 1, 368, 280, { story: 'BRIEF', priority: 2 }),
      frame('recruit-advert-left', 4, 1, 368, 344, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('recruit-advert-right', 5, 2, 368, 344, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('strip-advert', 0, 3, 568, 80, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('world-report', 0, 4, 656, 144, { story: 'STANDARD', priority: 3 }),
      frame('bank-advert', 4, 3, 720, 288, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('feature-strip', 0, 4, 808, 200, { story: 'ANALYSIS', priority: 3 }),
    ],
  },

  'broadsheet-business': {
    key: 'broadsheet-business',
    name: 'Broadsheet business and entertainment (reference)',
    grid: REFERENCE_GRID,
    description: 'A charted money lead with a tinted panel, a digital-payments story with its own chart, three reports, an entertainment panel, a reversed poster story and three jump stories.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('lead', 0, 5, 56, 264, { story: 'LEAD', priority: 5 }),
      frame('right-chart', 5, 2, 56, 456, { story: 'DATA', priority: 4 }),
      frame('brief', 0, 1, 328, 184, { story: 'BRIEF', priority: 2 }),
      frame('report', 1, 3, 328, 184, { story: 'SECONDARY', priority: 3 }),
      frame('report-side', 4, 1, 328, 184, { story: 'BRIEF', priority: 2 }),
      frame('film-panel', 0, 3, 520, 320, { story: 'PHOTO_FEATURE', priority: 3 }),
      frame('poster-story', 3, 1, 520, 488, { story: 'PHOTO_FEATURE', priority: 3 }),
      frame('film-story', 0, 3, 848, 160, { story: 'STANDARD', priority: 3 }),
      frame('jump-one', 4, 3, 520, 184, { story: 'STANDARD', priority: 3 }),
      frame('jump-two', 4, 3, 712, 184, { story: 'STANDARD', priority: 3 }),
      frame('jump-three', 4, 3, 904, 104, { story: 'STANDARD', priority: 3 }),
    ],
  },

  'broadsheet-world': {
    key: 'broadsheet-world',
    name: 'Broadsheet national and world (reference)',
    grid: REFERENCE_GRID,
    description: 'A four-item rail, a picture-led Q&A top story, a lead with a photo pair and sidebars, a right story with a numbered box, two reports, a strip, an advert and a separator-led feature.',
    // MEASURED off the reference scan onto its own seven-column grid, tops on
    // the baseline and closed to the one 8 px gap. Generated, so literals.
    sections: [
      frame('rail-one', 0, 1, 56, 224, { type: 'briefs', story: 'BRIEF', priority: 2 }),
      frame('rail-two', 0, 1, 288, 232, { story: 'BRIEF', priority: 2 }),
      frame('rail-three', 0, 1, 528, 120, { story: 'BRIEF', priority: 2 }),
      frame('rail-four', 0, 1, 656, 136, { story: 'BRIEF', priority: 2 }),
      frame('top-story', 1, 6, 56, 144, { story: 'SECONDARY', priority: 4 }),
      frame('lead', 1, 4, 208, 320, { story: 'LEAD', priority: 5 }),
      frame('right', 5, 2, 208, 320, { story: 'SECONDARY', priority: 4 }),
      frame('report-panel', 1, 2, 536, 256, { story: 'STANDARD', priority: 3 }),
      frame('report-narrow', 3, 1, 536, 256, { story: 'STANDARD', priority: 3 }),
      frame('strip', 4, 3, 536, 88, { story: 'BRIEF', priority: 2 }),
      frame('advert', 4, 3, 632, 376, { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      frame('feature-strip', 0, 4, 800, 208, { story: 'ANALYSIS', priority: 3 }),
    ],
  },

  features: {
    key: 'features',
    name: 'Feature Page',
    description: 'A tall picture feature, briefs, a photograph and a sidebar.',
    sections: (() => {
      const [briefRow, photoRow, supportRow, advertRow] = rows(INSIDE_TOP, [176, 336, 160, 248]);
      const lowerLeftTop = advertRow.y - 56;
      return [
        block('feature-lead', 0, 8, INSIDE_TOP, 632,
          { story: 'PHOTO_FEATURE', priority: 4, headline: 'accent' }),
        block('brief-one', 8, 8, briefRow.y, briefRow.height,
          { story: 'BRIEF', priority: 2 }),
        block('feature-photo', 8, 8, photoRow.y, photoRow.height,
          { type: 'photo', story: 'PHOTO_FEATURE', priority: 3, purpose: 'IMAGE_COMPANION', requirement: 'REQUIRED_CONTENT' }),
        block('feature-sidebar', 8, 8, supportRow.y, supportRow.height,
          { story: 'SIDEBAR', priority: 2 }),

        block('feature-two', 0, 4, lowerLeftTop, INSIDE_BOTTOM - lowerLeftTop, { story: 'OPINION', priority: 3 }),
        block('feature-three', 4, 4, lowerLeftTop, INSIDE_BOTTOM - lowerLeftTop, { story: 'DATA', priority: 3 }),
        block('feature-advert', 8, 8, advertRow.y, advertRow.height,
          { type: 'advert', story: 'ADVERTISEMENT', priority: 1 }),
      ];
    })(),
  },
};

function getTemplate(templateKey) {
  return templates[templateKey] || templates.front;
}

function getTemplateForPage(templateKey, pageNumber, newspaper = {}) {
  const template = getTemplate(templateKey);
  if (Number(pageNumber) !== 2) return template;
  const geometry = geometryOf(newspaper);
  const { bottom } = regionForPage(geometry, pageNumber).content;
  return { ...template, sections: template.sections.map((section) => ({
    ...section,
    height: Math.max(geometry.baselinePx, Math.min(section.height, bottom - section.y)),
  })) };
}

function reconcileSectionsForPage(sections = [], pageNumber, newspaper = {}) {
  const geometry = geometryOf(newspaper);
  const { top, bottom } = regionForPage(geometry, pageNumber).content;
  const editorial = sections.filter((section) => !(Number(pageNumber) === 1 && section.section_key === 'masthead-advert'));
  const firstTop = Math.min(...editorial.map((section) => Number(section.y_px ?? section.y)));
  // Page-one legacy pages were saved before the compact masthead clearance.
  // Rebase the entire editorial template to the canonical top edge, retaining
  // all inter-frame geometry rather than nudging named blocks independently.
  const topRebasePx = Number(pageNumber) === 1 ? Math.max(0, firstTop - top) : 0;
  const lastTop = Math.max(...editorial.map((section) => Number(section.y_px ?? section.y) - topRebasePx));
  return sections.map((section) => {
    if (Number(pageNumber) === 1 && section.section_key === 'masthead-advert') return section;
    const y = Math.max(top, Number(section.y_px ?? section.y) - topRebasePx);
    // Existing fixture rows were created against older region bottoms. Extend
    // only the final template row to the current canonical content edge; the
    // template owns that row's extent, never a named fixture section.
    const isFinalRow = y === lastTop;
    const wantedHeight = Number(section.height_px ?? section.height) + (isFinalRow ? Math.max(0, bottom - (y + Number(section.height_px ?? section.height))) : 0);
    return { ...section, y_px: y, y, height_px: Math.max(geometry.baselinePx, Math.min(wantedHeight, bottom - y)), height: Math.max(geometry.baselinePx, Math.min(wantedHeight, bottom - y)) };
  });
}

// Frames that hold a region the PAGE itself reserves, rather than a hole in
// the editorial matter - the sold corner of page one is the only one today
// (deleting it used to let the nameplate stretch across the space it had
// held; see geometry.js). The template catalog is the one place a section
// key is defined at all, so it is the one place this classification can live
// without a second copy drifting from it - pageSection.service.js's deletion
// guard and page.repository.js's structural-repair both read this, not a
// local Set of their own.
const STRUCTURAL_FRAME_KEYS = new Set(['masthead-advert']);

/** Is this frame part of the page itself rather than a hole in the matter? */
function isStructuralTemplateFrame(sectionOrKey) {
  const key = typeof sectionOrKey === 'string'
    ? sectionOrKey
    : sectionOrKey?.key || sectionOrKey?.section_key;
  return STRUCTURAL_FRAME_KEYS.has(String(key || ''));
}

function comparePageGeometryToTemplate(pageSections = [], template = {}) {
  const expected = new Map((template.sections || []).map((section) => [section.key, section]));
  const differences = [];
  for (const section of pageSections) {
    const target = expected.get(section.section_key);
    if (!target) { differences.push({ sectionKey: section.section_key, reason: 'NOT_IN_TEMPLATE' }); continue; }
    const actual = { x: Number(section.x_px), y: Number(section.y_px), width: Number(section.width_px), height: Number(section.height_px) };
    const wanted = { x: Number(target.x), y: Number(target.y), width: Number(target.width), height: Number(target.height) };
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) differences.push({ sectionKey: section.section_key, actual, expected: wanted });
  }
  for (const section of expected.values()) if (!pageSections.some((item) => item.section_key === section.key)) differences.push({ sectionKey: section.key, reason: 'MISSING_PERSISTED_SECTION' });
  return { status: differences.length ? 'MISMATCH' : 'MATCH', differences };
}

module.exports = {
  MEASURED_PAGES,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  GRID_COLUMNS: DEFAULTS.gridColumns,
  getTemplate,
  getTemplateForPage,
  reconcileSectionsForPage,
  comparePageGeometryToTemplate,
  STRUCTURAL_FRAME_KEYS,
  isStructuralTemplateFrame,
  templates,
  colX,
  colW,
  baseline,
};
