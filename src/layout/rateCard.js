// What a space on the page is worth.
//
// Newspaper advertising is not sold by the pixel or by the fraction of a page.
// It is sold by the COLUMN-CENTIMETRE: how many columns wide the block is,
// multiplied by how many centimetres tall, multiplied by a rate that depends on
// where on the paper it sits. Every rate card in the trade is written this way,
// and a desk quotes from it a dozen times a day with a calculator.
//
// The software already knows a block's width in columns and its height in
// millimetres exactly - that is what the grid is for - so the quote falls out
// for nothing. The block the designer drew IS the thing being sold.
//
// The rates below are SAHAS VARTA's to set; they are here so the feature works
// out of the box and in one place so a rate change is one edit.

const { geometryOf, pxToMm } = require('./geometry');

// Rupees per column-centimetre. Position is most of the price: page one costs
// several times an inside page, and the ear beside the nameplate - the first
// thing anyone sees - is the dearest space in the paper.
const RATES = {
  'front-ear': { name: 'पान १ - नामपट्टीशेजारी', perColumnCm: 900 },
  'front-page': { name: 'पान १', perColumnCm: 600 },
  'back-page': { name: 'शेवटचे पान', perColumnCm: 450 },
  'page-three': { name: 'पान ३', perColumnCm: 320 },
  inside: { name: 'आतील पान', perColumnCm: 180 },
};

// Colour costs more to print, and is charged for.
const COLOUR_SURCHARGE = 0.35;
// Nobody sells less than this; a two-line box still costs the desk a slot.
const MINIMUM_COLUMN_CM = 4;

/**
 * Which rate applies to a block, from where it sits.
 *
 * The ear is the block on page one that sits in the nameplate band's own row -
 * top of the page, to one side. It is recognised by position rather than by a
 * name, so a designer who draws one by hand gets the right price for it.
 */
function positionOf(section, page, totalPages, geometry) {
  const pageNumber = Number(page?.page_number);
  const top = Number(section.y_px);
  const bandBottom = geometry.marginYPx + 420;

  if (pageNumber === 1) {
    const rightOfCentre = Number(section.x_px) > geometry.marginXPx + geometry.matterWidthPx * 0.55;
    if (top < bandBottom && rightOfCentre) return 'front-ear';
    return 'front-page';
  }
  if (totalPages && pageNumber === totalPages) return 'back-page';
  if (pageNumber === 3) return 'page-three';
  return 'inside';
}

/**
 * Quotes a block.
 *
 * Columns are counted from the block's own width on the grid, height is its
 * height converted to centimetres, and both are what will actually be printed -
 * there is no separate "ad size" for anyone to key in wrongly.
 */
function quote(section, page, { totalPages, newspaper } = {}) {
  const geometry = geometryOf(newspaper || {});
  const columnPitch = geometry.columnPx + geometry.gutterPx;

  // A block spanning n columns is n column widths plus the n-1 gutters between.
  const columns = Math.max(1, Math.round((Number(section.width_px) + geometry.gutterPx) / columnPitch));
  const heightCm = pxToMm(Number(section.height_px)) / 10;
  const columnCm = Math.max(MINIMUM_COLUMN_CM, columns * heightCm);

  const position = positionOf(section, page, totalPages, geometry);
  const rate = RATES[position];
  const colour = page?.prints_colour !== false;

  const base = columnCm * rate.perColumnCm;
  const surcharge = colour ? base * COLOUR_SURCHARGE : 0;

  return {
    position,
    positionName: rate.name,
    columns,
    heightCm: Number(heightCm.toFixed(1)),
    columnCm: Number(columnCm.toFixed(1)),
    perColumnCm: rate.perColumnCm,
    colour,
    base: Math.round(base),
    colourSurcharge: Math.round(surcharge),
    total: Math.round(base + surcharge),
    currency: 'INR',
  };
}

module.exports = { quote, positionOf, RATES, COLOUR_SURCHARGE, MINIMUM_COLUMN_CM };
