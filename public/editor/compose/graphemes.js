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

/**
 * A run of whitespace, set as one space - which is what a compositor does.
 *
 * Two spaces mid-line are a typewriter habit; no printed newspaper sets one.
 * They arrive here without anybody typing them: the paragraph policy merges
 * two authored paragraphs by substituting each interior newline with a space
 * (compose.js), so a reporter's "...घेतला.\n\nशाळा..." becomes
 * "...घेतला.  शाळा..." - same length, same offsets, which is exactly the
 * property that keeps `line.at` valid and a sub-editor's marks in the right
 * place. The stored copy is never edited to fix this. It is SET as one space
 * instead, at the two places setting happens: the width it is measured at and
 * the ink it is painted with.
 *
 * Returns the collapsed text and, for every index in it, where that character
 * came from - so a mark held against the original text can be moved onto the
 * collapsed one exactly rather than approximately.
 */
export function setSpaces(text) {
  const source = String(text ?? '');
  if (!/\s\s/.test(source)) return { text: source, from: null };

  let out = '';
  const from = [];
  for (let i = 0; i < source.length; i += 1) {
    if (/\s/.test(source[i]) && out.length && /\s/.test(out[out.length - 1])) continue;
    out += source[i];
    from.push(i);
  }
  return { text: out, from };
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

/**
 * The nearest place a CARET or a MARK is allowed to sit.
 *
 * The compositor has always cut text at cluster boundaries; a sub-editor
 * marking words on the page had no such rule. The page maps a pointer
 * position to a character offset by proportion - `line.at + text.length ×
 * fraction` - which is plain code-unit arithmetic and lands inside an akshara
 * about as often as not. Bolding a dragged phrase then produced
 * `द<strong>िली`: the consonant in one run, its matra in the next, and the
 * browser drew the orphaned matra on a dotted circle. It is visible in a
 * screenshot and it is stored that way.
 *
 * `bias` says which way to move when the offset is inside a cluster:
 * -1 back to its start, +1 on to its end, 0 to whichever is nearer. A
 * selection expands OUTWARD - start with -1, end with +1 - so marking never
 * loses a character the desk had covered.
 */
export function snapToCluster(text, offset, bias = 0) {
  const value = String(text || '');
  const at = Math.max(0, Math.min(value.length, Math.round(Number(offset) || 0)));
  if (!at || at >= value.length) return at;
  let start = 0;
  for (const piece of clusters(value)) {
    const end = start + piece.length;
    if (at <= start) return start;
    if (at < end) {
      if (bias < 0) return start;
      if (bias > 0) return end;
      return at - start <= end - at ? start : end;
    }
    start = end;
  }
  return start;
}
