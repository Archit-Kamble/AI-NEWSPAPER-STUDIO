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

  // THE STANDING CARDS' OWN RULE.
  //
  // पंचांग and राशीभविष्य are ruled with a double band in the paper's accent -
  // heavy outside, hairline inside - which is what a printed almanac or
  // horoscope box carries and what distinguishes a standing feature from an
  // ordinary story block. The canvas draws it with two inset rings
  // (styles.css, `.smart-card-panchang .smart-card-content`); a plate that
  // omitted it would print the same card unruled, which is the two-surface
  // fault this walk exists to prevent.
  if (key === 'panchang' || key === 'rashi') {
    const w = Number(layout.contentBox?.width) || contentWidth;
    const h = Number(layout.contentBox?.height) || Number(frame.height) || 0;
    const ring = (offset, weight) => {
      out.push({ kind: 'bar', x: offset, y: offset, width: w - offset * 2, height: weight, ink: '#8a1428' });
      out.push({ kind: 'bar', x: offset, y: h - offset - weight, width: w - offset * 2, height: weight, ink: '#8a1428' });
      out.push({ kind: 'bar', x: offset, y: offset, width: weight, height: h - offset * 2, ink: '#8a1428' });
      out.push({ kind: 'bar', x: w - offset - weight, y: offset, width: weight, height: h - offset * 2, ink: '#8a1428' });
    };
    ring(0, 0.6);
    ring(2.2, 0.6);
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
      cell, gridSize, top, headingText, headingFontPx, headingLineHeightPx,
    } = layout.geometry;
    line(headingText, 0, subtitleOffsetPx, contentWidth, headingFontPx, 0,
      headingLineHeightPx, { bold: true, ink: '#8a1428' });
    bar(0, subtitleOffsetPx + headingLineHeightPx - 0.6, contentWidth, 0.6, '#8a1428');
    const isGrid = (value) => Array.isArray(value) && value.length === 9
      && value.every((row) => Array.isArray(row) && row.length === 9);
    const rows = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : [];

    // THE RULES ARE THE PUZZLE.
    //
    // A sudoku without its grid is eighty-one numerals scattered on white
    // paper - unreadable, and unsolvable. The browser drew them as CSS
    // borders on the <td>s (styles.css's `.smart-card-grid-table td`), so
    // they existed on screen and in NO export: the desk approved a puzzle and
    // the press file printed loose digits. Measured on a real card: the whole
    // export emitted `bar=1` - the heading rule - for a card the canvas draws
    // with twenty.
    //
    // Two weights, exactly as the stylesheet has always had and as every
    // printed puzzle sets: a hairline between cells, and a heavier rule on
    // the 3x3 box boundaries and the outer frame, which is what lets the eye
    // find a box at a glance.
    const size = Number(gridSize) || cell * 9;
    const gridLeft = Math.max(0, (contentWidth - size) / 2);
    const gridTop = subtitleOffsetPx + top;
    const HAIRLINE = 0.4;
    const BOX_RULE = 1.2;
    const CELL_INK = '#9a9aa2';
    const BOX_INK = '#333333';
    for (let i = 0; i <= 9; i += 1) {
      const heavy = i % 3 === 0;
      const weight = heavy ? BOX_RULE : HAIRLINE;
      const ink = heavy ? BOX_INK : CELL_INK;
      const at = i * cell;
      // Centred on the join, so the outer frame sits on the grid's own edge
      // rather than half a rule outside it.
      bar(gridLeft + at - weight / 2, gridTop, weight, size, ink);
      bar(gridLeft, gridTop + at - weight / 2, size, weight, ink);
    }

    rows.forEach((row, y) => row.forEach((value, x) => {
      const n = Number(value);
      if (!(n > 0)) return;
      line(devanagari(n), gridLeft + x * cell, gridTop + y * cell, cell, layout.fontPx, 1);
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
    const {
      labelWidth, valueWidth, labelTextWidth, valueTextWidth, cellPadX, cellPadY, lineHeightPx,
    } = layout.geometry;
    let top = subtitleOffsetPx;
    bar(0, top, contentWidth, 0.6, '#8a1428');
    bar(0, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    bar(contentWidth - 0.6, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    for (const [index, item] of layout.items.entries()) {
      bar(0, top, labelWidth, item.rowHeight, '#fbf2f3');
      if (index % 2 === 1) bar(labelWidth, top, valueWidth, item.rowHeight, '#fcf8f3');
      // Inside the cell's own inset - the solver's number, the same one the
      // canvas writes inline. Setting these flush to the cell edge put the
      // press file's type where the browser's never was.
      line(item.labelLines[0] || '', cellPadX, top + cellPadY + item.textNudgeY,
        labelTextWidth, layout.fontPx, 0, lineHeightPx, { bold: true, ink: '#8a1428' });
      item.valueLines.forEach((text, i) =>
        line(text, labelWidth + cellPadX, top + cellPadY + i * lineHeightPx,
          valueTextWidth, layout.fontPx, 0, lineHeightPx, { bold: true }));
      top += item.rowHeight;
      bar(0, top - 0.4, contentWidth, 0.4, '#d8c4c8');
    }
    bar(labelWidth - 0.25, subtitleOffsetPx, 0.5, top - subtitleOffsetPx, '#dec8cc');
    bar(0, top - 0.6, contentWidth, 0.6, '#8a1428');
    return out;
  }

  if (key === 'suvichar') {
    const g = layout.geometry;
    out.push({ kind: 'bar', x: 0, y: 0, width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });
    out.push({ kind: 'bar', x: 0, y: Math.max(0, (Number(frame.height) || 0) - 0.6), width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });

    // The same wrapped, CENTRED column the canvas paints. This used to emit
    // `layout.displayLine` - the quote and its credit run together as one
    // string on one row, left aligned - which was the only shape the old
    // single-line solver could produce. Both surfaces now set the quote over
    // several lines with the credit under its own rule, so the two agree.
    const quoteLines = layout.quoteLines || [];
    const creditLines = layout.attributionLines || [];
    const quoteHeight = Math.max(1, quoteLines.length) * g.lineHeightPx;
    const creditHeight = creditLines.length * g.creditLineHeightPx;
    const blockHeight = quoteHeight + (creditHeight ? g.ruleGap * 2 + creditHeight : 0);
    const boxHeight = (Number(layout.contentBox?.height) || Number(frame.height) || 0) - subtitleOffsetPx;
    let y = subtitleOffsetPx + Math.max(0, (boxHeight - blockHeight) / 2);

    quoteLines.forEach((text) => {
      line(text, g.sideInset, y, g.measureWidth, layout.fontPx, 1, g.lineHeightPx, { bold: true });
      y += g.lineHeightPx;
    });
    if (creditLines.length) {
      y += g.ruleGap;
      bar((contentWidth - g.ruleWidth) / 2, y - 0.35, g.ruleWidth, 0.7, '#8a1428');
      y += g.ruleGap;
      creditLines.forEach((text) => {
        line(text, g.sideInset, y, g.measureWidth, g.creditFontPx, 1, g.creditLineHeightPx, { ink: '#6a5559' });
        y += g.creditLineHeightPx;
      });
    }
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
    const boxHeight = Math.max(0, (Number(layout.contentBox?.height) || Number(frame.height) || 0) - subtitleOffsetPx);

    // ---- one city: the same forecast panel the canvas paints --------------
    if (g.solo) {
      const blockHeight = g.placeHeight + g.conditionHeight + g.gap + g.figureHeight
        + g.gap + g.rainHeight + g.gap + g.sourceHeight;
      // The panel's own rules, top and bottom, and its tinted ground.
      bar(0, subtitleOffsetPx, contentWidth, 0.8, '#8a1428');
      bar(0, subtitleOffsetPx + boxHeight - 0.8, contentWidth, 0.8, '#8a1428');
      let y = subtitleOffsetPx + Math.max(0, (boxHeight - blockHeight) / 2);

      line(layout.placeLine || '', g.inset, y, g.width, g.placeFontPx, 1,
        g.placeHeight, { bold: true, ink: '#8a1428' });
      y += g.placeHeight;
      (layout.conditionLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, layout.fontPx, 1, g.lineHeightPx, { ink: '#4a4147' });
        y += g.lineHeightPx;
      });
      y += g.gap;
      // The two readings, side by side, each over its own caption. The maximum
      // is the paper's accent and the minimum its cold blue, exactly as the
      // canvas sets them - an export that dropped the ink printed one figure
      // where the page showed two.
      (layout.figures || []).forEach((figure, index) => {
        const x = g.inset + index * (g.halfWidth + g.gap);
        line(figure.text, x, y, g.halfWidth, g.figureFontPx, 1, g.figureLineHeightPx,
          { bold: true, ink: figure.kind === 'min' ? '#33506e' : '#8a1428' });
        line(figure.label, x, y + g.figureLineHeightPx, g.halfWidth, g.capFontPx, 1,
          g.capLineHeightPx, { ink: '#6b6264' });
      });
      y += g.figureHeight + g.gap;
      (layout.rainLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, layout.fontPx, 1, g.lineHeightPx, { ink: '#5e5052' });
        y += g.lineHeightPx;
      });
      y += g.gap;
      (layout.sourceLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, g.sourceFontPx, 1, g.sourceLineHeightPx, { ink: '#6b6264' });
        y += g.sourceLineHeightPx;
      });
      return out;
    }

    // ---- several cities: one ruled row each -------------------------------
    let y = subtitleOffsetPx;
    layout.items.forEach((item) => {
      line(item.name, 0, y + g.rowPadding, g.nameWidth, layout.fontPx, 0,
        g.lineHeightPx, { bold: true, ink: '#8a1428' });
      line(item.tempText, g.nameWidth, y + g.rowPadding, Math.max(0, g.tempWidth - 6),
        layout.fontPx, 2, g.lineHeightPx, { bold: true });
      item.restLines.forEach((text, i) => line(
        text, g.nameWidth + g.tempWidth, y + g.rowPadding + i * g.lineHeightPx,
        g.restWidth, layout.fontPx, 0, g.lineHeightPx, { ink: '#5e5052' },
      ));
      y += item.rowHeight;
      bar(0, y - 0.4, contentWidth, 0.4, '#d8c4c8');
    });
    y += GAP;
    (layout.sourceLines || []).forEach((text, index) => line(
      text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 2,
      g.sourceLineHeightPx, { ink: '#6b6264' },
    ));
    return out;
  }

  if (key === 'market') {
    const g = layout.geometry;
    const MARK = { up: '\u25B2', down: '\u25BC', flat: '\u2013' };
    const INK = { up: '#237548', down: '#a51d34', flat: '#6b6264' };
    let y = subtitleOffsetPx;
    layout.titleLines.forEach((text, index) => line(
      text, 0, y + index * g.titleLineHeightPx, contentWidth, g.titleFontPx, 1,
      g.titleLineHeightPx, { bold: true, ink: '#8a1428' },
    ));
    if (layout.asOfLine) {
      line(layout.asOfLine, 0, y + layout.titleLines.length * g.titleLineHeightPx,
        contentWidth, g.headFontPx, 1, g.headLineHeightPx, { ink: '#7a6266' });
    }
    y += g.titleHeight + GAP;

    const rowsTop = y;
    // The rows in their groups, in the same order the canvas paints them - a
    // group head over each, or one plain table when the payload has no groups.
    const groups = g.grouped ? g.groupOrder : [null];
    for (const group of groups) {
      const inGroup = group === null
        ? layout.items
        : layout.items.filter((item) => item.group === group);
      if (!inGroup.length) continue;
      const headLabel = group === null ? '' : (g.groupLabels[group] || '');
      if (headLabel) {
        const headHeight = g.headLineHeightPx + g.rowPadding;
        bar(0, y, contentWidth, headHeight, '#f4e8ea');
        line(headLabel, 2, y, Math.max(0, contentWidth - 4), g.headFontPx, 0,
          g.headLineHeightPx, { bold: true, ink: '#8a1428' });
        y += headHeight;
        bar(0, y - 0.4, contentWidth, 0.4, '#ddcbd0');
      }
      for (const item of inGroup) {
        bar(0, y, contentWidth, item.rowHeight, '#fffafa');
        const textY = y + g.rowPadding;
        line(item.labelText, 2, textY, Math.max(0, g.labelWidth - 4), layout.fontPx, 0,
          g.lineHeightPx, { bold: true, ink: '#4f3036' });
        if (item.unitText) {
          // Beside the name, at the width the SOLVER measured that name at -
          // never re-measured here. layout.js is this project's one width
          // authority for a card and a second estimate in a writer is exactly
          // the drift its own header warns about.
          line(item.unitText,
            2 + (Number(item.labelWidthPx) || 0) + 3, textY,
            Math.max(0, g.labelWidth - 4), g.unitFontPx, 0, g.lineHeightPx, { ink: '#857074' });
        }
        line(item.valueText, g.labelWidth, textY, g.valueWidth - 2, layout.fontPx, 2,
          g.lineHeightPx, { bold: true });
        line(`${MARK[item.direction] || ''} ${item.changeText}`,
          g.labelWidth + g.valueWidth, textY, g.changeWidth - 2, layout.fontPx, 2,
          g.lineHeightPx, { bold: true, ink: INK[item.direction] || '#111111' });
        y += item.rowHeight;
        bar(0, y - 0.4, contentWidth, 0.4, '#ddcbd0');
      }
    }
    bar(0, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(contentWidth - 0.6, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(g.labelWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');
    bar(g.labelWidth + g.valueWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');

    if (layout.briefLines?.length) {
      y += GAP;
      bar(0, y, contentWidth, g.briefHeight, '#f7f1f2');
      bar(0, y, 2, g.briefHeight, '#8a1428');
      let briefY = y + g.rowPadding * 2;
      layout.briefLabelLines.forEach((text, index) => line(
        text, g.briefInset, briefY + index * g.headLineHeightPx,
        Math.max(0, contentWidth - g.briefInset * 2),
        g.headFontPx, 0, g.headLineHeightPx, { bold: true, ink: '#8a1428' },
      ));
      briefY += layout.briefLabelLines.length * g.headLineHeightPx;
      layout.briefLines.forEach((text, index) => line(
        text, g.briefInset, briefY + index * g.lineHeightPx,
        Math.max(0, contentWidth - g.briefInset * 2), layout.fontPx, 0, g.lineHeightPx,
      ));
      y += g.briefHeight;
    }
    if (layout.noteLines?.length) {
      y += 2;
      layout.noteLines.forEach((text, index) => line(
        text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 0,
        g.sourceLineHeightPx, { ink: '#7a6266' },
      ));
      y += g.noteHeight;
    }
    y += GAP;
    layout.sourceLines.forEach((text, index) => line(
      text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 2, g.sourceLineHeightPx,
      { ink: '#6b6264' },
    ));
    return out;
  }

  if (key === 'advert') {
    const g = layout.geometry;
    const boxWidth = Number(layout.contentBox?.width) || contentWidth;
    const boxHeight = Number(layout.contentBox?.height) || Number(frame.height) || 0;
    // The panel's own rule, on all four sides.
    bar(0, subtitleOffsetPx, boxWidth, 1.2, '#202024');
    bar(0, subtitleOffsetPx + boxHeight - 1.2, boxWidth, 1.2, '#202024');
    bar(0, subtitleOffsetPx, 1.2, boxHeight, '#202024');
    bar(boxWidth - 1.2, subtitleOffsetPx, 1.2, boxHeight, '#202024');

    let y = subtitleOffsetPx;
    if (g.imageUrl && g.imageHeight > 0) {
      // The artwork is a first-class item, so it reaches Scribus, the PDF, the
      // IDML and Word from this same walk rather than being browser-only
      // decoration that disappears from the printed paper.
      out.push({
        kind: 'image', file: g.imageUrl, x: 0, y, width: boxWidth, height: g.imageHeight,
      });
      y += g.imageHeight;
    }
    y += g.rowGap;

    const put = (lines, fontPx, height, style = {}) => {
      (lines || []).forEach((text) => {
        line(text, g.inset, y, g.measureWidth, fontPx, 1, height, style);
        y += height;
      });
      if (lines && lines.length) y += 0;
    };

    put(layout.nameLines, g.nameFontPx, g.nameLineHeightPx, { bold: true, ink: '#8a1428' });
    if (layout.shoutLines?.length) y += g.rowGap;
    put(layout.shoutLines, g.shoutFontPx, g.shoutLineHeightPx, { bold: true, ink: '#101014' });
    put(layout.standLines, g.standFontPx, g.standLineHeightPx, { ink: '#3d3439' });
    if (layout.detailLines?.length) y += g.rowGap;
    put(layout.detailLines, layout.fontPx, g.lineHeightPx, { ink: '#2a2427' });
    if (layout.offerLines?.length) {
      y += g.rowGap;
      // Reversed out of the accent, exactly as the canvas paints it: the ground
      // first, then white type over it.
      bar(0, y, boxWidth, g.offerHeight, '#8a1428');
      const offerTop = y + g.rowGap;
      layout.offerLines.forEach((text, index) => line(
        text, g.inset, offerTop + index * g.lineHeightPx, g.measureWidth, layout.fontPx, 1,
        g.lineHeightPx, { bold: true, ink: '#ffffff' },
      ));
      y += g.offerHeight;
    }
    if (layout.contactLines?.length) {
      y += g.rowGap;
      bar(g.inset, y - 0.6, g.measureWidth, 0.6, '#8a1428');
      put(layout.contactLines, g.smallFontPx, g.smallLineHeightPx, { bold: true });
    }
    put(layout.addressLines, g.smallFontPx, g.smallLineHeightPx, { ink: '#4a4147' });
    if (layout.footerLines?.length) y += g.rowGap;
    put(layout.footerLines, g.smallFontPx, g.smallLineHeightPx, { ink: '#6b6264' });
    return out;
  }

  if (key === 'tender') {
    const g = layout.geometry;
    const half = g.halfWidth;
    // Inside the notice's own rule and inset - the same corridor the solver
    // measured its lines against, and the same one the canvas draws in.
    const inset = Number(g.frameInsetPx) || 0;
    const noticeWidth = Number(g.noticeWidth) || Math.max(0, contentWidth - inset * 2);
    let y = subtitleOffsetPx + g.gap;
    bar(0, subtitleOffsetPx, contentWidth, 0.8, '#202024');
    bar(0, subtitleOffsetPx, 0.8, Math.max(0, Number(frame.height) || 0), '#202024');
    bar(contentWidth - 0.8, subtitleOffsetPx, 0.8, Math.max(0, Number(frame.height) || 0), '#202024');
    const putLines = (lines, x, width, fontPx, height, align = 0, style = {}) => {
      lines.forEach((text, index) => line(text, x, y + index * height, width, fontPx, align, height, style));
      y += lines.length * height;
    };
    // The two ends of a ruled band, and the rule under it.
    const putBand = (left, right, height, fontPx, lineHeightPx) => {
      if (!height) return;
      const top = y + g.bandPadY;
      left.forEach((text, index) => line(text, inset + 2, top + index * lineHeightPx,
        half - 4, fontPx, 0, lineHeightPx));
      right.forEach((text, index) => line(text, inset + noticeWidth - half, top + index * lineHeightPx,
        half - 2, fontPx, 2, lineHeightPx));
      y += height;
      bar(1, y - 0.5, contentWidth - 2, 0.5, '#777777');
    };

    putLines(layout.issuerLines, 2, noticeWidth - 4, g.issuerFontPx, g.issuerLineHeightPx, 1, { bold: true });
    putLines(layout.officeLines, 2, noticeWidth - 4, layout.fontPx, g.strongLineHeightPx, 1, { bold: true });
    bar(1, y - 0.4, contentWidth - 2, 0.5, '#777777');

    putBand(layout.emailLines || [], layout.addressLines || [],
      g.contactBandHeight, g.smallFontPx, g.smallLineHeightPx);
    putBand(layout.referenceLines || [], layout.dateLines || [],
      g.referenceBandHeight, g.smallFontPx, g.smallLineHeightPx);
    y += g.gap;

    putLines(layout.subjectLines, 2, noticeWidth - 4, layout.fontPx, g.strongLineHeightPx, 1, { bold: true });
    putLines(layout.titleLines, 2, noticeWidth - 4, g.titleFontPx, g.titleLineHeightPx, 1, { bold: true });
    y += g.gap;

    // Justified copy with an opening indent, exactly as the canvas sets it -
    // the first line of each paragraph starts one indent in.
    for (const paragraph of layout.paragraphItems) {
      paragraph.lines.forEach((text, index) => line(
        text, inset + 2 + (index === 0 ? paragraph.indentPx : 0), y + index * g.lineHeightPx,
        Math.max(0, noticeWidth - 4 - (index === 0 ? paragraph.indentPx : 0)),
        layout.fontPx, 0, g.lineHeightPx,
      ));
      y += paragraph.lines.length * g.lineHeightPx + g.gap;
    }

    if (layout.tableTitleLines?.length) {
      putLines(layout.tableTitleLines, 2, noticeWidth - 4, layout.fontPx, g.strongLineHeightPx, 1, { bold: true });
    }
    if (layout.groupLines?.length) {
      layout.groupLines.forEach((lines, index) => lines.forEach((text, i) => line(
        text, index * g.groupWidth + 2, y + i * g.strongLineHeightPx,
        Math.max(0, g.groupWidth - 4), layout.fontPx, 1, g.strongLineHeightPx, { bold: true },
      )));
      y += g.groupHeight;
    }

    if (layout.table) {
      const tableTop = y;
      const rows = [layout.table.header, ...layout.table.rows];
      rows.forEach((row, rowIndex) => {
        if (rowIndex === 0) bar(1, y, contentWidth - 2, row.height, '#f2eded');
        row.cells.forEach((cell, column) => cell.forEach((text, index) => line(
          text, inset + column * layout.table.columnWidth + layout.table.cellPadX,
          y + g.bandPadY + index * g.lineHeightPx,
          Math.max(0, layout.table.columnWidth - layout.table.cellPadX * 2),
          layout.fontPx, rowIndex === 0 ? 1 : 0,
          g.lineHeightPx, { bold: rowIndex === 0 },
        )));
        y += row.height;
        bar(1, y - 0.5, contentWidth - 2, 0.5, '#777777');
      });
      for (let column = 0; column <= layout.table.columnCount; column += 1) {
        bar(inset + column * layout.table.columnWidth, tableTop, 0.5, y - tableTop, '#777777');
      }
      y += g.gap;
    }

    putLines(layout.contactLines, 2, noticeWidth - 4, g.smallFontPx, g.smallLineHeightPx, 0);

    // The close: place and date left, the signature block right.
    if (layout.placeLines?.length || layout.signatoryLines?.length) {
      y += g.gap;
      const closeTop = y;
      let leftY = closeTop;
      (layout.placeLines || []).forEach((text, index) => line(
        text, 2, leftY + index * g.lineHeightPx, half - 4, layout.fontPx, 0, g.lineHeightPx));
      leftY += (layout.placeLines || []).length * g.lineHeightPx;
      (layout.noticeDateLines || []).forEach((text, index) => line(
        text, 2, leftY + index * g.lineHeightPx, half - 4, layout.fontPx, 0, g.lineHeightPx));

      let rightY = closeTop;
      (layout.signatoryLines || []).forEach((text, index) => line(
        text, inset + noticeWidth - half, rightY + index * g.strongLineHeightPx, half - 2,
        layout.fontPx, 1, g.strongLineHeightPx, { bold: true }));
      rightY += (layout.signatoryLines || []).length * g.strongLineHeightPx;
      (layout.designationLines || []).forEach((text, index) => line(
        text, inset + noticeWidth - half, rightY + index * g.smallLineHeightPx, half - 2,
        g.smallFontPx, 1, g.smallLineHeightPx));
      rightY += (layout.designationLines || []).length * g.smallLineHeightPx;
      (layout.signOfficeLines || []).forEach((text, index) => line(
        text, inset + noticeWidth - half, rightY + index * g.smallLineHeightPx, half - 2,
        g.smallFontPx, 1, g.smallLineHeightPx));
      y = closeTop + g.closeHeight;
    }

    if (layout.footerLines?.length) {
      y += g.gap;
      putLines(layout.footerLines, 2, noticeWidth - 4, g.smallFontPx, g.smallLineHeightPx, 0);
    }
    return out;
  }

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
      cell, gridSize, top, headingText, headingFontPx, headingLineHeightPx,
    } = layout.geometry;
    line(headingText, 0, subtitleOffsetPx, contentWidth, headingFontPx, 0,
      headingLineHeightPx, { bold: true, ink: '#8a1428' });
    bar(0, subtitleOffsetPx + headingLineHeightPx - 0.6, contentWidth, 0.6, '#8a1428');
    const isGrid = (value) => Array.isArray(value) && value.length === 9
      && value.every((row) => Array.isArray(row) && row.length === 9);
    const rows = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : [];

    // THE RULES ARE THE PUZZLE.
    //
    // A sudoku without its grid is eighty-one numerals scattered on white
    // paper - unreadable, and unsolvable. The browser drew them as CSS
    // borders on the <td>s (styles.css's `.smart-card-grid-table td`), so
    // they existed on screen and in NO export: the desk approved a puzzle and
    // the press file printed loose digits. Measured on a real card: the whole
    // export emitted `bar=1` - the heading rule - for a card the canvas draws
    // with twenty.
    //
    // Two weights, exactly as the stylesheet has always had and as every
    // printed puzzle sets: a hairline between cells, and a heavier rule on
    // the 3x3 box boundaries and the outer frame, which is what lets the eye
    // find a box at a glance.
    const size = Number(gridSize) || cell * 9;
    const gridLeft = Math.max(0, (contentWidth - size) / 2);
    const gridTop = subtitleOffsetPx + top;
    const HAIRLINE = 0.4;
    const BOX_RULE = 1.2;
    const CELL_INK = '#9a9aa2';
    const BOX_INK = '#333333';
    for (let i = 0; i <= 9; i += 1) {
      const heavy = i % 3 === 0;
      const weight = heavy ? BOX_RULE : HAIRLINE;
      const ink = heavy ? BOX_INK : CELL_INK;
      const at = i * cell;
      // Centred on the join, so the outer frame sits on the grid's own edge
      // rather than half a rule outside it.
      bar(gridLeft + at - weight / 2, gridTop, weight, size, ink);
      bar(gridLeft, gridTop + at - weight / 2, size, weight, ink);
    }

    rows.forEach((row, y) => row.forEach((value, x) => {
      const n = Number(value);
      if (!(n > 0)) return;
      line(devanagari(n), gridLeft + x * cell, gridTop + y * cell, cell, layout.fontPx, 1);
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
    const {
      labelWidth, valueWidth, labelTextWidth, valueTextWidth, cellPadX, cellPadY, lineHeightPx,
    } = layout.geometry;
    let top = subtitleOffsetPx;
    bar(0, top, contentWidth, 0.6, '#8a1428');
    bar(0, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    bar(contentWidth - 0.6, top, 0.6, layout.items.reduce((sum, item) => sum + item.rowHeight, 0), '#8a1428');
    for (const [index, item] of layout.items.entries()) {
      bar(0, top, labelWidth, item.rowHeight, '#fbf2f3');
      if (index % 2 === 1) bar(labelWidth, top, valueWidth, item.rowHeight, '#fcf8f3');
      // Inside the cell's own inset - the solver's number, the same one the
      // canvas writes inline. Setting these flush to the cell edge put the
      // press file's type where the browser's never was.
      line(item.labelLines[0] || '', cellPadX, top + cellPadY + item.textNudgeY,
        labelTextWidth, layout.fontPx, 0, lineHeightPx, { bold: true, ink: '#8a1428' });
      item.valueLines.forEach((text, i) =>
        line(text, labelWidth + cellPadX, top + cellPadY + i * lineHeightPx,
          valueTextWidth, layout.fontPx, 0, lineHeightPx, { bold: true }));
      top += item.rowHeight;
      bar(0, top - 0.4, contentWidth, 0.4, '#d8c4c8');
    }
    bar(labelWidth - 0.25, subtitleOffsetPx, 0.5, top - subtitleOffsetPx, '#dec8cc');
    bar(0, top - 0.6, contentWidth, 0.6, '#8a1428');
    return out;
  }

  if (key === 'suvichar') {
    const g = layout.geometry;
    out.push({ kind: 'bar', x: 0, y: 0, width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });
    out.push({ kind: 'bar', x: 0, y: Math.max(0, (Number(frame.height) || 0) - 0.6), width: Number(frame.width) || contentWidth, height: 0.6, ink: '#8a1428' });

    // The same wrapped, CENTRED column the canvas paints. This used to emit
    // `layout.displayLine` - the quote and its credit run together as one
    // string on one row, left aligned - which was the only shape the old
    // single-line solver could produce. Both surfaces now set the quote over
    // several lines with the credit under its own rule, so the two agree.
    const quoteLines = layout.quoteLines || [];
    const creditLines = layout.attributionLines || [];
    const quoteHeight = Math.max(1, quoteLines.length) * g.lineHeightPx;
    const creditHeight = creditLines.length * g.creditLineHeightPx;
    const blockHeight = quoteHeight + (creditHeight ? g.ruleGap * 2 + creditHeight : 0);
    const boxHeight = (Number(layout.contentBox?.height) || Number(frame.height) || 0) - subtitleOffsetPx;
    let y = subtitleOffsetPx + Math.max(0, (boxHeight - blockHeight) / 2);

    quoteLines.forEach((text) => {
      line(text, g.sideInset, y, g.measureWidth, layout.fontPx, 1, g.lineHeightPx, { bold: true });
      y += g.lineHeightPx;
    });
    if (creditLines.length) {
      y += g.ruleGap;
      bar((contentWidth - g.ruleWidth) / 2, y - 0.35, g.ruleWidth, 0.7, '#8a1428');
      y += g.ruleGap;
      creditLines.forEach((text) => {
        line(text, g.sideInset, y, g.measureWidth, g.creditFontPx, 1, g.creditLineHeightPx, { ink: '#6a5559' });
        y += g.creditLineHeightPx;
      });
    }
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
    const boxHeight = Math.max(0, (Number(layout.contentBox?.height) || Number(frame.height) || 0) - subtitleOffsetPx);

    // ---- one city: the same forecast panel the canvas paints --------------
    if (g.solo) {
      const blockHeight = g.placeHeight + g.conditionHeight + g.gap + g.figureHeight
        + g.gap + g.rainHeight + g.gap + g.sourceHeight;
      // The panel's own rules, top and bottom, and its tinted ground.
      bar(0, subtitleOffsetPx, contentWidth, 0.8, '#8a1428');
      bar(0, subtitleOffsetPx + boxHeight - 0.8, contentWidth, 0.8, '#8a1428');
      let y = subtitleOffsetPx + Math.max(0, (boxHeight - blockHeight) / 2);

      line(layout.placeLine || '', g.inset, y, g.width, g.placeFontPx, 1,
        g.placeHeight, { bold: true, ink: '#8a1428' });
      y += g.placeHeight;
      (layout.conditionLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, layout.fontPx, 1, g.lineHeightPx, { ink: '#4a4147' });
        y += g.lineHeightPx;
      });
      y += g.gap;
      // The two readings, side by side, each over its own caption. The maximum
      // is the paper's accent and the minimum its cold blue, exactly as the
      // canvas sets them - an export that dropped the ink printed one figure
      // where the page showed two.
      (layout.figures || []).forEach((figure, index) => {
        const x = g.inset + index * (g.halfWidth + g.gap);
        line(figure.text, x, y, g.halfWidth, g.figureFontPx, 1, g.figureLineHeightPx,
          { bold: true, ink: figure.kind === 'min' ? '#33506e' : '#8a1428' });
        line(figure.label, x, y + g.figureLineHeightPx, g.halfWidth, g.capFontPx, 1,
          g.capLineHeightPx, { ink: '#6b6264' });
      });
      y += g.figureHeight + g.gap;
      (layout.rainLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, layout.fontPx, 1, g.lineHeightPx, { ink: '#5e5052' });
        y += g.lineHeightPx;
      });
      y += g.gap;
      (layout.sourceLines || []).forEach((text) => {
        line(text, g.inset, y, g.width, g.sourceFontPx, 1, g.sourceLineHeightPx, { ink: '#6b6264' });
        y += g.sourceLineHeightPx;
      });
      return out;
    }

    // ---- several cities: one ruled row each -------------------------------
    let y = subtitleOffsetPx;
    layout.items.forEach((item) => {
      line(item.name, 0, y + g.rowPadding, g.nameWidth, layout.fontPx, 0,
        g.lineHeightPx, { bold: true, ink: '#8a1428' });
      line(item.tempText, g.nameWidth, y + g.rowPadding, Math.max(0, g.tempWidth - 6),
        layout.fontPx, 2, g.lineHeightPx, { bold: true });
      item.restLines.forEach((text, i) => line(
        text, g.nameWidth + g.tempWidth, y + g.rowPadding + i * g.lineHeightPx,
        g.restWidth, layout.fontPx, 0, g.lineHeightPx, { ink: '#5e5052' },
      ));
      y += item.rowHeight;
      bar(0, y - 0.4, contentWidth, 0.4, '#d8c4c8');
    });
    y += GAP;
    (layout.sourceLines || []).forEach((text, index) => line(
      text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 2,
      g.sourceLineHeightPx, { ink: '#6b6264' },
    ));
    return out;
  }

  if (key === 'market') {
    const g = layout.geometry;
    const MARK = { up: '\u25B2', down: '\u25BC', flat: '\u2013' };
    const INK = { up: '#237548', down: '#a51d34', flat: '#6b6264' };
    let y = subtitleOffsetPx;
    layout.titleLines.forEach((text, index) => line(
      text, 0, y + index * g.titleLineHeightPx, contentWidth, g.titleFontPx, 1,
      g.titleLineHeightPx, { bold: true, ink: '#8a1428' },
    ));
    if (layout.asOfLine) {
      line(layout.asOfLine, 0, y + layout.titleLines.length * g.titleLineHeightPx,
        contentWidth, g.headFontPx, 1, g.headLineHeightPx, { ink: '#7a6266' });
    }
    y += g.titleHeight + GAP;

    const rowsTop = y;
    // The rows in their groups, in the same order the canvas paints them - a
    // group head over each, or one plain table when the payload has no groups.
    const groups = g.grouped ? g.groupOrder : [null];
    for (const group of groups) {
      const inGroup = group === null
        ? layout.items
        : layout.items.filter((item) => item.group === group);
      if (!inGroup.length) continue;
      const headLabel = group === null ? '' : (g.groupLabels[group] || '');
      if (headLabel) {
        const headHeight = g.headLineHeightPx + g.rowPadding;
        bar(0, y, contentWidth, headHeight, '#f4e8ea');
        line(headLabel, 2, y, Math.max(0, contentWidth - 4), g.headFontPx, 0,
          g.headLineHeightPx, { bold: true, ink: '#8a1428' });
        y += headHeight;
        bar(0, y - 0.4, contentWidth, 0.4, '#ddcbd0');
      }
      for (const item of inGroup) {
        bar(0, y, contentWidth, item.rowHeight, '#fffafa');
        const textY = y + g.rowPadding;
        line(item.labelText, 2, textY, Math.max(0, g.labelWidth - 4), layout.fontPx, 0,
          g.lineHeightPx, { bold: true, ink: '#4f3036' });
        if (item.unitText) {
          // Beside the name, at the width the SOLVER measured that name at -
          // never re-measured here. layout.js is this project's one width
          // authority for a card and a second estimate in a writer is exactly
          // the drift its own header warns about.
          line(item.unitText,
            2 + (Number(item.labelWidthPx) || 0) + 3, textY,
            Math.max(0, g.labelWidth - 4), g.unitFontPx, 0, g.lineHeightPx, { ink: '#857074' });
        }
        line(item.valueText, g.labelWidth, textY, g.valueWidth - 2, layout.fontPx, 2,
          g.lineHeightPx, { bold: true });
        line(`${MARK[item.direction] || ''} ${item.changeText}`,
          g.labelWidth + g.valueWidth, textY, g.changeWidth - 2, layout.fontPx, 2,
          g.lineHeightPx, { bold: true, ink: INK[item.direction] || '#111111' });
        y += item.rowHeight;
        bar(0, y - 0.4, contentWidth, 0.4, '#ddcbd0');
      }
    }
    bar(0, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(contentWidth - 0.6, rowsTop, 0.6, g.rowsHeight, '#cdaeb4');
    bar(g.labelWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');
    bar(g.labelWidth + g.valueWidth - 0.2, rowsTop, 0.4, g.rowsHeight, '#ddcbd0');

    if (layout.briefLines?.length) {
      y += GAP;
      bar(0, y, contentWidth, g.briefHeight, '#f7f1f2');
      bar(0, y, 2, g.briefHeight, '#8a1428');
      let briefY = y + g.rowPadding * 2;
      layout.briefLabelLines.forEach((text, index) => line(
        text, g.briefInset, briefY + index * g.headLineHeightPx,
        Math.max(0, contentWidth - g.briefInset * 2),
        g.headFontPx, 0, g.headLineHeightPx, { bold: true, ink: '#8a1428' },
      ));
      briefY += layout.briefLabelLines.length * g.headLineHeightPx;
      layout.briefLines.forEach((text, index) => line(
        text, g.briefInset, briefY + index * g.lineHeightPx,
        Math.max(0, contentWidth - g.briefInset * 2), layout.fontPx, 0, g.lineHeightPx,
      ));
      y += g.briefHeight;
    }
    if (layout.noteLines?.length) {
      y += 2;
      layout.noteLines.forEach((text, index) => line(
        text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 0,
        g.sourceLineHeightPx, { ink: '#7a6266' },
      ));
      y += g.noteHeight;
    }
    y += GAP;
    layout.sourceLines.forEach((text, index) => line(
      text, 0, y + index * g.sourceLineHeightPx, contentWidth, g.sourceFontPx, 2, g.sourceLineHeightPx,
      { ink: '#6b6264' },
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
