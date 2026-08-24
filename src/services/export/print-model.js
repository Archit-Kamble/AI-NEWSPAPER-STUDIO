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

const { geometryOf, pxToMm, regionForPage } = require('../../layout/geometry');
const { identityFor, dateLine, devanagari } = require('../../layout/identity');
const { strip } = require('../../layout/plain-text');
const { captionBox, PLACED_CAPTION_METRICS } = require('../../../public/editor/layout/caption-geometry');
const { smartCardLines } = require('./smart-card-lines');

/** Editor pixels to millimetres. The one conversion, stated once. */
const mm = (px) => Number(pxToMm(px).toFixed(4));
/** Editor pixels to points. 2 px/mm, 72 pt/inch, 25.4 mm/inch. */
const pt = (px) => Number(((Number(px) / 2) * 72 / 25.4).toFixed(3));

let modules = null;

async function ensureComposeReady() {
  if (!modules) {
    const [metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent] =
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
      ]);
    modules = { metrics, shaper, adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent };
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

async function blockItems(section) {
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
      items.push(textItem(
        { x: originX + mm(line.x), y: originY + mm(line.y), width: mm(line.width), height: mm(line.height) },
        [run(line.text, { family: 'serif', weight: 400, fontPx: line.fontPx })],
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
    });
    const caption = captionBox(image);
    if (caption && image.caption) {
      items.push(textItem(
        { x: x0 + mm(caption.x), y: y0 + mm(caption.y), width: mm(caption.width), height: mm(caption.height) },
        [run(strip(image.caption), { family: 'serif', weight: 400, fontPx: PLACED_CAPTION_METRICS.fontPx })],
      ));
    }
  }

  return items.filter(Boolean);
}


// -------------------------------------------------------------- furniture ---

/**
 * THE NAMEPLATE, which no export has ever carried.
 *
 * Found by rendering a real four-page edition to a press PDF and looking at
 * it: page one had a hand's width of white where the paper's own name goes.
 * `scribus.service.js` has the same gap and always has - it emits the footer
 * and the imprint and nothing above the fold - so this is a hole in the press
 * path, not something the PDF introduced. A newspaper without its nameplate is
 * not a newspaper.
 *
 * It is drawn from the same two sources the canvas draws it from - the header
 * region `regionsFor()` reserves, and `identityFor()` - so it cannot describe
 * a different masthead from the screen. It is deliberately the PRESS
 * furniture rather than a pixel copy of the browser's: the plate artwork, the
 * date ear, the editor ear and the strapline, at the reserved geometry.
 *
 * The ear is left for the corner block when the page HAS one; a paper that
 * does not sell the corner prints its nameplate across the whole measure -
 * exactly the rule CLAUDE.md records for the canvas.
 */
function mastheadItems(newspaper, page, geometry, identity, sections) {
  if (Number(page.page_number) !== 1) return [];
  const region = regionForPage(geometry, page.page_number);
  const header = region.header;
  if (!header || !(header.bottom > header.top)) return [];

  const hasCorner = (sections || []).some((section) =>
    Number(section.x_px) < geometry.marginXPx + header.earWidthPx
    && Number(section.y_px) < header.bottom);
  const earPx = hasCorner ? header.earWidthPx + (header.earGapPx || 0) : 0;

  const leftMm = mm(geometry.marginXPx + earPx);
  const widthMm = mm(geometry.matterWidthPx - earPx);
  const topMm = mm(header.top);
  const bandMm = mm(header.bottom - header.top);

  const items = [];
  // The registered artwork, at its own proportions inside the band - never
  // stretched to fill it, because a stretched nameplate is a different
  // nameplate and this one is a registered mark.
  const aspect = Number(identity.nameplateAspect) || (1600 / 300);
  const plateHeight = Math.min(bandMm * 0.62, widthMm / aspect);
  const plateWidth = plateHeight * aspect;
  if (identity.nameplateUrl) {
    items.push({
      kind: 'image',
      x: leftMm + (widthMm - plateWidth) / 2, y: topMm,
      width: plateWidth, height: plateHeight,
      file: String(identity.nameplateUrl).replace(/^\//, ''),
      resolved: null, rotation: 0,
    });
  }

  const below = topMm + plateHeight;
  const rest = Math.max(0, bandMm - plateHeight);
  if (rest > 0) {
    const lineMm = rest / 2;
    const date = dateLine(newspaper.publication_date);
    items.push(textItem(
      { x: leftMm, y: below, width: widthMm, height: lineMm },
      [run(identity.strapline, { family: 'sans', weight: 400, fontPx: 11 })], 'center'));
    // NOT the RNI: the registered artwork above already carries it, and
    // printing it twice on the same plate is the "editor's name set twice"
    // fault CLAUDE.md records for the browser masthead, in a new place.
    items.push(textItem(
      { x: leftMm, y: below + lineMm, width: widthMm, height: lineMm },
      [run(date.day ? `${date.day} ${date.monthYear}` : '', { family: 'sans', weight: 700, fontPx: 10 })], 'right'));
  }

  return items.filter(Boolean);
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
    const declaration = height * 0.4;
    items.push(textItem({ x: leftMm, y: top, width: widthMm, height: declaration },
      [run(identity.imprint, { family: 'sans', weight: 400, fontPx: 9 })], 'center'));
    items.push(textItem({ x: leftMm, y: top + declaration, width: widthMm, height: declaration },
      [run(identity.imprintEnglish, { family: 'sans', weight: 400, fontPx: 8 })], 'center'));
    items.push(textItem({ x: leftMm, y: top + declaration * 2, width: widthMm, height: height - declaration * 2 },
      [run(identity.aiDisclosure, { family: 'sans', weight: 700, bold: true, fontPx: 9 })], 'center'));
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
    for (const section of page.sections || []) {
      items.push(...await blockItems(section));
    }
    items.push(...footerItems(newspaper, page, geometry, identity));
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
