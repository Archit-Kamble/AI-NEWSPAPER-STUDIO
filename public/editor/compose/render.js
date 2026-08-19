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
import { headlineSegments } from './accent.js';

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
  // Italic/underline are the Typography panel's whole-body toggles
  // (compose.js's pourBody carries them per line, unchanged from measurement
  // since neither affects a glyph's advance width - see compose.js). Painted
  // here for the first time: previously these persisted and even had their
  // own isolated preview widget, but never reached the canonical block a
  // desk actually looks at.
  const style = `font-family:${css};font-weight:${line.weight || 400};`;
  return line.italic || line.underline
    ? `${style}${line.italic ? 'font-style:italic;' : ''}${line.underline ? 'text-decoration:underline;' : ''}`
    : style;
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
//
// Decided once per BAND, not per line - see accent.js's headlineSegments()
// for why: compose.js breaks the headline into display lines with no idea
// where the desk's asterisks fall, so matching line-by-line (as this used
// to) missed an accent phrase split across that break, and coloured the
// last word of every line instead of the headline's true last word under
// `headlineStyle: 'accent'`.
function headlineBandSegments(lines, view) {
  return headlineSegments(lines.map((line) => line.text), { accentStyle: view.headlineStyle === 'accent' });
}

function headlineLineHtml(line, view, segments, marks) {
  const text = line.text;
  const accent = escapeHtml(view.accentColor || '#c8102e');
  const semantic = presentationRanges(text, view.editorialPresentation, 'headline');
  if (semantic.length) return renderPresentation(text, [], semantic, escapeHtml);
  if (segments) {
    return segments
      .map((segment) => (segment.accent ? `<span style="color:${accent}">${escapeHtml(segment.text)}</span>` : escapeHtml(segment.text)))
      .join('');
  }
  // The desk's own bold/italic/underline runs, clipped to this line and
  // rebased onto it - the same `line.at` mechanism a body line has always
  // used, now that a display line carries one (compose.js's setDisplayFlow).
  // A phrase emphasised across the headline's line break is therefore still
  // emphasised on both halves.
  if (marks.length) return renderPresentation(text, sliceRanges(marks, line.at || 0, text.length), [], escapeHtml);
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
    const headlineSegments = key === 'headline' ? headlineBandSegments(band.lines, view) : null;
    band.lines.forEach((line, lineIndex) => {
      const bandMarks = band.marks || [];
      const html = key === 'headline'
        ? headlineLineHtml(line, view, headlineSegments?.[lineIndex], bandMarks)
        : renderPresentation(
          line.text,
          sliceRanges(bandMarks, line.at || 0, line.text.length),
          presentationRanges(line.text, view.editorialPresentation, key === 'deck' ? 'subheading' : key),
          escapeHtml,
        );
      // A justified display line stretches its word spaces and, past that,
      // its glyphs - exactly as a justified body line does, and painted the
      // same way. Absent on every left/centre/right line, so nothing is
      // emitted for the ordinary case.
      const wordSpacing = Number.isFinite(line.wordSpacingPx) ? `word-spacing:${line.wordSpacingPx.toFixed(2)}px;` : '';
      const glyphScale = Number.isFinite(line.glyphScaleX) && line.glyphScaleX !== 1
        ? `transform:scaleX(${line.glyphScaleX});transform-origin:left top;`
        : '';
      pieces.push(
        `<span class="section-composed ${className}" style="left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
        + `width:${line.measure.toFixed(2)}px;height:${line.height.toFixed(2)}px;`
        + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;${wordSpacing}${glyphScale}${faceStyle(line)}">${html}</span>`,
      );
    });
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
    // The second justification lever (compose.js's justifyLine): the glyphs
    // themselves stretch by the small amount a newspaper really uses, after
    // the word spaces have opened as far as is decent. Anchored left so the
    // line still starts exactly where it was composed to start.
    const glyphScale = Number.isFinite(line.glyphScaleX) && line.glyphScaleX !== 1
      ? `transform:scaleX(${line.glyphScaleX});transform-origin:left top;`
      : '';
    pieces.push(
      `<span class="section-composed section-body-line${dateline ? ' has-dateline' : ''}"`
      + ` style="left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
      + `width:${(line.measure + 1).toFixed(2)}px;height:${line.height.toFixed(2)}px;`
      + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;${wordSpacing}${glyphScale}${faceStyle(line)}">${html}</span>`,
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
