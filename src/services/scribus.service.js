// Getting the paper off the screen and onto the press.
//
// This was the hole in the middle of the system. SAHAS could lay a page out
// exactly, measure it, flow copy round a cut-out and tell you what the advert
// was worth - and then produce nothing a printer could use. The pipeline in
// CLAUDE.md ends "Workspace → Generate Scribus → Editor adjusts → Export CMYK
// PDF", and only the last step, uploading the finished file, existed.
//
// Scribus rather than a PDF written here, deliberately:
//
//   * The page designer has to be able to open it and nudge things. A PDF is
//     final; an .sla is the job, and Scribus is what a small Indian press room
//     already has.
//   * Scribus does CMYK separation, overprint and ICC properly. Re-implementing
//     that would be re-implementing a print engine.
//   * .sla is XML. Everything it needs - frames in millimetres, fonts, colours,
//     the text itself - is what the workspace already holds.
//
// Everything below is in MILLIMETRES. The editor works at 2 px/mm and CLAUDE.md
// forbids mixing the two silently, so px→mm happens once, here, at the boundary.
//
// THE INVARIANT THIS FILE EXISTS TO HOLD: Layout, the Block Editor, preflight
// and Scribus consume ONE composition truth. This used to be a second,
// independent text-layout engine - `body_font_px * 1.6` for a kicker's height,
// `Math.floor(innerWidth / 38)` for how many columns a body sets in, and then
// the whole body handed to Scribus as ONE paragraph for Scribus's own text
// engine to wrap a second time. None of those numbers came from anywhere; they
// could not help disagreeing with what the desk had actually approved on
// screen. Every line that reaches a press frame now is a line
// public/editor/compose/ already decided, at an x/y/width/height/fontPx it
// already computed - this file only converts px to mm and writes XML.

const { geometryOf, pxToMm, regionForPage } = require('../layout/geometry');
// Captions are plain strings, not rich copy - the one place `strip()` (the
// server's cached view of rich-text.js's plainText()) is still used directly.
const { strip } = require('../layout/plain-text');
const { identityFor, dateLine, devanagari } = require('../layout/identity');
const { captionBox, PLACED_CAPTION_METRICS } = require('../../public/editor/layout/caption-geometry');

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const mm = (px) => Number(pxToMm(px).toFixed(4));
// The same rounding, for a number that has already been ASSEMBLED from
// millimetres rather than converted from pixels once - a frame's y is the
// block's own y plus the line's, and adding two already-rounded millimetre
// values reintroduces the float noise the rounding just removed: 30 + 18.645
// is 48.644999999999996 as a double, and that is what was going into the
// press file. A .sla is a document handed to a printer; it carries clean
// millimetres. It also made two paths that compute the same coordinate in a
// different ORDER disagree in their last digits, which is exactly what
// tests/scribusComposition.test.js exists to catch.
const mmRound = (value) => Number(Number(value).toFixed(4));
// Scribus works in points for type sizes. The editor's px are 2 per mm - the
// SAME conversion every persisted *_font_px column already uses, so a
// selected-size mark (rich-text.js's `data-sahas-size`, also stored in that
// px convention) converts with this one function too, not a second one.
const pxToPt = (px) => Number(((Number(px) / 2) * 72 / 25.4).toFixed(2));

// The paper's inks, as separations rather than as screen colours. A newspaper
// is printed from four plates; naming the spot colours here is what lets the
// press see the red of the masthead as one ink and not as a rich black mess.
const COLOURS = `
  <COLOR NAME="Black" CMYK="#00000000" Spot="0" Register="0"/>
  <COLOR NAME="Registration" CMYK="#ffffffff" Spot="0" Register="1"/>
  <COLOR NAME="White" CMYK="#00000000" Spot="0" Register="0"/>
  <COLOR NAME="SahasRed" CMYK="#00ffe61a" Spot="0" Register="0"/>
  <COLOR NAME="None" CMYK="#00000000" Spot="0" Register="0"/>`;

// The four faces the publication actually ships (public/assets/fonts/, the
// same registry compose/font-metrics.js reads under FONT_FILES) - keyed the
// same way, "stack/weight", so a composed line's own `family`/`weight`
// (compose.js's DISPLAY_TYPOGRAPHY, or the block's own Typography-panel
// choice for body copy) maps onto a real name Scribus can resolve on the
// machine that opens the file, never a second, invented font name.
const FONT_NAMES = {
  'serif/400': 'Noto Serif Devanagari Regular',
  'serif/700': 'Noto Serif Devanagari Bold',
  'sans/400': 'Noto Sans Devanagari Regular',
  'sans/700': 'Noto Sans Devanagari Bold',
};
const BODY_FONT = FONT_NAMES['serif/400'];
const HEAD_FONT = FONT_NAMES['sans/700'];

function faceKey(family, weight) {
  const stack = String(family || 'serif').toLowerCase().includes('sans') ? 'sans' : 'serif';
  return `${stack}/${Number(weight) >= 600 ? 700 : 400}`;
}
/** The real font NAME for a composed line's own family/weight - `forceBold`
 * is a per-RUN override (a `<b>`/`<strong>` mark inside otherwise-regular
 * body copy), never a second classification. */
function fontNameFor(family, weight, forceBold = false) {
  return FONT_NAMES[faceKey(family, forceBold ? 700 : weight)] || BODY_FONT;
}

let frameId = 1;
const nextId = () => (frameId += 1);

// --------------------------------------------------------- compose loader ---
//
// The same lazy-import pattern fit.service.js and preflight.service.js
// already use for these ES modules (public/editor/compose/ has no CommonJS
// build). "No fallback geometry is allowed at press export" - a page that
// went to the plate composed against the hmtx fallback, because the shaper
// silently failed to load, is not a conservative press file, it is a WRONG
// one; requireShaperReady() makes that a loud failure at build time instead.

let metricsModule = null;
let shaperModule = null;
let adapterModule = null;
let richTextModule = null;
let smartCardsModule = null;
let smartCardLayoutModule = null;
let textFlowModule = null;
let imageGeometryModule = null;
let accentModule = null;

async function ensureComposeReady() {
  if (!metricsModule) metricsModule = await import('../../public/editor/compose/font-metrics.js');
  if (!shaperModule) shaperModule = await import('../../public/editor/compose/shaper.js');
  if (!adapterModule) adapterModule = await import('../../public/editor/compose/section-adapter.js');
  if (!richTextModule) richTextModule = await import('../../public/editor/layout/rich-text.js');
  if (!smartCardsModule) smartCardsModule = await import('../../public/editor/smart-cards/smart-cards.js');
  if (!smartCardLayoutModule) smartCardLayoutModule = await import('../../public/editor/smart-cards/layout.js');
  if (!textFlowModule) textFlowModule = await import('../../public/editor/layout/text-flow.js');
  if (!imageGeometryModule) imageGeometryModule = await import('../../public/editor/layout/image-geometry.js');
  if (!accentModule) accentModule = await import('../../public/editor/compose/accent.js');
  await Promise.all([metricsModule.ensureFontsLoaded(), shaperModule.ensureShaperReady()]);
  shaperModule.requireShaperReady();
  return {
    adapter: adapterModule,
    richText: richTextModule,
    smartCards: smartCardsModule,
    smartCardLayout: smartCardLayoutModule,
    textFlow: textFlowModule,
    imageGeometry: imageGeometryModule,
    accent: accentModule,
  };
}

// -------------------------------------------------------------- XML frames ---

/**
 * One already-positioned composed LINE, as one Scribus text frame - never a
 * paragraph Scribus is asked to wrap again. `runs` are the line's own styled
 * pieces (rich-text.js's styledRuns(), or a single plain run for a band line
 * with no marks); every run becomes one ITEXT inside the SAME frame, so
 * several styles can sit on one physical line without Scribus ever breaking
 * it onto two.
 *
 * EXTRA/TEXTRA/BEXTRA/REXTRA are all 0: the compositor already owns every
 * pixel of padding a line needed (the frame's own x/y/width/height IS the
 * line's exact measure), so Scribus's own default text-frame inset (1.5mm on
 * every side in the old per-band frames) would silently re-introduce a
 * second, un-composed margin around type that was already placed exactly.
 */
function lineFrame({ xMm, yMm, widthMm, heightMm, runs, align = 0, ownPage = 0 }) {
  const itext = runs
    .filter((run) => run.text)
    .map((run) => {
      const font = fontNameFor(run.family, run.weight, run.bold);
      const colour = run.colour || 'Black';
      // Space-separated CharStyle feature tokens (confirmed against the real
      // Scribus 1.6.1 binary: its CharStyle class carries BOLD/ITALIC/
      // UNDERLINE/STRIKETHROUGH/... as named style flags, each serialised as
      // its lowercase name). Bold gets its own real bold font file
      // (fontNameFor() above) rather than a synthetic weight - the publication
      // ships one. Italic does not: no italic Devanagari face exists to ship
      // (confirmed - Noto Serif/Sans Devanagari publish no italic style at
      // all, on this system or upstream), so `italic` here is the same
      // synthetic oblique Scribus's own Italic toggle already applies to any
      // font lacking a true italic weight - not a fake attribute invented for
      // this exporter.
      const styleFeatures = [run.italic ? 'italic' : '', run.underline ? 'underline' : ''].filter(Boolean).join(' ');
      const features = styleFeatures ? ` FEATURES="${styleFeatures}"` : '';
      return `<ITEXT CH="${escapeXml(run.text)}" FONT="${escapeXml(font)}" FONTSIZE="${pxToPt(run.fontPx)}" FCOLOR="None" TXTFILL="${colour}"${features}/>`;
    })
    .join('');
  if (!itext) return '';

  return `
  <PAGEOBJECT XPOS="${mmRound(xMm)}" YPOS="${mmRound(yMm)}" WIDTH="${mmRound(widthMm)}" HEIGHT="${mmRound(heightMm)}"
              OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="4" ANNAME="" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None" LOCALSCX="1" LOCALSCY="1"
              COLUMNS="1" COLGAP="0" TEXTFLOWMODE="0"
              EXTRA="0" TEXTRA="0" BEXTRA="0" REXTRA="0">${itext}<para ALIGN="${align}"/>
  </PAGEOBJECT>`;
}

// An image frame. `PFILE` is a path the press box has to be able to resolve, so
// it is written relative to the .sla - the export ships the pictures beside it.
//
// The frame itself (position, size, rotation) is the ONE geometry every other
// surface already agrees on - public/editor/layout/image-geometry.js's
// resolvePlacedImage(), the same function paint, resize and the exclusion
// mask all read. `LOCALSCX`/`LOCALSCY`/`LOCALX`/`LOCALY` place the embedded
// picture inside that unrotated frame the way Contain/Cover/Stretch already
// scale and centre it in the browser (resolvePlacedImage()'s own
// localContentRect, before rotation is applied - Scribus's `ROT` rotates the
// frame and its content together, matching how the browser applies rotation
// as a transform around the frame's own centre).
//
// CAVEAT, stated rather than hidden: LOCALSCX/LOCALSCY/LOCALX/LOCALY are
// documented Scribus 1.5 image-frame attributes, applied here from that
// documentation - there is no Scribus binary in this environment to render
// and compare a generated frame against, so this has not been visually
// verified against a real Scribus render the way the rest of this project's
// geometry claims are. The frame's OWN position/size/rotation (the part
// every other surface already renders identically) IS exact; the crop/scale
// of the picture WITHIN that frame is a best-effort, deterministic
// derivation from resolvePlacedImage(), not a verified one.
function imageFrame({ resolved, xMm, yMm, file, ownPage = 0 }) {
  const { frame, localContentRect, rotation, scaleX, scaleY } = resolved;
  const widthMm = mm(frame.width);
  const heightMm = mm(frame.height);
  // Scribus scales the embedded picture by a factor of the FRAME's own
  // pre-rotation local target, not the source pixels - LOCALSCX/Y are that
  // ratio directly (resolvePlacedImage() already expresses Contain/Cover/
  // Stretch as exactly this scale for the cropped source into localTarget).
  const localScX = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1;
  const localScY = Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
  // The offset of the scaled picture's own top-left corner from the frame's
  // local origin, in the frame's PRE-rotation space (localContentRect is
  // already exactly that - image-geometry.js's own derivation).
  const localXMm = mm(localContentRect.x);
  const localYMm = mm(localContentRect.y);

  return `
  <PAGEOBJECT XPOS="${mmRound(xMm)}" YPOS="${mmRound(yMm)}" WIDTH="${mmRound(widthMm)}" HEIGHT="${mmRound(heightMm)}"
              ROT="${rotation || 0}" OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="2" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None"
              PFILE="${escapeXml(file)}" LOCALSCX="${localScX}" LOCALSCY="${localScY}"
              LOCALX="${localXMm}" LOCALY="${localYMm}" SCALETYPE="0" RATIO="1"
              TEXTFLOWMODE="2"/>`;
}

// ------------------------------------------------------ headline accent ----
//
// The painted word: one phrase of the headline set in the paper's accent
// colour. Marked by the desk with asterisks in the stored text, or - failing
// that - the true last word of the headline under `headline_style: 'accent'`.
// Decided band-wide by accent.js's headlineSegments(), the SAME function
// render.js uses, so a phrase split across a composed line break (compose.js
// has no idea where the asterisks fall when it wraps the line) still gets
// coloured on both halves here exactly as it does on the canvas - not a
// second, independently-drifting implementation of the same rule.
function segmentRuns(segments, { family, weight }, colour) {
  return segments.map((segment) => ({
    text: segment.text,
    family,
    weight,
    bold: false,
    italic: false,
    underline: false,
    fontPx: null,
    colour: segment.accent ? colour : undefined,
  }));
}

// -------------------------------------------------------------- body runs ---

/** The rich-mark runs for one composed body line, in the SAME coordinate
 * space markRun()/composedMarkup() already establish: marks are held against
 * the plain body text alone (no dateline prefix), and `line.at` is an offset
 * into the text WITH the prefix - shifted back by the prefix length, exactly
 * as render.js's lineHtml() already does, so the two renderers can never
 * slice a mark at two different characters. */
function styledBodyRuns(line, marks, prefixLength, richText) {
  const at = (line.at || 0) - prefixLength;
  return richText.styledRuns(line.text, at, marks, line.fontPx).map((run) => ({
    ...run,
    // Set as it prints: a run of whitespace is one space, the same rule the
    // width was measured with and the browser paints (graphemes.js's
    // setSpaces). Without it the press file carried a double word space where
    // the compositor had merged two paragraphs and the browser did not.
    text: String(run.text ?? '').replace(/\s\s+/g, ' '),
    family: line.family,
    weight: line.weight,
  }));
}

// --------------------------------------------------------- smart cards -----
//
// A Smart Card is never flattened through smartCardText() for the press the
// way it briefly was for prose - it is a STRUCTURED layout (a grid, a table
// of rows, a quote), and layoutSmartCard() has already resolved every line
// it will draw. This reads that SAME resolved geometry, not a second Scribus-
// only solver: a sudoku exports as its exact square cells, a rashi as its
// resolved reading/lucky lines, panchang as its resolved label/value rows, a
// suvichar as its resolved quote/attribution lines, dinvishesh as its
// resolved entries - never a re-flattened paragraph.
function smartCardFrames({ key, data, frame, xMm, yMm, ownPage, cardLayout, family = 'serif', weight = 400 }) {
  const layout = cardLayout.layoutSmartCard(key, data, frame);
  if (layout.fitState === 'EMPTY') return '';
  const parts = [];
  const plainRun = (text, fontPx) => [{ text, family, weight, bold: false, italic: false, underline: false, fontPx }];
  const oneLine = (text, atXPx, atYPx, widthPx, fontPx, align = 0) => {
    if (!text) return;
    parts.push(lineFrame({
      xMm: xMm + mm(atXPx), yMm: yMm + mm(atYPx), widthMm: mm(widthPx), heightMm: mm(layout.geometry?.lineHeightPx || fontPx * 1.5),
      runs: plainRun(text, fontPx), align, ownPage,
    }));
  };

  if (layout.subtitle?.lines?.length) {
    layout.subtitle.lines.forEach((line, i) => oneLine(line, 0, i * layout.subtitle.lineHeightPx, frame.width, layout.subtitle.fontPx, 1));
  }
  const subtitleOffsetPx = layout.subtitle?.height || 0;

  if (key === 'sudoku' || key === 'sudoku-solution') {
    const { cell, top } = layout.geometry;
    const isGrid = (value) => Array.isArray(value) && value.length === 9 && value.every((row) => Array.isArray(row) && row.length === 9);
    const rows = isGrid(data?.grid) ? data.grid : isGrid(data?.solution) ? data.solution : [];
    rows.forEach((row, y) => row.forEach((value, x) => {
      const n = Number(value);
      if (!(n > 0)) return;
      oneLine(devanagari(n), x * cell, subtitleOffsetPx + top + y * cell, cell, layout.fontPx, 1);
    }));
    return parts.join('');
  }

  if (key === 'rashi') {
    const { columns, rows, rowHeights, columnWidth, nameWidth, lineHeightPx } = layout.geometry;
    layout.items.forEach((item, index) => {
      const column = Math.floor(index / rows);
      const row = index % rows;
      const rowTop = rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0);
      const colX = column * columnWidth;
      oneLine(item.name, colX, subtitleOffsetPx + rowTop, nameWidth, layout.fontPx);
      const lines = [...item.readingLines, ...item.luckLines];
      lines.forEach((line, i) => oneLine(line, colX + nameWidth, subtitleOffsetPx + rowTop + i * lineHeightPx, columnWidth - nameWidth, layout.fontPx));
    });
    return parts.join('');
  }

  if (key === 'panchang') {
    const { labelWidth, valueWidth, lineHeightPx } = layout.geometry;
    let top = subtitleOffsetPx;
    for (const item of layout.items) {
      oneLine(item.labelLines[0] || '', 0, top, labelWidth, layout.fontPx);
      item.valueLines.forEach((line, i) => oneLine(line, labelWidth, top + i * lineHeightPx, valueWidth, layout.fontPx));
      top += item.rowHeight;
    }
    return parts.join('');
  }

  if (key === 'suvichar') {
    const { lineHeightPx, attributionFontPx, attributionLineHeightPx, ruleReservePx } = layout.geometry;
    let top = subtitleOffsetPx + ruleReservePx;
    layout.quoteLines.forEach((line, i) => oneLine(line, 0, top + i * lineHeightPx, frame.width, layout.fontPx, 1));
    top += layout.quoteLines.length * lineHeightPx;
    layout.attributionLines.forEach((line, i) => oneLine(line, 0, top + i * attributionLineHeightPx, frame.width, attributionFontPx, 1));
    return parts.join('');
  }

  if (key === 'dinvishesh') {
    const { lineHeightPx } = layout.geometry;
    let top = subtitleOffsetPx;
    for (const item of layout.items) {
      item.lines.forEach((line, i) => oneLine(line, 0, top + i * lineHeightPx, frame.width, layout.fontPx));
      top += item.height;
    }
    return parts.join('');
  }

  return parts.join('');
}

// ------------------------------------------------------------ one block ----

/**
 * Every block on a page becomes frames: one per composed kicker/headline/deck
 * LINE, one per body LINE, one per placed picture (with its caption), or -
 * for a Smart Card - its own resolved structured geometry. `pageIndex` is the
 * real Scribus page this block's frames belong to (see buildDocument()'s own
 * note on OwnPage); `pageOffsetMm` is the same continuous-document vertical
 * offset the page itself is drawn at.
 */
async function blockFrames(section, { pageIndex = 0, pageOffsetMm = 0 } = {}) {
  const { adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent } = await ensureComposeReady();
  const parts = [];

  const holdsCard = Boolean(section.smart_card_key) && Boolean(section.smart_card_data)
    && smartCards.canRenderSmartCard(section.smart_card_key);

  // A Smart Card is never prose: composed with an empty body and no images
  // (smartCardFrame()'s own rule, section-thumb.js), so its kicker/headline/
  // deck bands are exact and the card takes over from exactly where the
  // body would otherwise have started.
  const composition = holdsCard
    ? adapter.composeSection({ ...section, images: [], body: '' }, { ...section, body: '' })
    : adapter.composeSection(section, section);

  parts.push(displayBandFrames(composition, section, accent, richText, {
    xBaseMm: mm(section.x_px), yBaseMm: mm(section.y_px), pageOffsetMm, ownPage: pageIndex,
  }));

  if (holdsCard) {
    const frame = smartCardLayout.smartCardFrameFromComposition(composition);
    parts.push(smartCardFrames({
      key: section.smart_card_key, data: section.smart_card_data, frame,
      xMm: mm(section.x_px + composition.content.left),
      yMm: mm(section.y_px + composition.bodyTop) + pageOffsetMm,
      ownPage: pageIndex, cardLayout: smartCardLayout,
    }));
    return parts.filter(Boolean).join('');
  }

  if (section.body) {
    const { marks } = richText.textWithMarks(section.body);
    const prefix = textFlow.datelineText(section);
    for (const line of composition.bodyLines) {
      const runs = styledBodyRuns(line, marks, prefix.length, richText);
      // Same hard-overset case as displayBandFrames(): a body piece wider
      // than every legal gap in the frame (BODY_UNBREAKABLE_TOKEN_OVERSET)
      // is drawn past its own measure in the browser, not wrapped or
      // clipped - so the press frame must be at least as wide as what was
      // actually drawn, not just the measure it was offered.
      parts.push(lineFrame({
        xMm: mm(section.x_px + line.x), yMm: mm(section.y_px + line.y) + pageOffsetMm,
        widthMm: mm(Math.max(line.width || 0, line.measure) + 1), heightMm: mm(line.height),
        runs, align: 0, ownPage: pageIndex,
      }));
    }
  }

  for (const image of section.images || []) {
    const resolved = imageGeometry.resolvePlacedImage(image);
    parts.push(imageFrame({
      resolved,
      xMm: mm(section.x_px + image.x_px), yMm: mm(section.y_px + image.y_px) + pageOffsetMm,
      file: `.${image.url}`, ownPage: pageIndex,
    }));
    const caption = captionBox(image);
    if (caption && image.caption) {
      parts.push(lineFrame({
        xMm: mm(section.x_px) + mm(caption.x), yMm: mm(section.y_px) + mm(caption.y) + pageOffsetMm,
        widthMm: mm(caption.width), heightMm: mm(caption.height),
        runs: [{ text: strip(image.caption), family: 'serif', weight: 400, bold: false, italic: false, underline: false, fontPx: PLACED_CAPTION_METRICS.fontPx }],
        ownPage: pageIndex,
      }));
    }
  }

  return parts.filter(Boolean).join('');
}

/** The kicker/headline/deck bands, each composed LINE as its own frame - the
 * headline's own accent phrase (asterisk-marked, or the true last word under
 * `headline_style: 'accent'`) split into its own run so it paints in the
 * paper's colour, decided band-wide by accent.js's headlineSegments() -
 * exactly as render.js's composedMarkup() already does for the browser. */
function displayBandFrames(composition, section, accent, richText, { xBaseMm, yBaseMm, pageOffsetMm, ownPage }) {
  const parts = [];
  const headlineBand = composition.bands?.headline;
  const headlineTexts = headlineBand ? headlineBand.lines.map((line) => line.text) : [];
  const headline = accent.headlineSegments(headlineTexts, { accentStyle: section.headline_style === 'accent' });
  for (const [key, band] of Object.entries(composition.bands || {})) {
    band.lines.forEach((line, lineIndex) => {
      // The desk's own marks inside a display flow - a name set bold in a
      // headline, a word at its own size in a deck - through the SAME
      // styledRuns() the body goes through, against the same `line.at`
      // contract. Without this the press file flattened every display band to
      // one plain run: the browser printed the bold word and the paper did
      // not, which is the exact class of divergence a press file may not have.
      const runs = key === 'headline' && headline
        ? segmentRuns(headline[lineIndex], { family: line.family, weight: line.weight }, 'SahasRed').map((run) => ({ ...run, fontPx: run.fontPx || line.fontPx }))
        : richText.styledRuns(line.text, line.at || 0, band.marks || [], line.fontPx)
          .map((run) => ({ ...run, family: line.family, weight: run.bold ? 700 : line.weight }));
      // `line.measure` is the band's own gap; `line.width` is what was
      // actually drawn there. A one-word headline wider than the whole
      // measure is set anyway (compose.js will not invent a hyphen inside a
      // Marathi word) and the browser lets it spill past its box
      // (`.section-composed{overflow:visible}`, styles.css). A frame sized
      // to `measure` alone would let Scribus wrap or clip exactly that word
      // - the one case the browser and the press must not disagree on.
      parts.push(lineFrame({
        xMm: xBaseMm + mm(line.x), yMm: yBaseMm + mm(line.y) + pageOffsetMm,
        widthMm: mm(Math.max(line.width || 0, line.measure)), heightMm: mm(line.height),
        runs, align: 0, ownPage,
      }));
    });
  }
  return parts.join('');
}

// ------------------------------------------------------------- furniture ---
//
// The footer band: the SAME three things the browser prints
// (masthead.js's pageFootMarkup()) - the paper's name, the edition's date,
// the page number - from the SAME reserved region (geometry.js's
// regionsFor()) and the SAME identity (identity.js). No rule, no border, no
// extra legal sentence: the footer band is furniture, not a second imprint.
function footerFrames(newspaper, page, geometry, identity, { pageOffsetMm, ownPage }) {
  const parts = [];
  const region = regionForPage(geometry, page.page_number);
  const date = dateLine(newspaper.publication_date);
  const dateText = date.day ? `${date.day} ${date.monthYear}` : '';
  const verso = Number(page.page_number) % 2 === 0;

  const leftMm = mm(geometry.marginXPx);
  const widthMm = mm(geometry.matterWidthPx);
  const footYMm = mm(region.footer.footTop) + pageOffsetMm;
  const footHeightMm = mm(region.footer.footHeightPx);

  // Three even columns across the foot, left to right in VISUAL order - the
  // browser achieves the verso flip with CSS `flex-direction:row-reverse`
  // (masthead.js/styles.css's .foot-verso); Scribus has no flex, so the
  // three frames are placed directly in the order a reader would actually
  // see them, recto (title, date, page) or verso (page, date, title).
  const thirdMm = widthMm / 3;
  const pageLabel = `पृष्ठ ${devanagari(page.page_number)}`;
  const columns = verso ? [pageLabel, dateText, identity.title] : [identity.title, dateText, pageLabel];

  columns.forEach((text, index) => {
    if (!text) return;
    const weight = index === 1 ? 400 : 700; // the date column is regular; title/page are bold
    parts.push(lineFrame({
      xMm: leftMm + index * thirdMm, yMm: footYMm,
      widthMm: thirdMm, heightMm: footHeightMm,
      runs: [{ text, family: 'sans', weight, bold: false, italic: false, underline: false, fontPx: 18 }],
      align: 0, ownPage,
    }));
  });

  // The legal imprint - printed ONCE, on identity.imprintPage (page two),
  // never duplicated into every page's footer.
  if (Number(page.page_number) === Number(identity.imprintPage || 2) && region.footer.imprintHeightPx > 0) {
    const imprintYMm = mm(region.footer.imprintTop) + pageOffsetMm;
    const imprintHeightMm = mm(region.footer.imprintHeightPx);
    // Two declaration lines and the standing AI disclosure, in the same
    // proportions the canvas sets them in (masthead.js's imprintMarkup): the
    // Marathi and English declarations take two of the band's five lines
    // each, the disclosure the fifth. A press file that dropped the
    // disclosure would print a paper that does not carry it.
    const declarationMm = imprintHeightMm * 0.4;
    parts.push(lineFrame({
      xMm: leftMm, yMm: imprintYMm, widthMm, heightMm: declarationMm,
      runs: [{ text: identity.imprint, family: 'sans', weight: 400, bold: false, italic: false, underline: false, fontPx: 9 }],
      align: 1, ownPage,
    }));
    parts.push(lineFrame({
      xMm: leftMm, yMm: imprintYMm + declarationMm, widthMm, heightMm: declarationMm,
      runs: [{ text: identity.imprintEnglish, family: 'sans', weight: 400, bold: false, italic: false, underline: false, fontPx: 8 }],
      align: 1, ownPage,
    }));
    parts.push(lineFrame({
      xMm: leftMm, yMm: imprintYMm + declarationMm * 2, widthMm, heightMm: imprintHeightMm - declarationMm * 2,
      runs: [{ text: identity.aiDisclosure, family: 'sans', weight: 700, bold: true, italic: false, underline: false, fontPx: 9 }],
      align: 1, ownPage,
    }));
  }

  return parts.join('');
}

/**
 * The whole edition as one Scribus document.
 *
 * One .sla with every page in it, rather than a file per page: the designer
 * opens the paper, not eight separate jobs, and Scribus's own page navigation
 * is what they already know.
 */
async function buildDocument(newspaper, pages) {
  await ensureComposeReady();
  frameId = 1;
  const g = geometryOf(newspaper);
  const identity = identityFor(newspaper.publication_date, pages.length);
  const date = dateLine(newspaper.publication_date);

  const pageWidthMm = g.pageWidthMm;
  const pageHeightMm = g.pageHeightMm;
  const marginXMm = (pageWidthMm - g.matterWidthMm) / 2;
  const marginYMm = (pageHeightMm - g.matterHeightMm) / 2;
  const pageStepMm = pageHeightMm + 20;

  const pageElements = pages
    .map(
      (page, index) => `
  <PAGE PAGEXPOS="0" PAGEYPOS="${index * pageStepMm}" PAGEWIDTH="${pageWidthMm}" PAGEHEIGHT="${pageHeightMm}"
        BORDERLEFT="${marginXMm}" BORDERRIGHT="${marginXMm}" BORDERTOP="${marginYMm}" BORDERBOTTOM="${marginYMm}"
        NUM="${index}" NAM="" MNAM="Normal" Size="Custom" Orientation="0"
        LEFT="0" PRESET="0" VerticalGuides="" HorizontalGuides=""/>`,
    )
    .join('');

  const objectParts = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageOffsetMm = index * pageStepMm;
    for (const section of page.sections || []) {
      // eslint-disable-next-line no-await-in-loop
      objectParts.push(await blockFrames(section, { pageIndex: index, pageOffsetMm }));
    }
    objectParts.push(footerFrames(newspaper, page, g, identity, { pageOffsetMm, ownPage: index }));
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<SCRIBUSUTF8NEW Version="1.5.8">
<DOCUMENT ANZPAGES="${pages.length}" PAGEWIDTH="${pageWidthMm}" PAGEHEIGHT="${pageHeightMm}"
          BORDERLEFT="${marginXMm}" BORDERRIGHT="${marginXMm}" BORDERTOP="${marginYMm}" BORDERBOTTOM="${marginYMm}"
          ORIENTATION="0" PAGESIZE="Custom" FIRSTNUM="1" BOOK="0" AUTOSPALTEN="1" ABSTSPALTEN="${g.gridGutterMm}"
          UNITS="1" DFONT="${escapeXml(BODY_FONT)}" DSIZE="9"
          AUTHOR="${escapeXml(identity.title)}"
          TITLE="${escapeXml(`${identity.title} — ${date.day || ''} ${date.monthYear || ''}`)}"
          KEYWORDS="${escapeXml(identity.volumeLine)}"
          COMMENTS="Generated by SAHAS. Colour space CMYK; ${g.printDpi} dpi target."
          BLEEDTOP="${g.bleedMm}" BLEEDLEFT="${g.bleedMm}" BLEEDRIGHT="${g.bleedMm}" BLEEDBOTTOM="${g.bleedMm}">
${COLOURS}
${pageElements}
${objectParts.join('')}
</DOCUMENT>
</SCRIBUSUTF8NEW>
`;
}

module.exports = {
  buildDocument, blockFrames, escapeXml, mm, mmRound, pxToPt, BODY_FONT, HEAD_FONT, fontNameFor,
  ensureComposeReady,
};
