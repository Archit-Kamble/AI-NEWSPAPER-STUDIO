// THE CARET AND THE SELECTION, DRAWN WHERE THE TYPE IS SET.
//
// WHY THIS EXISTS. The desk's report was "body inside editor is not editable",
// and "I select a text and try to change the font ... it working but not
// properly". Neither could be reproduced by reading code: a double click on
// the body really does focus Quill, a drag across the page really does call
// `quill.setSelection()`, and typing really does reach the copy. It took
// driving the running app and photographing the page to see what was actually
// true - Quill's editor is collapsed to nothing while the direct body edit
// runs, so the DOM selection lives inside an invisible element, and
// THE COMPOSED PAGE DREW NEITHER A CARET NOR A SELECTION AT ALL.
//
// Measured, by doing it: a drag across one composed line reported
// `{index: 0, length: 12}` in Quill - twelve characters selected - and the
// screenshot of the page showed no highlight anywhere. A desk was being asked
// to mark words it could not see, and to type at a caret that was not drawn.
// That is the whole of "not editable": the copy accepted the keystrokes and
// the page never said where they were going.
//
// The composed line is a real element carrying real text, so its geometry is
// not estimated here - a DOM Range over the line's own text nodes gives the
// exact painted position of any character, including the two justification
// levers (word-spacing, and the scaleX a stretched line carries), because a
// client rect is measured after both. Nothing in this module decides where a
// line or a glyph goes; it reads where the renderer already put them.
//
// `data-at` on each composed body line is the compositor's own source offset
// (render.js emits it). Quill's index space is the AUTHORED body, and the
// composed text opens with the dateline, so the two differ by exactly the
// dateline's length - the same constant `bodyOffsetAt()` subtracts going the
// other way. One number, stated once, in both directions.

const LINE_SELECTOR = '.section-body-line';

/** Every text node under `root`, in document order. */
function locate(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.data.length;
    if (offset <= seen + length) return { node, offset: offset - seen };
    seen += length;
    last = node;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

function rangeIn(span, from, to) {
  const start = locate(span, from);
  const end = locate(span, to);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * Where a caret sits inside one composed line, in client coordinates.
 *
 * A collapsed Range reports no rects in Chrome, so the position is taken from
 * the character BESIDE the caret: the left edge of the one after it, or - at
 * the end of the line - the right edge of the one before. The offsets handed
 * in are always akshara boundaries (graphemes.js's snapToCluster), so the
 * character measured is a whole cluster and never half of one.
 */
function caretRect(span, local) {
  const length = (span.textContent || '').length;
  if (!length) {
    const box = span.getBoundingClientRect();
    return { left: box.left, top: box.top, height: box.height };
  }
  if (local < length) {
    const range = rangeIn(span, local, local + 1);
    const box = range?.getBoundingClientRect();
    if (box && box.height) return { left: box.left, top: box.top, height: box.height };
  }
  const range = rangeIn(span, Math.max(0, length - 1), length);
  const box = range?.getBoundingClientRect();
  if (box && box.height) return { left: box.right, top: box.top, height: box.height };
  const fallback = span.getBoundingClientRect();
  return { left: fallback.left, top: fallback.top, height: fallback.height };
}

/** The composed body lines, with the source range each one covers. */
function linesOf(host) {
  return [...host.querySelectorAll(LINE_SELECTOR)].map((span) => {
    const at = Number(span.dataset.at) || 0;
    return { span, at, length: (span.textContent || '').length };
  });
}

/**
 * Draws the one Quill document's caret and selection onto the composed page.
 *
 * `range` is Quill's own - authored-body indices - and `offset` is the length
 * of the composed dateline prefix. Passing `range: null` (or an inactive
 * edit) clears the layer, which is what leaving the body must do.
 */
export function paintBodySelection({ layer, host, page, range, offset = 0, active = true, empty = null }) {
  if (!layer) return;
  if (!active || !range || !host || !page) {
    layer.innerHTML = '';
    return;
  }

  const origin = page.getBoundingClientRect();
  const lines = linesOf(host);
  if (!lines.length) {
    // Nothing composed yet. The caret waits at the head of the frame the first
    // character will be set in, so an unwritten block still shows where typing
    // will go - see the note at the call site.
    const box = empty?.getBoundingClientRect();
    layer.innerHTML = box && box.height
      ? `<span class="body-caret" style="left:${(box.left - origin.left).toFixed(2)}px;`
        + `top:${(box.top - origin.top).toFixed(2)}px;height:${Math.min(box.height, 24).toFixed(2)}px;"></span>`
      : '';
    return;
  }

  const from = Math.max(0, Number(range.index) || 0) + offset;
  const to = from + Math.max(0, Number(range.length) || 0);
  const pieces = [];

  const place = (box, className) => {
    const left = box.left - origin.left;
    const top = box.top - origin.top;
    pieces.push(`<span class="${className}" style="left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;`
      + `width:${Math.max(1, box.width || 1).toFixed(2)}px;height:${box.height.toFixed(2)}px;"></span>`);
  };

  if (to > from) {
    for (const line of lines) {
      const start = Math.max(from, line.at);
      const end = Math.min(to, line.at + line.length);
      if (end <= start) continue;
      const marked = rangeIn(line.span, start - line.at, end - line.at);
      for (const box of marked ? marked.getClientRects() : []) {
        if (box.width > 0.5) place(box, 'body-selection-band');
      }
    }
  }

  // The caret is drawn at the range's focus end, which for a plain click is
  // the range itself. A selection keeps its caret too - that is how every
  // editor shows which end a Shift-arrow will move.
  const line = lines.find((row) => to >= row.at && to <= row.at + row.length)
    || (to > lines[lines.length - 1].at ? lines[lines.length - 1] : lines[0]);
  const caret = caretRect(line.span, Math.max(0, Math.min(line.length, to - line.at)));
  pieces.push(`<span class="body-caret" style="left:${(caret.left - origin.left).toFixed(2)}px;`
    + `top:${(caret.top - origin.top).toFixed(2)}px;height:${caret.height.toFixed(2)}px;"></span>`);

  layer.innerHTML = pieces.join('');
}
