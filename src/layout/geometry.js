// The one place the editor's pixel scale is written down.
//
// SAHAS VARTA prints 330 x 530 mm with a 310 x 510 mm matter box, in CMYK. The
// editor works at exactly 2 px per mm, which is where 660 x 1060 px (page) and
// 620 x 1020 px (matter) come from. CLAUDE.md's rule is that px and mm are
// never mixed silently - so the conversion lives here, is exported to the
// client over GET /api/geometry, and is never re-typed anywhere else.
//
// 2 px/mm is ~51 DPI: a design proxy, not a print resolution. Print output is
// generated at `printDpi` from the millimetres, never by scaling these pixels
// up - see PROJECT_STATUS.md on the export pipeline.

const PX_PER_MM = 2;

const DEFAULTS = {
  pageWidthMm: 330,
  pageHeightMm: 530,
  matterWidthMm: 310,
  matterHeightMm: 510,
  bleedMm: 3,
  printDpi: 300,
  gridColumns: 16,
  gridGutterMm: 3,
};

const mmToPx = (mm) => Math.round(Number(mm) * PX_PER_MM);
const pxToMm = (px) => Number(px) / PX_PER_MM;
const mmToPt = (mm) => (Number(mm) * 72) / 25.4;
// What a print raster of this measurement would be, at the edition's DPI.
const mmToPrintPx = (mm, dpi) => Math.round((Number(mm) / 25.4) * Number(dpi));

// The column grid, in editor pixels. Blocks snap to these, which is what makes
// text line up across a page the way it does in a national daily.
function columnGrid({ matterWidthMm, gridColumns, gridGutterMm }) {
  const columns = Math.max(1, Number(gridColumns));
  const gutterPx = mmToPx(gridGutterMm);
  const matterPx = mmToPx(matterWidthMm);
  // Fractional column widths are kept as a float; only the snapped edges are
  // rounded, so accumulated rounding never pushes the last column off the page.
  const columnPx = (matterPx - gutterPx * (columns - 1)) / columns;
  return { columns, gutterPx, columnPx, matterPx };
}

// A block starts on a column's LEFT edge and ends on a column's RIGHT edge, so
// it always covers a whole number of columns. Keeping the two sets apart is
// what stops a block starting inside a gutter - snapping x to whichever edge
// happened to be nearest would let a block begin half a column over, and the
// text in it would no longer line up with its neighbours.
function snapPointsX(geometry) {
  const { columns, gutterPx, columnPx } = columnGrid(geometry);
  const originPx = mmToPx((geometry.pageWidthMm - geometry.matterWidthMm) / 2);
  const left = [];
  const right = [];
  for (let i = 0; i < columns; i += 1) {
    const edge = originPx + i * (columnPx + gutterPx);
    left.push(Math.round(edge));
    right.push(Math.round(edge + columnPx));
  }
  return { left, right };
}

// Vertical rhythm. Print pages sit on a baseline grid so columns of text align
// row to row; 4 mm is a conventional newsprint baseline step.
const BASELINE_MM = 4;
const baselinePx = () => mmToPx(BASELINE_MM);

function geometryOf(newspaper = {}) {
  const g = {
    pageWidthMm: Number(newspaper.page_width_mm) || DEFAULTS.pageWidthMm,
    pageHeightMm: Number(newspaper.page_height_mm) || DEFAULTS.pageHeightMm,
    matterWidthMm: Number(newspaper.matter_width_mm) || DEFAULTS.matterWidthMm,
    matterHeightMm: Number(newspaper.matter_height_mm) || DEFAULTS.matterHeightMm,
    bleedMm: Number(newspaper.bleed_mm ?? DEFAULTS.bleedMm),
    printDpi: Number(newspaper.print_dpi) || DEFAULTS.printDpi,
    gridColumns: Number(newspaper.grid_columns) || DEFAULTS.gridColumns,
    gridGutterMm: Number(newspaper.grid_gutter_mm) || DEFAULTS.gridGutterMm,
  };

  const grid = columnGrid(g);
  return {
    ...g,
    pxPerMm: PX_PER_MM,
    baselinePx: baselinePx(),
    pageWidthPx: mmToPx(g.pageWidthMm),
    pageHeightPx: mmToPx(g.pageHeightMm),
    matterWidthPx: mmToPx(g.matterWidthMm),
    matterHeightPx: mmToPx(g.matterHeightMm),
    marginXPx: mmToPx((g.pageWidthMm - g.matterWidthMm) / 2),
    marginYPx: mmToPx((g.pageHeightMm - g.matterHeightMm) / 2),
    columnPx: grid.columnPx,
    gutterPx: grid.gutterPx,
    snapLeftPx: snapPointsX(g).left,
    snapRightPx: snapPointsX(g).right,
    printPageWidthPx: mmToPrintPx(g.pageWidthMm, g.printDpi),
    printPageHeightPx: mmToPrintPx(g.pageHeightMm, g.printDpi),
  };
}

module.exports = {
  PX_PER_MM,
  DEFAULTS,
  mmToPx,
  pxToMm,
  mmToPt,
  mmToPrintPx,
  columnGrid,
  snapPointsX,
  geometryOf,
  typeScaleFor,
};

// Default type sizes for a block, scaled to how wide it is.
//
// A fixed 34px headline is right for a lead and absurd for a single-column
// filler: in a 96px block it consumed every row, leaving a character budget of
// zero. National dailies size the headline to the measure, and so does this -
// roughly one line of headline across the block, with body text held between
// legible newsprint limits.
// The block's own margin and the line box the character grid uses, so the two
// agree about how many lines a headline costs. A Devanagari line needs 1.45 of
// its type size - the vowel signs stack above the shirorekha and below the
// baseline - and that is the number text-flow.js enforces.
const BLOCK_MARGIN_PX = 12;
const LINE_HEIGHT = 1.45;
// A headline is assumed to wrap to two lines, because most do, and it may not
// take more than half of what the block has. The other half is the story.
const HEADLINE_LINES = 2;
const HEADLINE_SHARE = 0.5;

function typeScaleFor(widthPx, heightPx) {
  const width = Number(widthPx) || 0;
  const height = Number(heightPx) || 0;
  const clamp = (value, min, max) => Math.round(Math.min(max, Math.max(min, value)));

  // Big blocks carry big headlines; the cap keeps a full-width strip from
  // shouting, the floor keeps a filler readable.
  const byMeasure = clamp(width / 11, 13, 40);

  // And a headline may never be larger than the block can carry.
  //
  // This used to be a cliff - blocks under 160px tall had their headline capped
  // at 18px, and everything taller was left alone - which is not a rule about
  // anything. A 620x168 full-width banner sits just the wrong side of it and
  // was given a 40px headline: two headline lines and a subheading came to more
  // than the whole block, so its character budget was ZERO. The block could not
  // hold one word of the story it existed to carry, and nothing said so until
  // the copy had already been written.
  //
  // So the cap is continuous and derived: the headline gets at most half the
  // block's usable height, at two lines. Every size below that is unchanged -
  // this only ever takes a headline down, never up.
  const usable = Math.max(0, height - BLOCK_MARGIN_PX * 2);
  const byHeight = height
    ? clamp((usable * HEADLINE_SHARE) / (HEADLINE_LINES * LINE_HEIGHT), 13, 40)
    : byMeasure;
  const headlineFitted = Math.min(byMeasure, byHeight);

  return {
    headlineFontPx: headlineFitted,
    subheadingFontPx: clamp(headlineFitted * 0.55, 11, 22),
    bodyFontPx: clamp(width / 26, 9, 16),
  };
}
