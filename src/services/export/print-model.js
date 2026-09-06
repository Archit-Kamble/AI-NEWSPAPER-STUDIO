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
// The chip row the folio actually draws in, inside the band geometry.js
// reserves - masthead.js's own FOLIO_CHIP_PX, measured off the reference at
// this page's 2 px/mm. The reserved REGION is untouched either side of it.
const FOLIO_CHIP_PX = 19;
const FOOT_STRIP_PX = 20;
const { identityFor, dateLine, devanagari } = require('../../layout/identity');
const { strip } = require('../../layout/plain-text');
const { captionBox, PLACED_CAPTION_METRICS } = require('../../../public/editor/layout/caption-geometry');
const { borderEdges, borderWidthPx, borderOffsetsPx, isBoxed, borderRadiusPx } = require('../../../public/editor/layout/borders');
const { panelsOf, panelLayout, panelStyle } = require('../../../public/editor/layout/inset-panels');
const { overlaysOf } = require('../../../public/editor/layout/page-overlays');
const { smartCardLines } = require('./smart-card-lines');

/** Editor pixels to millimetres. The one conversion, stated once. */
const mm = (px) => Number(pxToMm(px).toFixed(4));
/** Editor pixels to points. 2 px/mm, 72 pt/inch, 25.4 mm/inch. */
const pt = (px) => Number(((Number(px) / 2) * 72 / 25.4).toFixed(3));

let modules = null;

async function ensureComposeReady() {
  if (!modules) {
    const [metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent, compose, columnRules, inks, furniture, blockShapes] =
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
        // The paper's own palette: which display bands a treatment lays a
        // ground behind, and what a screen of an ink looks like.
        import('../../../public/editor/layout/inks.js'),
        // The folio and footer's own five-style catalogue - the same one
        // masthead.js reads, so a themed page's running head and foot print
        // exactly what the canvas showed the desk.
        import('../../../public/editor/layout/furniture-styles.js'),
        // The block-shape catalogue - a block's own cut-corner outline,
        // traced as one polygon everywhere the block's border is drawn.
        import('../../../public/editor/layout/block-shapes.js'),
      ]);
    modules = { metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent, compose, columnRules, inks, furniture, blockShapes };
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

/**
 * The same box, carrying the compositor's own baseline for the line in it -
 * and, for a justified line, HOW IT WAS JUSTIFIED.
 *
 * THIS IS THE FIELD THE EXPORTS DID NOT CARRY, and it is the most visible
 * property of newspaper body copy. compose.js justifies a line by two levers
 * (justifyLine): extra space at each word gap, and up to 3% of horizontal
 * glyph stretch for the remainder. `render.js` applies both, so the CANVAS was
 * justified - measured, 4 px of variation across nine lines. Nothing else read
 * them, so the press PDF, the IDML and Scribus all set the same copy FLUSH
 * LEFT: on the same block, 111 px of ragged right edge on a 510 px measure.
 *
 * Two surfaces, opposite renderings, on the one thing a reader notices first.
 *
 * In MILLIMETRES like every other geometry in this model, so a writer never
 * has to know what an editor pixel is.
 */
const lineItem = (box, baselineMm, runs, align = 'left', justify = null) => {
  const item = textItem(box, runs, align);
  if (!item) return item;
  item.baseline = baselineMm;
  // Only when there is something to say. A flush-left line carries neither
  // field, so nothing about an unjustified block's output changes.
  if (justify) {
    if (justify.wordSpacingPx) item.wordSpacingMm = mm(justify.wordSpacingPx);
    if (justify.glyphScaleX && justify.glyphScaleX !== 1) item.glyphScaleX = justify.glyphScaleX;
  }
  return item;
};

const run = (text, { family = 'sans', weight = 400, bold = false, italic = false,
  underline = false, fontPx = 12, ink = null } = {}) => ({
  text: String(text ?? ''), family, weight, bold, italic, underline, sizePt: pt(fontPx), ink,
});

// -------------------------------------------------------------- one block ---

const ACCENT_INK = '#c8102e';

/**
 * A DISPLAY BAND'S OWN INK.
 *
 * The order is the renderer's, and must stay the renderer's: a reverse band is
 * white type out of a solid panel whatever hue the panel is, so it beats the
 * block's heading colour; a desk's own inked WORD beats both and is applied by
 * the caller before this is consulted.
 *
 * `headline_ink` is what a page's theme writes (page-styles.js). NULL is the
 * paper's own black, which is `null` here - the writers' own default - so a
 * block nobody dressed emits exactly the runs it always did.
 */
function bandInk(section, key, reversed) {
  if (reversed && key === 'headline') return '#ffffff';
  if (section?.headline_ink && (key === 'headline' || key === 'kicker')) return section.headline_ink;
  return null;
}
const REVERSE_BLEED_PX = 2;

async function blockItems(section, { mono = false } = {}) {
  const { adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent } = await ensureComposeReady();
  const items = [];
  const x0 = mm(section.x_px);
  const y0 = mm(section.y_px);

  const holdsCard = Boolean(section.smart_card_key) && Boolean(section.smart_card_data)
    && smartCards.canRenderSmartCard(section.smart_card_key);

  // Exactly the composition scribus.service.js takes: the card owns the full
  // frame, without ordinary article headline or subheading bands.
  const emptyCardDisplay = { headline: '', subheading: '', body: '' };
  const composition = holdsCard
    ? adapter.composeSection({ ...section, images: [], ...emptyCardDisplay }, { ...section, ...emptyCardDisplay })
    : adapter.composeSection(section, section);

  // The block's ground goes down FIRST, because every writer here paints in
  // document order and this is what the rest of the block is printed on.
  //
  // SHAPED, when the block's own frame is not a rectangle - a filled polygon
  // is the same `poly` primitive the border above draws stroked, so a cut
  // corner's ground never bleeds past where its own border sits.
  if (section.background_color) {
    if (section.frame_shape) {
      items.push({
        kind: 'poly', close: true, ink: section.background_color,
        x: x0, y: y0, width: mm(section.width_px), height: mm(section.height_px),
        points: modules.blockShapes.shapedRectPoints(section.frame_shape, mm(section.width_px), mm(section.height_px))
          .map(([px, py]) => [x0 + px, y0 + py]),
      });
    } else {
      items.push({
        kind: 'fill', x: x0, y: y0,
        width: mm(section.width_px), height: mm(section.height_px),
        ink: section.background_color,
      });
    }
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
  // ONE FUNCTION DRAWS A BLOCK'S BORDER, for every writer. blockRules()
  // below used to be Scribus's own, separate copy of this exact logic, missed
  // when the block's own ink and its rounded corner were added here - so a
  // block's border carried its theme colour and its radius in the PDF/IDML
  // and printed plain black square corners in the .sla. Consolidated rather
  // than kept in step by hand, which is how it drifted the first time.
  items.push(...blockRules(section));

  const bands = composition.bands || {};
  const headlineBand = bands.headline;
  const headlineSegments = headlineBand
    ? accent.headlineSegments(headlineBand.lines.map((line) => line.text),
      { accentStyle: modules.inks?.accentedHeadline(section.headline_style) })
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
      ink: section.accent_color || ACCENT_INK,
    });
  }

  // AND A SCREEN BEHIND A DISPLAY BAND, from the same catalogue the canvas
  // reads. The type is left in its own colour - a screen is an ink laid down
  // lightly, not a panel knocked out of - so unlike the reverse above there is
  // nothing to do to the runs below.
  const { groundedBands, screenOf } = modules.inks || {};
  if (groundedBands) {
    for (const key of groundedBands(section.headline_style)) {
      const band = bands[key];
      if (!band?.lines?.length) continue;
      items.push({
        kind: 'fill',
        x: x0 + mm(composition.content.left),
        y: y0 + mm(band.top - REVERSE_BLEED_PX),
        width: mm(composition.content.measure),
        height: mm(band.height + REVERSE_BLEED_PX * 2),
        ink: screenOf(section.accent_color || ACCENT_INK),
      });
    }
  }

  // Paint-only display furniture. `headlineFurniture()` returns the exact
  // compositor-owned rectangles used on the canvas; conversion to millimetres
  // is the only work this press model does.
  if (modules.inks?.headlineFurniture) {
    for (const piece of modules.inks.headlineFurniture(section.headline_style, composition)) {
      items.push({
        kind: piece.kind,
        x: x0 + mm(piece.x), y: y0 + mm(piece.y),
        width: mm(piece.width), height: mm(piece.height),
        ink: piece.ink === 'screen'
          ? modules.inks.screenOf(section.accent_color || ACCENT_INK)
          : (section.accent_color || ACCENT_INK),
      });
    }
  }

  for (const [key, band] of Object.entries(bands)) {
    if (!band?.lines?.length) continue;
    band.lines.forEach((line, index) => {
      const runs = key === 'headline' && headlineSegments
        ? (headlineSegments[index] || []).map((segment) => run(segment.text, {
          family: line.family, weight: line.weight, fontPx: line.fontPx,
          ink: segment.accent ? (section.accent_color || ACCENT_INK) : bandInk(section, key, reversed),
        }))
        : richText.styledRuns(line.text, line.at || 0, band.marks || [], line.fontPx)
          .map((piece) => run(piece.text, {
            family: line.family, weight: piece.bold ? 700 : line.weight,
            bold: Boolean(piece.bold), italic: Boolean(piece.italic), underline: Boolean(piece.underline),
            fontPx: piece.fontPx || line.fontPx,
            ink: piece.colour || bandInk(section, key, reversed),
          }));
      items.push(lineItem({
        x: x0 + mm(line.x), y: y0 + mm(line.y),
        // `measure` is the gap the line was offered; `width` is what was
        // actually drawn there. A one-word headline wider than the measure is
        // set anyway and spills, so the frame must be at least as wide.
        width: mm(Math.max(line.width || 0, line.measure)), height: mm(line.height),
      }, y0 + mm(line.baseline), runs, 'left', line));
    });
  }

  if (holdsCard) {
    const frame = smartCardLayout.smartCardFrameFromComposition(composition);
    // Moved clear of anything standing in the card's way - a card is a grid
    // and cannot flow round an overlay the way the copy either side of it can.
    items.push(...cardItems(
      section.smart_card_key, section.smart_card_data, frame,
      x0 + mm(composition.content.left + (frame.offsetX || 0)),
      y0 + mm(composition.bodyTop + (frame.offsetY || 0)),
      mono,
    ));
    return items.filter(Boolean);
  }

  if (section.body) {
    const { marks: authoredMarks } = richText.textWithMarks(section.body);
    const prefixLength = textFlow.datelineText(section).length;
    const marks = textFlow.marksWithDateline(authoredMarks, prefixLength);
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
      }, y0 + mm(line.baseline), runs, 'left', line));
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

  items.push(...blockDecorations(section, composition));

  return items.filter(Boolean);
}


/**
 * ONE SMART CARD, as neutral items, at a given origin.
 *
 * Lifted out of blockItems() because a chart is no longer only ever a whole
 * block: a chart PANEL (layout/inset-panels.js's `chart` kind) is the same
 * card solved against a smaller rectangle, set inside a story with the copy
 * running round it - which is how a desk asks a chart to "take space in news
 * block" rather than taking the block. Two call sites, one walk, so a chart in
 * a panel and a chart in a block cannot print differently.
 */
function cardItems(key, data, frame, originX, originY, mono = false) {
  const items = [];
  const ALIGN = ['left', 'center', 'right'];
  // From the module cache rather than a parameter: blockItems() destructures
  // the loaded modules and blockDecorations() does not, and threading one
  // through two call chains to hand this function a reference it can already
  // reach is how the second caller came to be written without it. Nothing can
  // reach here before ensureComposeReady() has run - both callers await it.
  const { smartCardLayout } = modules;
  for (const line of smartCardLines(key, data, frame, smartCardLayout)) {
    if (line.kind === 'image') {
      items.push({
        kind: 'image',
        x: originX + mm(line.x), y: originY + mm(line.y),
        width: mm(line.width), height: mm(line.height),
        file: String(line.file || '').replace(/^\//, ''),
        resolved: null, rotation: 0, mono, stretch: Boolean(line.stretch),
      });
      continue;
    }
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
    // A pie slice, a line chart's line and a dot are all POINT LISTS - the
    // arc was turned into segments by the solver, once, so every writer here
    // draws the identical polygon and none of them needs bezier geometry.
    if (line.kind === 'poly') {
      const points = (line.points || []).map(([x, y]) => [originX + mm(x), originY + mm(y)]);
      if (points.length < 2) continue;
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      items.push({
        kind: 'poly',
        points,
        // The bounding box, which IDML needs for its centre-based transform
        // and which costs the other two writers nothing.
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        ink: line.ink || ACCENT_INK,
        close: line.close !== false,
        strokeWidth: line.strokeWidth ? mm(line.strokeWidth) : 0,
      });
      continue;
    }
    items.push(textItem(
      { x: originX + mm(line.x), y: originY + mm(line.y), width: mm(line.width), height: mm(line.height) },
      [run(line.text, {
        // THE FACE THE CARD WAS MEASURED IN, stated by the walk. This was a
        // hard-coded 'serif' while layoutSmartCard() measures a chart, the
        // weather panel and the market table in 'sans' - so those cards were
        // fitted in one face and printed in another, 5-17% narrower on the
        // plate than the box they were fitted to.
        family: line.family || 'serif', weight: line.bold ? 700 : 400, bold: Boolean(line.bold),
        fontPx: line.fontPx, ink: line.ink || null,
      })],
      ALIGN[line.align] || 'left',
    ));
  }
  return items;
}

/**
 * WHAT A BLOCK DRAWS BESIDE ITS TYPE - the initial letter and the panels set
 * inside the story. Both are things the compositor has ALREADY made room for
 * (compose.js's dropCapOf, section-adapter.js's obstaclesOf), so all that is
 * left here is ink; nothing in this function may decide geometry.
 *
 * It is a function of its own, and exported, because Scribus keeps its own
 * block walk (the tested path scribusComposition.test.js pins line for line)
 * and was therefore drawing NEITHER. A `.sla` with a drop cap reserved and no
 * cap in it prints the story with its opening akshara missing; one with a
 * panel reserved and no panel in it prints a white hole where the fact box
 * goes. Four writers, one decision - the rule this project already holds for
 * the column rules and the nameplate.
 */
function blockDecorations(section, composition) {
  const items = [];
  const x0 = mm(section.x_px);
  const y0 = mm(section.y_px);

  // THE INITIAL LETTER, which no export drew at all.
  //
  // The pour skips the cap's own clusters (they are set separately, so that
  // `line.at` - and every mark a sub-editor made - stays valid to the
  // character), which means `bodyLines` genuinely does not contain them. A
  // writer that renders only `bodyLines` therefore prints the story starting
  // one akshara in: composed live, a block whose copy opens "शहरातील" set its
  // cap to "श" and its first body line to "हरातील". On screen that is a drop
  // cap; on the plate it was a typo.
  const cap = composition?.dropCap;
  if (cap && cap.text) {
    items.push(lineItem(
      { x: x0 + mm(cap.x), y: y0 + mm(cap.y), width: mm(cap.width) + 1, height: mm(cap.height) },
      // The compositor's own baseline - the last body line the cap spans. The
      // browser never needed it said out loud because CSS derives it from
      // `line-height`; a PDF has to be told.
      y0 + mm(cap.baseline),
      [run(cap.text, { family: cap.family || 'serif', weight: cap.weight || 400, fontPx: cap.fontPx })],
    ));
  }

  // A LIST'S MARKERS, hung beside the copy. Furniture, exactly like the cap
  // above: never in `bodyLines`, so a writer that draws only those printed a
  // list with its numbers missing - which is a list that is not a list.
  for (const marker of composition?.listMarkers || []) {
    items.push(lineItem(
      { x: x0 + mm(marker.x), y: y0 + mm(marker.y), width: mm(marker.width) + 1, height: mm(marker.height) },
      y0 + mm(marker.baseline),
      [run(marker.text, { family: marker.family || 'serif', weight: marker.weight || 400, fontPx: marker.fontPx })],
    ));
  }

  // A PANEL SET INSIDE THE STORY. The compositor already ran the copy round
  // it, so all that is left is to draw the rectangle the copy avoided and the
  // type inside it - from the same solve, so the two cannot disagree about
  // where its lines sit.
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
    const { edges, family: panelFace, ground } = panelStyle(panel.kind);
    // A CHART OR TABLE PANEL DRAWS A CARD. The same walk a whole-block one goes
    // through, given the panel's own rectangle - so either in a panel and
    // either in a block reach the plate as the same items in the same ink.
    if (panel.kind === 'chart' || panel.kind === 'table') {
      if (panel.tint) {
        items.push({ kind: 'fill', x: px, y: py, width: mm(panel.width), height: mm(panel.height), ink: panel.tint });
      }
      items.push(...cardItems(panel.kind, panel.card,
        { width: panel.width, height: panel.height, padding: 0 }, px, py));
      continue;
    }
    // The ground first, then the rule, then the type - the order a printer
    // lays them down, and the same order a tinted BLOCK already uses.
    if (ground || panel.tint) {
      items.push({
        kind: 'fill', x: px, y: py, width: mm(panel.width), height: mm(panel.height),
        ink: panel.tint || '#ffffff',
      });
    }
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
          family: line.family || panelFace,
          weight: line.bold ? 700 : 400, bold: line.bold, fontPx: line.fontPx,
          ink: line.ink === 'accent' ? (section.accent_color || ACCENT_INK) : null,
        })],
        line.align === 1 ? 'center' : 'left',
      ));
    }
  }
  return items.filter(Boolean);
}

/**
 * THE PAGE'S OWN PICTURES - laid over the blocks, never belonging to one.
 *
 * Extracted for the same reason as blockDecorations(): the `.sla` had no
 * `overlay` in it anywhere, so a photograph a desk ran across two stories was
 * on the canvas, in the PDF and in the IDML, and simply absent from the file
 * that reaches a plate - with the two blocks underneath still set clear of it,
 * so the page printed with a hole in it.
 */
function pageOverlayItems(page, { mono = false } = {}) {
  const items = [];
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
  return items.filter(Boolean);
}

/**
 * A MONO FORME HAS NO COLOUR PLATES, so nothing on it may be separated to one.
 *
 * `pages.prints_colour` was carried on IMAGE items alone: the photographs were
 * separated to K and everything else - a chart's accent bars, a pie's tinted
 * slices, a reversed headline's panel, a block's tinted ground, a word a
 * sub-editor inked - was emitted as its own CMYK. So a page with no colour
 * plates asked the press for four, which is the same fault that was found and
 * fixed for the pictures and left standing for the ink beside them.
 *
 * TWO RULES, and they are different on purpose:
 *
 *  - TYPE goes to 100% K. A red headline on a mono forme prints BLACK; set as
 *    a screen of black it would be a broken dotted line on newsprint, which is
 *    the same reason `column-rules.js` refuses to draw a grey hairline.
 *  - A FILL, a RULE and a POLY take their own tonal value, at Rec. 709 luma.
 *    A chart whose four slices all went solid black would not be a chart, and
 *    a tint that went solid black would not be a tint - these are areas, and an
 *    area is the one thing a screen can hold.
 *
 * Applied once, here, so the PDF, the IDML and the `.sla` cannot disagree
 * about what a mono page looks like.
 */
const MONO_TEXT_INK = '#000000';
// KNOCKOUT TYPE STAYS KNOCKED OUT. A reversed headline is WHITE type out of a
// solid panel, and "every inked run goes to 100% K" would have set it black on
// a dark grey panel - an invisible headline on the one block a page shouts
// with. Anything this light is not a colour a mono forme has to lose; it is
// the absence of ink.
const MONO_KNOCKOUT_ABOVE = 0.8;

/** Rec. 709 luma, 0-1, or -1 for anything that is not a plain hex. */
function lumaOf(ink) {
  const hex = String(ink || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return -1;
  const value = parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  // The perceptual weighting - the same one the picture path uses, and right
  // for the same reason: it answers "how dark does this print".
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toKOnly(ink) {
  const luma = lumaOf(ink);
  if (luma < 0) return ink || null;
  const grey = Math.max(0, Math.min(255, Math.round(luma * 255)));
  const byte = grey.toString(16).padStart(2, '0');
  return `#${byte}${byte}${byte}`;
}

/** Every item on a mono page, with its inks separated to K. */
function separateToK(items) {
  return items.map((item) => {
    if (item.kind === 'text') {
      return {
        ...item,
        runs: (item.runs || []).map((run) => (run.ink
          ? { ...run, ink: lumaOf(run.ink) > MONO_KNOCKOUT_ABOVE ? run.ink : MONO_TEXT_INK }
          : run)),
      };
    }
    if (item.kind === 'fill' || item.kind === 'rule' || item.kind === 'poly') {
      return item.ink ? { ...item, ink: toKOnly(item.ink) } : item;
    }
    return item;
  });
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
  weekdayPx: 10,
  monthYearPx: 12,
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
  // The date ear reads numeral, month-and-year, weekday - the order the canvas
  // sets it in (masthead.js). The two halves of one date are kept together and
  // the weekday follows them; the weight goes with the position, so whatever
  // completes the numeral is the bold line.
  items.push(furnitureLine(leftPx, ey, earL, date.monthYear,
    { family: 'sans', weight: 700, bold: true, fontPx: MASTHEAD.monthYearPx }));
  ey += monthH;
  items.push(furnitureLine(leftPx, ey, earL, date.weekday,
    { family: 'sans', weight: 400, fontPx: MASTHEAD.weekdayPx }));

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
// FIVE FOLIO STYLES, resolved from the page's own theme - the exact catalogue
// masthead.js reads for the canvas, so the plate prints the folio a desk
// already approved on screen. A page nobody has dressed resolves 'plain'/
// 'front' and draws precisely what this function always drew.
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

  const { folioStyleForTheme, furnitureInkForTheme, furnitureTintForTheme, sectionNameFor } = modules.furniture;
  const style = folioStyleForTheme(page.style_theme);
  const reversed = style.band === 'reverse';
  const themeInk = style.title !== 'plain' ? furnitureInkForTheme(page.style_theme) : null;
  const titleInk = reversed ? '#ffffff' : (themeInk || ACCENT_INK);
  const bodyInk = reversed ? '#ffffff' : undefined;
  const tint = style.band ? furnitureTintForTheme(page.style_theme) : null;

  const title = furnitureLine(leftPx + (verso ? thirdPx * 2 : 0), lineY, thirdPx,
    identity.title, { family: 'sans', weight: 700, bold: true, fontPx: 11, ink: titleInk },
    verso ? 'right' : 'left');
  const number = furnitureLine(leftPx + (verso ? 0 : thirdPx * 2), lineY + 2, thirdPx,
    pageLabel, { family: 'sans', weight: 400, fontPx: 8, ink: bodyInk }, verso ? 'left' : 'right');
  // THE SECTION NAMEPLATE opens the centre cell, exactly as it does on the
  // canvas: the reference's folio row carries three boxes and this is the
  // third. Measured here rather than guessed, through the same shaper, so the
  // date that follows it starts where the canvas starts it.
  // Its ink is the THEME's own, never `themeInk` - see masthead.js's
  // folioMarkup for why the folio style may not gate this.
  const sectionName = sectionNameFor(page.style_theme);
  const sectionInk = sectionName ? furnitureInkForTheme(page.style_theme) : null;
  const SECTION_PAD = 5;
  const sectionW = sectionName
    ? inkWidthPx(sectionName, 8, 'sans', 700) + SECTION_PAD * 2
    : 0;
  const CENTRE_GAP = 6; // the .folio-centre gap
  const centreRun = sectionName ? sectionW + CENTRE_GAP : 0;
  const middle = furnitureLine(leftPx + thirdPx + centreRun, lineY + 2, thirdPx - centreRun,
    placeAndDate, { family: 'sans', weight: 400, fontPx: 8, ink: bodyInk }, 'center');

  const items = [];
  // THE FOLIO PAINTS A CHIP ROW, NOT THE WHOLE BAND - the same measurement
  // masthead.js's folioMarkup carries, mirrored here so the plate prints the
  // folio the desk approved. Filling the reserved band edge to edge ran the
  // ink straight into the first block's rule; the reference paper leaves five
  // rows of white there, and its brand and page number are small solid CHIPS
  // rather than a band across the measure.
  const chipPx = Math.min(FOLIO_CHIP_PX, bandPx);
  if (reversed && themeInk) {
    // Chips, not a band: one behind the title, one behind the page number.
    // Each is sized from its OWN text through the same shaper the compositor
    // measures with (inkWidthPx), not a fixed share of the column - the canvas
    // chip hugs its words, and a fixed guess here would print a chip the words
    // overflow or rattle around in.
    const PAD = 5; // the same 5 px the .folio-chip rule pads with, each side.
    const chips = [
      { text: identity.title, fontPx: 11, weight: 700, atStart: !verso },
      { text: pageLabel, fontPx: 8, weight: 400, atStart: verso },
    ];
    for (const c of chips) {
      const w = Math.min(thirdPx, inkWidthPx(c.text, c.fontPx, 'sans', c.weight) + PAD * 2);
      const x = c.atStart ? leftPx : leftPx + widthPx - w;
      items.push({ kind: 'fill', x: mm(x), y: mm(header.top), width: mm(w), height: mm(chipPx), ink: themeInk });
    }
  } else if (style.band === true && tint) {
    items.push({ kind: 'fill', x: mm(leftPx), y: mm(header.top), width: mm(widthPx), height: mm(chipPx), ink: tint });
  }
  if (sectionName) {
    // Drawn in every themed style, not only the reversed one - a section name
    // set as ordinary type beside the date is a word, not a nameplate.
    const x = leftPx + thirdPx;
    items.push({ kind: 'fill', x: mm(x), y: mm(header.top), width: mm(sectionW), height: mm(chipPx), ink: sectionInk });
    items.push(furnitureLine(x, lineY + 2, sectionW, sectionName,
      { family: 'sans', weight: 700, bold: true, fontPx: 8, ink: '#ffffff' }, 'center'));
  }
  items.push(title, middle, number);
  // No rule at all for a reversed banner - the panel's own edge IS the rule.
  // A double rule is the same two-offset geometry blockRules() already draws.
  if (!reversed && style.rule.weight > 0) {
    const ruleInk = themeInk || RULE_INK;
    const weight = style.rule.weight;
    // The double moves INWARD from the band's true edge, mirroring
    // blockRules()'s own double-rule offsets - the outer line sits exactly
    // where the single rule always sat, and the inner line is a gap above it,
    // never past the band into the content that follows.
    const offsets = style.rule.double ? [0, -weight * 2] : [0];
    for (const offset of offsets) items.push(ruleItem(leftPx, header.top + chipPx + offset, widthPx, weight, ruleInk));
  }
  return items.filter(Boolean);
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

// FIVE FOOTER STYLES, resolved the same way the folio above is - one theme,
// read once, drawn identically top to bottom of the page. The band's height
// is never touched; only the rule (if any), the tint and the title's ink are.
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

  const { footerStyleForTheme, furnitureInkForTheme, furnitureTintForTheme } = modules.furniture;
  const fstyle = footerStyleForTheme(page.style_theme);
  const footInk = fstyle.title !== 'plain' ? furnitureInkForTheme(page.style_theme) : null;
  const footTint = fstyle.band ? furnitureTintForTheme(page.style_theme) : null;
  // THE FOOT KEEPS ITS CLEARANCE, exactly as the folio does - the paint sits
  // at the bottom of its reserved band with white above it, rather than
  // filling the band and meeting the last block's rule.
  const footStripMm = Math.min(footHeightMm, mm(FOOT_STRIP_PX));
  const footPaintY = footYMm + (footHeightMm - footStripMm);
  if (footTint) {
    items.push({ kind: 'fill', x: leftMm, y: footPaintY, width: widthMm, height: footStripMm, ink: footTint });
  }
  if (fstyle.rule) {
    const weight = mm(fstyle.rule.weight);
    const ruleInk = footInk || RULE_INK;
    const yAt = fstyle.rule.edge === 'top' ? footPaintY : footYMm + footHeightMm - weight;
    const offsets = fstyle.rule.double ? [0, fstyle.rule.edge === 'top' ? weight * 2 : -weight * 2] : [0];
    for (const offset of offsets) {
      items.push({ kind: 'rule', x: leftMm, y: yAt + offset, width: widthMm, height: weight, ink: ruleInk });
    }
  }

  columns.forEach((text, index) => {
    if (!text) return;
    // The page's own name and its number carry the theme ink where one is
    // asked for (the same two spans pageFootMarkup colours on the canvas);
    // the date in the middle stays neutral either way, exactly as it always
    // has - a themed foot is not a themed date.
    const themedColumn = index !== 1 && footInk;
    items.push(textItem(
      { x: leftMm + index * thirdMm, y: footYMm, width: thirdMm, height: footHeightMm },
      [run(text, { family: 'sans', weight: index === 1 ? 400 : 700, fontPx: 18, ink: themedColumn ? footInk : null })],
      ALIGN[index],
    ));
  });

  // The legal imprint prints ONCE, on its own page. A press file that dropped
  // the AI disclosure would print a paper that does not carry it.
  if (Number(page.page_number) === Number(identity.imprintPage || 2) && region.footer.imprintHeightPx > 0) {
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
    //
    // TWO BOXES, ONE PER LANGUAGE. The standing disclosure closes each
    // language's own paragraph rather than standing under both, which is what
    // the canvas draws (masthead.js's imprintMarkup) - and a press file that
    // set the imprint in a different shape from the sheet the desk approved
    // is the two-surface fault this repository guards hardest against.
    const IMPRINT_MIN_PX = 3.6;
    const IMPRINT_LINE = 1.45;
    const RULE_PX = 0.5;
    const PAD_PX = 1;
    const bandHeightPx = region.footer.imprintHeightPx;
    const boxes = [
      [
        { text: identity.imprint, weight: 400, bold: false },
        { text: identity.aiDisclosure, weight: 700, bold: true },
      ],
      [
        { text: identity.imprintEnglish, weight: 400, bold: false },
        { text: identity.aiDisclosureEnglish, weight: 700, bold: true },
      ],
    ].map((box) => box.filter((part) => String(part.text || '').trim()))
      .filter((box) => box.length);

    // The type is SOLVED against the band, exactly as the canvas does it, and
    // the boxes' own rules and inset are charged for - a size chosen against
    // the bare line count would set six lines into a band that has room for
    // six lines minus four rules and four rows of padding.
    const boxChrome = boxes.length * (RULE_PX * 2 + PAD_PX * 2);
    let fontPx = 5.2;
    let wrapped = [];
    for (; fontPx >= IMPRINT_MIN_PX; fontPx -= 0.2) {
      wrapped = boxes.map((box) => box.map((part) => ({
        ...part,
        lines: wrapFurniture(part.text, geometry.matterWidthPx - (RULE_PX + PAD_PX) * 2, fontPx, 'sans', part.weight),
      })));
      const rows = wrapped.reduce((n, box) => n + box.reduce((m, part) => m + part.lines.length, 0), 0);
      if (rows * fontPx * IMPRINT_LINE + boxChrome <= bandHeightPx) break;
    }

    const rowPx = fontPx * IMPRINT_LINE;
    const rowMm = mm(rowPx);
    let yPx = region.footer.imprintTop;
    for (const box of wrapped) {
      const rows = box.reduce((n, part) => n + part.lines.length, 0);
      const boxHeightPx = rows * rowPx + PAD_PX * 2 + RULE_PX * 2;
      // The rule, drawn as four thin fills - the one primitive every writer
      // already has. A `rule` is what a block border and a column rule are
      // made of; there is no second geometry here.
      const t = mm(RULE_PX);
      const bx = geometry.marginXPx;
      const bw = geometry.matterWidthPx;
      for (const edge of [
        { x: mm(bx), y: mm(yPx), width: mm(bw), height: t },
        { x: mm(bx), y: mm(yPx + boxHeightPx - RULE_PX), width: mm(bw), height: t },
        { x: mm(bx), y: mm(yPx), width: t, height: mm(boxHeightPx) },
        { x: mm(bx + bw - RULE_PX), y: mm(yPx), width: t, height: mm(boxHeightPx) },
      ]) items.push({ kind: 'rule', ...edge, ink: RULE_INK });

      let y = mm(yPx + RULE_PX + PAD_PX);
      for (const part of box) {
        for (const text of part.lines) {
          items.push(textItem({ x: mm(bx + RULE_PX + PAD_PX), y, width: mm(bw - (RULE_PX + PAD_PX) * 2), height: rowMm },
            [run(text, { family: 'sans', weight: part.weight, bold: part.bold, fontPx })], 'center'));
          y += rowMm;
        }
      }
      yPx += boxHeightPx + PAD_PX;
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
    for (const rule of columnRules.columnRulesFor(page, geometry, Boolean(newspaper.column_rules))) {
      items.push(rule.axis === 'v'
        ? { kind: 'rule', x: mm(rule.at - 0.25), y: mm(rule.from), width: mm(0.5), height: mm(rule.to - rule.from), ink: RULE_INK }
        : { kind: 'rule', x: mm(rule.from), y: mm(rule.at - 0.25), width: mm(rule.to - rule.from), height: mm(0.5), ink: RULE_INK });
    }

    // The page's own pictures go down AFTER the blocks, because that is what
    // "laid over" means and every writer here paints in document order. The
    // blocks have already set their type clear of them, so this is paint and
    // not layout.
    items.push(...pageOverlayItems(page, { mono }));

    items.push(...footerItems(newspaper, page, geometry, identity));
    items.push(...registrationItems(geometry));
    // The whole page at once, and LAST - the masthead, the folio, the rules and
    // the registration marks are as much on this forme as the blocks are.
    built.push({ number: Number(page.page_number), items: mono ? separateToK(items) : items });
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

/**
 * The PAGE FURNITURE as neutral items, for a writer that does its own block
 * walk. Scribus is the one - it is the tested press path and moving its whole
 * walk onto this model at the end of a pass is the rewrite that should not be
 * done - but there is no reason for it to describe the nameplate, the folio or
 * the column rules a second time. It renders these.
 */
async function pageFurniture(newspaper, page, geometry, identity) {
  const { columnRules } = await ensureComposeReady();
  const items = [
    ...mastheadItems(newspaper, page, geometry, identity, page.sections),
    ...folioItems(newspaper, page, geometry, identity),
  ];
  for (const rule of columnRules.columnRulesFor(page, geometry, Boolean(newspaper.column_rules))) {
    items.push(rule.axis === 'v'
      ? { kind: 'rule', x: mm(rule.at - 0.25), y: mm(rule.from), width: mm(0.5), height: mm(rule.to - rule.from), ink: RULE_INK }
      : { kind: 'rule', x: mm(rule.from), y: mm(rule.at - 0.25), width: mm(rule.to - rule.from), height: mm(0.5), ink: RULE_INK });
  }
  return items.filter(Boolean);
}

/** A block's own rules, in the same neutral kinds. */
/**
 * A rounded rectangle as a closed point list, clockwise from the top-left
 * corner, in the same millimetres every other item in this model is stated in.
 *
 * The straight edges come free: each corner arc ends exactly where the next
 * one begins, so the four arcs joined in order ARE the path. The radius is
 * clamped to half the shorter side, which is what makes a `pill` radius an end
 * cap rather than a shape that folds through itself - the same clamp a browser
 * applies to `border-radius`, so the two agree.
 */
function roundedRectPoints(x, y, w, h, radius) {
  // The SAME segmentation a pie's slices are drawn with, so a rounded corner
  // on the plate is the same polygon the canvas rounds - never a second
  // approximation of the same arc.
  const { arcPoints: arcPointsOf } = modules.smartCardLayout;
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const arc = (cx, cy, from, to) => arcPointsOf(cx, cy, r, from, to);
  return [
    ...arc(x + r, y + r, 0.75, 1),
    ...arc(x + w - r, y + r, 0, 0.25),
    ...arc(x + w - r, y + h - r, 0.25, 0.5),
    ...arc(x + r, y + h - r, 0.5, 0.75),
  ];
}

/**
 * A BLOCK'S OWN BORDER - the one implementation every writer draws from.
 * PDF and IDML reach it through `blockItems()` above; Scribus calls it
 * directly. It used to be two copies, and the second never learned the
 * block's own ink or its rounded corner - the .sla printed square black
 * borders on a page whose PDF and canvas both showed the desk's own theme.
 *
 * THE SHAPE TAKES PRECEDENCE OVER THE RADIUS. A cut corner and a rounded one
 * both need the border traced as one stroked polygon rather than four
 * straight rules - `shapedRectPoints()` degrades to the plain rectangle's
 * four corners when no shape is set, so this is the SAME code path a square
 * block already took, extended rather than branched.
 */
function blockRules(section) {
  const edges = borderEdges(section.border_style);
  if (!edges.length) return [];
  const weight = borderWidthPx(section.border_width_px);
  const x0 = mm(section.x_px);
  const y0 = mm(section.y_px);
  const w = mm(section.width_px);
  const h = mm(section.height_px);
  const t = mm(weight);
  const ink = section.border_ink || RULE_INK;
  const shapeKey = section.frame_shape;
  const out = [];
  for (const offset of borderOffsetsPx(section.border_style, weight)) {
    const o = mm(offset);
    if (shapeKey) {
      // A cut corner traced as one stroked polygon, in the block's own
      // page-mm coordinates - blockShapes.shapedRectPoints() is LOCAL (0,0 at
      // the block's own top-left), so every point is offset by x0+o/y0+o,
      // the same inset a rounded box already applies per double-rule pass.
      const localW = w - o * 2;
      const localH = h - o * 2;
      const points = modules.blockShapes.shapedRectPoints(shapeKey, localW - t, localH - t)
        .map(([px, py]) => [x0 + o + t / 2 + px, y0 + o + t / 2 + py]);
      out.push({ kind: 'poly', close: true, ink, strokeWidth: t, x: x0 + o, y: y0 + o, width: localW, height: localH, points });
      continue;
    }
    const radius = isBoxed(section.border_style) ? borderRadiusPx(section.border_radius_px) : 0;
    if (radius > 0) {
      out.push({
        kind: 'poly', close: true, ink, strokeWidth: t,
        x: x0 + o, y: y0 + o, width: w - o * 2, height: h - o * 2,
        points: roundedRectPoints(x0 + o + t / 2, y0 + o + t / 2, w - o * 2 - t, h - o * 2 - t, mm(radius)),
      });
      continue;
    }
    const RULES = {
      top: { x: x0 + o, y: y0 + o, width: w - o * 2, height: t },
      bottom: { x: x0 + o, y: y0 + h - o - t, width: w - o * 2, height: t },
      left: { x: x0 + o, y: y0 + o, width: t, height: h - o * 2 },
      right: { x: x0 + w - o - t, y: y0 + o, width: t, height: h - o * 2 },
    };
    for (const edge of edges) out.push({ kind: 'rule', ...RULES[edge], ink });
  }
  return out;
}

module.exports = {
  buildPrintModel, ensureComposeReady,
  pageFurniture, blockRules, blockDecorations, pageOverlayItems,
  mm, pt,
};
