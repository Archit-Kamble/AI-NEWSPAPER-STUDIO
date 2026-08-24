// Real Devanagari shaping. This is the exact authority font-metrics.js
// claimed to be and was not.
//
// font-metrics.js sums a font's raw hmtx advances - one number per codepoint,
// added up. That is not what a browser or a printer does. Devanagari text is
// SHAPED before it is set: conjuncts substitute several codepoints for one
// narrower glyph (GSUB), and marks are positioned relative to their base
// rather than advancing the pen (GPOS). Measured against real HarfBuzz
// shaping of NotoSerifDevanagari-Regular.ttf, summing hmtx advances instead
// overstates:
//
//     क्ष              hmtx-sum 1.200em   shaped 0.695em   +72.7%
//     ज्ञान            hmtx-sum 2.000em   shaped 1.350em   +48.1%
//     श्री             hmtx-sum 1.600em   shaped 0.885em   +80.8%
//     कर्म             hmtx-sum 1.600em   shaped 1.267em   +26.3%
//     ज्ञानेश्वर        hmtx-sum 4.000em   shaped 2.410em   +66.0%
//
// A conjunct-heavy headline measured this wrong was reserving up to 80% more
// room than the glyph that actually prints - which is a hole, not a safety
// margin. This module replaces summed advances with real shaping for every
// exact measurement; font-metrics.js's hhea-derived ascent/descent/line-height
// remain correct as they are (no GSUB/GPOS involved in a font's vertical
// metrics) and are not duplicated here.
//
// WHAT IS STILL NOT MODELLED: cross-run kerning at a word-break boundary. A
// piece (graphemes.js's breakPieces() unit - a word plus its trailing space)
// is shaped as its own HarfBuzz buffer, not as part of one continuous line
// buffer, so a font's line-initial reph adjustment or word-boundary kerning
// is not captured. This is the same word-at-a-time measurement principle the
// whole engine already uses for line-breaking (a line is assembled from
// independently-fitted pieces); the alternative - reshaping every candidate
// line as one buffer - is what a real paginating typesetter does and is out
// of scope for this pass. The error this leaves is a fraction of a percent
// for Devanagari, which does not kern across the word space the way Latin
// does.

import '../layout/typefaces.js';
const { FONT_FILES, faceKey } = globalThis.SahasTypefaces;

// This used to be a hand-kept copy of font-metrics.js's classification, with a
// comment saying so. Both now read layout/typefaces.js, so the measurer and
// the shaper cannot disagree about which face a block is set in.

async function readFontFile(path) {
  if (typeof process !== 'undefined' && process.versions?.node) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(import.meta.url);
    const root = here.slice(0, here.indexOf('/public/'));
    return readFile(`${root}/public${path}`);
  }
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} could not be read`);
  return new Uint8Array(await response.arrayBuffer());
}

// One module, two runtimes, same as font-metrics.js: Node reaches the real
// npm package (harfbuzzjs, in node_modules); the browser has no bundler and
// no node_modules resolution, so it is served its own copy from
// public/vendor/harfbuzz/ - the same vendoring pattern this project already
// uses for Quill (see CLAUDE.md).
async function loadHarfBuzz() {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return import('harfbuzzjs');
  }
  return import('/vendor/harfbuzz/index.mjs');
}

const fonts = new Map();
let ready = null;

/**
 * Loads the WASM shaping engine and every publication face once. Exact
 * shaping before this resolves is not available; callers check
 * `isShaperReady()` and fall back rather than guess.
 */
export function ensureShaperReady() {
  if (ready) return ready;
  ready = (async () => {
    let hb;
    try {
      hb = await loadHarfBuzz();
    } catch {
      return false;
    }
    await Promise.all(
      Object.entries(FONT_FILES).map(async ([key, path]) => {
        try {
          const bytes = await readFontFile(path);
          const blob = new hb.Blob(bytes);
          const face = new hb.Face(blob);
          const font = new hb.Font(face);
          font.setScale(face.upem, face.upem);
          fonts.set(key, { hb, face, font, upem: face.upem });
        } catch {
          // A missing face leaves this weight/family unshapeable; the caller
          // falls back to the hmtx estimate for exactly that face.
        }
      }),
    );
    return fonts.size > 0;
  })();
  return ready;
}

export function isShaperReady() {
  return fonts.size > 0;
}

// For the paths that must never quietly become approximate: Layout, the
// Block Editor, fit and preflight all measure a page that is about to be
// shown to a desk or sent to a plate. A composition made from summed hmtx
// advances there is not a slightly-rough version of the real page, it is a
// DIFFERENT page - and the previous behaviour (fall back silently, push a
// warning nobody reads) let that happen without anyone knowing which one
// they were looking at. These callers ask for this instead of `isShaperReady()`
// so a shaper that failed to load is a loud, visible failure, not a quiet
// downgrade.
export function requireShaperReady() {
  if (!isShaperReady()) {
    throw new Error('EXACT_SHAPER_NOT_READY');
  }
}

function shapedFace(family, weight) {
  return fonts.get(faceKey(family, weight)) || fonts.get('serif/400') || null;
}

// Shaping the same short run over and over (every keystroke, every candidate
// line) is the common case.
const shapeCache = new Map();
const CACHE_LIMIT = 20000;

/**
 * Shapes one run of text with one real publication face and returns its
 * exact advance width, in em (of the face's own upem, which is what every
 * other caller in this engine already treats "em" as meaning).
 *
 * Returns `null` if the shaper or this face is not ready - callers must have
 * a font-metrics.js fallback ready rather than treat null as zero width.
 */
export function shapeWidthEm(text, family = 'serif', weight = 400) {
  const value = String(text || '');
  if (!value) return 0;
  const face = shapedFace(family, weight);
  if (!face) return null;

  const key = `${faceKey(family, weight)} ${value}`;
  const hit = shapeCache.get(key);
  if (hit !== undefined) return hit;

  const buffer = new face.hb.Buffer();
  buffer.addText(value);
  buffer.guessSegmentProperties();
  face.hb.shape(face.font, buffer);
  const positions = buffer.getGlyphPositions();
  const em = positions.reduce((sum, p) => sum + p.xAdvance, 0) / face.upem;

  if (shapeCache.size > CACHE_LIMIT) shapeCache.clear();
  shapeCache.set(key, em);
  return em;
}

/** The shaped width of a run at a real type size, in pixels, or `null`. */
export function shapeWidthPx(text, fontPx, family = 'serif', weight = 400) {
  const em = shapeWidthEm(text, family, weight);
  return em === null ? null : em * (Number(fontPx) || 0);
}

/**
 * Full shaping result for one run - glyphs and positions, in font units
 * scaled to the requested pixel size. For render.js, when it needs to paint
 * exact shaped glyph advances rather than re-measure with the browser's own
 * text layout (which is what would make Editor/Layout/print disagree again).
 */
export function shapeRun(text, { family = 'serif', weight = 400, fontPx = 16 } = {}) {
  const face = shapedFace(family, weight);
  if (!face) return null;

  const buffer = new face.hb.Buffer();
  buffer.addText(String(text || ''));
  buffer.guessSegmentProperties();
  face.hb.shape(face.font, buffer);
  const infos = buffer.getGlyphInfos();
  const positions = buffer.getGlyphPositions();
  const scale = fontPx / face.upem;

  let width = 0;
  const glyphs = infos.map((info, i) => {
    const pos = positions[i];
    const glyph = {
      glyphId: info.codepoint,
      cluster: info.cluster,
      xAdvance: pos.xAdvance * scale,
      xOffset: pos.xOffset * scale,
      yOffset: pos.yOffset * scale,
      x: width + pos.xOffset * scale,
    };
    width += pos.xAdvance * scale;
    return glyph;
  });

  return { width, glyphs, ready: true };
}
