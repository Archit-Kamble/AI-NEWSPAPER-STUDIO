// Splitting Marathi into words, once.
//
// This lived inside providers/rss.js while the feed reader was its only
// caller. It has two now - the reader's own query matching, and the Newsdesk
// Run's duplicate detection - and it carries a lesson expensive enough that a
// second copy of it is not acceptable:
//
//   \p{L} ("Letter") DOES NOT INCLUDE Devanagari combining vowel signs.
//
// Splitting on [^\p{L}\p{N}]+ therefore treats every matra as a word boundary,
// and "सातारा" becomes स / त / र - three fragments, each below the 3-character
// floor, so a district query lost its only real word and silently matched
// everything. Measured when it was found: 91 unrelated items for
// "सातारा ताज्या बातम्या". The class is \p{M} ("Mark") and it is not optional.

const { NEWS_WORDS, TEMPORAL_WORDS } = require('./intent');

/** Words that only say "this is news" carry no content of their own. */
const NOISE_WORDS = new Set([...NEWS_WORDS, ...TEMPORAL_WORDS].map((w) => w.toLowerCase()));

const MIN_WORD_LENGTH = 3;

/** Letter, Mark or Number - anything else is a boundary. */
function significantWords(text) {
  return String(text || '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= MIN_WORD_LENGTH);
}

/**
 * The words a query is actually ABOUT.
 *
 * If every word were a noise word (rare - the intent classifier already
 * required a content signal to reach retrieval at all) filtering to nothing
 * would match everything indiscriminately, which is worse than matching on the
 * noise words. Fall back to the unfiltered set.
 */
function contentWords(text) {
  const words = significantWords(text);
  const withoutNoise = words.filter((w) => !NOISE_WORDS.has(w));
  return withoutNoise.length ? withoutNoise : words;
}

module.exports = { significantWords, contentWords, NOISE_WORDS, MIN_WORD_LENGTH };
