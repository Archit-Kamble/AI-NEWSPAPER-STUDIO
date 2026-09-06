import { readFontFile } from './font-bytes.js';
// Real advances, from the real publication fonts.
//
// Everything that measures a block used to go through one constant:
// AVG_CHAR_WIDTH_RATIO = 0.4 in text-flow.js - every codepoint, whatever it
// is, charged 0.4 of the type size.
//
// The interesting thing about that constant is that its AVERAGE is nearly
// right, which is exactly why the damage it does went unfound for so long.
// Measured against a five-sentence Marathi sample (419 codepoints) it
// overstates the real width by 7.8%. Per LINE it is not close at all:
//
//     matra-heavy      शिक्षिकेने विद्यार्थिनींसाठी       0.340 em/cp   model +18%
//     conjunct-heavy   ज्ञानेश्वर श्रद्धांजली            0.338 em/cp   model +18%
//     plain consonants कमल गगन सरल पवन                  0.490 em/cp   model -18%
//     Latin headline   BREAKING NEWS TODAY              0.475 em/cp   model -16%
//     Devanagari+Latin digits  १२३४ 1234                0.513 em/cp   model -22%
//
// A line of plain consonants sets 18% WIDER than the model believes, so it
// overflows its measure; a matra-heavy line sets 18% narrower, so it leaves a
// hole. Both errors are in the same block, and they cancel in the total. That
// is the signature of the whole family of complaints this engine exists to
// answer: a block reporting itself full while visibly short of its own bottom
// edge, and copy escaping a frame that the budget said had room.
//
// The reason the spread is so wide is that a Devanagari vowel sign is drawn
// ON the consonant it belongs to and takes NO advance width of its own. Read
// straight out of NotoSerifDevanagari-Regular.ttf, at 1000 units per em:
//
//     क  711     ि  246     े  0     ं  0
//     म  556     ा  246     ु  0     ्  0
//
// "शेतकऱ्यांसाठी" is thirteen codepoints, of which six advance the pen. A
// constant cannot express that, and no choice of constant can - which is why
// this reads the font instead of tuning the number again.
//
// This module replaces the constant with the font's own hmtx table. It is a
// small TrueType reader - table directory, head, hhea, hmtx, cmap - written
// by hand for the same reason the RSS reader was: Node ships no font parser,
// and pulling in a general one to read four numbers out of four files is a
// dependency this project does not need.
//
// WHAT THIS IS EXACT ABOUT, AND WHAT IT IS NOT. Advances are exact - they are
// the font's own numbers. What is NOT modelled is GSUB/GPOS: the conjunct
// substitutions (क् + ष -> the single glyph क्ष) and kerning that a real
// shaper applies. A substituted conjunct is normally NARROWER than the sum of
// its parts, so summing advances OVERESTIMATES a conjunct-heavy run. That
// direction is deliberate and is the whole reason this is safe to use as the
// authority: a composition that reserves slightly too much room leaves a
// small gap; one that reserves too little overflows the page. Never "fix"
// this by scaling the result down.
//
// The same numbers are read in Node and in the browser, from the same files,
// by the same code - which is what makes Layout, the Block Editor, the fit
// action, the worklist and preflight agree by construction rather than by a
// parity test. See compose.js.

// ---------------------------------------------------------------- parsing ---

function tableDirectory(view, bytes) {
  const numTables = view.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i += 1) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    tables[tag] = { offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  }
  return tables;
}

// Character -> glyph id. Format 4 covers the Basic Multilingual Plane, which
// is all of Devanagari and all of Latin; format 12 is preferred when present
// because it is the one that also carries anything above U+FFFF.
function readCmap(view, bytes, cmap) {
  const count = view.getUint16(cmap.offset + 2);
  let chosen = null;
  for (let i = 0; i < count; i += 1) {
    const record = cmap.offset + 4 + i * 8;
    const subtable = cmap.offset + view.getUint32(record + 4);
    const format = view.getUint16(subtable);
    if (format === 12) chosen = { at: subtable, format };
    else if (format === 4 && chosen?.format !== 12) chosen = { at: subtable, format };
  }
  const map = new Map();
  if (!chosen) return map;

  if (chosen.format === 12) {
    const groups = view.getUint32(chosen.at + 12);
    for (let i = 0; i < groups; i += 1) {
      const group = chosen.at + 16 + i * 12;
      const start = view.getUint32(group);
      const end = view.getUint32(group + 4);
      const glyph = view.getUint32(group + 8);
      for (let cp = start; cp <= end; cp += 1) map.set(cp, glyph + (cp - start));
    }
    return map;
  }

  const at = chosen.at;
  const segCountX2 = view.getUint16(at + 6);
  const segments = segCountX2 / 2;
  const endAt = at + 14;
  const startAt = endAt + segCountX2 + 2;
  const deltaAt = startAt + segCountX2;
  const rangeAt = deltaAt + segCountX2;

  for (let s = 0; s < segments; s += 1) {
    const end = view.getUint16(endAt + s * 2);
    const start = view.getUint16(startAt + s * 2);
    if (start === 0xffff) continue;
    const delta = view.getInt16(deltaAt + s * 2);
    const rangeOffset = view.getUint16(rangeAt + s * 2);
    for (let cp = start; cp <= end; cp += 1) {
      let glyph;
      if (rangeOffset === 0) glyph = (cp + delta) & 0xffff;
      else {
        const index = rangeAt + s * 2 + rangeOffset + (cp - start) * 2;
        if (index + 1 >= bytes.length) continue;
        glyph = view.getUint16(index);
        if (glyph) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) map.set(cp, glyph);
    }
  }
  return map;
}

export function parseFont(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = tableDirectory(view, bytes);
  if (!tables.head || !tables.hhea || !tables.hmtx || !tables.cmap) {
    throw new Error('Not a TrueType font this reader understands');
  }

  const unitsPerEm = view.getUint16(tables.head.offset + 18) || 1000;
  const ascender = view.getInt16(tables.hhea.offset + 4);
  const descender = view.getInt16(tables.hhea.offset + 6);
  const lineGap = view.getInt16(tables.hhea.offset + 8);
  const longMetrics = view.getUint16(tables.hhea.offset + 34);

  const advances = new Uint16Array(longMetrics);
  for (let i = 0; i < longMetrics; i += 1) advances[i] = view.getUint16(tables.hmtx.offset + i * 4);

  const cmap = readCmap(view, bytes, tables.cmap);

  return {
    unitsPerEm,
    // Per em, so a caller multiplies by the type size and never has to know
    // the font's own unit grid.
    ascent: ascender / unitsPerEm,
    descent: Math.abs(descender) / unitsPerEm,
    lineGap: lineGap / unitsPerEm,
    cmap,
    advances,
    longMetrics,
  };
}

// ------------------------------------------------------------- the registry ---

// The faces styles.css actually declares, from the ONE catalogue
// (layout/typefaces.js). This list used to be written out here, again in
// shaper.js and a third time in the press PDF writer - three copies of the
// same thing in the one place where a drift means the plate setting a
// different face from the screen. Nothing outside that catalogue is a
// publication font, so nothing else is measurable.
import '../layout/typefaces.js';
export const { FONT_FILES } = globalThis.SahasTypefaces;

const loaded = new Map();
let loading = null;

// A real, pre-existing bug this classification had: "Arial" and "Helvetica
// Neue" (two of the Typography panel's own six choices - typography-panel.js)
// contain neither "serif" nor "sans" as a substring, so they fell through to
// the `serif` default here - meaning selecting them has always silently
// measured Noto SERIF Devanagari widths, not Noto Sans, for as long as this
// function has existed. Found only once `publicationFamily()` (below) was
// written against the SAME two entries and a test caught the two disagreeing.
const { faceKey } = globalThis.SahasTypefaces;

// The one place "which face" is decided, for MEASUREMENT (this file,
// shaper.js) and for PAINT (render.js, and anything else that has to draw a
// CSS font-family that matches). A desk can still pick "Georgia" or "Arial"
// in the Typography panel - real system fonts, with no Devanagari glyphs at
// all, that a browser would silently substitute for anyway - but every one of
// those choices was always secretly EITHER the serif or the sans publication
// face for measurement purposes (faceKey() above). The bug this closes is
// that nothing made the PAINTED font agree: the canonical renderer never
// applied `fontFamily` as CSS at all, so a block measured as "sans" (Arial
// selected) still rendered inheriting "Sahas Serif" from its container - a
// different face than the one its width was computed from. `publicationFamily()`
// is the SAME classification as `faceKey()`, returned as real CSS pointing at
// the actual @font-face names this project declares (styles.css) - not a
// bare "Noto Sans Devanagari", which has no @font-face rule under that exact
// name and would silently fall through to a browser default.
export const { publicationFamily } = globalThis.SahasTypefaces;

/** Canonicalised to the only two weights a physical bundled face exists for. */
export function publicationWeight(value) {
  if (value === 'bold') return 700;
  if (value === 'normal') return 400;
  const n = Number(value);
  return Number.isFinite(n) && n >= 600 ? 700 : 400;
}

// Both this module and its neighbour used to carry a byte-identical copy of
// this, and each independently fetched EVERY publication face - so opening an
// edition downloaded the paper's ten faces twice, 3.2 MB of TTF arriving as
// 6.4 MB on the one request a desk waits through before the sheet appears. One
// cached reader, in font-bytes.js.

/**
 * Loads every publication face once. Measurement before this resolves falls
 * back to the old ratio model and says so (`fontsReady()` is false), because
 * a fallback-font measurement must never quietly become the final truth for
 * a page that is going to print.
 */
export function ensureFontsLoaded() {
  if (loading) return loading;
  loading = Promise.all(
    Object.entries(FONT_FILES).map(async ([key, path]) => {
      try {
        loaded.set(key, parseFont(await readFontFile(path)));
      } catch {
        // A missing face is not fatal - the caller finds out through
        // fontsReady() and gets the conservative estimate instead.
      }
    }),
  ).then(() => loaded.size > 0);
  return loading;
}

export function fontsReady() {
  return loaded.size > 0;
}

export function faceMetrics(family, weight) {
  return loaded.get(faceKey(family, weight)) || loaded.get('serif/400') || null;
}

// ------------------------------------------------------------- measurement ---

// What a codepoint costs when the publication font has no glyph for it. The
// Devanagari faces carry no Latin, so English words in a Marathi paper are
// set by the CSS stack's next font (Georgia / Arial). 0.5 em is the standard
// conservative figure for a serif lowercase average and errs wide, which is
// the safe direction here for exactly the reason the header explains.
const FALLBACK_ADVANCE = 0.5;
const MARK = /\p{M}/u;

function advanceOf(face, codepoint) {
  const glyph = face.cmap.get(codepoint);
  if (glyph === undefined) {
    // A combining mark the face does not carry still costs nothing - it is
    // drawn on its base wherever it ends up being drawn.
    return MARK.test(String.fromCodePoint(codepoint)) ? 0 : FALLBACK_ADVANCE;
  }
  const index = glyph < face.longMetrics ? glyph : face.longMetrics - 1;
  return face.advances[index] / face.unitsPerEm;
}

// Measuring the same word twice in a paragraph is the common case, and a
// block is measured again on every keystroke.
const widthCache = new Map();
const CACHE_LIMIT = 20000;

/**
 * The width of a run of text, in em. Multiply by the type size for pixels.
 *
 * Deterministic and identical in Node and in the browser - that is the point.
 * Nothing here consults the DOM, a canvas or a layout engine, so the number
 * the worklist quotes before a word is written is the number the page sets
 * to, rather than two numbers that have to be kept in step by tests.
 */
export function measureEm(text, family = 'serif', weight = 400) {
  const value = String(text || '');
  if (!value) return 0;
  const face = faceMetrics(family, weight);
  if (!face) return value.length * 0.4;

  const key = `${faceKey(family, weight)} ${value}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;

  let em = 0;
  for (const character of value) em += advanceOf(face, character.codePointAt(0));

  if (widthCache.size > CACHE_LIMIT) widthCache.clear();
  widthCache.set(key, em);
  return em;
}

/** The width of a run at a real type size, in pixels. */
export function measureWidth(text, fontPx, family = 'serif', weight = 400) {
  return measureEm(text, family, weight) * (Number(fontPx) || 0);
}

/**
 * How tall one line of this face has to be for nothing to be clipped.
 *
 * Marathi stacks vowel signs above the shirorekha and below the baseline, so
 * a line box shorter than the face's own ascent + descent crops them - which
 * is why this is read from hhea rather than chosen. NotoSerifDevanagari
 * reports 930 up and 625 down at 1000/em: 1.555, not the 1.45 that was
 * previously hard-coded as the floor. That 0.105 em is the top of a velanti.
 */
// The measured worst case for this script, and the floor no face may go under.
//
// A face's hhea is what it CLAIMS to need, and some faces claim less than
// Devanagari actually occupies - Noto Sans Devanagari reports 1.304 and Tiro
// Devanagari Marathi reports 1.000, both under the 1.475 em ink box that was
// measured exhaustively across every consonant, vowel sign and virama
// conjunct (see CLAUDE.md, and MIN_LINE_HEIGHT in text-flow.js which is this
// same number). Trusting a tight hhea would crop matras on exactly the faces
// a desk chose for being handsome.
//
// It became load-bearing when this stopped being a two-face product: with
// only Noto Serif in play the reported 1.555 was the largest number anyway.
const DEVANAGARI_INK_EM = 1.45;

export function minLineHeightFor(family = 'serif', weight = 400) {
  const face = faceMetrics(family, weight);
  if (!face) return DEVANAGARI_INK_EM;
  return Math.max(DEVANAGARI_INK_EM, face.ascent + face.descent);
}

export function faceAscent(family = 'serif', weight = 400) {
  return faceMetrics(family, weight)?.ascent ?? 0.93;
}

export function faceDescent(family = 'serif', weight = 400) {
  return faceMetrics(family, weight)?.descent ?? 0.52;
}

/** Test seam: hand the registry a parsed face without touching the disk. */
export function registerFace(family, weight, face) {
  loaded.set(faceKey(family, weight), face);
  widthCache.clear();
}
