// The headline's one hand-marked emphasis - "*word*" - decided across a
// whole band's lines at once.
//
// A headline is broken into display lines the same way any other text is:
// by width, with no idea where an editor's asterisks fall. An accent phrase
// that happens to land across that break used to be invisible - render.js
// and scribus.service.js each matched `/\*([^*]+)\*/` one composed LINE at a
// time, so a pair split by the break never matched on either half and both
// asterisks printed literally. The fix is not per-line: the whole band's
// text must be matched first, then re-cut at the same points compose.js
// already broke it at, so a phrase that spans the break still gets
// coloured on both of its halves.
export function accentSegments(lineTexts) {
  if (!lineTexts.some((text) => text.includes('*'))) {
    return lineTexts.map((text) => [{ text, accent: false }]);
  }

  const joined = lineTexts.join('\n');
  const parts = joined.split(/\*([^*]+)\*/g);
  const flat = [];
  let accent = false;
  for (const part of parts) {
    if (part) flat.push({ text: part, accent });
    accent = !accent;
  }

  const perLine = [];
  let current = [];
  for (const segment of flat) {
    const pieces = segment.text.split('\n');
    pieces.forEach((piece, index) => {
      if (index > 0) {
        perLine.push(current);
        current = [];
      }
      if (piece) current.push({ text: piece, accent: segment.accent });
    });
  }
  perLine.push(current);
  return perLine;
}

// The whole headline-accent decision, band-wide: asterisks win when present
// (accentSegments(), above); failing that, `headlineStyle: 'accent'` colours
// the true last word of the whole headline - the last band line's last word,
// not every line's own last word, which is what colouring each line in
// isolation used to produce on a multi-line headline. Returns `null` when
// neither applies, so a caller falls back to its own plain rendering.
export function headlineSegments(lineTexts, { accentStyle = false } = {}) {
  if (lineTexts.some((text) => text.includes('*'))) return accentSegments(lineTexts);
  if (accentStyle && lineTexts.length) {
    const lastIndex = lineTexts.length - 1;
    const words = lineTexts[lastIndex].trim().split(/\s+/);
    if (words.length > 1) {
      const last = words.pop();
      const segments = lineTexts.map((text) => [{ text, accent: false }]);
      segments[lastIndex] = [{ text: `${words.join(' ')} `, accent: false }, { text: last, accent: true }];
      return segments;
    }
  }
  return null;
}
