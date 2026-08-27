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

// The paper's accent, the one a chart's bars and figures are set in.
const CHART_ACCENT = '#c8102e';

/**
 * @returns {Array<{kind, text, x, y, width, fontPx, align}>} align is 0 left,
 *          1 centre, 2 right - the same three a composed line can carry.
 *
 * `kind` is absent for an ordinary line of type, which is every entry this
 * returned until information graphics existed. A chart also emits
 * `{ kind: 'bar', x, y, width, height, ink }` - a rectangle - and
 * `{ kind: 'poly', points, ink, close, strokeWidth }` - a point list, which is
 * what a pie slice, a line chart's line and a dot all reduce to once the arc
 * has been turned into segments by the SOLVER. That is why there are five
 * chart kinds now and not two: no writer needs bezier geometry, and because
 * the segmentation happens in one place none of them can round an arc
 * differently from another.
 */
function smartCardLines(key, data, frame, cardLayout) {
  const layout = cardLayout.layoutSmartCard(key, data, frame);
  if (layout.fitState === 'EMPTY') return [];

  const out = [];
  const contentX = Number(layout.contentBox?.x) || 0;
  const contentY = Number(layout.contentBox?.y) || 0;
  const contentWidth = Number(layout.contentBox?.width) || Number(frame.width) || 0;

  // Artwork is a first-class neutral item. It therefore reaches Scribus,
  // PDF, IDML and Word from this same walk instead of existing as browser-only
  // decoration that disappears from the printed paper.
  if (layout.artwork?.file) {
    out.push({ kind: 'image', ...layout.artwork });
  }
  if (key === 'rashi' && layout.artwork) {
    const y = layout.artwork.y + layout.artwork.height / 2;
    const rightX = layout.artwork.x + layout.artwork.width + 6;
    out.push({ kind: 'bar', x: 0, y, width: Math.max(0, layout.artwork.x - 6), height: 0.7, ink: '#8a1428' });
    out.push({ kind: 'bar', x: rightX, y, width: Math.max(0, (Number(frame.width) || 0) - rightX), height: 0.7, ink: '#8a1428' });
  }

  // AN ENTRY'S BOX IS ITS OWN TYPE'S, not the card's body line.
  //
  // This handed every entry `layout.geometry.lineHeightPx` - the card's body
  // leading - which was invisible for as long as every card set all its
  // entries at one size. A stat row does not: its figures are 2.2x its
  // captions. So a 26.4 px numeral was given an 18.8 px box, and since the
  // writers put a baseline at 80% of the box when an entry carries none, its
  // glyphs printed straight through the row underneath. Photographed on page
  // six of a six-page edition: the captions crashing into the figures below
  // them.
  //
  // The ratio is the card's own (lineHeightPx / fontPx), so an entry set at
  // the card's body size gets exactly the number it got before and no
  // existing card moves.
  const ratio = layout.fontPx > 0
    ? (layout.geometry?.lineHeightPx || layout.fontPx * 1.45) / layout.fontPx
    : 1.45;
  // `ink` and `bold` travel with the entry, because the canvas paints them and
  // an export that dropped them printed the same card in a different ink.
  // Photographed side by side: a stat row's figures are the paper's accent red
  // on the website and were plain black in the PDF, and a bar chart's value
  // labels are bold on the website and were regular.
  const line = (text, x, y, width, fontPx, align = 0, height = null, style = {}) => {
    if (!text) return;
    out.push({
      text, x: contentX + x, y: contentY + y, width, fontPx, align, height: height || fontPx * ratio,
      ink: style.ink || null, bold: Boolean(style.bold),
    });
  };

  if (layout.subtitle?.lines?.length) {
    layout.subtitle.lines.forEach((text, i) =>
      line(text, 0, i * layout.subtitle.lineHeightPx, contentWidth, layout.subtitle.fontPx, 1,
        layout.subtitle.lineHeightPx));
  }
  const subtitleOffsetPx = layout.subtitle?.height || 0;

  const image = (file, x, y, width, height) => out.push({
    kind: 'image', file, x: contentX + x, y: contentY + y, width, height,
  });
  const bar = (x, y, width, height, ink) => out.push({
    kind: 'bar', x: contentX + x, y: contentY + y, width, height, ink,
  });
  const poly = (points, ink, { close = true, strokeWidth = 0 } = {}) =>
    out.push({
      kind: 'poly',
      points: (points || []).map(([x, y]) => [contentX + x, contentY + y]),
      ink,
      close,
      strokeWidth,
    });

  // The gap between the wheel and its legend - the card's own body size, which
  // is the only measure on a card that means anything.
  const GAP = layout.fontPx * 0.5;

  if (key === 'chart') {
    const g = layout.geometry;
    // THE CHART'S OWN INK, off the one solve. `ACCENT` is the paper's red and
    // was hard-coded at all four of the sites below, so a chart a desk set in
    // blue drew blue on screen and printed red - the two-surface fault this
    // codebase guards hardest against, and one this file would have shipped
    // the moment the ink became a choice. The fallback is for a geometry
    // solved before `ink` was published.
    const ACCENT = g.ink || CHART_ACCENT;
    let y = subtitleOffsetPx;
    if (g.chartType === 'stat') {
      const perBand = Math.max(1, g.columns);
      layout.items.forEach((item, index) => {
        const column = index % perBand;
        const band = Math.floor(index / perBand);
        const x = column * g.columnWidth;
        const top = y + band * g.bandHeight;
        line(item.valueText, x, top, g.columnWidth, g.figurePx, 1, g.figureLine, { ink: ACCENT, bold: true });
        (item.captionLines || []).forEach((text, i) =>
          line(text, x, top + g.figureLine + i * g.lineHeightPx, g.columnWidth, layout.fontPx, 1));
      });
      y += Math.ceil(layout.items.length / perBand) * g.bandHeight;
    } else if (g.chartType === 'pie') {
      // The wheel on the left, the legend on the right. Marathi labels do not
      // fit inside a slice and a newspaper does not set them at an angle.
      const cx = g.radius;
      const cy = y + g.radius;
      layout.items.forEach((item, index) => {
        // EACH SLICE IN A TINT OF THE ONE INK, resolved to a real hex here.
        // A newspaper prints a pie in tints of a single ink, not in a rainbow -
        // and a "shade" would have been a new concept every writer had to
        // learn, when a lighter hex is something all three already draw.
        const ink = cardLayout.sliceInk(index, ACCENT);
        poly(cardLayout.arcPoints(cx, cy, g.radius, item.from, item.to), ink, { close: true });
        const top = y + index * g.legendLine;
        bar(g.diameter + GAP, top + g.legendLine * 0.25, g.legendLine * 0.5, g.legendLine * 0.5, ink);
        line(`${item.label} — ${item.valueText}`,
          g.diameter + GAP + g.legendLine * 0.7, top,
          Math.max(0, g.legendWidth - g.legendLine * 0.7 - GAP), layout.fontPx, 0);
      });
      y += Math.max(g.diameter, layout.items.length * g.legendLine);
    } else if (g.chartType === 'line' || g.chartType === 'dots') {
      const points = layout.items.map((item) => [item.x, y + item.y]);
      if (g.chartType === 'line' && points.length > 1) {
        poly(points, ACCENT, { close: false, strokeWidth: g.lineWidth });
      }
      layout.items.forEach((item, index) => {
        // Every point carries its own dot - on a line chart too, because a
        // reader follows a line by its readings and a printed line chart marks
        // them.
        poly(cardLayout.arcPoints(item.x, y + item.y, g.dotRadius, 0, 1, { centre: false }), ACCENT, { close: true });
        line(item.valueText, item.x - g.step / 2, y + item.y - g.valueBand,
          g.step || frame.width, layout.fontPx, 1, null, { bold: true });
        line(item.label, item.x - g.step / 2, y + g.valueBand + g.plotHeight,
          g.step || frame.width, layout.fontPx, 1);
      });
      y += g.valueBand + g.plotHeight + g.labelBand;
    } else {
      const barHeight = Math.max(2, g.lineHeightPx * 0.62);
      layout.items.forEach((item) => {
        line(item.label, 0, y, g.labelWidth, layout.fontPx, 0);
        bar(g.labelWidth, y + (g.rowHeight - barHeight) / 2, item.barWidth, barHeight, ACCENT);
        line(item.valueText, g.labelWidth + g.trackWidth + 2, y, g.valueWidth, layout.fontPx, 2, null, { bold: true });
        y += g.rowHeight;
      });
    }
    if (g.source) line(g.source, 0, y, contentWidth, layout.fontPx * 0.85, 0);
    return out;
  }

  if (key === 'sudoku' || key === 'sudoku-solution') {
    const {
      cell, top, headingText, headingFontPx, headingLineHeightPx,
    } = layout.geometry;
    line(headingText, 0, subtitleOffsetPx, contentWidth, headingFontPx, 0,
      headingLineHeightPx, { bold: true, ink: '#8a1428' });
    bar(0, subtitleOffsetPx + headingLineHeightPx - 0.6, contentWidth, 0.6, '#8a1428');
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
    const {
      rows, rowHeights, columnWidth, columnGap, iconSize, itemPadding, lineHeightPx,
    } = layout.geometry;
    layout.items.forEach((item, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const rowTop = rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0);
      const colX = column * (columnWidth + columnGap);
      const top = subtitleOffsetPx + rowTop + itemPadding;
      if (item.imageFile) image(item.imageFile, colX + itemPadding, top, iconSize, iconSize);
      const luckTop = top + iconSize + 2;
      item.luckLines.forEach((text, i) => line(
        text,
        colX + itemPadding,
        luckTop + i * item.luckLineHeightPx,
        iconSize,
        item.luckFontPx,
        1,
        item.luckLineHeightPx,
        { bold: true, ink: '#6a5559' },
      ));
      const textX = colX + itemPadding + iconSize + 6;
      const textWidth = Math.max(0, columnWidth - iconSize - 6 - itemPadding * 2);
      line(item.name, textX, top, textWidth, layout.fontPx, 0, lineHeightPx, { bold: true, ink: '#8a1428' });
      item.readingLines.forEach((text, i) =>
        line(text, textX, top + (i + 1) * lineHeightPx, textWidth, layout.fontPx));
    });
    rowHeights.forEach((height, row) => {
      const y = subtitleOffsetPx + rowHeights.slice(0, row + 1).reduce((sum, value) => sum + value, 0) - 0.5;
      bar(0, y, contentWidth, 0.5, '#d5c7c9');
    });
    if (layout.geometry.columns > 1) {
      bar(columnWidth + columnGap / 2 - 0.25, subtitleOffsetPx, 0.5,
        rowHeights.reduce((sum, height) => sum + height, 0), '#d5c7c9');
    }
    return out;
  }

  if (key === 'panchang') {
    const { labelWidth, valueWidth, lineHeightPx } = layout.geometry;
    let top = subtitleOffsetPx;
    bar(0, top, contentWidth, 0.6, '#8a1428');
    bar(0, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    bar(contentWidth - 0.6, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    for (const [index, item] of layout.items.entries()) {
      bar(0, top, labelWidth, item.rowHeight, '#fbf2f3');
      if (index % 2 === 1) bar(labelWidth, top, valueWidth, item.rowHeight, '#fcf8f3');
      line(item.labelLines[0] || '', 0, top + item.textNudgeY, labelWidth, layout.fontPx, 0,
        lineHeightPx, { bold: true, ink: '#8a1428' });
      item.valueLines.forEach((text, i) =>
        line(text, labelWidth, top + i * lineHeightPx, valueWidth, layout.fontPx, 0,
          lineHeightPx, { bold: true }));
      top += item.rowHeight;
      bar(0, top - 0.4, contentWidth, 0.4, '#d8c4c8');
    }
    bar(labelWidth - 0.25, subtitleOffsetPx, 0.5, top - subtitleOffsetPx, '#dec8cc');
    bar(0, top - 0.6, contentWidth, 0.6, '#8a1428');
    return out;
  }

  if (key === 'suvichar') {
    out.push({ kind: 'bar', x: 0, y: 0, width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });
    out.push({ kind: 'bar', x: 0, y: Math.max(0, (Number(frame.height) || 0) - 0.6), width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });
    line(layout.displayLine, 0, subtitleOffsetPx, contentWidth, layout.fontPx, 0,
      layout.geometry.lineHeightPx);
    return out;
  }

  if (key === 'dinvishesh') {
    const { lineHeightPx, textInset, rowGap } = layout.geometry;
    let top = subtitleOffsetPx;
    bar(1.45, top, 0.6, Math.max(0, layout.items.reduce((sum, item) => sum + item.height, 0)
      + Math.max(0, layout.items.length - 1) * rowGap), '#d5a9b0');
    for (const item of layout.items) {
      if (item.symbol === 'flag') {
        const stemX = 1;
        const stemY = top + lineHeightPx * 0.2;
        bar(stemX, stemY, 0.55, lineHeightPx * 0.68, '#8a1428');
        poly([[stemX + 0.55, stemY], [stemX + 4.2, stemY + 2], [stemX + 0.55, stemY + 4]], '#8a1428');
      } else {
        line(item.symbol, 0, top, Math.max(4, textInset - 1), layout.fontPx * 0.72, 1,
          lineHeightPx, { bold: true, ink: '#8a1428' });
      }
      item.lines.forEach((text, i) => line(
        text, textInset, top + i * lineHeightPx, Math.max(0, contentWidth - textInset), layout.fontPx,
      ));
      top += item.height + rowGap;
    }
    return out;
  }

  if (key === 'havaman') {
    const g = layout.geometry;
    layout.items.forEach((item, index) => {
      const column = index % g.columns;
      const row = Math.floor(index / g.columns);
      const x = column * (g.columnWidth + g.columnGap);
      const top = subtitleOffsetPx + row * (g.cellHeight + g.rowGap);
      bar(x, top, g.columnWidth, g.cellHeight, '#fff7f7');
      bar(x, top, 2, g.cellHeight, '#8a1428');
      let y = top;
      line(item.name, x + 4, y, Math.max(0, g.columnWidth - 6), layout.fontPx, 0,
        g.lineHeightPx, { bold: true, ink: '#8a1428' });
      y += g.lineHeightPx;
      for (const text of item.conditionLines) {
        line(text, x + 4, y, Math.max(0, g.columnWidth - 6), layout.fontPx, 0, g.lineHeightPx);
        y += g.lineHeightPx;
      }
      for (const text of item.temperatureLines) {
        line(text, x + 4, y, Math.max(0, g.columnWidth - 6), layout.fontPx, 0,
          g.lineHeightPx, { bold: true });
        y += g.lineHeightPx;
      }
      for (const text of item.rainLines) {
        line(text, x + 4, y, Math.max(0, g.columnWidth - 6), layout.fontPx, 0, g.lineHeightPx);
        y += g.lineHeightPx;
      }
    });
    layout.sourceLines.forEach((text, index) => line(
      text, 0, subtitleOffsetPx + g.gridHeight + GAP + index * g.sourceLineHeightPx,
      contentWidth, g.sourceFontPx, 2, g.sourceLineHeightPx,
    ));
    return out;
  }

  if (key === 'market') {
    const g = layout.geometry;
    let y = subtitleOffsetPx;
    layout.titleLines.forEach((text, index) => line(
      text, 0, y + index * g.titleLineHeightPx, contentWidth, g.titleFontPx, 1,
      g.titleLineHeightPx, { bold: true, ink: '#8a1428' },
    ));
    y += g.titleHeight + GAP;
    const rowsTop = y;
    for (const item of layout.items) {
      bar(0, y, contentWidth, item.rowHeight, '#fffafa');
      item.labelLines.forEach((text, index) => line(
        text, 2, y + index * g.lineHeightPx, Math.max(0, g.labelWidth - 4), layout.fontPx, 0,
        g.lineHeightPx, { bold: true, ink: '#4f3036' },
      ));
      item.valueLines.forEach((text, index) => line(
        text, g.labelWidth, y + index * g.lineHeightPx, g.valueWidth - 2, layout.fontPx, 2,
        g.lineHeightPx, { bold: true },
      ));
      item.changeLines.forEach((text, index) => line(
        text, g.labelWidth + g.valueWidth, y + index * g.lineHeightPx, g.changeWidth - 2,
        layout.fontPx, 2, g.lineHeightPx,
        { bold: true, ink: item.direction === 'up' ? '#237548' : item.direction === 'down' ? '#a51d34' : '#111111' },
      ));
      y += item.rowHeight;
      bar(0, y - 0.4, contentWidth, 0.4, '#ddcbd0');
    }
    bar(0, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(contentWidth - 0.6, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(g.labelWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');
    bar(g.labelWidth + g.valueWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');
    if (layout.briefLines?.length) {
      y += GAP;
      bar(0, y, contentWidth, g.briefHeight, '#f7f1f2');
      bar(0, y, 2, g.briefHeight, '#8a1428');
      let briefY = y + 3;
      layout.briefLabelLines.forEach((text, index) => line(
        text, 4, briefY + index * g.lineHeightPx, Math.max(0, contentWidth - 8),
        layout.fontPx, 0, g.lineHeightPx, { bold: true, ink: '#8a1428' },
      ));
      briefY += layout.briefLabelLines.length * g.lineHeightPx;
      layout.briefLines.forEach((text, index) => line(
        text, 4, briefY + index * g.lineHeightPx, Math.max(0, contentWidth - 8),
        layout.fontPx, 0, g.lineHeightPx,
      ));
      y += g.briefHeight;
    }
    y += GAP;
    layout.sourceLines.forEach((text, index) => line(
      text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 2, g.sourceLineHeightPx,
    ));
    return out;
  }

  if (key === 'tender') {
    const g = layout.geometry;
    let y = subtitleOffsetPx + g.gap;
    bar(0, subtitleOffsetPx, contentWidth, 0.8, '#202024');
    bar(0, subtitleOffsetPx, 0.8, Math.max(0, Number(frame.height) || 0), '#202024');
    bar(contentWidth - 0.8, subtitleOffsetPx, 0.8, Math.max(0, Number(frame.height) || 0), '#202024');
    const putLines = (lines, x, width, fontPx, height, align = 0, style = {}) => {
      lines.forEach((text, index) => line(text, x, y + index * height, width, fontPx, align, height, style));
      y += lines.length * height;
    };
    putLines(layout.issuerLines, 2, contentWidth - 4, g.issuerFontPx, g.issuerLineHeightPx, 1, { bold: true });
    putLines(layout.officeLines, 2, contentWidth - 4, layout.fontPx, g.lineHeightPx, 1);
    bar(1, y + g.gap - 0.4, contentWidth - 2, 0.5, '#777777');
    y += g.gap;
    if (layout.referenceLines.length || layout.dateLines.length) {
      const metaTop = y;
      layout.referenceLines.forEach((text, index) => line(text, 2, metaTop + index * g.lineHeightPx,
        contentWidth / 2 - 4, layout.fontPx, 0, g.lineHeightPx));
      layout.dateLines.forEach((text, index) => line(text, contentWidth / 2, metaTop + index * g.lineHeightPx,
        contentWidth / 2 - 2, layout.fontPx, 2, g.lineHeightPx));
      y += Math.max(layout.referenceLines.length, layout.dateLines.length) * g.lineHeightPx + g.gap;
    }
    putLines(layout.subjectLines, 2, contentWidth - 4, layout.fontPx, g.strongLineHeightPx, 1, { bold: true });
    y += g.gap;
    putLines(layout.titleLines, 2, contentWidth - 4, g.titleFontPx, g.titleLineHeightPx, 1, { bold: true });
    y += g.gap;
    for (const paragraph of layout.paragraphItems) {
      putLines(paragraph.lines, 2, contentWidth - 4, layout.fontPx, g.lineHeightPx, 0);
      y += g.gap;
    }
    if (layout.table) {
      const tableTop = y;
      const rows = [layout.table.header, ...layout.table.rows];
      rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) bar(1, y, contentWidth - 2, row.height, '#f2eded');
        row.cells.forEach((cell, column) => cell.forEach((text, index) => line(
          text, column * layout.table.columnWidth + 2, y + index * g.lineHeightPx,
          Math.max(0, layout.table.columnWidth - 4), layout.fontPx, rowIndex === 0 ? 1 : 0,
          g.lineHeightPx, { bold: rowIndex === 0 },
        )));
        y += row.height;
        bar(1, y - 0.5, contentWidth - 2, 0.5, '#777777');
      });
      for (let column = 0; column <= layout.table.columnCount; column += 1) {
        bar(column * layout.table.columnWidth, tableTop, 0.5, y - tableTop, '#777777');
      }
      y += g.gap;
    }
    putLines(layout.contactLines, 2, contentWidth - 4, layout.fontPx, g.lineHeightPx, 0);
    if (layout.signatoryLines.length) {
      y += g.gap;
      layout.signatoryLines.forEach((text, index) => line(
        text, contentWidth * 0.52, y + index * g.strongLineHeightPx, contentWidth * 0.46,
        layout.fontPx, 1, g.strongLineHeightPx, { bold: true },
      ));
    }
    bar(0, Math.max(0, (Number(frame.height) || 0) - 0.8), contentWidth, 0.8, '#202024');
    return out;
  }

  return out;
}

module.exports = { smartCardLines };
