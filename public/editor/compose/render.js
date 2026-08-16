// A CompositionResult, drawn.
//
// This is the ONLY place a composed block becomes HTML, and it is
// deliberately dumb: every line already knows its x, its y, its width and its
// type size, so drawing is placing absolutely-positioned spans at numbers
// somebody else worked out. Nothing here decides where a line goes.
//
// That is what makes Layout and the Block Editor the same picture rather than
// two pictures kept in step by tests. Neither of them re-flows anything: they
// call composeBlock() with the block's own logical pixels, hand the result to
// this function, and the editor puts a CSS scale() on the whole layer. A
// browser is never asked to break a line, so a browser can never break it
// somewhere else.

import { escapeHtml } from '../format.js';
import { textWithMarks, plainText } from '../layout/rich-text.js';
import { presentationRanges, renderPresentation } from '../layout/editorial-presentation.js';
import { publicationFamily } from './font-metrics.js';

// The measured font, painted. Every line now carries the family/weight
// compose.js actually measured it in (see compose.js); this turns that back
// into real CSS instead of leaving the browser to inherit whatever face the
// container's stylesheet happens to declare. Before this, a body measured in
// "sans" (an Arial/Helvetica selection - see font-metrics.js's
// publicationFamily()) still painted inheriting "Sahas Serif" from
// `.newspaper-canvas`, because nothing here ever emitted `font-family` at
// all - the measured font and the painted font could silently be two
// different faces.
function faceStyle(line) {
  const { css } = publicationFamily(line.family);
  return `font-family:${css};font-weight:${line.weight || 400};`;
}

// Marks and semantic ranges are held against the whole flow's plain text, and
// a line is a slice of it. This clips both to the slice and rebases them onto
// it, which is how a bolded phrase survives being broken across three lines.
function sliceRanges(ranges, from, length) {
  return ranges
    .filter((range) => range.end > from && range.start < from + length)
    .map((range) => ({
      ...range,
      start: Math.max(0, range.start - from),
      end: Math.min(length, range.end - from),
    }));
}

function lineHtml(line, { marks, semantic, offset }) {
  const at = (line.at || 0) - offset;
  return renderPresentation(
    line.text,
    sliceRanges(marks, at, line.text.length),
    sliceRanges(semantic, at, line.text.length),
    escapeHtml,
  );
}

// The painted word: one word of the headline in the paper's colour, which is
// the single most recognisable thing about a Marathi front page. Marked
// explicitly by the desk with asterisks - the software must never guess which
// word matters - or, failing that, the last word when the layout asked for
// the accent treatment.
function headlineHtml(text, view) {
  const accent = escapeHtml(view.accentColor || '#c8102e');
  const semantic = presentationRanges(text, view.editorialPresentation, 'headline');
  if (semantic.length) return renderPresentation(text, [], semantic, escapeHtml);

  if (text.includes('*')) {
    return text
      .split(/\*([^*]+)\*/g)
      .map((part, index) => (index % 2 ? `<span style="color:${accent}">${escapeHtml(part)}</span>` : escapeHtml(part)))
      .join('');
  }
  if (view.headlineStyle === 'accent') {
    const words = text.trim().split(/\s+/);
    if (words.length > 1) {
      const last = words.pop();
      return `${escapeHtml(words.join(' '))} <span style="color:${accent}">${escapeHtml(last)}</span>`;
    }
  }
  return escapeHtml(text);
}

const BAND_CLASS = {
  kicker: 'section-kicker',
  headline: 'section-headline',
  deck: 'section-subheading',
};

/**
 * Every line of a composed block, as absolutely positioned spans.
 *
 * `composition` is what composeBlock() returned for this exact block. The
 * markup is in the block's own logical pixels; a surface that wants it larger
 * scales the element it is put inside.
 */
export function composedMarkup(composition, view, { datelinePrefix = '' } = {}) {
  const pieces = [];

  for (const [key, band] of Object.entries(composition.bands || {})) {
    const className = BAND_CLASS[key] || 'section-flowed-band';
    for (const line of band.lines) {
      const html = key === 'headline'
        ? headlineHtml(line.text, view)
        : renderPresentation(
          line.text,
          [],
          presentationRanges(line.text, view.editorialPresentation, key === 'deck' ? 'subheading' : key),
          escapeHtml,
        );
      pieces.push(
        `<span class="section-composed ${className}" style="left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
        + `width:${line.measure.toFixed(2)}px;height:${line.height.toFixed(2)}px;`
        + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;${faceStyle(line)}">${html}</span>`,
      );
    }
  }

  const { text: bodyText, marks } = textWithMarks(view.body);
  const semantic = presentationRanges(bodyText, view.editorialPresentation, 'body');

  for (const line of composition.bodyLines) {
    const html = lineHtml(line, { marks, semantic, offset: datelinePrefix.length });
    // The dateline opens the body rather than sitting apart from it, so it is
    // part of the flow and part of what was measured - but it is SAHAS
    // furniture, not copy, and is marked so it can be set differently.
    const dateline = datelinePrefix && (line.at || 0) < datelinePrefix.length;
    // `left`/`x` already carries right/center alignment - composeBlock()
    // repositioned the whole line, so nothing extra is drawn for those.
    // `justify` is different: the line stays where it was broken and the
    // SPACE inside it stretches, which is a real CSS property, not a
    // position - `word-spacing` is the one property that does that without
    // this renderer having to re-lay out the individual words itself.
    const wordSpacing = Number.isFinite(line.wordSpacingPx) ? `word-spacing:${line.wordSpacingPx.toFixed(2)}px;` : '';
    pieces.push(
      `<span class="section-composed section-body-line${dateline ? ' has-dateline' : ''}"`
      + ` style="left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
      + `width:${(line.measure + 1).toFixed(2)}px;height:${line.height.toFixed(2)}px;`
      + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;${wordSpacing}${faceStyle(line)}">${html}</span>`,
    );
  }

  return pieces.join('');
}

/**
 * What the desk is told about a block that does not fit or is not full.
 *
 * Overset is never painted - the copy that had no room simply was not placed,
 * because a newspaper cannot print outside a frame. But it must not vanish
 * silently either, so it is counted here and shown as a diagnostic that does
 * not print.
 */
export function diagnosticMarkup(composition) {
  if (!composition || composition.fitState === 'FITS' || composition.fitState === 'EMPTY') return '';

  const overset = Object.entries(composition.overset || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `${key} +${plainText(value).length}`);

  if (composition.fitState === 'OVERSET') {
    // A hard-unbreakable-token violation (a single word wider than every
    // legal line in the frame - Marathi has no hyphenation, so it is drawn
    // rather than damaged, see graphemes.js) leaves `overset` EMPTY: nothing
    // was left over, the word itself was placed. Without this, that case
    // rendered as a bare "⚠" with no text after it - a real diagnostic
    // telling the desk nothing about what to actually do.
    const tokenViolations = (composition.violations || [])
      .filter((v) => v.code.endsWith('UNBREAKABLE_TOKEN_OVERSET'))
      .map((v) => `${v.code.replace('_UNBREAKABLE_TOKEN_OVERSET', '').toLowerCase()}: word too wide for this block`);
    const detail = [...overset, ...tokenViolations].join(', ') || 'this copy has no room in this block';
    return `<span class="section-diagnostic is-overset" title="This copy has no room in this block">⚠ ${escapeHtml(detail)}</span>`;
  }
  return `<span class="section-diagnostic is-underfilled" title="Room left that a writer could still fill">◌ ${composition.whitespace.largestHoleLines.toFixed(1)} lines</span>`;
}
