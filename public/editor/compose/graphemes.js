// Where Marathi is allowed to break, and where it must never be cut.
//
// The old pour broke copy with `text.slice(0, runLength)` - an index into a
// JavaScript string, which is an index into UTF-16 code units. In Marathi
// that lands inside a syllable roughly half the time: "शेतकऱ्यांसाठी" cut at
// eight units gives "शेतकऱ्या" + "ंसाठी", and the second piece opens with a
// naked anusvara that the font draws on whatever consonant happens to follow
// it on the next line. A printed newspaper cannot do this, and no amount of
// CSS repairs it afterwards - the damage is done in the string.
//
// A visible unit of Devanagari is an akshara: a consonant plus its vowel
// signs, plus any consonants joined to it through a virama (क् + ष -> क्ष).
// UAX #29 extended grapheme clusters describe exactly that, including the
// Indic conjunct rule, and Intl.Segmenter implements it - verified against
// this project's own copy on Node 24:
//
//     क्ष            -> क्ष                    (one cluster, not three)
//     ज्ञान          -> ज्ञा | न
//     शेतकऱ्यांसाठी  -> शे | त | क | ऱ्यां | सा | ठी
//
// So the rule this module enforces is simple and total: text is only ever
// measured and cut at cluster boundaries. Nothing downstream needs to know
// anything about Devanagari.

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('mr', { granularity: 'grapheme' })
  : null;

/** The visible units of a string, in order. Never splits an akshara. */
export function clusters(text) {
  const value = String(text || '');
  if (!value) return [];
  if (segmenter) return Array.from(segmenter.segment(value), (part) => part.segment);
  // No Segmenter (a very old runtime): at minimum keep combining marks with
  // the base they belong to, which is the failure that actually damages copy.
  const out = [];
  for (const character of value) {
    if (out.length && /[\p{M}]/u.test(character)) out[out.length - 1] += character;
    else out.push(character);
  }
  return out;
}

// A break opportunity is a place a line may end. Marathi is written with
// spaces between words like English, so the ordinary opportunities are the
// same ones: after whitespace, and after a few punctuation marks that a
// printer will break on. The danda (।) is Devanagari's full stop.
//
// Deliberately NOT here: hyphenation. Breaking inside a Marathi word needs a
// language-aware hyphenator, and inventing one produces "अतिवृ-ष्टीग्रस्त",
// which is not hyphenation, it is damage. A word too wide for every legal
// interval is reported as a violation instead, so a human sees it.
const BREAK_AFTER = /[\s।॥\-–—/]/;

/**
 * Splits text into the smallest pieces a line break is allowed to fall
 * between. Whitespace stays attached to the piece it follows, so a break
 * taken there consumes the space rather than starting the next line with it.
 */
export function breakPieces(text) {
  const units = clusters(text);
  const pieces = [];
  let current = '';
  for (let i = 0; i < units.length; i += 1) {
    current += units[i];
    const next = units[i + 1];
    if (BREAK_AFTER.test(units[i]) && next !== undefined && !BREAK_AFTER.test(next)) {
      pieces.push(current);
      current = '';
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Trailing whitespace removed at a cluster boundary. */
export function trimEndClusters(text) {
  return String(text || '').replace(/\s+$/u, '');
}

/**
 * The count of visible units - what a character budget should really be
 * counting. `"शेतकऱ्यांसाठी".length` is 13; a reader sees 6.
 */
export function clusterCount(text) {
  return clusters(text).length;
}
