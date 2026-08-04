// The plain text under a story's markup, for the server.
//
// A story is written in the rich editor and stored with the few marks a printer
// can set. Everything on this side that MEASURES or PRINTS text has to see the
// text rather than the markup, or a page goes to press with "<b>" set in type.
//
// It loads public/editor/layout/rich-text.js — the same module the browser uses
// — rather than keeping a second copy of the rule. Two implementations of "how
// long is this story, and what does it say" is exactly the drift CLAUDE.md
// records; the whole point of the character grid living in one file is that the
// desk's measurement and the press file's measurement cannot disagree.
//
// The module is loaded once and cached, so callers that cannot await (the
// Scribus writer builds its XML synchronously, deep inside helpers) call
// `load()` once at the top of their entry point and then use `strip()`.

let cached = null;

/** Loads the shared module. Call once, at the top of an async entry point. */
async function load() {
  if (!cached) cached = await import('../../public/editor/layout/rich-text.js');
  return cached;
}

/** The plain text. Async, and safe to call anywhere. */
async function plainText(value) {
  const { plainText: take } = await load();
  return take(value);
}

/**
 * The synchronous form, valid only after `load()` has resolved once.
 *
 * If it has not, the value is returned untouched rather than a guess being
 * made: a caller that forgot to load would otherwise silently print markup, and
 * printing markup is worse than printing the string it was handed.
 */
function strip(value) {
  return cached ? cached.plainText(value) : String(value ?? '');
}

module.exports = { load, plainText, strip };
