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
// The head rule's own weight, mirrored by .smart-card-head-rule in styles.css.
const HEAD_RULE_PX = 0.6;

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
  // THE FACE THIS CARD WAS MEASURED IN.
  //
  // print-model.js set EVERY card line in 'serif', and layoutSmartCard()
  // measures most of them in 'sans' - so the card was fitted in one face and
  // printed in another. Measured across a chart's own strings, the plate sets
  // them 5-17% narrower than the box they were fitted to, worst on Devanagari
  // digits (16.7%), which is exactly what a value column is made of. That is
  // the two-surface fault this codebase guards hardest against, and it had
  // been true of every card since the walk was written.
  //
  // A card names the face it measures in, once, here - and `line()` carries it
  // out so every writer sets what the solver measured. Serif is the default
  // because that is what most cards measure their reading matter in, and what
  // this walk has always emitted.
  const CARD_FACES = {
    chart: 'sans', havaman: 'sans', market: 'sans', table: 'sans',
  };
  // A face the DESK chose for this card wins over the card's own default -
  // layout.js solved every measurement in it, so the plate has to set it or
  // the card is fitted in one face and printed in another all over again.
  const face = layout.family || CARD_FACES[String(key)] || 'serif';
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
  // पंचांग and राशीभविष्य are ruled like every other card in the paper's accent -
  // heavy outside, hairline inside - which is what a printed almanac or
  // horoscope box carries and what distinguishes a standing feature from an
  // ordinary story block. The canvas draws it with two inset rings
  // (styles.css, `.smart-card-panchang .smart-card-content`); a plate that
  // omitted it would print the same card unruled, which is the two-surface
  // fault this walk exists to prevent.
  // EVERY CARD IS RULED, AND THE PAPER HAS TWO INKS FOR IT.
  //
  // A standing feature of the paper carries the accent (सुविचार, दिनविशेष,
  // पंचांग, राशिभविष्य, हवामान, बाजार, सुडोकू); a commercial block carries
  // black, because an advertisement and a प्रकटपत्र are not the paper speaking.
  // The almanac and the horoscope keep the DOUBLE band - heavy outside,
  // hairline inside - which is what distinguishes those two from an ordinary
  // ruled box in a printed daily.
  //
  // This table is read here and mirrored by `.smart-card-<key>` in styles.css.
  // It is not a second geometry: a border is ink at the frame's own edge, so
  // both surfaces need only the frame, which both already have.
  // The one border catalogue, from the shared module - never a second copy
  // here. The solver already stood each ruled card's content clear of its own
  // rule (cardRuleFor().clearancePx), so this only lays the ink down.
  const border = (cardLayout.CARD_BORDERS || {})[key];
  if (border) {
    // The card's own borderBox: the BLOCK's own edge, so the four sides are
    // one rule at one distance from the paper's grid whatever furniture the
    // card puts inside itself. Every entry in this walk is placed relative to
    // the content box, so the rule is offset back to where it belongs.
    const box = layout.borderBox || layout.contentBox || {};
    const w = Number(box.width) || contentWidth;
    const h = Number(box.height) || Number(frame.height) || 0;
    const dx = (Number(box.x) || 0) - (Number(layout.contentBox?.x) || 0);
    const dy = (Number(box.y) || 0) - (Number(layout.contentBox?.y) || 0);
    const ring = (offset, weight) => {
      out.push({ kind: 'bar', x: dx + offset, y: dy + offset, width: w - offset * 2, height: weight, ink: border.ink });
      out.push({ kind: 'bar', x: dx + offset, y: dy + h - offset - weight, width: w - offset * 2, height: weight, ink: border.ink });
      out.push({ kind: 'bar', x: dx + offset, y: dy + offset, width: weight, height: h - offset * 2, ink: border.ink });
      out.push({ kind: 'bar', x: dx + w - offset - weight, y: dy + offset, width: weight, height: h - offset * 2, ink: border.ink });
    };
    ring(0, Number(border.weightPx) || 0.6);
  }

  // The head rule - the hairline closing a nameplate or a subtitle off from
  // the box under it. Stated by the solver in the card's own coordinates, so
  // the plate draws it exactly where the canvas does.
  if (layout.headRule) {
    out.push({
      kind: 'bar',
      x: (Number(layout.headRule.x) || 0) - (Number(layout.contentBox?.x) || 0),
      y: (Number(layout.headRule.y) || 0) - (Number(layout.contentBox?.y) || 0),
      width: Number(layout.headRule.width) || 0,
      height: HEAD_RULE_PX,
      ink: (cardLayout.CARD_BORDERS[key] || {}).ink || '#8a1428',
    });
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
      // The card's own face, unless this particular line says otherwise - a
      // सुविचार sets its quote in serif and its credit in sans, so a card is
      // not always one face throughout.
      family: style.family || face,
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
    // AND EVERY READING'S OWN INK, off that same solve. A reading may name a
    // colour of its own now, so the plate reads `item.ink` rather than deriving
    // one here - deriving it is how a pie's slices could have printed in shades
    // the screen never drew. The fallback covers a geometry solved before
    // per-reading ink existed.
    const inkOf = (item, index) => item?.ink || cardLayout.sliceInk(index, ACCENT);
    let y = subtitleOffsetPx;
    if (g.chartType === 'stat') {
      const perBand = Math.max(1, g.columns);
      layout.items.forEach((item, index) => {
        const column = index % perBand;
        const band = Math.floor(index / perBand);
        const x = column * g.columnWidth;
        const top = y + band * g.bandHeight;
        line(item.valueText, x, top, g.columnWidth, g.figurePx, 1, g.figureLine, { ink: inkOf(item, index), bold: true });
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
        // EACH SLICE IN ITS OWN RESOLVED HEX. Where the desk has not chosen
        // one, rowInk() gives back the tint of the chart's single ink this
        // line used to compute - a newspaper prints a pie in tints of one ink,
        // not in a rainbow - so an untouched pie is unchanged to the byte.
        const ink = inkOf(item, index);
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
        poly(cardLayout.arcPoints(item.x, y + item.y, g.dotRadius, 0, 1, { centre: false }), inkOf(item, index), { close: true });
        line(item.valueText, item.x - g.step / 2, y + item.y - g.valueBand,
          g.step || frame.width, layout.fontPx, 1, null, { bold: true, ink: inkOf(item, index) });
        line(item.label, item.x - g.step / 2, y + g.valueBand + g.plotHeight,
          g.step || frame.width, layout.fontPx, 1);
      });
      y += g.valueBand + g.plotHeight + g.labelBand;
    } else {
      const barHeight = Math.max(2, g.lineHeightPx * 0.62);
      layout.items.forEach((item, index) => {
        line(item.label, 0, y, g.labelWidth, layout.fontPx, 0);
        bar(g.labelWidth, y + (g.rowHeight - barHeight) / 2, item.barWidth, barHeight, inkOf(item, index));
        line(item.valueText, g.labelWidth + g.trackWidth + 2, y, g.valueWidth, layout.fontPx, 2, null, { bold: true });
        y += g.rowHeight;
      });
    }
    if (g.source) line(g.source, 0, y, contentWidth, layout.fontPx * 0.85, 0);
    return out;
  }

  if (key === 'table') {
    // The same resolved geometry the canvas places, in the same order: the
    // head, its rule, then a row and its hairline. Nothing is measured here -
    // every cell was fitted to its own column by the solver.
    const g = layout.geometry;
    let y = subtitleOffsetPx;
    if (g.showHead) {
      (g.head || []).forEach((text, i) =>
        line(text, g.x[i] + g.pad, y, Math.max(0, g.widths[i] - g.pad * 2), layout.fontPx, 0, g.lineHeightPx, { bold: true }));
      bar(0, y + g.rowHeight - g.rulePx, contentWidth, g.rulePx, g.ink);
      y += g.rowHeight;
    }
    layout.items.forEach((row, r) => {
      row.cells.forEach((text, i) =>
        line(text, g.x[i] + g.pad, y, Math.max(0, g.widths[i] - g.pad * 2), layout.fontPx, 0, g.lineHeightPx));
      if (r < layout.items.length - 1) bar(0, y + g.rowHeight - g.rulePx, contentWidth, g.rulePx, '#cfcfcf');
      y += g.rowHeight;
    });
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
      bandHeight, bandAfterRow,
    } = layout.geometry;
    // The nameplate's band, taken out of the card's middle. Every row below it
    // is pushed down by exactly its depth - the same offset the canvas applies
    // as an extra grid track.
    const banded = bandHeight > 0 && bandAfterRow >= 0;
    const bandOffset = (row) => (banded && row >= bandAfterRow ? bandHeight : 0);
    layout.items.forEach((item, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const rowTop = rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0) + bandOffset(row);
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
      const y = subtitleOffsetPx
        + rowHeights.slice(0, row + 1).reduce((sum, value) => sum + value, 0)
        + bandOffset(row) - 0.5;
      bar(0, y, contentWidth, 0.5, '#d5c7c9');
    });
    // THE BAND IS RULED ON BOTH SIDES, and the column opens with a rule.
    // Every sign draws its own BOTTOM rule, so the row above the band closed
    // with one and the row below it opened with nothing - the canvas says so
    // with :first-child and .is-after-band, and this walk said it with
    // neither.
    bar(0, subtitleOffsetPx, contentWidth, 0.5, '#d5c7c9');
    if (banded) {
      const above = rowHeights.slice(0, bandAfterRow).reduce((sum, h) => sum + h, 0);
      bar(0, subtitleOffsetPx + above + bandHeight, contentWidth, 0.5, '#d5c7c9');
    }
    if (layout.geometry.columns > 1) {
      // Two runs where a band splits the column, so the rule does not cross
      // the nameplate.
      const total = rowHeights.reduce((sum, height) => sum + height, 0);
      const x = columnWidth + columnGap / 2 - 0.25;
      if (banded) {
        const above = rowHeights.slice(0, bandAfterRow).reduce((sum, h) => sum + h, 0);
        bar(x, subtitleOffsetPx, 0.5, above, '#d5c7c9');
        bar(x, subtitleOffsetPx + above + bandHeight, 0.5, total - above, '#d5c7c9');
      } else {
        bar(x, subtitleOffsetPx, 0.5, total, '#d5c7c9');
      }
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
    // No top/bottom rules of its own: CARD_BORDERS already rings this card on
    // all four sides, and a second pair here made the strip read as a band.

    // The same wrapped, CENTRED column the canvas paints. This used to emit
    // `layout.displayLine` - the quote and its credit run together as one
    // string on one row, left aligned - which was the only shape the old
    // single-line solver could produce. Both surfaces now set the quote over
    // several lines with the credit under its own rule, so the two agree.
    const quoteLines = layout.quoteLines || [];
    const creditLines = layout.attributionLines || [];

    // ONE LINE, CREDIT RUNNING ON. The strip's quote and its credit share a
    // row, so they are two runs at one baseline, placed from the SOLVER's own
    // measured quote width - never re-measured here, which is the rule this
    // file's header states.
    // `g.strip`, not `g.inlineCredit` - the canvas switches on the same flag,
    // and a one-line quote with no attribution is still a strip.
    if (g.strip) {
      // The solver placed the row: its box IS the row's own width and the
      // first line's top is stated. Centring it again here would put the
      // plate's strip somewhere the canvas never had it.
      const top = subtitleOffsetPx + (Number(g.firstLineTopPx) || 0);
      line(quoteLines[0] || '', 0, top, g.quoteInlineWidth, layout.fontPx, 0,
        g.lineHeightPx, { bold: true });
      if (g.creditText && g.inlineCredit) {
        line(g.creditText, g.quoteInlineWidth + g.creditGap, top,
          g.creditInlineWidth, g.creditFontPx, 0, g.lineHeightPx, { ink: '#6a5559', family: 'sans' });
      }
      return out;
    }

    const quoteHeight = Math.max(1, quoteLines.length) * g.lineHeightPx;
    const creditHeight = creditLines.length * g.creditLineHeightPx;
    const blockHeight = quoteHeight + (creditHeight ? g.ruleGap * 2 + creditHeight : 0);
    const boxHeight = (Number(layout.contentBox?.height) || Number(frame.height) || 0) - subtitleOffsetPx;
    let y = subtitleOffsetPx + (Number(g.firstLineTopPx) || Math.max(0, (boxHeight - blockHeight) / 2));

    quoteLines.forEach((text) => {
      line(text, g.sideInset, y, g.measureWidth, layout.fontPx, 1, g.lineHeightPx, { bold: true });
      y += g.lineHeightPx;
    });
    if (creditLines.length) {
      y += g.ruleGap;
      bar((contentWidth - g.ruleWidth) / 2, y - 0.35, g.ruleWidth, 0.7, '#8a1428');
      y += g.ruleGap;
      creditLines.forEach((text) => {
        line(text, g.sideInset, y, g.measureWidth, g.creditFontPx, 1, g.creditLineHeightPx, { ink: '#6a5559', family: 'sans' });
        y += g.creditLineHeightPx;
      });
    }
    return out;
  }

  if (key === 'dinvishesh') {
    const { lineHeightPx, textInset, rowGap, centred, boxed } = layout.geometry;
    const stackHeight = Math.max(0, layout.items.reduce((sum, item) => sum + item.height, 0)
      + Math.max(0, layout.items.length - 1) * rowGap);

    // दिनविशेष IS A BOX. One hairline round the whole card - not the almanac's
    // double band, which on a 190px box is all rule - drawn here as well as in
    // the stylesheet, or the plate prints the same card unruled.
    if (boxed) {
      const w = Number(layout.contentBox?.width) || contentWidth;
      const h = Number(layout.contentBox?.height) || Number(frame.height) || 0;
      bar(0, 0, w, 0.6, '#8a1428');
      bar(0, h - 0.6, w, 0.6, '#8a1428');
      bar(0, 0, 0.6, h, '#8a1428');
      bar(w - 0.6, 0, 0.6, h, '#8a1428');
    }

    // The entries CENTRED, with the mark set into the line rather than hanging
    // beside it - a hanging mark on a centred entry points at nothing, which is
    // why the spine rule goes with it. The alignment flag is the solver's, read
    // by both surfaces, so the canvas and the plate cannot centre differently.
    // Centred in its own box, the same air above the first entry as below the
    // last - the canvas gets it from `align-content: center`, this reads the
    // solver's own number so the two cannot differ.
    let top = subtitleOffsetPx + (Number(layout.geometry.topOffset) || 0);
    if (!centred) {
      bar(1.45, top, 0.6, stackHeight, '#d5a9b0');
    }
    for (const item of layout.items) {
      if (centred) {
        // THE MARK OPENS THE ENTRY, ONCE. It used to be prefixed to every
        // line, so a two-line anniversary printed as two bulleted entries -
        // the plate saying the paper carries three when the desk approved
        // two. The canvas has always drawn it once; this is that.
        const mark = item.symbol === 'flag' ? '\u25c6' : item.symbol;
        item.lines.forEach((text, i) => line(
          i === 0 ? `${mark} ${text}` : text,
          0, top + i * lineHeightPx, contentWidth, layout.fontPx, 1, lineHeightPx,
        ));
        top += item.height + rowGap;
        continue;
      }
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
      // No rules of its own: CARD_BORDERS rings this card on all four sides,
      // and a heavier pair here made the box read as a band top and bottom
      // with hairlines down the sides.
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
    // A printed panel starts at the top of its own box. What the card has
    // spare opens the gaps BETWEEN its bands (g.gap, resolved by the solver
    // and written inline by the canvas), never a hole at the head.
    const BAND = g.gap || GAP;
    let y = subtitleOffsetPx;
    layout.titleLines.forEach((text, index) => line(
      text, 0, y + index * g.titleLineHeightPx, contentWidth, g.titleFontPx, 1,
      g.titleLineHeightPx, { bold: true, ink: '#8a1428' },
    ));
    if (layout.asOfLine) {
      line(layout.asOfLine, 0, y + layout.titleLines.length * g.titleLineHeightPx,
        contentWidth, g.headFontPx, 1, g.headLineHeightPx, { ink: '#7a6266' });
    }
    y += g.titleHeight + BAND;

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

    // The month's line, from the solver's own normalised points - the same
    // list the browser's <svg> draws, emitted as the `poly` every other chart
    // in this product uses. Two roundings of one curve is the drift this file
    // exists to prevent.
    if (layout.trend) {
      const axis = layout.trend.axis;
      y += BAND;
      line(layout.trend.headLine, 0, y, contentWidth, g.trendLabelFontPx, 0,
        g.trendLabelLineHeightPx, { bold: true, ink: '#8a1428' });
      const plotTop = y + g.trendLabelLineHeightPx + 2;
      const plotBottom = plotTop + layout.trend.plotHeight;
      // The writers take a poly's points as [x, y] PAIRS (scribus.service.js's
      // polyFrame destructures them, and the PDF/IDML walks match); the
      // solver states them as {x, y} because that is what the browser's <svg>
      // consumes. One conversion, here, at the boundary between the two.
      const shift = (points) => points.map((pt) => [pt.x, plotTop + pt.y]);
      // The scale, drawn before the line so the line sits over it.
      bar(axis.width, plotTop, contentWidth - axis.width, 0.6, '#ddcbd0');
      bar(axis.width, plotTop + layout.trend.plotHeight / 2, contentWidth - axis.width, 0.5, '#eadfe1');
      bar(axis.width, plotTop, 0.6, layout.trend.plotHeight, '#c9aeb3');
      out.push({
        kind: 'poly', points: shift(layout.trend.area), ink: layout.trend.ink,
        close: true, opacity: 0.12,
      });
      out.push({
        kind: 'poly', points: shift(layout.trend.points), ink: layout.trend.ink,
        close: false, strokeWidth: 1.1,
      });
      bar(0, plotBottom, contentWidth, 0.4, '#ddcbd0');
      // y axis: the high at the top of the plot, the low at its foot - the two
      // figures a reader can check against the rate table above.
      line(axis.highLabel, 0, plotTop, Math.max(0, axis.width - 3), g.trendFootFontPx, 2,
        g.trendFootLineHeightPx, { ink: '#7a6266' });
      line(axis.lowLabel, 0, plotBottom - g.trendFootLineHeightPx, Math.max(0, axis.width - 3),
        g.trendFootFontPx, 2, g.trendFootLineHeightPx, { ink: '#7a6266' });
      // x axis: the first and last session, and what the month did between them.
      const footY = plotBottom + 2;
      line(axis.fromLabel, axis.width, footY, axis.plotWidth, g.trendFootFontPx, 0,
        g.trendFootLineHeightPx, { ink: '#7a6266' });
      line(`${axis.sessionsLabel} ${axis.changeLabel}`.trim(), axis.width, footY, axis.plotWidth,
        g.trendFootFontPx, 1, g.trendFootLineHeightPx, { ink: '#7a6266' });
      line(axis.toLabel, axis.width, footY, axis.plotWidth, g.trendFootFontPx, 2,
        g.trendFootLineHeightPx, { ink: '#7a6266' });
      y += g.trendHeight;
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
    // NO PANEL RULE HERE. The advert's own ring is drawn once at the block's
    // edge from cardRuleFor(), like every other card's; this walk used to lay
    // a second 1.2px box down 2.6px inside it, so the plate carried the double
    // border the canvas had already lost.
    const rel = (rect) => ({
      x: (Number(rect.x) || 0),
      y: subtitleOffsetPx + (Number(rect.y) || 0),
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
    });

    // The artwork is a first-class item, so it reaches Scribus, the PDF, the
    // IDML and Word from this same walk rather than being browser-only
    // decoration that disappears from the printed paper. Where it goes is the
    // solver's rectangle, whichever of the five shapes this advert is.
    if (g.art && g.imageUrl) {
      const box = rel(g.art);
      out.push({ kind: 'image', file: g.imageUrl, x: box.x, y: box.y, width: box.width, height: box.height });
    }
    // The चौकट: one rule inside the card's ring.
    if (g.frameStyle === 'double' && g.frameInk > 0) {
      const inset = g.framePad - g.frameInk;
      const w = Math.max(0, (Number(frame.width) || contentWidth) - inset * 2);
      const h = Math.max(0, (Number(frame.height) || 0) - inset * 2);
      bar(inset, subtitleOffsetPx + inset, w, g.frameInk, '#202024');
      bar(inset, subtitleOffsetPx + inset + h - g.frameInk, w, g.frameInk, '#202024');
      bar(inset, subtitleOffsetPx + inset, g.frameInk, h, '#202024');
      bar(inset + w - g.frameInk, subtitleOffsetPx + inset, g.frameInk, h, '#202024');
    }
    // A poster's reversed panel goes down BEFORE its type, exactly as the
    // canvas paints it and as a .sla must be ordered.
    if (g.panel) {
      const box = rel(g.panel);
      bar(box.x, box.y, box.width, box.height, '#101014');
    }
    if (g.frameStyle === 'rule') {
      const box = rel(g.typeBox);
      const hair = Number(g.frameHairPx) || 1.2;
      bar(box.x, box.y - hair, box.width, hair, '#202024');
      bar(box.x, box.y + box.height, box.width, hair, '#202024');
    }

    const type = rel(g.typeBox);
    const textX = type.x + g.inset;
    const align = g.align === 'centre' ? 1 : 0;
    const reversed = Boolean(g.reversed);
    const ink = (normal, light) => (reversed ? light : normal);
    let y = type.y + g.rowGap;

    const put = (lines, fontPx, height, style = {}) => {
      (lines || []).forEach((text) => {
        line(text, textX, y, g.measureWidth, fontPx, align, height, style);
        y += height;
      });
    };

    put(layout.nameLines, g.nameFontPx, g.nameLineHeightPx, { bold: true, ink: ink('#8a1428', '#f0c9cf') });
    if (layout.shoutLines?.length) y += g.rowGap;
    put(layout.shoutLines, g.shoutFontPx, g.shoutLineHeightPx, { bold: true, ink: ink('#101014', '#ffffff') });
    put(layout.standLines, g.standFontPx, g.standLineHeightPx, { ink: ink('#3d3439', '#ffffff') });
    if (layout.detailLines?.length) y += g.rowGap;
    put(layout.detailLines, layout.fontPx, g.lineHeightPx, { ink: ink('#2a2427', '#ffffff') });
    if (layout.offerLines?.length) {
      y += g.rowGap;
      // Whichever way this shape sets its offer: reversed out of the accent,
      // between two rules, or as plain type.
      if (g.offerStyle === 'reverse') {
        bar(type.x, y, type.width, g.offerHeight, '#8a1428');
      } else if (g.offerStyle === 'rule') {
        bar(textX, y, g.measureWidth, 0.6, '#8a1428');
        bar(textX, y + g.offerHeight - 0.6, g.measureWidth, 0.6, '#8a1428');
      }
      const offerTop = y + (g.offerStyle === 'plain' ? 0 : g.rowGap);
      layout.offerLines.forEach((text, index) => line(
        text, textX, offerTop + index * g.lineHeightPx, g.measureWidth, layout.fontPx, align,
        g.lineHeightPx, { bold: true, ink: g.offerStyle === 'reverse' ? '#ffffff' : '#8a1428' },
      ));
      y += g.offerHeight;
    }
    if (layout.contactLines?.length) {
      y += g.rowGap;
      bar(textX, y - 0.6, g.measureWidth, 0.6, '#8a1428');
      put(layout.contactLines, g.smallFontPx, g.smallLineHeightPx, { bold: true, ink: ink('#171719', '#ffffff') });
    }
    put(layout.addressLines, g.smallFontPx, g.smallLineHeightPx, { ink: ink('#4a4147', '#ffffff') });
    if (layout.footerLines?.length) y += g.rowGap;
    put(layout.footerLines, g.smallFontPx, g.smallLineHeightPx, { ink: ink('#6b6264', '#ffffff') });
    return out;
  }

  if (key === 'tender') {
    const g = layout.geometry;
    const half = g.halfWidth;
    // Inside the notice's own rule and inset - the same corridor the solver
    // measured its lines against, and the same one the canvas draws in.
    const inset = Number(g.frameInsetPx) || 0;
    const noticeWidth = Number(g.noticeWidth) || Math.max(0, contentWidth - inset * 2);
    // NO NOTICE RULE HERE either - see the advert branch. The प्रकटपत्र's ring
    // is the card's own, drawn once at the block's edge.
    let y = subtitleOffsetPx + g.gap;
    const putLines = (lines, x, width, fontPx, height, align = 0, style = {}) => {
      lines.forEach((text, index) => line(text, x, y + index * height, width, fontPx, align, height, style));
      y += lines.length * height;
    };
    // The two ends of a ruled band, and the rule under it.
    const putBand = (left, right, height, fontPx, lineHeightPx, leftWidth, rightWidth) => {
      if (!height) return;
      const top = y + g.bandPadY;
      const lw = leftWidth || half;
      const rw = rightWidth || half;
      left.forEach((text, index) => line(text, inset + 2, top + index * lineHeightPx,
        lw - 4, fontPx, 0, lineHeightPx));
      right.forEach((text, index) => line(text, inset + noticeWidth - rw, top + index * lineHeightPx,
        rw - 2, fontPx, 2, lineHeightPx));
      y += height;
      bar(1, y - 0.5, contentWidth - 2, 0.5, '#777777');
    };

    putLines(layout.issuerLines, 2, noticeWidth - 4, g.issuerFontPx, g.issuerLineHeightPx, 1, { bold: true });
    putLines(layout.officeLines, 2, noticeWidth - 4, layout.fontPx, g.strongLineHeightPx, 1, { bold: true });
    bar(1, y - 0.4, contentWidth - 2, 0.5, '#777777');

    putBand(layout.emailLines || [], layout.addressLines || [],
      g.contactBandHeight, g.smallFontPx, g.smallLineHeightPx,
      g.emailWidth, g.addressWidth);
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

  // Every key this walk handles has returned by now. What used to follow was a
  // SECOND, unreachable copy of the whole branch chain - chart, sudoku, rashi,
  // panchang, suvichar, dinvishesh, havaman, market, tender again, 465 lines,
  // left behind when the live set above was rewritten. It was a strict subset
  // (it never gained an `advert` branch), so nothing reached it and nothing
  // could: the branch for each key above ends in `return out`. Confirmed by
  // deleting it and re-running the canvas-against-export sweep of all nine
  // cards unchanged. A second copy of a card's geometry is precisely the drift
  // this file exists to prevent, and one sitting where no test can execute it
  // is the worst kind.

  return out;
}

module.exports = { smartCardLines };
