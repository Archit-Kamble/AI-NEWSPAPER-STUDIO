// A Smart Card's already-resolved lines, in BLOCK PIXELS, for any writer.
//
// WHY THIS IS ITS OWN MODULE. A Smart Card is never flattened to prose for
// output - it is a STRUCTURED layout (a grid, a table of rows, a quote), and
// `layoutSmartCard()` has already resolved every line it will draw. Reading
// that resolved geometry is one job with one right answer, and it used to live
// inside scribus.service.js, which was correct while Scribus was the only
// destination. It is not correct for four: InDesign, Word and the CMYK press
// PDF each need the same walk, and four walks of the same card is the
// duplicated-catalog failure this project has already been bitten by twice.
//
// So the walk is here, once, and returns neutral entries. Every writer places
// them; none decides where they go. `x`/`y`/`width` are block pixels relative
// to the card's own frame origin, exactly as layoutSmartCard() resolves them -
// the caller converts to its own unit, which is the only place a unit changes.

const { devanagari } = require('../../layout/identity');

/**
 * @returns {Array<{text, x, y, width, fontPx, align}>} align is 0 left,
 *          1 centre, 2 right - the same three a composed line can carry.
 */
function smartCardLines(key, data, frame, cardLayout) {
  const layout = cardLayout.layoutSmartCard(key, data, frame);
  if (layout.fitState === 'EMPTY') return [];

  const out = [];
  const line = (text, x, y, width, fontPx, align = 0) => {
    if (!text) return;
    out.push({ text, x, y, width, fontPx, align, height: layout.geometry?.lineHeightPx || fontPx * 1.5 });
  };

  if (layout.subtitle?.lines?.length) {
    layout.subtitle.lines.forEach((text, i) =>
      line(text, 0, i * layout.subtitle.lineHeightPx, frame.width, layout.subtitle.fontPx, 1));
  }
  const subtitleOffsetPx = layout.subtitle?.height || 0;

  if (key === 'sudoku' || key === 'sudoku-solution') {
    const { cell, top } = layout.geometry;
    const isGrid = (value) => Array.isArray(value) && value.length === 9
      && value.every((row) => Array.isArray(row) && row.length === 9);
    const rows = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : [];
    rows.forEach((row, y) => row.forEach((value, x) => {
      const n = Number(value);
      if (!(n > 0)) return;
      line(devanagari(n), x * cell, subtitleOffsetPx + top + y * cell, cell, layout.fontPx, 1);
    }));
    return out;
  }

  if (key === 'rashi') {
    const { rows, rowHeights, columnWidth, nameWidth, lineHeightPx } = layout.geometry;
    layout.items.forEach((item, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const rowTop = rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0);
      const colX = column * columnWidth;
      line(item.name, colX, subtitleOffsetPx + rowTop, nameWidth, layout.fontPx);
      [...item.readingLines, ...item.luckLines].forEach((text, i) =>
        line(text, colX + nameWidth, subtitleOffsetPx + rowTop + i * lineHeightPx, columnWidth - nameWidth, layout.fontPx));
    });
    return out;
  }

  if (key === 'panchang') {
    const { labelWidth, valueWidth, lineHeightPx } = layout.geometry;
    let top = subtitleOffsetPx;
    for (const item of layout.items) {
      line(item.labelLines[0] || '', 0, top, labelWidth, layout.fontPx);
      item.valueLines.forEach((text, i) =>
        line(text, labelWidth, top + i * lineHeightPx, valueWidth, layout.fontPx));
      top += item.rowHeight;
    }
    return out;
  }

  if (key === 'suvichar') {
    const { lineHeightPx, attributionFontPx, attributionLineHeightPx, ruleReservePx } = layout.geometry;
    let top = subtitleOffsetPx + ruleReservePx;
    layout.quoteLines.forEach((text, i) => line(text, 0, top + i * lineHeightPx, frame.width, layout.fontPx, 1));
    top += layout.quoteLines.length * lineHeightPx;
    layout.attributionLines.forEach((text, i) =>
      line(text, 0, top + i * attributionLineHeightPx, frame.width, attributionFontPx, 1));
    return out;
  }

  if (key === 'dinvishesh') {
    const { lineHeightPx } = layout.geometry;
    let top = subtitleOffsetPx;
    for (const item of layout.items) {
      item.lines.forEach((text, i) => line(text, 0, top + i * lineHeightPx, frame.width, layout.fontPx));
      top += item.height;
    }
    return out;
  }

  return out;
}

module.exports = { smartCardLines };
