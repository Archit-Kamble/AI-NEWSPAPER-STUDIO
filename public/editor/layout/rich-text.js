// Marked-up copy, and the plain text underneath it.
//
// A sub-editor needs bold and italic in a story - a name, an emphasis, a
// stand-first - and until now the only writing surface was a plain textarea, so
// there was no way to say any of that. But a newspaper is measured in
// CHARACTERS, not in markup: the character grid, preflight, the jump line and
// the AI brief all count what will be set in type, and `<strong>` is not set in
// type. Two words in bold occupy exactly as much space as two words that are
// not.
//
// So there is one rule, enforced here: **markup is presentation, text is
// content**. Everything that measures reads `plainText()`; everything that
// renders reads the marks. One function, used by the browser and by the server,
// so the two can never disagree about how long a story is.
//
// The marks that survive to print are the ones a printer can actually set:
//
//    <b> <strong>   bold          — a real weight on the page
//    <i> <em>       italic        — a real slope
//    <u>            underline     — rare in body copy, real in a standfirst
//    <br> <p>       line breaks   — paragraphs
//    <ul> <ol> <li> lists         — briefs columns are set as lists
//
// Colour, font family and font size are deliberately NOT offered in body copy.
// They are decided by the layout for the whole block (see typeScaleFor) because
// that is how a newspaper keeps a page looking like one paper rather than a
// scrapbook. Typography for the block lives in the Typography panel.

// Only the marks this editor produces are stripped - never "anything between
// angle brackets". Copy legitimately contains them: a price "<२०%", a headline
// about "दर <वाढले>". Treating those as markup would silently delete words from
// a story, and the words would be gone from the printed page with nothing to
// show they had ever been there. The sanitiser is what removes foreign tags, on
// the way in; by the time text is stored, the only tags left are these.
const MARKS = 'b|strong|i|em|u|br|p|div|ul|ol|li';
// A paragraph ends with a BLANK line, not a single break. Everything
// downstream splits paragraphs on two newlines - the e-paper renders them as
// <p>, the press file as separate paragraphs - so collapsing them to one would
// have set every story as a single unbroken block of type.
const PARAGRAPH_TAGS = /<\/(p|div)\s*>/gi;
const LIST_TAGS = /<\/li\s*>/gi;
const BREAK_TAGS = /<br\s*\/?>/gi;
const ANY_TAG = new RegExp(`</?(${MARKS})(\\s[^>]*)?>`, 'gi');

const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
};

/**
 * The text a reader will see, with the markup taken off.
 *
 * This is what everything MEASURES: the character grid, the overset check, the
 * jump line, the AI's character budget. Copy that is not plain text still has a
 * plain length, and that length is what fits or does not fit.
 */
export function plainText(value) {
  const source = String(value ?? '');
  if (!isMarkedUp(source)) return source;

  return source
    // A closing block tag is a line break to a reader.
    .replace(BREAK_TAGS, '\n')
    .replace(PARAGRAPH_TAGS, '\n\n')
    .replace(LIST_TAGS, '\n')
    .replace(ANY_TAG, '')
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    // Collapse the runs of blank lines an editor leaves behind, but keep
    // paragraph breaks - they are how a story reads.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** How many characters of type this copy will actually set. */
export function textLength(value) {
  return plainText(value).length;
}

/** Whether the value carries any markup at all. */
export function isMarkedUp(value) {
  return /<(b|strong|i|em|u|ul|ol|li|p|br)\b/i.test(String(value ?? ''));
}

// --- sanitising ---------------------------------------------------------------
//
// Copy is pasted into a newspaper from everywhere: a reporter's email, a press
// release, a Word document, a website. All of it arrives carrying fonts,
// colours, background shading and sometimes scripts. None of that may reach a
// page, so what comes in is reduced to the marks above and nothing else.

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI']);

/**
 * Reduces arbitrary HTML to the few marks a printer can set.
 *
 * Runs in the browser, on paste and before every save. Anything not on the
 * list is unwrapped - its text is kept, its markup is dropped - so pasting a
 * story never loses a word and never brings a stylesheet with it.
 */
export function sanitise(html) {
  if (typeof document === 'undefined') return String(html ?? '');

  const holder = document.createElement('div');
  holder.innerHTML = String(html ?? '');

  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) return child.remove();

      walk(child);

      if (!ALLOWED.has(child.tagName)) {
        // Keep the words, drop the wrapper.
        child.replaceWith(...child.childNodes);
        return;
      }
      // Even an allowed tag arrives dressed up. Strip every attribute:
      // inline styles are exactly how a pasted story brings a website's fonts
      // and colours onto a newspaper page.
      [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
    });
  };
  walk(holder);

  return holder.innerHTML;
}

/**
 * Plain text into the markup an editor can work with, so a story written before
 * there was a rich editor opens in it with its paragraphs intact.
 */
export function fromPlainText(value) {
  const text = String(value ?? '');
  if (!text.trim()) return '';
  if (isMarkedUp(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>`)
    .join('');
}

// --- marks, as character ranges -----------------------------------------------
//
// The canvas does not render the copy as HTML: it pours it into the character
// grid cell by cell, which is what makes text run round a picture exactly. So a
// mark cannot survive as a tag - it has to survive as a RANGE over the plain
// text, which the pour can then put back on the right words after it has broken
// the copy into pieces.
//
// This is also exactly what Scribus needs, because a .sla applies a character
// style to a span of a story rather than nesting tags.

const MARK_TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u' };

/**
 * Splits marked-up copy into its plain text and the ranges that are marked.
 *
 * Returns `{ text, marks: [{ start, end, tag }] }` with offsets into `text`.
 */
export function textWithMarks(html) {
  const source = String(html ?? '');
  if (!isMarkedUp(source)) return { text: source, marks: [] };

  // Parsed by walking the string, NOT by putting it in a DOM.
  //
  // The DOM version worked in the browser and quietly returned no marks on the
  // server - which meant a word marked bold by a sub-editor reached the canvas
  // in bold and reached the PRESS FILE plain. A mark that survives on screen
  // and not on paper is worse than no mark at all, because nobody finds out
  // until the paper is printed. One parser, both sides.
  const open = [];
  const marks = [];
  let text = '';
  let index = 0;

  const TAG = new RegExp(`<(/?)(${MARKS})(?:\\s[^>]*)?>`, 'gi');
  let match;

  while ((match = TAG.exec(source)) !== null) {
    text += decode(source.slice(index, match.index));
    index = TAG.lastIndex;

    const closing = match[1] === '/';
    const name = match[2].toUpperCase();
    const mark = MARK_TAGS[name];

    if (name === 'BR') { text += '\n'; continue; }

    if (!closing) {
      if (mark) open.push({ tag: mark, start: text.length });
      continue;
    }

    if (mark) {
      // Close the most recent matching open tag; unbalanced markup from a
      // paste must not throw away the rest of the story.
      for (let i = open.length - 1; i >= 0; i -= 1) {
        if (open[i].tag !== mark) continue;
        if (text.length > open[i].start) marks.push({ start: open[i].start, end: text.length, tag: mark });
        open.splice(i, 1);
        break;
      }
    }
    // A paragraph ends with a blank line; a list item with a single break.
    if (name === 'P' || name === 'DIV') text += '\n\n';
    else if (name === 'LI') text += '\n';
  }
  text += decode(source.slice(index));

  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), marks };
}

function decode(value) {
  return value.replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * Puts the marks back on one poured run.
 *
 * `at` is where the run's text starts in the plain text; the run is split at
 * every mark boundary that falls inside it and the pieces are wrapped.
 */
export function markRun(runText, at, marks, escape) {
  if (!marks.length) return escape(runText);

  const end = at + runText.length;
  const relevant = marks.filter((mark) => mark.start < end && mark.end > at);
  if (!relevant.length) return escape(runText);

  // Every boundary that falls inside this run, in order.
  const cuts = new Set([0, runText.length]);
  for (const mark of relevant) {
    if (mark.start > at) cuts.add(mark.start - at);
    if (mark.end < end) cuts.add(mark.end - at);
  }
  const points = [...cuts].sort((a, b) => a - b);

  let out = '';
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const piece = escape(runText.slice(from, to));
    const tags = relevant
      .filter((mark) => mark.start <= at + from && mark.end >= at + to)
      .map((mark) => mark.tag);
    out += tags.length
      ? tags.reduce((inner, tag) => `<${tag}>${inner}</${tag}>`, piece)
      : piece;
  }
  return out;
}
