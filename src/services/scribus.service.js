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
// The furniture the shared print model already describes - the nameplate, the
// folio, the column rules and a block's own border. See furnitureFrames().
const { pageFurniture, blockRules, blockDecorations, pageOverlayItems } = require('./export/print-model');
const ACCENT_HEX = '#c8102e';
const { smartCardLines } = require('./export/smart-card-lines');

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
/**
 * COLOURS THIS DOCUMENT NEEDS THAT THE FIXED TABLE BELOW DOES NOT NAME.
 *
 * A `.sla` names every colour in a table at the top and refers to them by
 * name, so a fixed table can only draw the inks it was written with. That was
 * true and sufficient until a pie arrived: a newspaper prints one in TINTS of
 * a single ink, and each tint is a real colour the plate has to be told about.
 * Mapped through the same `ink === accent ? 'SahasRed' : 'Black'` rule the
 * furniture uses, every slice of a four-slice pie came out solid black.
 *
 * So an ink the table does not name registers itself here and the table gains
 * it - the same thing idml.writer.js's `colourName()` already does, for the
 * same reason. Reset per document, because the names are document-scoped.
 */
let documentColours = new Map();

function colourFor(hex, fallback = 'Black') {
  if (!hex) return fallback;
  const key = String(hex).toLowerCase();
  // WHITE IS IN THE TABLE ABOVE AND MUST RESOLVE TO IT BY NAME. Reversed type
  // - a headline out of its panel, a themed folio out of its banner - is the
  // one ink this exporter is asked for that the palette deliberately does not
  // name: `inkSeparation('#ffffff')` answers 'Black' (white is the absence of
  // an ink, so the palette has nothing to say about it) and
  // `tintSeparation('#ffffff')` answers 'None'. Both fall through, and the
  // auto-register below would then mint a `SahasAutoN` for it. The block walk
  // never hit this because it sets `run.colour = 'White'` by hand for a
  // reversed headline; the furniture had no such special case.
  if (key === '#ffffff' || key === '#fff') return 'White';
  // THE PALETTE NAMES ITS OWN COLOURS. This was a one-entry map holding the
  // paper's red, so every other palette ink fell through to the auto-register
  // below and reached the plate as "SahasAuto3" - a real colour with a name
  // that says nothing, in a file a designer opens by hand. inks.js already
  // states the Scribus name beside every ink and tint (`inkSeparation` /
  // `tintSeparation`), and asking it is the one-catalogue answer.
  //
  // The auto-register stays underneath for what the palette genuinely does not
  // name: a pie's TINTS of an ink are computed shades, not catalogue entries.
  const palette = richTextModule;
  if (palette) {
    const named = palette.inkSeparation(key);
    if (named && named !== 'Black') return named;
    const ground = palette.tintSeparation(key);
    if (ground && ground !== 'None') return ground;
  }
  if (key === '#c8102e') return 'SahasRed';
  if (!documentColours.has(key)) {
    const value = parseInt(key.replace('#', ''), 16);
    if (!Number.isFinite(value)) return fallback;
    const r = ((value >> 16) & 0xff) / 255;
    const g = ((value >> 8) & 0xff) / 255;
    const b = (value & 0xff) / 255;
    // The same naive separation the PDF writer uses, and deliberately so: this
    // product has no colour-management pipeline and pretending otherwise in a
    // press file is worse than being plain about it.
    const k = 1 - Math.max(r, g, b);
    const channel = (c) => (k >= 1 ? 0 : Math.round(((1 - c - k) / (1 - k)) * 255));
    const byte = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    documentColours.set(key, {
      name: `SahasAuto${documentColours.size}`,
      cmyk: `#${byte(channel(r))}${byte(channel(g))}${byte(channel(b))}${byte(Math.round(k * 255))}`,
    });
  }
  return documentColours.get(key).name;
}

const extraColourTable = () => [...documentColours.values()]
  .map((entry) => `\n  <COLOR NAME="${entry.name}" CMYK="${entry.cmyk}" Spot="0" Register="0"/>`).join('');

// BLACK IS 100% K, AND IT WAS DECLARED AS NO INK AT ALL.
//
// The CMYK attribute is four bytes, #CCMMYYKK, each 0-255 for 0-100%. That
// byte order is not assumed - Registration below reads #ffffffff (100% of
// every plate, which is what a registration mark is), and SahasRed reads
// #00ffe61a = C0 M100 Y90 K10, which is the paper's own red. So the table
// could be read with confidence, and it said:
//
//   Black = #00000000  ->  C0 M0 Y0 K0   ->  NO INK ON ANY PLATE
//   White = #00000000  ->  identical
//
// 443 of the 465 text runs in a real press file - 95% of all type in the
// paper - are set in TXTFILL="Black". A press file whose black is no ink is
// a paper that prints essentially blank.
//
// The value is #000000ff, and this project already states the rule in as many
// words for the PDF writer: "Black is 100% K, not four-plate black.
// Registration on small Devanagari counters is exactly where four-plate black
// shows as a fringe." The press file has to say what the PDF says, or the two
// artifacts from one composition disagree about the commonest ink on the page.
//
// White stays #00000000 and that is correct rather than the same oversight:
// white IS the absence of ink, it is the newsprint showing through. The two
// being byte-identical is what made the fault visible.
const COLOURS = `
  <COLOR NAME="Black" CMYK="#000000ff" Spot="0" Register="0"/>
  <COLOR NAME="Registration" CMYK="#ffffffff" Spot="0" Register="1"/>
  <COLOR NAME="White" CMYK="#00000000" Spot="0" Register="0"/>
  <COLOR NAME="SahasRed" CMYK="#00ffe61a" Spot="0" Register="0"/>
  <COLOR NAME="SahasBlue" CMYK="#d6840070" Spot="0" Register="0"/>
  <COLOR NAME="SahasGreen" CMYK="#ea007b85" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintGrey" CMYK="#0202000b" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintCream" CMYK="#00081204" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintPink" CMYK="#000c0a02" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintBlue" CMYK="#0d080004" Spot="0" Register="0"/>
  <!-- The three inks and three grounds the palette gained when the desk asked
       for more colours. Every one is a PROCESS colour (Spot="0"), separating
       onto the four plates the paper already prints from - a longer palette is
       not a longer press run. CMYK computed from the same hex the browser
       draws, the same naive way the six above were. -->
  <COLOR NAME="SahasOrange" CMYK="#008adf2d" Spot="0" Register="0"/>
  <COLOR NAME="SahasPurple" CMYK="#52af0079" Spot="0" Register="0"/>
  <COLOR NAME="SahasTeal" CMYK="#df170087" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintMint" CMYK="#09000708" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintLilac" CMYK="#070c0005" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintSand" CMYK="#00061107" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintTeal" CMYK="#09010008" Spot="0" Register="0"/>
  <COLOR NAME="SahasMaroon" CMYK="#00cba675" Spot="0" Register="0"/>
  <COLOR NAME="SahasRose" CMYK="#00ba784b" Spot="0" Register="0"/>
  <COLOR NAME="SahasNavy" CMYK="#c37d00a1" Spot="0" Register="0"/>
  <COLOR NAME="SahasSky" CMYK="#d85e004f" Spot="0" Register="0"/>
  <COLOR NAME="SahasForest" CMYK="#c4007fa9" Spot="0" Register="0"/>
  <COLOR NAME="SahasOlive" CMYK="#1d00b894" Spot="0" Register="0"/>
  <COLOR NAME="SahasAmber" CMYK="#0065f34f" Spot="0" Register="0"/>
  <COLOR NAME="SahasRust" CMYK="#0095d65c" Spot="0" Register="0"/>
  <COLOR NAME="SahasBrown" CMYK="#005dac94" Spot="0" Register="0"/>
  <COLOR NAME="SahasPlum" CMYK="#00b44d85" Spot="0" Register="0"/>
  <COLOR NAME="SahasViolet" CMYK="#88a90070" Spot="0" Register="0"/>
  <COLOR NAME="SahasSlate" CMYK="#442400a9" Spot="0" Register="0"/>
  <COLOR NAME="SahasPine" CMYK="#d50024a3" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintMaroon" CMYK="#00090706" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintRose" CMYK="#000c0803" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintNavy" CMYK="#09060008" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintSky" CMYK="#0d060004" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintForest" CMYK="#0700050a" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintOlive" CMYK="#01000a09" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintAmber" CMYK="#00071304" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintRust" CMYK="#000a1004" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintBrown" CMYK="#00040908" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintPlum" CMYK="#00090407" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintViolet" CMYK="#0a0c0005" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintPine" CMYK="#0700020a" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividRed" CMYK="#00211c09" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividBlue" CMYK="#160e0013" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividGreen" CMYK="#15000b17" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividPurple" CMYK="#08100015" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividOrange" CMYK="#00142008" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividTeal" CMYK="#14020017" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividMaroon" CMYK="#00151014" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividRose" CMYK="#00170f0d" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividNavy" CMYK="#0f09001b" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividSky" CMYK="#1b0c000d" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividForest" CMYK="#0c00081d" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividOlive" CMYK="#02000e19" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividAmber" CMYK="#000d1f0d" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividRust" CMYK="#00111910" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividBrown" CMYK="#00080d19" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividPlum" CMYK="#000f0717" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividViolet" CMYK="#0e110013" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintVividPine" CMYK="#0f00021c" Spot="0" Register="0"/>
  <COLOR NAME="SahasScarlet" CMYK="#00d7d71b" Spot="0" Register="0"/>
  <COLOR NAME="SahasCyan" CMYK="#f257002c" Spot="0" Register="0"/>
  <COLOR NAME="SahasMarigold" CMYK="#005df404" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintPowder" CMYK="#2c0d000c" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintOrchid" CMYK="#00210018" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintBlush" CMYK="#0011190b" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintPeach" CMYK="#00183103" Spot="0" Register="0"/>
  <COLOR NAME="SahasTintSilver" CMYK="#00000015" Spot="0" Register="0"/>
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
let inksModule = null;
let furnitureModule = null;
let blockShapesModule = null;
let renderModule = null;

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
  if (!inksModule) inksModule = await import('../../public/editor/layout/inks.js');
  if (!furnitureModule) furnitureModule = await import('../../public/editor/layout/furniture-styles.js');
  if (!blockShapesModule) blockShapesModule = await import('../../public/editor/layout/block-shapes.js');
  // panelRect() - where a reverse headline panel is actually drawn, shared
  // with print-model.js so the .sla cannot bleed a different amount than the
  // PDF past the same headline.
  if (!renderModule) renderModule = await import('../../public/editor/compose/render.js');
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
    render: renderModule,
    inks: inksModule,
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

/**
 * A plain filled rectangle - the ground behind a block, and the panel behind a
 * reversed headline.
 *
 * PTYPE 6 is Scribus's Polygon; a rectangle is its default shape, so no path
 * has to be described. PCOLOR is the fill and PWIDTH 0 means no outline: this
 * is ink laid down, never a frame with a border. It is pushed BEFORE the text
 * frames that sit on it, because a .sla paints in document order.
 */
function fillFrame({ xMm, yMm, widthMm, heightMm, colour, ownPage = 0 }) {
  if (!colour || colour === 'None') return '';
  return `
  <PAGEOBJECT XPOS="${mmRound(xMm)}" YPOS="${mmRound(yMm)}" WIDTH="${mmRound(widthMm)}" HEIGHT="${mmRound(heightMm)}"
              OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="6" ANNAME="" FRTYPE="0"
              PWIDTH="0" PCOLOR="${escapeXml(colour)}" PCOLOR2="None" LOCALSCX="1" LOCALSCY="1"
              SHADE="100" SHADE2="100" TEXTFLOWMODE="0"/>`;
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
/**
 * A POLYGON - a pie slice, a line chart's line, a dot.
 *
 * Scribus stores a shape as a `path` in the item's OWN coordinate space, so
 * the points are made relative to the frame's top-left corner here. The arc
 * was turned into segments by the SOLVER, once, so this is straight lines only
 * and there is no bezier geometry in this file - and because the segmentation
 * happens in one place, the wheel in the .sla and the wheel in the PDF are the
 * same polygon rather than two roundings of one arc.
 *
 * Same caveat as the image frame, and stated for the same reason: there is no
 * Scribus binary in this environment to render and compare against, so the
 * ATTRIBUTE FORM follows Scribus 1.5 documentation and has not been visually
 * verified. The geometry itself - where each point is, in millimetres - is
 * exact and shared with the PDF and the IDML.
 */
function polyFrame({ points, x, y, yMm, width, height, ink, close = true, strokeWidth = 0, ownPage = 0 }) {
  const list = (points || []).map(([px, py]) => [px - x, py - y]);
  if (list.length < 2) return '';
  const d = `M${mmRound(list[0][0])} ${mmRound(list[0][1])} `
    + list.slice(1).map(([px, py]) => `L${mmRound(px)} ${mmRound(py)}`).join(' ')
    + (close ? ' Z' : '');
  const stroke = Number(strokeWidth) || 0;
  const colour = colourFor(ink);
  return `
  <PAGEOBJECT XPOS="${mmRound(x)}" YPOS="${mmRound(yMm)}"
              WIDTH="${mmRound(width)}" HEIGHT="${mmRound(height)}"
              OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="6" FRTYPE="3"
              PWIDTH="${mmRound(stroke)}" PCOLOR="${stroke > 0 ? 'None' : colour}"
              PCOLOR2="${stroke > 0 ? colour : 'None'}" SHADE="100" SHADE2="100"
              TEXTFLOWMODE="0" path="${escapeXml(d)}"/>`;
}

function smartCardFrames({ key, data, frame, xMm, yMm, ownPage, cardLayout, family = 'serif', weight = 400 }) {
  // The walk itself lives in export/smart-card-lines.js, because Scribus is no
  // longer the only destination: InDesign, Word and the CMYK press PDF read the
  // same resolved card. This places what that walk returns and decides nothing
  // about where it goes.
  return smartCardLines(key, data, frame, cardLayout).map((line) => {
    if (line.kind === 'image') {
      return `
  <PAGEOBJECT XPOS="${mmRound(xMm + mm(line.x))}" YPOS="${mmRound(yMm + mm(line.y))}"
              WIDTH="${mmRound(mm(line.width))}" HEIGHT="${mmRound(mm(line.height))}"
              ROT="0" OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="2" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None"
              PFILE="${escapeXml(`./${String(line.file || '').replace(/^\//, '')}`)}" SCALETYPE="1" RATIO="${line.stretch ? '0' : '1'}" TEXTFLOWMODE="0"/>`;
    }
    // A chart's bars are rectangles, which this file already draws for a
    // block's ground and a reversed headline's panel. Emitted as ink rather
    // than as an empty text frame.
    if (line.kind === 'bar') {
      return fillFrame({
        xMm: xMm + mm(line.x), yMm: yMm + mm(line.y),
        widthMm: mm(line.width), heightMm: mm(line.height),
        // THE ENTRY'S OWN INK, not a hard-coded accent. That was true while a
        // chart used one colour; a pie's legend swatches are TINTS of it, and
        // named 'SahasRed' every one of them printed at full strength - four
        // identical swatches beside four different slices.
        colour: colourFor(line.ink, 'SahasRed'), ownPage,
      });
    }
    // A pie slice, a line chart's line, a dot.
    if (line.kind === 'poly') {
      const points = (line.points || []).map(([px, py]) => [xMm + mm(px), yMm + mm(py)]);
      if (points.length < 2) return '';
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      return polyFrame({
        points,
        x: Math.min(...xs), y: Math.min(...ys), yMm: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        ink: line.ink, close: line.close !== false,
        strokeWidth: line.strokeWidth ? mm(line.strokeWidth) : 0,
        ownPage,
      });
    }
    return lineFrame({
      xMm: xMm + mm(line.x), yMm: yMm + mm(line.y),
      widthMm: mm(line.width), heightMm: mm(line.height),
      runs: [{
        // THE FACE THE CARD WAS MEASURED IN, stated by the walk. The caller's
        // `family` was used for every card line while layoutSmartCard()
        // measures a chart, the weather panel and the market table in 'sans' -
        // so those cards were fitted in one face and set on the plate in
        // another, 5-17% narrower than the box they were fitted to.
        text: line.text, family: line.family || family,
        weight: line.bold ? 700 : weight, bold: Boolean(line.bold),
        italic: false, underline: false, fontPx: line.fontPx, ink: line.ink || null,
      }],
      align: line.align, ownPage,
    });
  }).join('');
}

/**
 * The shared page furniture, as .sla frames.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND WALK. This file did its own walk for
 * everything, which was right while Scribus was the only destination. It has
 * not been right for four, and it showed: the nameplate, the column rules and
 * a block's own border are all drawn by the canvas and by print-model.js, and
 * were drawn HERE by nothing at all - so the press file, the one artifact that
 * actually reaches a plate, came out with no paper name above the fold and its
 * stories separated by white space.
 *
 * The block walk below is untouched: it is the tested path and moving it is a
 * rewrite, not a fix. What this does is render the neutral items the shared
 * model already produces for the furniture, so there is no second opinion
 * about where a nameplate sits or which pair of blocks earns a rule.
 */
function furnitureFrames(items, { pageOffsetMm, ownPage, family = 'sans', weight = 400 }) {
  return items.map((item) => {
    if (item.kind === 'fill' || item.kind === 'rule') {
      return fillFrame({
        xMm: item.x, yMm: pageOffsetMm + item.y, widthMm: item.width, heightMm: item.height,
        colour: colourFor(item.ink), ownPage,
      });
    }
    if (item.kind === 'poly') {
      return polyFrame({ ...item, yMm: pageOffsetMm + item.y, ownPage });
    }

    if (item.kind === 'image') {
      // A FURNITURE picture, not a placed one. The nameplate has no crop, no
      // rotation and no fit mode - it is artwork at a reserved rectangle - and
      // its geometry is already in MILLIMETRES, so it cannot go through
      // imageFrame(), which takes a resolvePlacedImage() transform and converts
      // from editor pixels.
      //
      // SCALETYPE="1" is Scribus's documented "scale image to frame" and
      // RATIO="1" keeps the aspect, which is exactly the rule the canvas and
      // the print model already hold for this artwork: it is a registered mark
      // and may be sized but never stretched. Using the attribute rather than
      // computing LOCALSCX/Y avoids inventing a second, unverifiable scale -
      // this file's own caveat about not having a Scribus binary to render
      // against applies here too.
      return `
  <PAGEOBJECT XPOS="${mmRound(item.x)}" YPOS="${mmRound(pageOffsetMm + item.y)}"
              WIDTH="${mmRound(item.width)}" HEIGHT="${mmRound(item.height)}"
              ROT="0" OwnPage="${ownPage}" ItemID="${nextId()}" PTYPE="2" FRTYPE="0"
              PWIDTH="0" PCOLOR="None" PCOLOR2="None"
              PFILE="${escapeXml(item.file)}" SCALETYPE="1" RATIO="${item.stretch ? '0' : '1'}" TEXTFLOWMODE="0"/>`;
    }
    if (item.kind === 'text') {
      return lineFrame({
        xMm: item.x, yMm: pageOffsetMm + item.y, widthMm: item.width, heightMm: item.height,
        runs: item.runs.map((run) => ({
          text: run.text, family: run.family || family, weight: run.weight || weight,
          bold: Boolean(run.bold), italic: false, underline: false,
          fontPx: (run.sizePt / 72) * 25.4 * 2,
          // `colour`, NOT `ink` - lineFrame() reads run.colour, so naming this
          // field after the model's own vocabulary silently dropped every
          // furniture colour in the document to lineFrame's 'Black' default.
          // Measured on a sunday-themed page: the print model emits four
          // #ffffff runs onto a #d2601a panel and the .sla carried no white
          // text at all - a dark orange folio with BLACK type set in it. The
          // fill/rule branch above always passed `colour:` correctly, which is
          // why the panel drew and only its type was lost.
          //
          // Found independently on both sides of this merge, and resolved to
          // one line: colourFor(null) is 'Black', which is lineFrame's own
          // default, so the explicit call and the guarded one agree.
          colour: run.ink ? colourFor(run.ink) : undefined,
        })),
        align: item.align === 'center' ? 1 : item.align === 'right' ? 2 : 0,
        ownPage,
      });
    }
    return '';
  }).join('');
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
  const { adapter, richText, smartCards, smartCardLayout, textFlow, imageGeometry, accent, render, inks } = await ensureComposeReady();
  const parts = [];

  const holdsCard = Boolean(section.smart_card_key) && Boolean(section.smart_card_data)
    && smartCards.canRenderSmartCard(section.smart_card_key);

  // A Smart Card owns the full printable frame. Headline and subheading are
  // deliberately empty here, matching the canvas; card titles will be handled
  // by the card design itself rather than ordinary article display bands.
  const emptyCardDisplay = { headline: '', subheading: '', body: '' };
  const composition = holdsCard
    ? adapter.composeSection({ ...section, images: [], ...emptyCardDisplay }, { ...section, ...emptyCardDisplay })
    : adapter.composeSection(section, section);

  // The block's own ground, first, because a .sla paints in document order and
  // this is what everything else in the block is printed ON.
  //
  // SHAPED when the block's own frame is not a rectangle - the SAME polygon
  // canvas.js clips to and print-model.js fills, from the one shared
  // catalogue (block-shapes.js), so a cut corner's ground is never a square
  // patch of colour peeking out past its own clipped border.
  if (section.frame_shape) {
    const wMm = mm(section.width_px);
    const hMm = mm(section.height_px);
    const xMm = mm(section.x_px);
    const yMm = mm(section.y_px) + pageOffsetMm;
    const points = blockShapesModule.shapedRectPoints(section.frame_shape, wMm, hMm)
      .map(([px, py]) => [xMm + px, yMm + py]);
    parts.push(polyFrame({
      points, x: xMm, y: yMm, yMm, width: wMm, height: hMm,
      ink: richTextModule.sanitiseTint(section.background_color) || section.background_color,
      close: true, strokeWidth: 0, ownPage: pageIndex,
    }));
  } else {
    parts.push(fillFrame({
      xMm: mm(section.x_px), yMm: mm(section.y_px) + pageOffsetMm,
      widthMm: mm(section.width_px), heightMm: mm(section.height_px),
      colour: richText.tintSeparation(section.background_color), ownPage: pageIndex,
    }));
  }

  parts.push(displayBandFrames(composition, section, accent, richText, render, inks, {
    xBaseMm: mm(section.x_px), yBaseMm: mm(section.y_px), pageOffsetMm, ownPage: pageIndex,
  }));

  if (holdsCard) {
    const frame = smartCardLayout.smartCardFrameFromComposition(composition);
    parts.push(smartCardFrames({
      key: section.smart_card_key, data: section.smart_card_data, frame,
      xMm: mm(section.x_px + composition.content.left + (frame.offsetX || 0)),
      yMm: mm(section.y_px + composition.bodyTop + (frame.offsetY || 0)) + pageOffsetMm,
      ownPage: pageIndex, cardLayout: smartCardLayout,
    }));
    return parts.filter(Boolean).join('');
  }

  if (section.body) {
    const { marks: authoredMarks } = richText.textWithMarks(section.body);
    const prefix = textFlow.datelineText(section);
    const marks = textFlow.marksWithDateline(authoredMarks, prefix.length);
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
        runs: [{ text: strip(image.caption), family: PLACED_CAPTION_METRICS.family, weight: PLACED_CAPTION_METRICS.weight, bold: false, italic: false, underline: false, fontPx: PLACED_CAPTION_METRICS.fontPx }],
        ownPage: pageIndex,
      }));
    }
  }

  // THE INITIAL LETTER AND THE PANELS SET INSIDE THE STORY, from the one walk
  // print-model.js already does for the PDF and the IDML. This block walk is
  // deliberately its own (scribusComposition.test.js pins it line for line),
  // and that is exactly how it came to draw NEITHER: a `.sla` with a drop cap
  // reserved and no cap in it prints the story one akshara short, and one with
  // a fact box reserved and no box in it prints a white hole. After the
  // pictures, because a .sla paints in document order and the canvas stacks a
  // panel over a placed picture.
  parts.push(furnitureFrames(blockDecorations(section, composition),
    { pageOffsetMm, ownPage: pageIndex, family: 'sans' }));

  return parts.filter(Boolean).join('');
}

/** The kicker/headline/deck bands, each composed LINE as its own frame - the
 * headline's own accent phrase (asterisk-marked, or the true last word under
 * `headline_style: 'accent'`) split into its own run so it paints in the
 * paper's colour, decided band-wide by accent.js's headlineSegments() -
 * exactly as render.js's composedMarkup() already does for the browser. */
function displayBandFrames(composition, section, accent, richText, render, inks, { xBaseMm, yBaseMm, pageOffsetMm, ownPage }) {
  const parts = [];
  const headlineBand = composition.bands?.headline;
  const headlineTexts = headlineBand ? headlineBand.lines.map((line) => line.text) : [];
  const headline = accent.headlineSegments(headlineTexts, { accentStyle: inks.accentedHeadline(section.headline_style) });

  // A reversed headline is white type out of a solid panel, and the panel is
  // laid down first - exactly as render.js draws it for the browser, at the
  // same bleed, bounded the same way (`panelRect()`, shared rather than
  // re-derived - a hand-copied REVERSE_BLEED here is what let this panel run
  // to the block's bare edge and into the deck below, unnoticed, on a surface
  // nobody screenshots to check). A press file that emitted the white type
  // without the panel would print nothing at all where the lead's headline
  // should be, which is the worst failure this exporter could have.
  //
  // Coloured in the BLOCK'S OWN accent, not a fixed house red - `colourFor()`
  // is the one lookup that keeps a dressed page's plate the same ink as its
  // screen.
  const reversed = section.headline_style === 'reverse';
  if (reversed) {
    const rect = render.panelRect(composition, 'headline');
    if (rect) {
      parts.push(fillFrame({
        xMm: xBaseMm + mm(composition.content.left),
        yMm: yBaseMm + mm(rect.top) + pageOffsetMm,
        widthMm: mm(composition.content.measure),
        heightMm: mm(rect.height),
        colour: colourFor(section.accent_color, 'SahasRed'), ownPage,
      }));
    }
  }

  // A SCREEN BEHIND A DISPLAY BAND, from the same catalogue the canvas reads.
  // Through `panelRect()` like the reverse panel above, NOT a second copy of
  // the bleed arithmetic: render.js draws these screens with panelRect too, so
  // a hand-rolled `band.top - REVERSE_BLEED_PX` here would put the plate's
  // screen at a different depth from the screen the desk approved - the exact
  // divergence the shared helper exists to prevent.
  for (const key of inks.groundedBands(section.headline_style)) {
    const rect = render.panelRect(composition, key);
    if (!rect) continue;
    parts.push(fillFrame({
      xMm: xBaseMm + mm(composition.content.left),
      yMm: yBaseMm + mm(rect.top) + pageOffsetMm,
      widthMm: mm(composition.content.measure),
      heightMm: mm(rect.height),
      colour: colourFor(inks.screenOf(section.accent_color || ACCENT_HEX)), ownPage,
    }));
  }

  // The compositor supplies every rectangle. Scribus only changes pixels to
  // millimetres and names the ink, exactly as the neutral print model does.
  for (const piece of inks.headlineFurniture(section.headline_style, composition)) {
    const hex = piece.ink === 'screen'
      ? inks.screenOf(section.accent_color || ACCENT_HEX)
      : piece.ink === 'rule'
        ? (section.border_ink || section.accent_color || ACCENT_HEX)
        : (section.accent_color || ACCENT_HEX);
    parts.push(fillFrame({
      xMm: xBaseMm + mm(piece.x), yMm: yBaseMm + mm(piece.y) + pageOffsetMm,
      widthMm: mm(piece.width), heightMm: mm(piece.height),
      colour: colourFor(hex), ownPage,
    }));
  }

  for (const [key, band] of Object.entries(composition.bands || {})) {
    band.lines.forEach((line, lineIndex) => {
      // The desk's own marks inside a display flow - a name set bold in a
      // headline, a word at its own size in a deck - through the SAME
      // styledRuns() the body goes through, against the same `line.at`
      // contract. Without this the press file flattened every display band to
      // one plain run: the browser printed the bold word and the paper did
      // not, which is the exact class of divergence a press file may not have.
      const runs = key === 'headline' && headline
        ? segmentRuns(headline[lineIndex], { family: line.family, weight: line.weight }, colourFor(section.accent_color || ACCENT_HEX)).map((run) => ({ ...run, fontPx: run.fontPx || line.fontPx }))
        : richText.styledRuns(line.text, line.at || 0, band.marks || [], line.fontPx)
          .map((run) => ({ ...run, family: line.family, weight: run.bold ? 700 : line.weight }));
      if (!reversed && section.headline_ink && (key === 'headline' || key === 'kicker')) {
        runs.forEach((run) => { if (!run.colour) run.colour = colourFor(section.headline_ink); });
      }
      // Out of the panel above. A desk's own ink mark inside the headline
      // still wins, the same way it does in the browser.
      if ((reversed && key === 'headline') || (key === 'kicker' && section.headline_style === 'kicker-chip-rule')) {
        runs.forEach((run) => { if (!run.colour) run.colour = 'White'; });
      }
      if (key === 'kicker' && section.headline_style === 'kicker-label') {
        runs.forEach((run) => { if (!run.colour) run.colour = colourFor(section.accent_color || ACCENT_HEX); });
      }
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

  // Three even columns across the foot, left to right in VISUAL order. The
  // browser achieves the verso flip by reordering the two ears while keeping
  // its date in the centre grid column; Scribus has no grid, so the frames are
  // placed and aligned directly: left / centre / right. Merely putting the
  // date in the middle THIRD and leaving it ALIGN=0 starts it one-third across
  // the page — it does not centre it on the page.
  const thirdMm = widthMm / 3;
  const pageLabel = `पृष्ठ ${devanagari(page.page_number)}`;
  const columns = verso ? [pageLabel, dateText, identity.title] : [identity.title, dateText, pageLabel];

  // FIVE FOOTER STYLES, resolved from the page's own theme - the SAME
  // catalogue print-model.js reads for the PDF/IDML foot and masthead.js
  // reads for the canvas, so this plate carries the foot the desk approved
  // rather than a fourth, silently different one. An undressed page resolves
  // 'classic' (no rule, plain title) and draws byte-for-byte what this
  // function always drew.
  const fstyle = furnitureModule.footerStyleForTheme(page.style_theme);
  const footInk = fstyle.title !== 'plain' ? furnitureModule.furnitureInkForTheme(page.style_theme) : null;
  const footTint = fstyle.band ? furnitureModule.furnitureTintForTheme(page.style_theme) : null;
  // THE FOOT KEEPS ITS CLEARANCE - the same measured rule the canvas and the
  // shared print model both hold: paint at the bottom of the reserved band,
  // white above it, never the band filled edge to edge into the last block.
  const footStripMm = Math.min(footHeightMm, mm(20));
  const footPaintY = footYMm + (footHeightMm - footStripMm);
  if (footTint) {
    parts.push(fillFrame({ xMm: leftMm, yMm: footPaintY, widthMm, heightMm: footStripMm, colour: colourFor(footTint), ownPage }));
  }
  if (fstyle.rule) {
    const weightMm = mm(fstyle.rule.weight);
    const ruleColour = colourFor(footInk || '#111111');
    const yAt = fstyle.rule.edge === 'top' ? footPaintY : footYMm + footHeightMm - weightMm;
    const offsets = fstyle.rule.double ? [0, fstyle.rule.edge === 'top' ? weightMm * 2 : -weightMm * 2] : [0];
    for (const offset of offsets) {
      parts.push(fillFrame({ xMm: leftMm, yMm: yAt + offset, widthMm, heightMm: weightMm, colour: ruleColour, ownPage }));
    }
  }

  columns.forEach((text, index) => {
    if (!text) return;
    const weight = index === 1 ? 400 : 700; // the date column is regular; title/page are bold
    // The paper's own name and its page number carry the theme's ink where
    // one is asked for - the same two columns pageFootMarkup colours on the
    // canvas. The date stays neutral either way.
    const themedColumn = index !== 1 && footInk;
    parts.push(lineFrame({
      xMm: leftMm + index * thirdMm, yMm: footYMm,
      widthMm: thirdMm, heightMm: footHeightMm,
      runs: [{ text, family: 'sans', weight, bold: false, italic: false, underline: false, fontPx: 18,
        colour: themedColumn ? colourFor(footInk) : undefined }],
      align: index, ownPage,
    }));
  });

  // The legal imprint - printed ONCE, on identity.imprintPage (page two),
  // never duplicated into every page's footer.
  if (Number(page.page_number) === Number(identity.imprintPage || 2) && region.footer.imprintHeightPx > 0) {
    const imprintYMm = mm(region.footer.imprintTop) + pageOffsetMm;
    const imprintHeightMm = mm(region.footer.imprintHeightPx);
    // TWO BOXES, ONE PER LANGUAGE, in the shape the canvas draws them
    // (masthead.js's imprintMarkup): each declaration closes with the standing
    // disclosure in its own language, inside its own rule. A press file that
    // dropped the disclosure - or set the imprint in a different shape from
    // the sheet the desk approved - would print a paper that is not the one
    // that was passed.
    const RULE_MM = mm(0.5);
    const halfMm = imprintHeightMm / 2;
    const boxes = [
      { body: identity.imprint, note: identity.aiDisclosure, bodyPx: 9 },
      { body: identity.imprintEnglish, note: identity.aiDisclosureEnglish, bodyPx: 8 },
    ];
    boxes.forEach((box, index) => {
      const yMm = mmRound(imprintYMm + index * halfMm);
      // The rule, as four thin fills - the same primitive a block border and a
      // column rule are made of. There is no second geometry for a box.
      for (const edge of [
        { x: leftMm, y: yMm, w: widthMm, h: RULE_MM },
        { x: leftMm, y: mmRound(yMm + halfMm - RULE_MM), w: widthMm, h: RULE_MM },
        { x: leftMm, y: yMm, w: RULE_MM, h: halfMm },
        { x: mmRound(leftMm + widthMm - RULE_MM), y: yMm, w: RULE_MM, h: halfMm },
      ]) {
        parts.push(fillFrame({
          xMm: edge.x, yMm: edge.y, widthMm: edge.w, heightMm: edge.h,
          colour: colourFor('#111111'), ownPage,
        }));
      }
      const inner = mmRound(halfMm - RULE_MM * 2);
      parts.push(lineFrame({
        xMm: leftMm, yMm: mmRound(yMm + RULE_MM), widthMm, heightMm: mmRound(inner * 0.66),
        runs: [{ text: box.body, family: 'sans', weight: 400, bold: false, italic: false, underline: false, fontPx: box.bodyPx }],
        align: 1, ownPage,
      }));
      parts.push(lineFrame({
        xMm: leftMm, yMm: mmRound(yMm + RULE_MM + inner * 0.66), widthMm, heightMm: mmRound(inner * 0.34),
        runs: [{ text: box.note, family: 'sans', weight: 700, bold: true, italic: false, underline: false, fontPx: box.bodyPx }],
        align: 1, ownPage,
      }));
    });
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
  // Document-scoped, so two builds in one process cannot leak names into
  // each other's colour tables.
  documentColours = new Map();
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
    // The furniture goes down FIRST - a .sla paints in document order, so the
    // nameplate and the rules must not land on top of the stories.
    // eslint-disable-next-line no-await-in-loop
    objectParts.push(furnitureFrames(await pageFurniture(newspaper, page, g, identity),
      { pageOffsetMm, ownPage: index }));
    for (const section of page.sections || []) {
      objectParts.push(furnitureFrames(blockRules(section), { pageOffsetMm, ownPage: index }));
      // eslint-disable-next-line no-await-in-loop
      objectParts.push(await blockFrames(section, { pageIndex: index, pageOffsetMm }));
    }
    // The page's own pictures go down AFTER the blocks, because that is what
    // "laid over" means - the same order print-model.js uses, and the blocks
    // have already set their type clear of them, so this is paint, not layout.
    objectParts.push(furnitureFrames(pageOverlayItems(page), { pageOffsetMm, ownPage: index }));
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
${COLOURS}${extraColourTable()}
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
