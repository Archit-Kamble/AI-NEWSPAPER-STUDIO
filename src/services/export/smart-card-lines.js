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
      text, x, y, width, fontPx, align, height: height || fontPx * ratio,
      ink: style.ink || null, bold: Boolean(style.bold),
    });
  };

  if (layout.subtitle?.lines?.length) {
    layout.subtitle.lines.forEach((text, i) =>
      line(text, 0, i * layout.subtitle.lineHeightPx, frame.width, layout.subtitle.fontPx, 1,
        layout.subtitle.lineHeightPx));
  }
  const subtitleOffsetPx = layout.subtitle?.height || 0;

  const bar = (x, y, width, height, ink) => out.push({ kind: 'bar', x, y, width, height, ink });
  const poly = (points, ink, { close = true, strokeWidth = 0 } = {}) =>
    out.push({ kind: 'poly', points, ink, close, strokeWidth });

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
    if (g.source) line(g.source, 0, y, frame.width, layout.fontPx * 0.85, 0);
    return out;
  }

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
