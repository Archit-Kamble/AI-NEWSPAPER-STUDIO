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

const { geometryOf, pxToMm, regionsFor } = require('./geometry');

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
 * The ear is the block on page one that sits inside the NAMEPLATE'S OWN BAND.
 * That band is reserved furniture - `regionsFor()` hands the nameplate
 * everything above `header.bottom` and no editorial block may be there - so
 * sitting in it is the whole test, and it holds whichever corner the paper
 * sells. It is still recognised by position rather than by a name, so a
 * designer who draws one by hand gets the right price for it.
 *
 * BOTH HALVES OF THIS WERE WRONG, AND THEY WERE WRONG TOGETHER.
 *
 * It used to require the block to be RIGHT of centre, and to sit above a
 * hard-coded `marginYPx + 420`. This paper's ear is on the LEFT:
 * `MASTHEAD_ADVERT.col` is 0 and geometry.js reserves the ear from "the
 * matter's left edge" in as many words. So the highest rate in the card was
 * unreachable - measured on edition 54470's real front page, the ear at
 * x=20 priced as an ordinary `front-page` block: 22.4 column-cm at Rs 600
 * instead of Rs 900, Rs 18,144 where the card says Rs 27,216. **The paper
 * undercharged Rs 9,072 on the dearest space it sells, every day.**
 *
 * And 420 was four hundred and forty pixels of band where the real one is
 * 144, which is why loosening the side test alone would have been worse: the
 * LEAD, at y=184, sits inside 440 and would have been sold as an ear.
 *
 * The band comes from `regionsFor()` now - the one geometry every other
 * surface reads - rather than from a number in this file.
 */
function positionOf(section, page, totalPages, geometry) {
  const pageNumber = Number(page?.page_number);

  if (pageNumber === 1) {
    const band = regionsFor(geometry, 'front', 1).header.bottom;
    const bottom = Number(section.y_px) + Number(section.height_px);
    if (Number.isFinite(bottom) && Number.isFinite(band) && bottom <= band) return 'front-ear';
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
