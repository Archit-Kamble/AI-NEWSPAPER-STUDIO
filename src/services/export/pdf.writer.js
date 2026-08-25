// THE CMYK PRESS PDF.
//
// The one artifact a printing press actually takes. Everything about it is
// decided by the press rather than by the screen:
//
// - **DeviceCMYK, everywhere.** Not one RGB value reaches the file. A press
//   separates four plates; an RGB colour is a colour it has to guess at, and
//   the guess happens at the RIP where nobody sees it. `inks.js` is the
//   catalogue the whole product is bounded by, so the conversion has a small,
//   known domain rather than "any colour a browser can make".
// - **The type is drawn as GLYPHS, not as text.** Devanagari cannot be printed
//   by handing a PDF a Unicode string and a font: the shaping (conjuncts,
//   reordered matras, mark positioning) is what turns क + ् + ष into क्ष, and a
//   PDF viewer does no shaping at all. HarfBuzz has already done it - the
//   compositor's own shaper, the same one that measured the line - so the file
//   carries the glyph ids it produced, in a CID-keyed font with Identity
//   encoding. That is also why the press file cannot drift from the screen:
//   they are the same glyphs at the same advances.
// - **`/ToUnicode` so the copy is still readable.** Drawing glyph ids makes a
//   PDF that prints perfectly and cannot be searched or copied out of. The
//   reverse map is written from the shaper's own clusters, so a sub-editor can
//   still select a sentence out of the proof.
//
// It renders `print-model.js` and decides nothing about where anything goes.

const fs = require('fs');
const path = require('path');
const { PdfBuilder, hex, literal } = require('./pdf-primitives');

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');
const MM_TO_PT = 72 / 25.4;
const mmToPt = (value) => Number(value) * MM_TO_PT;

// ------------------------------------------------------------------ colour ---
//
// One conversion, stated once. It is the ordinary naive separation - no ICC
// profile, because this product has no colour-management pipeline and
// pretending otherwise in a press file is worse than being plain about it.
// Black text therefore comes out as 100% K and NOT as four-colour black,
// which is what a printer wants for type: registration on small Devanagari
// counters is exactly where four-plate black shows as a fringe.

function cmykOf(ink) {
  if (!ink) return [0, 0, 0, 1];
  const value = String(ink).trim().toLowerCase();
  if (value === 'white' || value === '#fff' || value === '#ffffff') return [0, 0, 0, 0];
  const short = /^#([0-9a-f]{3})$/.exec(value);
  const long = /^#([0-9a-f]{6})$/.exec(value);
  if (!short && !long) return [0, 0, 0, 1];
  const digits = short ? short[1].split('').map((c) => c + c).join('') : long[1];
  const r = parseInt(digits.slice(0, 2), 16) / 255;
  const g = parseInt(digits.slice(2, 4), 16) / 255;
  const b = parseInt(digits.slice(4, 6), 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [
    (1 - r - k) / (1 - k),
    (1 - g - k) / (1 - k),
    (1 - b - k) / (1 - k),
    k,
  ].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000);
}

const fill = ([c, m, y, k]) => `${c} ${m} ${y} ${k} k`;

// ------------------------------------------------------------------- fonts ---

// The faces, from the ONE catalogue the compositor measures and shapes with
// (public/editor/layout/typefaces.js). A third copy of this list lived here,
// beside the two in font-metrics.js and shaper.js, in the one place where a
// drift would mean the plate carrying a different face from the screen. The
// paths are relative to public/, which is what this writer resolves against.
const TYPEFACES = require('../../../public/editor/layout/typefaces');
const FONT_FILES = Object.fromEntries(
  Object.entries(TYPEFACES.FONT_FILES).map(([key, file]) => [key, file.replace(/^\//, '')]),
);

// The same classification as the measurer and the shaper, from the same file.
// This one was its own third opinion and a narrower one - it recognised only
// the exact string 'sans', so a run carrying the Typography panel's own
// "Arial, Helvetica, sans-serif" was embedded from the SERIF face while being
// measured against the sans. The line still fitted (the advances came from the
// shaper) and it printed in the wrong face.
const { faceKey } = TYPEFACES;

/**
 * One embedded CID-keyed font.
 *
 * CIDToGIDMap is Identity, so the two-byte codes in the content stream ARE
 * glyph ids - which is exactly what the shaper hands over, with no mapping
 * table in between to get wrong. The whole face is embedded rather than
 * subsetted: a subsetter is a second thing that has to be right about which
 * glyphs a conjunct needs, and being wrong about that drops a letter from a
 * printed newspaper. Four faces cost about a megabyte; a dropped क्ष costs a
 * reprint.
 */
function embedFace(builder, key, metrics, usedGlyphs, toUnicode) {
  const file = fs.readFileSync(path.join(PUBLIC_DIR, FONT_FILES[key]));
  const upem = metrics?.unitsPerEm || 1000;
  const advanceOf = (glyphId) => {
    if (!metrics?.advances) return 500;
    const index = glyphId < metrics.longMetrics ? glyphId : metrics.longMetrics - 1;
    return Math.round((metrics.advances[index] / upem) * 1000);
  };

  // /W only for the glyphs this edition actually sets, in ascending runs.
  const ids = [...usedGlyphs].sort((a, b) => a - b);
  const widths = [];
  let run = null;
  for (const id of ids) {
    if (run && id === run.start + run.values.length) run.values.push(advanceOf(id));
    else { run = { start: id, values: [advanceOf(id)] }; widths.push(run); }
  }
  const w = widths.map((entry) => `${entry.start} [${entry.values.join(' ')}]`).join(' ');

  const fontFile = builder.addStream({ Length1: file.length }, file);
  const descriptor = builder.add({
    Type: '/FontDescriptor',
    FontName: `/${key.replace('/', '-')}`,
    Flags: 4,                                  // symbolic: the face is not Latin
    FontBBox: [-1000, -500, 2000, 1200],
    ItalicAngle: 0,
    Ascent: Math.round((metrics?.ascent ?? 0.9) * 1000),
    Descent: -Math.round((metrics?.descent ?? 0.3) * 1000),
    CapHeight: 700,
    StemV: Number(key.endsWith('700') ? 140 : 80),
    FontFile2: `${fontFile} 0 R`,
  });
  const descendant = builder.add({
    Type: '/Font',
    Subtype: '/CIDFontType2',
    BaseFont: `/${key.replace('/', '-')}`,
    CIDSystemInfo: { Registry: literal('Adobe'), Ordering: literal('Identity'), Supplement: 0 },
    FontDescriptor: `${descriptor} 0 R`,
    DW: 1000,
    W: w ? `[${w}]` : undefined,
    CIDToGIDMap: '/Identity',
  });
  const unicodeStream = builder.addStream({}, toUnicodeCMap(toUnicode));
  return builder.add({
    Type: '/Font',
    Subtype: '/Type0',
    BaseFont: `/${key.replace('/', '-')}`,
    Encoding: '/Identity-H',
    DescendantFonts: [`${descendant} 0 R`],
    ToUnicode: `${unicodeStream} 0 R`,
  });
}

/**
 * The reverse map, so the printed copy can still be selected and searched.
 *
 * ONLY the glyphs that stand for exactly one character. Devanagari shaping is
 * many-to-many - one cluster becomes several glyphs (a conjunct's base, its
 * half-form, a reordered matra), and the same glyph id serves different
 * letters in different words - so a per-glyph table cannot describe it.
 * Measured, by doing it the naive way first: `शेतकऱ्यांसाठी` extracted as
 * `शेशेतकऱ्यांयांयांसायांठीठी`, every cluster repeated once per glyph it produced.
 *
 * The real text comes from `/ActualText` on each run instead (see drawRun),
 * which is exactly what that operator is for and which a reader prefers over
 * this table. This stays as the fallback for a reader that ignores it.
 */
function toUnicodeCMap(pairs) {
  const entries = [...pairs.entries()].filter(([, text]) => text);
  const chunks = [];
  for (let i = 0; i < entries.length; i += 100) {
    const slice = entries.slice(i, i + 100);
    chunks.push(`${slice.length} beginbfchar\n${slice.map(([gid, text]) =>
      `<${gid.toString(16).padStart(4, '0')}> <${[...text].map((ch) =>
        ch.codePointAt(0).toString(16).padStart(4, '0')).join('')}>`).join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join('\n')}
endcmap CMapName currentdict /CMap defineresource pop end end`;
}



// ------------------------------------------------------------------- text ---
//
// A composed line, drawn as the glyphs the compositor's own shaper produced.
//
// Positions are EXACT rather than left to the font's advance widths: every
// glyph's x comes from HarfBuzz, and the TJ adjustment is whatever it takes to
// put it there. That matters because the line has already been justified - the
// word spaces were opened and the glyphs stretched by compose.js, and a PDF
// that re-advanced by hmtx alone would set a line that does not reach its own
// measure. A glyph the shaper lifted or dropped (yOffset) gets its own
// placement, because TJ can only move the pen sideways.

/**
 * THE PUBLICATION FACES CARRY NO LATIN, and no ■.
 *
 * Measured against the real fonts: `serif/400` and `sans/700` both lack
 * `■`, `•` and every Latin letter. That is not an edge case in this paper -
 * the dateline opens with a ■, the legal imprint is printed in English, and
 * `RNI No. MAHMUL/2015/67123` is on page two of every edition. On screen the
 * CSS stack falls through to Georgia/Arial; a press file that did nothing
 * would print a row of .notdef boxes where the imprint should be.
 *
 * So a glyph the shaper resolved to id 0 is drawn from one of PDF's own
 * base-14 fonts instead - no embedding, present in every RIP ever built, and
 * near enough to the Georgia/Arial the screen falls back to. It is placed at
 * the x HarfBuzz reserved for it, so the LINE does not move: the compositor
 * measured with the same .notdef advances (compose.js measures through
 * shapeWidthPx), and the space is already allotted.
 */
const FALLBACK_FONT = { serif: 'Times-Roman', sans: 'Helvetica' };

/**
 * THE FILLED SQUARES THIS PAPER SETS, and how big each one is as a share of
 * the type it sits in.
 *
 * Neither has a WinAnsi slot, and neither is in the publication faces, so
 * both are DRAWN as the rectangles they are rather than substituted with
 * whatever a Latin face happens to keep at that byte.
 *
 * U+25A0 opens the dateline and was the only one handled. U+25AA is the
 * marker a panel's bulleted list has used since panels were built, and now
 * the marker a bulleted list in running copy hangs - and it printed as `?`.
 * Photographed in a rendered press PDF: the numbered list beside it set its
 * Devanagari numerals perfectly and the bulleted one had a question mark
 * where every bullet should be. Reading the code would not have found it;
 * the two characters look alike and one of them was in the list.
 */
const FILLED_SQUARES = { '\u25a0': 0.42, '\u25aa': 0.30 };
const SQUARE_RE = /[\u25a0\u25aa]/g;

/** WinAnsi bytes for a base-14 font, with anything outside it dropped. */
function winAnsi(text) {
  return [...String(text)]
    .map((ch) => {
      const code = ch.codePointAt(0);
      // Drawn as a rectangle above, never as a letter - see FILLED_SQUARES.
      if (code === 0x25a0 || code === 0x25aa) return 0xa7;
      return code <= 0xff ? code : 0x3f;  // '?' rather than silence
    })
    .filter((code) => code !== null);
}

function drawFallback(out, { text, sizePt, x, baselineY, ink, fontName, width }) {
  const squares = String(text).match(SQUARE_RE);
  if (squares) {
    // The mark IS a filled square, so it is drawn as one rather than
    // substituted with whatever a Latin face happens to have at that slot.
    // Sized and sat on the type's own body, like the glyph it replaces - each
    // at its own share, because a BLACK SMALL SQUARE is not a BLACK SQUARE.
    const side = sizePt * FILLED_SQUARES[squares[0]];
    out.push('q', fill(ink),
      `${round(x)} ${round(baselineY + sizePt * 0.06)} ${round(side)} ${round(side)} re f`, 'Q');
    const rest = String(text).replace(SQUARE_RE, '').trim();
    if (!rest) return;
    text = rest;
    x += side + sizePt * 0.18;
  }
  const bytes = winAnsi(text);
  if (!bytes.length) return;
  out.push(`/Span << /ActualText <FEFF${utf16be(text)}> >> BDC`);
  out.push('BT', fill(ink), `/${fontName} ${round(sizePt)} Tf`,
    `1 0 0 1 ${round(x)} ${round(baselineY)} Tm`,
    `<${Buffer.from(bytes).toString('hex')}> Tj`, 'ET', 'EMC');
}

function drawRun(out, { glyphs, sizePt, fontName, x, baselineY, ink, advanceOf, text, fallbackName }) {
  if (!glyphs.length) return;
  // WHAT THIS RUN ACTUALLY SAYS. The glyphs below print correctly and cannot
  // be read back - Devanagari shaping is many-to-many, so no per-glyph table
  // can undo it. /ActualText is the operator for exactly this: it tells a
  // reader what the marked content means, whatever it is drawn with, so a
  // sub-editor can still select a sentence out of the press proof.
  if (text) out.push(`/Span << /ActualText <FEFF${utf16be(text)}> >> BDC`);

  let pending = [];
  let pen = null;
  let penY = null;
  // A TEXT BLOCK IS NOT NESTABLE. A fallback glyph is drawn from a different
  // font - and the dateline marker as a filled rectangle - and both of those
  // are operators a PDF text block may not contain. Ghostscript said so in as
  // many words ("BT found inside a text block", "invalid operator used in text
  // block") the first time this ran over a real four-page edition, where the
  // imprint's English finally exercised the path. So the block is closed
  // before either and opened again after.
  let open = false;
  const begin = () => {
    if (open) return;
    out.push('BT', fill(ink), `/${fontName} ${round(sizePt)} Tf`);
    open = true;
    pen = null;
  };
  const flush = () => {
    if (!pending.length) return;
    out.push(`[${pending.join(' ')}] TJ`);
    pending = [];
  };
  const end = () => {
    if (!open) return;
    flush();
    out.push('ET');
    open = false;
  };

  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];
    // A GLYPH THE PUBLICATION FACE DOES NOT HAVE, and the whole WORD of them.
    //
    // These used to be drawn one character at a time, each at the x HarfBuzz
    // had reserved for it. HarfBuzz reserves the face's `.notdef` advance for
    // a character the face cannot set - one fixed width, the same for `i` as
    // for `m` - so a Latin word came out spaced by a number that has nothing
    // to do with Latin. Photographed in the masthead's own contact line:
    // `sahasnews@gmai l .com`, letters colliding and gapping in one word.
    //
    // A contiguous span of them is one piece of text in one font, so it is
    // drawn as one string and laid out by THAT font's own metrics. The
    // Devanagari after it still sits where the compositor put it; only the
    // inside of the fallback span stops being nonsense.
    if (glyph.glyphId === 0 && fallbackName) {
      // The span runs on across punctuation the publication face DOES have,
      // when that punctuation is sitting inside the foreign word.
      //
      // `sahasnews@gmail.com` came out as `sahasnews@gmail .com`: the face has
      // a full stop, so the span ended at `gmail`, the stop was set from the
      // face at its own reserved x, and `com` began a second span - and
      // because Helvetica sets `sahasnews@gmail` NARROWER than the .notdef
      // advances reserved for it, the join opened into a space in the middle
      // of a URL. Carrying the span across the stop sets the address as one
      // word, which is what it is.
      //
      // Deliberately only ACROSS, never starting on one: an ordinary full stop
      // in Marathi copy has no foreign glyph beside it, so no body line
      // changes. What this catches is exactly the mixed word - a URL, an email
      // address, `COVID-19` - where the punctuation belongs to the Latin.
      const source = String(text || '');
      const latin = (at) => {
        const ch = source[at];
        return Boolean(ch) && ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) < 0x7f;
      };
      let last = index;
      while (last + 1 < glyphs.length
        && (glyphs[last + 1].glyphId === 0
          || (latin(glyphs[last + 1].cluster)
            && glyphs.slice(last + 2).some((other) => other.glyphId === 0
              && other.cluster - glyphs[last + 1].cluster <= 2)))) last += 1;
      const after = glyphs[last + 1];
      end();
      drawFallback(out, {
        text: String(text || '').slice(glyph.cluster, after ? after.cluster : undefined),
        sizePt, x: x + glyph.x, baselineY, ink, fontName: fallbackName,
        width: (after ? after.x : glyph.x + glyph.xAdvance) - glyph.x,
      });
      index = last;
      continue;
    }
    begin();
    const wantX = x + glyph.x;
    const wantY = baselineY + (glyph.yOffset || 0);
    if (pen === null || penY !== wantY) {
      flush();
      out.push(`1 0 0 1 ${round(wantX)} ${round(wantY)} Tm`);
      pen = wantX;
      penY = wantY;
    } else if (Math.abs(wantX - pen) > 0.001) {
      // TJ moves the pen backwards for a POSITIVE number, in thousandths of
      // the type size - the one place in PDF where the sign is inverted.
      pending.push(round(((pen - wantX) / sizePt) * 1000));
      pen = wantX;
    }
    pending.push(`<${glyph.glyphId.toString(16).padStart(4, '0')}>`);
    pen += (advanceOf(glyph.glyphId) / 1000) * sizePt;
  }
  end();
  if (text) out.push('EMC');
}

/** UTF-16BE hex, which is what /ActualText and /ToUnicode both speak. */
function utf16be(text) {
  return Buffer.from(String(text), 'utf16le').swap16().toString('hex');
}

const round = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return (Math.round(n * 1000) / 1000).toString();
};



// ------------------------------------------------------------------ images ---
//
// Decoded and separated, not passed through. A JPEG in a press PDF is RGB (or
// YCbCr), and a file that promises CMYK and carries RGB photographs is not a
// CMYK file - the separation would happen at the RIP, where nobody on the desk
// ever sees the result. jimp is already a dependency (it is what the cut-out
// pipeline uses), so the picture is decoded here, separated with the same
// naive conversion the type uses, and embedded raw. Bigger, and honest.
//
// A cut-out's alpha becomes an /SMask, so the silhouette the desk cut still
// prints as a silhouette rather than as a white box.

async function embedImage(builder, absolutePath, { mono = false } = {}) {
  const { Jimp } = require('jimp');
  const image = await Jimp.read(absolutePath);
  const { width, height } = image.bitmap;
  const pixels = image.bitmap.data;

  const cmyk = Buffer.alloc(width * height * 4);
  const alpha = Buffer.alloc(width * height);
  let transparent = false;
  for (let i = 0, p = 0, a = 0; i < pixels.length; i += 4, p += 4, a += 1) {
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    // ON A MONO FORME EVERY PIXEL IS K AND NOTHING ELSE.
    //
    // Rec. 709 luma rather than the naive max() the colour path uses: a
    // photograph reduced by max(r,g,b) comes out flat and pale, because it
    // throws away the fact that the eye reads green as far brighter than blue.
    // This is the one place in this writer where a perceptual weighting is
    // right - it is converting a picture, not separating an ink.
    if (mono) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      cmyk[p] = 0; cmyk[p + 1] = 0; cmyk[p + 2] = 0;
      cmyk[p + 3] = Math.round((1 - luma) * 255);
      alpha[a] = pixels[i + 3];
      if (pixels[i + 3] < 255) transparent = true;
      continue;
    }
    const k = 1 - Math.max(r, g, b);
    if (k >= 1) { cmyk[p] = 0; cmyk[p + 1] = 0; cmyk[p + 2] = 0; cmyk[p + 3] = 255; }
    else {
      cmyk[p] = Math.round(((1 - r - k) / (1 - k)) * 255);
      cmyk[p + 1] = Math.round(((1 - g - k) / (1 - k)) * 255);
      cmyk[p + 2] = Math.round(((1 - b - k) / (1 - k)) * 255);
      cmyk[p + 3] = Math.round(k * 255);
    }
    alpha[a] = pixels[i + 3];
    if (pixels[i + 3] < 255) transparent = true;
  }

  const smask = transparent ? builder.addStream({
    Type: '/XObject', Subtype: '/Image', Width: width, Height: height,
    ColorSpace: '/DeviceGray', BitsPerComponent: 8,
  }, alpha) : null;

  return builder.addStream({
    Type: '/XObject', Subtype: '/Image', Width: width, Height: height,
    ColorSpace: '/DeviceCMYK', BitsPerComponent: 8,
    ...(smask ? { SMask: `${smask} 0 R` } : {}),
  }, cmyk);
}

// ------------------------------------------------------------- the document ---

/**
 * The whole edition as one CMYK press PDF.
 *
 * @param model the neutral document from print-model.js
 * @param deps  { shapeRun, faceMetrics } - the compositor's OWN shaper and
 *              metrics, handed in rather than imported, because they are ES
 *              modules the caller has already loaded and awaited. Nothing here
 *              may measure text any other way.
 */
async function buildPdf(model, deps) {
  const { shapeRun, faceMetrics } = deps;
  const builder = new PdfBuilder();
  const pagesId = builder.reserve();

  // What every face actually sets on this edition, gathered first so /W and
  // /ToUnicode describe the edition rather than the whole font.
  const used = new Map();   // faceKey -> { glyphs:Set, toUnicode:Map }
  const noteFace = (key) => {
    if (!used.has(key)) used.set(key, { glyphs: new Set(), toUnicode: new Map() });
    return used.get(key);
  };

  const warnings = [];
  const missingImages = [];
  const imageIds = new Map();

  // ---- pass one: shape everything, so the fonts can be described exactly.
  const shaped = [];
  for (const page of model.pages) {
    const items = [];
    for (const item of page.items) {
      if (item.kind !== 'text') { items.push(item); continue; }
      const runs = [];
      let cursor = 0;
      const widths = item.runs.map((run) => {
        const key = faceKey(run.family, run.weight);
        const result = shapeRun(run.text, { family: run.family, weight: run.weight, fontPx: run.sizePt });
        if (!result) { warnings.push(`No publication face for ${run.family}/${run.weight}`); return 0; }
        const face = noteFace(key);
        for (const glyph of result.glyphs) face.glyphs.add(glyph.glyphId);
        // The reverse map, from the shaper's own clusters: a glyph is named by
        // the characters that produced it, so a conjunct copies out as its
        // real letters rather than as one unknown symbol.
        // Only a glyph that IS one whole cluster on its own can be named
        // here; anything else is described by the run's /ActualText.
        const perCluster = new Map();
        for (const glyph of result.glyphs) {
          perCluster.set(glyph.cluster, (perCluster.get(glyph.cluster) || 0) + 1);
        }
        for (const glyph of result.glyphs) {
          if (face.toUnicode.has(glyph.glyphId) || perCluster.get(glyph.cluster) !== 1) continue;
          const next = result.glyphs.find((other) => other.cluster > glyph.cluster);
          const text = run.text.slice(glyph.cluster, next ? next.cluster : undefined);
          if (text) face.toUnicode.set(glyph.glyphId, text);
        }
        runs.push({ run, key, glyphs: result.glyphs, width: result.width, offset: cursor });
        cursor += result.width;
        return result.width;
      });
      items.push({ ...item, shapedRuns: runs, textWidth: widths.reduce((a, b) => a + b, 0) });
    }
    shaped.push({ ...page, items });
  }

  // ---- the fonts.
  const fontIds = new Map();
  // The two base-14 fallbacks, added unconditionally: they cost one dictionary
  // each and no embedded bytes, and the alternative is discovering at the
  // plate that page two's imprint printed as boxes.
  const fallbackIds = {
    serif: builder.add({ Type: '/Font', Subtype: '/Type1', BaseFont: `/${FALLBACK_FONT.serif}`, Encoding: '/WinAnsiEncoding' }),
    sans: builder.add({ Type: '/Font', Subtype: '/Type1', BaseFont: `/${FALLBACK_FONT.sans}`, Encoding: '/WinAnsiEncoding' }),
  };
  for (const [key, face] of used) {
    const [family, weight] = key.split('/');
    fontIds.set(key, embedFace(builder, key, faceMetrics(family, Number(weight)), face.glyphs, face.toUnicode));
  }
  const advanceFor = (key) => {
    const [family, weight] = key.split('/');
    const metrics = faceMetrics(family, Number(weight));
    const upem = metrics?.unitsPerEm || 1000;
    return (glyphId) => {
      if (!metrics?.advances) return 500;
      const index = glyphId < metrics.longMetrics ? glyphId : metrics.longMetrics - 1;
      return Math.round((metrics.advances[index] / upem) * 1000);
    };
  };
  const advanceCache = new Map();
  const advanceOf = (key) => {
    if (!advanceCache.has(key)) advanceCache.set(key, advanceFor(key));
    return advanceCache.get(key);
  };

  // ---- pass two: draw.
  const pageIds = [];
  for (const page of shaped) {
    const heightPt = mmToPt(model.heightMm);
    const widthPt = mmToPt(model.widthMm);
    const out = [];
    const xobjects = {};

    // The sheet itself. A press file states its own paper rather than assuming
    // the RIP will: an unpainted background is not white, it is "unknown".
    out.push('q', fill([0, 0, 0, 0]), `0 0 ${round(widthPt)} ${round(heightPt)} re f`, 'Q');

    for (const item of page.items) {
      if (item.kind === 'fill' || item.kind === 'rule') {
        out.push('q', fill(cmykOf(item.ink)),
          `${round(mmToPt(item.x))} ${round(heightPt - mmToPt(item.y + item.height))} `
          + `${round(mmToPt(item.width))} ${round(mmToPt(item.height))} re f`, 'Q');
        continue;
      }

      if (item.kind === 'image') {
        const absolute = path.join(PUBLIC_DIR, item.file);
        // KEYED ON THE FORME AS WELL AS THE FILE. The same photograph can be
        // placed on a colour page and on a mono one in the same edition, and
        // those are two different embedded images - one separated to four
        // plates, one to K alone. Keyed on the filename alone, whichever page
        // was walked first decided how it printed on every other.
        const key = `${item.file}|${item.mono ? 'k' : 'cmyk'}`;
        if (!imageIds.has(key)) {
          if (!fs.existsSync(absolute)) { missingImages.push(item.file); imageIds.set(key, null); }
          else imageIds.set(key, await embedImage(builder, absolute, { mono: Boolean(item.mono) }));
        }
        const id = imageIds.get(key);
        if (!id) continue;
        const label = `Im${id}`;
        xobjects[label] = `${id} 0 R`;
        out.push('q',
          `${round(mmToPt(item.width))} 0 0 ${round(mmToPt(item.height))} `
          + `${round(mmToPt(item.x))} ${round(heightPt - mmToPt(item.y + item.height))} cm`,
          `/${label} Do`, 'Q');
        continue;
      }

      // Text. The whole line's own alignment is applied to the shaped width,
      // because the compositor aligned display type by moving the LINE, and a
      // footer column is aligned inside its own third.
      const slack = mmToPt(item.width) - item.textWidth;
      const shift = item.align === 'center' ? slack / 2 : item.align === 'right' ? slack : 0;
      const baselineY = heightPt - mmToPt(item.baseline ?? (item.y + item.height * 0.8));
      for (const piece of item.shapedRuns || []) {
        drawRun(out, {
          glyphs: piece.glyphs,
          sizePt: piece.run.sizePt,
          fontName: `F${fontIds.get(piece.key)}`,
          x: mmToPt(item.x) + shift + piece.offset,
          baselineY,
          ink: cmykOf(piece.run.ink),
          advanceOf: advanceOf(piece.key),
          text: piece.run.text,
          fallbackName: `L${fallbackIds[piece.key.startsWith('sans') ? 'sans' : 'serif']}`,
        });
        if (piece.run.underline && piece.width > 0) {
          const y = baselineY - piece.run.sizePt * 0.12;
          out.push('q', fill(cmykOf(piece.run.ink)),
            `${round(mmToPt(item.x) + shift + piece.offset)} ${round(y)} `
            + `${round(piece.width)} ${round(Math.max(0.4, piece.run.sizePt * 0.05))} re f`, 'Q');
        }
      }
    }

    const content = builder.addStream({}, out.join('\n'));
    const fonts = {};
    for (const [, id] of fontIds) fonts[`F${id}`] = `${id} 0 R`;
    for (const [, id] of Object.entries(fallbackIds)) fonts[`L${id}`] = `${id} 0 R`;
    pageIds.push(builder.add({
      Type: '/Page',
      Parent: `${pagesId} 0 R`,
      MediaBox: [0, 0, round(widthPt), round(heightPt)],
      // The trim is the sheet: this product's geometry has no bleed of its own,
      // and inventing one here would be a number nobody chose.
      TrimBox: [0, 0, round(widthPt), round(heightPt)],
      Resources: { Font: fonts, XObject: Object.keys(xobjects).length ? xobjects : undefined,
        ProcSet: ['/PDF', '/Text', '/ImageC'] },
      Contents: `${content} 0 R`,
    }));
  }

  builder.put(pagesId, { Type: '/Pages', Kids: pageIds.map((id) => `${id} 0 R`), Count: pageIds.length });
  const info = builder.add({
    Title: literal(`${model.titleEnglish} ${model.date}`),
    Creator: literal('SAHAS Layout Desk'),
    Producer: literal('SAHAS Layout Desk'),
  });
  const catalog = builder.add({ Type: '/Catalog', Pages: `${pagesId} 0 R` });

  return { pdf: builder.build({ root: catalog, info }), warnings, missingImages };
}

module.exports = {
  buildPdf, cmykOf, mmToPt, faceKey, FONT_FILES, embedFace, fill, toUnicodeCMap, drawRun, round, utf16be,
};
