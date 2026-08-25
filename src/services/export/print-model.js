// THE EDITION AS ONE NEUTRAL, ALREADY-POSITIONED DOCUMENT.
//
// WHY THIS EXISTS. `scribus.service.js` walks the composition and emits .sla
// XML in the same breath. That was right while Scribus was the only
// destination. It is not right for four: InDesign, Word and a CMYK press PDF
// would each need the same walk, and four walks of the same composition is
// exactly the duplicated-catalog failure this project has already been bitten
// by twice (the drifted template keys, `object-fit: cover` against `contain`).
//
// So the walk happens ONCE, here, and produces a list of placed items. Every
// writer under this folder renders that list and decides nothing about where
// anything goes. If two exports disagree about a position, the bug is in one
// writer, not in a second layout engine.
//
// UNITS. Everything in this model is MILLIMETRES from the top-left of the
// PAGE, and every type size is POINTS. The editor works in pixels at 2 px/mm;
// the conversion happens here, once, explicitly - never silently downstream.
// (CLAUDE.md: "never mix these silently; conversion must be explicit".)
//
// It composes through the exact compositor and refuses the fallback shaper,
// for the same reason scribus.service.js does: a page that went to the plate
// measured against raw hmtx advances is not a conservative press file, it is a
// wrong one - a Devanagari conjunct is overstated by up to 80%.

const { geometryOf, pxToMm, regionForPage, HEADER } = require('../../layout/geometry');
/** The folio strip's own declared height, from the one page-region model. */
const HEADER_FOLIO_PX = HEADER.folioHeightPx;
const { identityFor, dateLine, devanagari } = require('../../layout/identity');
const { strip } = require('../../layout/plain-text');
const { captionBox, PLACED_CAPTION_METRICS } = require('../../../public/editor/layout/caption-geometry');
const { borderEdges, borderWidthPx, isDouble } = require('../../../public/editor/layout/borders');
const { panelsOf, panelLayout } = require('../../../public/editor/layout/inset-panels');
const { overlaysOf } = require('../../../public/editor/layout/page-overlays');
const { smartCardLines } = require('./smart-card-lines');

/** Editor pixels to millimetres. The one conversion, stated once. */
const mm = (px) => Number(pxToMm(px).toFixed(4));
/** Editor pixels to points. 2 px/mm, 72 pt/inch, 25.4 mm/inch. */
const pt = (px) => Number(((Number(px) / 2) * 72 / 25.4).toFixed(3));

let modules = null;

async function ensureComposeReady() {
  if (!modules) {
    const [metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent, compose, columnRules] =
      await Promise.all([
        import('../../../public/editor/compose/font-metrics.js'),
        import('../../../public/editor/compose/shaper.js'),
        import('../../../public/editor/compose/section-adapter.js'),
        import('../../../public/editor/layout/rich-text.js'),
        import('../../../public/editor/smart-cards/smart-cards.js'),
        import('../../../public/editor/smart-cards/layout.js'),
        import('../../../public/editor/layout/text-flow.js'),
        import('../../../public/editor/layout/image-geometry.js'),
        import('../../../public/editor/compose/accent.js'),
        import('../../../public/editor/compose/compose.js'),
        import('../../../public/editor/canvas/column-rules.js'),
      ]);
    modules = { metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent, compose, columnRules };
  }
  await Promise.all([modules.metrics.ensureFontsLoaded(), modules.shaper.ensureShaperReady()]);
  modules.shaper.requireShaperReady();
  return modules;
}

// ------------------------------------------------------------------ items ---
//
// Four kinds, and no more. A writer that cannot express one of them says so
// rather than inventing a fifth.
//
//   { kind: 'fill',  x, y, width, height, ink }
//   { kind: 'text',  x, y, width, height, baseline, align, runs: [{ text,
//                    family, weight, bold, italic, underline, sizePt, ink }] }
//
// `baseline` is the compositor's OWN baseline for that line (compose.js sets
// it as `y + fontPx * faceAscent()`), in mm from the page top. A writer that
// re-derived it from the box would be a second opinion about where type sits,
// and the two would drift the first time a row grew for a larger run.
//   { kind: 'image', x, y, width, height, file, scaleX, scaleY, offsetX,
//                    offsetY, rotation }
//   { kind: 'rule',  x, y, width, height, ink }
//
// `ink` is a hex string or null for black. `file` is a path relative to the
// public directory, which is what the package writers resolve against.

const textItem = (box, runs, align = 'left') => (runs.some((run) => run.text)
  ? { kind: 'text', ...box, align, runs: runs.filter((run) => run.text) }
  : null);

/** The same box, carrying the compositor's own baseline for the line in it. */
const lineItem = (box, baselineMm, runs, align = 'left') => {
  const item = textItem(box, runs, align);
  if (item) item.baseline = baselineMm;
  return item;
};

const run = (text, { family = 'sans', weight = 400, bold = false, italic = false,
  underline = false, fontPx = 12, ink = null } = {}) => ({
  text: String(text ?? ''), family, weight, bold, italic, underline, sizePt: pt(fontPx), ink,
});

// -------------------------------------------------------------- one block ---

const ACCENT_INK = '#c8102e';
const REVERSE_BLEED_PX = 2;

async function blockItems(section, { mono = false } = {}) {
  const { adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent } = await ensureComposeReady();
  const items = [];
  const x0 = mm(section.x_px);
  const y0 = mm(section.y_px);

  const holdsCard = Boolean(section.smart_card_key) && Boolean(section.smart_card_data)
    && smartCards.canRenderSmartCard(section.smart_card_key);

  // Exactly the composition scribus.service.js takes: a Smart Card is never
  // prose, so it composes with an empty body and no images and its bands stay
  // exact.
  const composition = holdsCard
    ? adapter.composeSection({ ...section, images: [], body: '' }, { ...section, body: '' })
    : adapter.composeSection(section, section);

  // The block's ground goes down FIRST, because every writer here paints in
  // document order and this is what the rest of the block is printed on.
  if (section.background_color) {
    items.push({
      kind: 'fill', x: x0, y: y0,
      width: mm(section.width_px), height: mm(section.height_px),
      ink: section.background_color,
    });
  }

  // THE BLOCK'S OWN RULES, which no export drew.
  //
  // `border_style` has been a column since the schema was written and the
  // canvas has drawn it since. Neither the .sla nor the print model drew
  // anything at all - so a block a desk boxed printed boxed on the website and
  // unruled in every download. Found by grepping this file for `border` and
  // getting nothing back.
  //
  // Drawn after the ground and before the type, which is the order a printer
  // lays them down, and at the width the desk specified rather than at a
  // number written into a stylesheet.
  const edges = borderEdges(section.border_style);
  if (edges.length) {
    const weight = borderWidthPx(section.border_width_px);
    const w = mm(section.width_px);
    const h = mm(section.height_px);
    const t = mm(weight);
    // A DOUBLE RULE IS DRAWN AS TWO RULES, never as one thicker one. The eye
    // reads two thin lines as a boundary and one thick line as emphasis, and
    // those are different statements - which is the whole reason a printer
    // owns the device. The inner pass is inset by twice the weight: line, gap,
    // line, and the gap is the same weight as the lines.
    const passes = isDouble(section.border_style) ? [0, weight * 2] : [0];
    for (const offset of passes) {
      const o = mm(offset);
      const RULES = {
        top: { x: x0 + o, y: y0 + o, width: w - o * 2, height: t },
        bottom: { x: x0 + o, y: y0 + h - o - t, width: w - o * 2, height: t },
        left: { x: x0 + o, y: y0 + o, width: t, height: h - o * 2 },
        right: { x: x0 + w - o - t, y: y0 + o, width: t, height: h - o * 2 },
      };
      for (const edge of edges) items.push({ kind: 'rule', ...RULES[edge], ink: RULE_INK });
    }
  }

  const bands = composition.bands || {};
  const headlineBand = bands.headline;
  const headlineSegments = headlineBand
    ? accent.headlineSegments(headlineBand.lines.map((line) => line.text),
      { accentStyle: section.headline_style === 'accent' })
    : null;

  // A reversed headline is white type out of a solid panel, and the panel is
  // laid down first. A file that emitted the white type without the panel
  // would print nothing at all where the lead's headline should be.
  const reversed = section.headline_style === 'reverse';
  if (reversed && headlineBand?.lines?.length) {
    items.push({
      kind: 'fill',
      x: x0 + mm(composition.content.left),
      y: y0 + mm(headlineBand.top - REVERSE_BLEED_PX),
      width: mm(composition.content.measure),
      height: mm(headlineBand.height + REVERSE_BLEED_PX * 2),
      ink: ACCENT_INK,
    });
  }

  for (const [key, band] of Object.entries(bands)) {
    if (!band?.lines?.length) continue;
    band.lines.forEach((line, index) => {
      const runs = key === 'headline' && headlineSegments
        ? (headlineSegments[index] || []).map((segment) => run(segment.text, {
          family: line.family, weight: line.weight, fontPx: line.fontPx,
          ink: segment.accent ? ACCENT_INK : (reversed ? '#ffffff' : null),
        }))
        : richText.styledRuns(line.text, line.at || 0, band.marks || [], line.fontPx)
          .map((piece) => run(piece.text, {
            family: line.family, weight: piece.bold ? 700 : line.weight,
            bold: Boolean(piece.bold), italic: Boolean(piece.italic), underline: Boolean(piece.underline),
            fontPx: piece.fontPx || line.fontPx,
            ink: piece.colour || (reversed && key === 'headline' ? '#ffffff' : null),
          }));
      items.push(lineItem({
        x: x0 + mm(line.x), y: y0 + mm(line.y),
        // `measure` is the gap the line was offered; `width` is what was
        // actually drawn there. A one-word headline wider than the measure is
        // set anyway and spills, so the frame must be at least as wide.
        width: mm(Math.max(line.width || 0, line.measure)), height: mm(line.height),
      }, y0 + mm(line.baseline), runs));
    });
  }

  if (holdsCard) {
    const frame = smartCardLayout.smartCardFrameFromComposition(composition);
    const originX = x0 + mm(composition.content.left);
    const originY = y0 + mm(composition.bodyTop);
    const ALIGN = ['left', 'center', 'right'];
    for (const line of smartCardLines(section.smart_card_key, section.smart_card_data, frame, smartCardLayout)) {
      // A chart's bars are rectangles, which is a kind this model already has.
      if (line.kind === 'bar') {
        items.push({
          kind: 'fill',
          x: originX + mm(line.x), y: originY + mm(line.y),
          width: mm(line.width), height: mm(line.height),
          ink: line.ink || ACCENT_INK,
        });
        continue;
      }
      items.push(textItem(
        { x: originX + mm(line.x), y: originY + mm(line.y), width: mm(line.width), height: mm(line.height) },
        [run(line.text, {
          family: 'serif', weight: line.bold ? 700 : 400, bold: Boolean(line.bold),
          fontPx: line.fontPx, ink: line.ink || null,
        })],
        ALIGN[line.align] || 'left',
      ));
    }
    return items.filter(Boolean);
  }

  if (section.body) {
    const { marks } = richText.textWithMarks(section.body);
    const prefixLength = textFlow.datelineText(section).length;
    for (const line of composition.bodyLines) {
      const at = (line.at || 0) - prefixLength;
      const runs = richText.styledRuns(line.text, at, marks, line.fontPx).map((piece) => run(
        // Set as it prints: a run of whitespace is ONE space, the same rule the
        // width was measured with (graphemes.js's setSpaces).
        String(piece.text ?? '').replace(/\s\s+/g, ' '),
        {
          family: line.family, weight: piece.bold ? 700 : line.weight,
          bold: Boolean(piece.bold), italic: Boolean(piece.italic), underline: Boolean(piece.underline),
          fontPx: piece.fontPx || line.fontPx, ink: piece.colour || null,
        },
      ));
      items.push(lineItem({
        x: x0 + mm(line.x), y: y0 + mm(line.y),
        width: mm(Math.max(line.width || 0, line.measure) + 1), height: mm(line.height),
      }, y0 + mm(line.baseline), runs));
    }
  }

  for (const image of section.images || []) {
    items.push({
      kind: 'image',
      x: x0 + mm(image.x_px), y: y0 + mm(image.y_px),
      width: mm(image.width_px), height: mm(image.height_px),
      file: String(image.url || '').replace(/^\//, ''),
      resolved: imageGeometry.resolvePlacedImage(image),
      rotation: Number(image.rotation) || 0,
      // A PAGE THAT DOES NOT PRINT IN COLOUR PRINTS THIS IN BLACK.
      // `pages.prints_colour` is the press forme, and the canvas has always
      // greyed a photograph on a mono page (styles.css's `filter:
      // grayscale(1)`) precisely so a desk can see what the press will do.
      // The export ignored it, so the website showed grey and the CMYK press
      // file carried three more separations - which is a colour plate on a
      // forme that has none. Found by placing photographs on the `photo`
      // template, which the ladder puts on a mono page, and reading the two
      // renders side by side.
      mono,
    });
    const caption = captionBox(image);
    if (caption && image.caption) {
      items.push(textItem(
        { x: x0 + mm(caption.x), y: y0 + mm(caption.y), width: mm(caption.width), height: mm(caption.height) },
        [run(strip(image.caption), { family: PLACED_CAPTION_METRICS.family, weight: PLACED_CAPTION_METRICS.weight, fontPx: PLACED_CAPTION_METRICS.fontPx })],
      ));
    }
  }

  // A PANEL SET INSIDE THE STORY. The compositor already ran the copy round
  // it (section-adapter.js's obstaclesOf), so all that is left is to draw the
  // rectangle the copy avoided and the type inside it - from the same solve,
  // so the two cannot disagree about where its lines sit.
  //
  // AFTER the pictures, and that matters. Every writer here paints in
  // document order, so emitting the panel before them put a photograph on
  // top of it - while the canvas gives .section-inset-panel a higher z-index
  // than a placed picture and draws the panel over. Two surfaces, opposite
  // stacking, found by rendering a page that had both and looking at it.
  for (const panel of panelsOf(section)) {
    const px = x0 + mm(panel.x);
    const py = y0 + mm(panel.y);
    const rule = mm(0.71);
    // The ground first, then the rule, then the type - the order a printer
    // lays them down, and the same order a tinted BLOCK already uses.
    items.push({
      kind: 'fill', x: px, y: py, width: mm(panel.width), height: mm(panel.height),
      ink: panel.tint || '#ffffff',
    });
    const edges = panel.kind === 'quote' ? ['top', 'bottom'] : ['top', 'right', 'bottom', 'left'];
    const BOX = {
      top: { x: px, y: py, width: mm(panel.width), height: rule },
      bottom: { x: px, y: py + mm(panel.height) - rule, width: mm(panel.width), height: rule },
      left: { x: px, y: py, width: rule, height: mm(panel.height) },
      right: { x: px + mm(panel.width) - rule, y: py, width: rule, height: mm(panel.height) },
    };
    for (const edge of edges) items.push({ kind: 'rule', ...BOX[edge], ink: RULE_INK });
    const solved = panelLayout(panel, Number(section.body_font_px) || 6.4);
    for (const line of solved.lines) {
      items.push(textItem(
        { x: px + mm(line.x), y: py + mm(line.y), width: mm(line.width), height: mm(line.fontPx * solved.lineHeight) },
        [run(line.text, {
          family: panel.kind === 'quote' ? 'serif' : 'sans',
          weight: line.bold ? 700 : 400, bold: line.bold, fontPx: line.fontPx,
        })],
      ));
    }
  }

  return items.filter(Boolean);
}


// -------------------------------------------------------------- furniture ---

/**
 * THE NAMEPLATE BAND, as the canvas draws it.
 *
 * WHY THIS IS THE WHOLE BAND AND NOT A SUMMARY. The first version of this
 * function put the plate artwork, the strapline and a date on the page and
 * called it the masthead. Rendered beside the browser and compared line for
 * line, what it was missing was not decoration:
 *
 *   the editions line, the place of publication, the weekday, the volume and
 *   issue number, the page count, THE COVER PRICE, the e-paper address, the
 *   owner, the office, the telephone and the email.
 *
 * Those are the legal and commercial identity of the edition - identity.js
 * says so in as many words - and a download missing them is not the paper the
 * desk approved. The desk reported exactly that, and they were right.
 *
 * It is laid out from `canvas/masthead.js` and its rules in styles.css, in the
 * same editor pixels, so the two cannot describe different furniture:
 *
 *     strapline ....................................... editions
 *     -----------------------------------------------------------
 *     place |                                          |     RNI
 *      DAY  |          the registered plate            |  volume
 *  weekday  |                                          | pages | price
 *  monthyear |                                          |  epaper
 *     -----------------------------------------------------------
 *     owner ................................ office | phone | email
 *
 * The ear is left for the corner block when the page HAS one; a paper that
 * does not sell the corner prints its nameplate across the whole measure -
 * exactly the rule CLAUDE.md records for the canvas.
 */
const MASTHEAD = Object.freeze({
  padPx: 2,            // .page-masthead padding
  stripPx: 7,          // .masthead-strip font-size
  stripGapPx: 3,       // its padding-bottom + margin-bottom
  earLeftPx: 64,       // .masthead-body grid-template-columns
  earRightPx: 88,
  gapPx: 6,
  platePx: 80,         // .masthead-plate img max-height
  ownerPx: 5.5,        // .masthead-owner font-size
  ownerGapPx: 3,       // its padding-top
  placePx: 9,          // .masthead-place
  placePadXPx: 6,
  dayPx: 38,           // .masthead-day, line-height 0.95
  dayLine: 0.95,
  weekdayPx: 12,
  monthYearPx: 10,
  rniPx: 6,
  metaPx: 8,
  linePx: 1.45,        // --devanagari-line
});

const RULE_INK = '#111111';
const HAIRLINE_INK = '#d0d0d6';
const OWNER_INK = '#33333a';
const RNI_INK = '#444444';

/** A hairline across [xPx, xPx+widthPx] at yPx. Editor pixels in, mm out. */
const ruleItem = (xPx, yPx, widthPx, weightPx = 1, ink = RULE_INK) => ({
  kind: 'rule', x: mm(xPx), y: mm(yPx), width: mm(widthPx), height: mm(weightPx), ink,
});

/**
 * One line of standing furniture, with the baseline where the FACE puts it.
 *
 * The writers fall back to `y + height * 0.8` when an item carries no
 * baseline, which is fine in the footer where every line is the same size.
 * This band is not: a 38 px date numeral and a 5.5 px owner line share it, and
 * at 38 px that fallback is three pixels of drift. `FACE_BOX_ASCENT_EM` is
 * imported from the compositor rather than copied - it is the number the
 * browser lays the face out with, and a second copy of it here is the
 * duplicated-catalog fault this project has already been bitten by twice.
 */
function furnitureLine(xPx, yPx, widthPx, text, opts, align = 'left', lineFactor = MASTHEAD.linePx) {
  if (!String(text || '').trim()) return null;
  const size = opts.fontPx;
  const heightPx = size * lineFactor;
  const ascent = modules ? modules.compose.FACE_BOX_ASCENT_EM : 0.93;
  return lineItem(
    { x: mm(xPx), y: mm(yPx), width: mm(widthPx), height: mm(heightPx) },
    mm(yPx + (heightPx - size) / 2 + size * ascent),
    [run(text, opts)],
    align,
  );
}

/** Exactly the width this text sets at - the shaper that composed the page. */
function inkWidthPx(text, fontPx, family = 'sans', weight = 700) {
  if (!modules) return String(text || '').length * fontPx * 0.55;
  return modules.shaper.shapeWidthPx(String(text || ''), fontPx, family, weight);
}

/**
 * A line of furniture broken to fit its measure.
 *
 * The legal imprint is one long sentence naming the printer, the publisher and
 * the address of the press, and it was emitted as a SINGLE unwrapped textItem.
 * The browser wraps it because CSS does; a PDF text frame does not, so on page
 * two of every edition it ran off both edges of the sheet and the first and
 * last words were simply cut off the page. Found by rendering page two and
 * reading it - a legal declaration that does not print in full is the one kind
 * of overflow that actually matters.
 *
 * Greedy, on word boundaries, measured with the same shaper that composed the
 * page. Furniture is short and the balancing this engine does for body copy
 * would be over-engineering here - what matters is that every word is on the
 * sheet.
 */
function wrapFurniture(text, widthPx, fontPx, family = 'sans', weight = 400) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && inkWidthPx(candidate, fontPx, family, weight) > widthPx) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function mastheadItems(newspaper, page, geometry, identity, sections) {
  if (Number(page.page_number) !== 1) return [];
  const region = regionForPage(geometry, page.page_number);
  const header = region.header;
  if (!header || !(header.bottom > header.top)) return [];

  const hasCorner = (sections || []).some((section) =>
    Number(section.x_px) < geometry.marginXPx + header.earWidthPx
    && Number(section.y_px) < header.bottom);
  const earPx = hasCorner ? header.earWidthPx + (header.earGapPx || 0) : 0;

  const leftPx = geometry.marginXPx + earPx;
  const widthPx = geometry.matterWidthPx - earPx;
  const topPx = header.top;
  const date = dateLine(newspaper.publication_date);

  const items = [];
  let y = topPx + MASTHEAD.padPx;

  // ---- the hairline strip: the paper's line, and where it prints ----------
  const stripH = MASTHEAD.stripPx * MASTHEAD.linePx;
  const stripOpts = { family: 'sans', weight: 400, fontPx: MASTHEAD.stripPx };
  items.push(furnitureLine(leftPx, y, widthPx * 0.4, identity.strapline, stripOpts, 'left'));
  items.push(furnitureLine(leftPx + widthPx * 0.4, y, widthPx * 0.6, identity.editions, stripOpts, 'right'));
  y += stripH;
  items.push(ruleItem(leftPx, y, widthPx));
  y += MASTHEAD.stripGapPx;

  // ---- the three-part body: date ear, plate, identity ear ----------------
  const earL = MASTHEAD.earLeftPx;
  const earR = MASTHEAD.earRightPx;
  const plateLeft = leftPx + earL + MASTHEAD.gapPx;
  const plateWidth = Math.max(1, widthPx - earL - earR - MASTHEAD.gapPx * 2);
  const earRLeft = leftPx + widthPx - earR;

  const placeH = MASTHEAD.placePx * MASTHEAD.linePx + 2;
  const dayH = MASTHEAD.dayPx * MASTHEAD.dayLine;
  const weekdayH = MASTHEAD.weekdayPx * MASTHEAD.linePx;
  const monthH = MASTHEAD.monthYearPx * MASTHEAD.linePx;
  const earLeftH = placeH + dayH + weekdayH + monthH;
  const earRightH = MASTHEAD.metaPx * 3 * MASTHEAD.linePx + 2;
  const rowH = Math.max(MASTHEAD.platePx, earLeftH, earRightH);

  // The date ear. The place badge is set in reverse on the accent, exactly as
  // the canvas sets it, and its panel is measured with the shaper rather than
  // estimated - a red bar the width of the whole ear is not a badge.
  let ey = y;
  if (identity.placeOfPublication) {
    const badgeW = inkWidthPx(identity.placeOfPublication, MASTHEAD.placePx) + MASTHEAD.placePadXPx * 2;
    items.push({
      kind: 'fill', x: mm(leftPx), y: mm(ey),
      width: mm(Math.min(badgeW, earL)), height: mm(placeH), ink: ACCENT_INK,
    });
    items.push(furnitureLine(leftPx + MASTHEAD.placePadXPx, ey + 1,
      Math.min(badgeW, earL), identity.placeOfPublication,
      { family: 'sans', weight: 700, bold: true, fontPx: MASTHEAD.placePx, ink: '#ffffff' }));
  }
  ey += placeH;
  items.push(furnitureLine(leftPx, ey, earL, date.day,
    { family: 'sans', weight: 700, bold: true, fontPx: MASTHEAD.dayPx, ink: ACCENT_INK },
    'left', MASTHEAD.dayLine));
  ey += dayH;
  items.push(furnitureLine(leftPx, ey, earL, date.weekday,
    { family: 'sans', weight: 700, bold: true, fontPx: MASTHEAD.weekdayPx }));
  ey += weekdayH;
  items.push(furnitureLine(leftPx, ey, earL, date.monthYear,
    { family: 'sans', weight: 400, fontPx: MASTHEAD.monthYearPx }));

  // The registered artwork, at its own proportions inside the row - never
  // stretched to fill it, because a stretched nameplate is a different
  // nameplate and this one is a registered mark.
  const aspect = Number(identity.nameplateAspect) || (1600 / 300);
  const plateH = Math.min(MASTHEAD.platePx, plateWidth / aspect);
  const plateW = plateH * aspect;
  if (identity.nameplateUrl) {
    items.push({
      kind: 'image',
      x: mm(plateLeft + (plateWidth - plateW) / 2),
      y: mm(y + (rowH - plateH) / 2),
      width: mm(plateW), height: mm(plateH),
      file: String(identity.nameplateUrl).replace(/^\//, ''),
      resolved: null, rotation: 0,
    });
  }

  // The identity ear.
  //
  // The RNI is deliberately NOT set here, and this was settled by opening the
  // artwork and looking at it: sahas-nameplate.png carries
  // "RNI No. MAHMUL/2015/67123" inside the registered mark itself, top right.
  // Setting it again as type is the "editor's name set twice" fault CLAUDE.md
  // records for this same band, in a new place - so the canvas, which DID
  // repeat it, lost its copy rather than this gaining one. Parity by removing
  // the duplicate from both, never by copying it.
  let ry = y;
  const metaOpts = { family: 'sans', weight: 400, fontPx: MASTHEAD.metaPx };
  items.push(furnitureLine(earRLeft, ry, earR, identity.volumeLine, metaOpts, 'right'));
  ry += MASTHEAD.metaPx * MASTHEAD.linePx + 1;
  const priceLine = [identity.pageCountLabel, identity.price].filter(Boolean).join(' \u0964 ');
  items.push(furnitureLine(earRLeft, ry, earR, priceLine, metaOpts, 'right'));
  ry += MASTHEAD.metaPx * MASTHEAD.linePx + 1;
  items.push(furnitureLine(earRLeft, ry, earR, identity.epaper,
    { family: 'sans', weight: 400, fontPx: MASTHEAD.metaPx, ink: ACCENT_INK }, 'right'));

  y += rowH;

  // ---- the owner line ----------------------------------------------------
  items.push(ruleItem(leftPx, y, widthPx, 1, HAIRLINE_INK));
  y += MASTHEAD.ownerGapPx;
  const ownerOpts = { family: 'sans', weight: 400, fontPx: MASTHEAD.ownerPx, ink: OWNER_INK };
  items.push(furnitureLine(leftPx, y, widthPx * 0.45, identity.owner, ownerOpts, 'left'));
  const contact = [identity.office, identity.phone, identity.email].filter(Boolean).join(' \u00b7 ');
  items.push(furnitureLine(leftPx + widthPx * 0.45, y, widthPx * 0.55, contact, ownerOpts, 'right'));
  y += MASTHEAD.ownerPx * MASTHEAD.linePx;

  // The band closes on a rule, as every broadsheet does. Drawn at the bottom
  // of the furniture actually set rather than at the region's own edge: the
  // region is baseline-snapped and can sit a few pixels below the band.
  items.push(ruleItem(leftPx, Math.min(y + 2, header.bottom - 1), widthPx));

  return items.filter(Boolean);
}

/**
 * THE FOLIO, which no export carried either.
 *
 * Page one gets the nameplate; every other page gets this ruled line, and the
 * export had no equivalent at all - so pages two and up came out of the
 * download with a blank strip where the browser prints the paper's name, the
 * place, the date and the page number.
 *
 * Verso and recto, the same rule the canvas follows: a reader holding the
 * paper open sees the OUTER edge of each page, so the page number goes there.
 */
function folioItems(newspaper, page, geometry, identity) {
  if (Number(page.page_number) === 1) return [];
  const region = regionForPage(geometry, page.page_number);
  const header = region.header;
  if (!header || !(header.bottom > header.top)) return [];

  const leftPx = geometry.marginXPx;
  const widthPx = geometry.matterWidthPx;
  const date = dateLine(newspaper.publication_date);
  const dateText = date.day ? `${date.day} ${date.monthYear}, ${date.weekday}` : '';
  const placeAndDate = [identity.placeOfPublication, dateText].filter(Boolean).join(' \u0964 ');
  const pageLabel = `\u092a\u0943\u0937\u094d\u0920 ${devanagari(page.page_number)}`;
  const verso = Number(page.page_number) % 2 === 0;

  const bandPx = Math.min(HEADER_FOLIO_PX, header.bottom - header.top);
  const thirdPx = widthPx / 3;
  const lineY = header.top + bandPx * 0.32;

  const title = furnitureLine(leftPx + (verso ? thirdPx * 2 : 0), lineY, thirdPx,
    identity.title, { family: 'sans', weight: 700, bold: true, fontPx: 11, ink: ACCENT_INK },
    verso ? 'right' : 'left');
  const number = furnitureLine(leftPx + (verso ? 0 : thirdPx * 2), lineY + 2, thirdPx,
    pageLabel, { family: 'sans', weight: 400, fontPx: 8 }, verso ? 'left' : 'right');
  const middle = furnitureLine(leftPx + thirdPx, lineY + 2, thirdPx,
    placeAndDate, { family: 'sans', weight: 400, fontPx: 8 }, 'center');

  return [title, middle, number,
    ruleItem(leftPx, header.top + bandPx, widthPx)].filter(Boolean);
}

/**
 * The strip of colour patches printed along the foot so the press can check
 * the four plates are in register. The canvas draws it (masthead.js's
 * registrationMarkup) and its absence is one of the things CLAUDE.md records
 * as making a page look like a web mock-up - so parity requires it.
 */
function registrationItems(geometry) {
  const leftPx = geometry.marginXPx;
  const widthPx = geometry.matterWidthPx;
  const topPx = geometry.pageHeightPx - 14;
  const inks = ['#00a0e3', '#e6007e', '#ffed00', '#111111'];
  const patches = inks.concat(inks);
  const patchW = Math.min(10, widthPx / patches.length);
  return patches.map((ink, index) => ({
    kind: 'fill',
    x: mm(leftPx + index * (patchW + 2)),
    y: mm(topPx),
    width: mm(patchW), height: mm(6), ink,
  }));
}

function footerItems(newspaper, page, geometry, identity) {
  const items = [];
  const region = regionForPage(geometry, page.page_number);
  const date = dateLine(newspaper.publication_date);
  const dateText = date.day ? `${date.day} ${date.monthYear}` : '';
  const verso = Number(page.page_number) % 2 === 0;

  const leftMm = mm(geometry.marginXPx);
  const widthMm = mm(geometry.matterWidthPx);
  const footYMm = mm(region.footer.footTop);
  const footHeightMm = mm(region.footer.footHeightPx);
  const thirdMm = widthMm / 3;
  const pageLabel = `पृष्ठ ${devanagari(page.page_number)}`;
  const columns = verso ? [pageLabel, dateText, identity.title] : [identity.title, dateText, pageLabel];
  const ALIGN = ['left', 'center', 'right'];

  columns.forEach((text, index) => {
    if (!text) return;
    items.push(textItem(
      { x: leftMm + index * thirdMm, y: footYMm, width: thirdMm, height: footHeightMm },
      [run(text, { family: 'sans', weight: index === 1 ? 400 : 700, fontPx: 18 })],
      ALIGN[index],
    ));
  });

  // The legal imprint prints ONCE, on its own page. A press file that dropped
  // the AI disclosure would print a paper that does not carry it.
  if (Number(page.page_number) === Number(identity.imprintPage || 2) && region.footer.imprintHeightPx > 0) {
    const top = mm(region.footer.imprintTop);
    const height = mm(region.footer.imprintHeightPx);
    // WRAPPED, AND SIZED TO THE BAND IT WAS GIVEN.
    //
    // Two faults, one after the other, both found by rendering page two and
    // reading it. First it was emitted as a SINGLE unwrapped line per band, so
    // the declaration ran off both edges of the sheet and its first and last
    // words were cut off the page - a legal statement that does not print in
    // full is the one kind of overflow that actually matters. Then, wrapped at
    // the sizes asked for, seven lines went into a 20 mm band and overlapped
    // each other.
    //
    // So the size is SOLVED against the band, exactly as the canvas does it -
    // styles.css sets .page-imprint at 5.2px for the same reason. It steps
    // down from the requested size until every wrapped line has its own room,
    // and never below what a page can be read at.
    const IMPRINT_MIN_PX = 3.6;
    const IMPRINT_LINE = 1.45;
    const bandHeightPx = region.footer.imprintHeightPx;
    const parts = [
      { text: identity.imprint, weight: 400, bold: false },
      { text: identity.imprintEnglish, weight: 400, bold: false },
      { text: identity.aiDisclosure, weight: 700, bold: true },
    ].filter((part) => String(part.text || '').trim());

    let fontPx = 5.2;
    let wrapped = [];
    for (; fontPx >= IMPRINT_MIN_PX; fontPx -= 0.2) {
      wrapped = parts.map((part) => ({
        ...part,
        lines: wrapFurniture(part.text, geometry.matterWidthPx, fontPx, 'sans', part.weight),
      }));
      const rows = wrapped.reduce((n, part) => n + part.lines.length, 0);
      if (rows * fontPx * IMPRINT_LINE <= bandHeightPx) break;
    }

    const rowMm = mm(fontPx * IMPRINT_LINE);
    let y = top;
    for (const part of wrapped) {
      for (const text of part.lines) {
        items.push(textItem({ x: leftMm, y, width: widthMm, height: rowMm },
          [run(text, { family: 'sans', weight: part.weight, bold: part.bold, fontPx })], 'center'));
        y += rowMm;
      }
    }
  }

  return items.filter(Boolean);
}

// ------------------------------------------------------------ the edition ---

/**
 * The whole edition, positioned, in millimetres and points.
 *
 * `{ title, date, widthMm, heightMm, pages: [{ number, items }] }` - and that
 * is the entire contract every writer under this folder is built against.
 */
async function buildPrintModel(newspaper, pages) {
  await ensureComposeReady();
  const geometry = geometryOf(newspaper);
  const identity = identityFor(newspaper.publication_date, pages.length);
  const date = String(newspaper.publication_date).slice(0, 10);

  const built = [];
  for (const page of pages) {
    const items = [];
    items.push(...mastheadItems(newspaper, page, geometry, identity, page.sections));
    items.push(...folioItems(newspaper, page, geometry, identity));
    const mono = page.prints_colour === false;
    for (const section of page.sections || []) {
      items.push(...await blockItems(section, { mono }));
    }
    // THE COLUMN RULES - the hairlines between one story and the next.
    //
    // CLAUDE.md calls these "the single most recognisable thing about a
    // printed newspaper page", and no export drew them. The canvas has since
    // it was written; grepping this file and scribus.service.js for
    // `columnRules` returned nothing. Found by rendering a six-page edition
    // and reading the website's own page beside the PDF's.
    //
    // They come from `columnRulesFor()`, the one function that decides where a
    // rule goes - a rule belongs exactly halfway between the two stories it
    // separates, and it exists because two blocks MEET, which is a fact about
    // the pair and not about either one. A second implementation here would be
    // free to disagree about that, so there is not one.
    //
    // Half a pixel wide, which at 2 px/mm is the 0.25 mm hairline a newspaper
    // actually sets - the same number the canvas draws.
    const { columnRules } = await ensureComposeReady();
    for (const rule of columnRules.columnRulesFor(page, geometry)) {
      items.push(rule.axis === 'v'
        ? { kind: 'rule', x: mm(rule.at - 0.25), y: mm(rule.from), width: mm(0.5), height: mm(rule.to - rule.from), ink: RULE_INK }
        : { kind: 'rule', x: mm(rule.from), y: mm(rule.at - 0.25), width: mm(rule.to - rule.from), height: mm(0.5), ink: RULE_INK });
    }

    // The page's own pictures go down AFTER the blocks, because that is what
    // "laid over" means and every writer here paints in document order. The
    // blocks have already set their type clear of them, so this is paint and
    // not layout.
    for (const overlay of overlaysOf(page)) {
      items.push({
        kind: 'image',
        x: mm(overlay.x), y: mm(overlay.y),
        width: mm(overlay.width), height: mm(overlay.height),
        file: String(overlay.url).replace(/^\//, ''),
        resolved: null, rotation: 0, mono,
      });
      if (overlay.caption) {
        items.push(textItem(
          { x: mm(overlay.x), y: mm(overlay.y + overlay.height),
            width: mm(overlay.width), height: mm(PLACED_CAPTION_METRICS.fontPx * PLACED_CAPTION_METRICS.lineHeight + 2) },
          [run(overlay.caption, {
            family: PLACED_CAPTION_METRICS.family, weight: PLACED_CAPTION_METRICS.weight,
            fontPx: PLACED_CAPTION_METRICS.fontPx,
          })],
        ));
      }
    }
    items.push(...footerItems(newspaper, page, geometry, identity));
    items.push(...registrationItems(geometry));
    built.push({ number: Number(page.page_number), items });
  }

  return {
    title: identity.title,
    titleEnglish: identity.titleEnglish || 'Dainik Sahas Varta',
    date,
    identity,
    widthMm: mm(newspaper.page_width_px),
    heightMm: mm(newspaper.page_height_px),
    marginMm: mm(geometry.marginXPx),
    pages: built,
  };
}

module.exports = { buildPrintModel, ensureComposeReady, mm, pt };
