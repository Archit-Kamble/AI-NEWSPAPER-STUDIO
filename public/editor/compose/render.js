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
// Which display bands a treatment lays a ground behind, and what a screen of
// an ink looks like - one catalogue, shared with the press model.
import { accentedHeadline, groundedBands, headlineFurniture, screenOf } from '../layout/inks.js';
import { presentationRanges, renderPresentation } from '../layout/editorial-presentation.js';
import { publicationFamily } from './font-metrics.js';
import { headlineSegments } from './accent.js';
import { setSpaces } from './graphemes.js';
import { marksWithDateline } from '../layout/text-flow.js';

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
/**
 * A line's text as it is SET, with its ranges moved onto it.
 *
 * The same one-space rule the widths were measured with (graphemes.js's
 * setSpaces) - painting the raw run instead would put ink where no width was
 * reserved, which is the one thing this renderer exists not to do. The ranges
 * are remapped through setSpaces' own index table, so a bold phrase that
 * happens to start or end at a collapsed space lands on exactly the same
 * words it did before.
 */
function asSet(text, ranges) {
  const { text: out, from } = setSpaces(text);
  if (!from) return { text, ranges };
  const at = new Map(from.map((source, index) => [source, index]));
  const moved = (index) => {
    for (let i = index; i >= 0; i -= 1) if (at.has(i)) return at.get(i) + (i === index ? 0 : 1);
    return 0;
  };
  return {
    text: out,
    ranges: ranges.map((range) => ({
      ...range,
      start: Math.min(out.length, moved(range.start)),
      end: Math.min(out.length, moved(Math.max(0, range.end - 1)) + 1),
    })),
  };
}

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
  const bold = asSet(line.text, sliceRanges(marks, at, line.text.length));
  const sense = asSet(line.text, sliceRanges(semantic, at, line.text.length));
  return renderPresentation(bold.text, bold.ranges, sense.ranges, escapeHtml);
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
  return headlineSegments(lines.map((line) => line.text), { accentStyle: accentedHeadline(view.headlineStyle) });
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
  if (marks.length) {
    const set = asSet(text, sliceRanges(marks, line.at || 0, text.length));
    return renderPresentation(set.text, set.ranges, [], escapeHtml);
  }
  return escapeHtml(setSpaces(text).text);
}

// A printed reverse panel carries about a millimetre of ink above and below
// the type it holds - type sitting exactly on the panel's edge reads as a
// mistake. One pixel is 0.5 mm on this page.
const REVERSE_BLEED = 2;

// The smallest gap a coloured panel keeps from whatever sits directly below
// it. Without a floor here REVERSE_BLEED is spent in full even when the next
// band sits close underneath - a deck is set tight to its headline by design
// (BASELINE_GAP, compose.js), tighter than the panel assumes - and the panel
// reads as touching, or overlapping, the very thing it was drawn to sit
// above. 1.5 mm: smaller and it is a hairline at screen resolution, which is
// exactly the "touching" complaint this exists to fix; the panel still never
// gives up more of REVERSE_BLEED's own 1 mm bleed than the next flow forces.
const MIN_PANEL_GAP = 3;

const BAND_CLASS = {
  kicker: 'section-kicker',
  headline: 'section-headline',
  deck: 'section-subheading',
};

// Order the display flows actually pour in. A panel's bottom bleed may never
// cross into whatever comes next in this order - the following display band
// if there is one, else the first line of the body, else the block's own
// usable bottom.
const FLOW_ORDER = ['kicker', 'headline', 'deck'];

function roomBelow(composition, afterKey) {
  const from = FLOW_ORDER.indexOf(afterKey) + 1;
  for (let i = from; i < FLOW_ORDER.length; i += 1) {
    const next = composition.bands?.[FLOW_ORDER[i]];
    if (next?.lines?.length) return next.top;
  }
  // A COMPOSED LINE CARRIES `y`, NOT `top` - only a BAND carries `top`.
  //
  // Reading `.top` here got `undefined`, so this returned undefined, and
  // `undefined - MIN_PANEL_GAP` is NaN. `Math.min(x, NaN)` and `Math.max(x,
  // NaN)` are both NaN, so panelRect() handed back `height: NaN`, the browser
  // dropped `height:NaNpx` as invalid, and the panel collapsed to nothing -
  // while the type above it is painted WHITE, because that is what a reverse
  // band means. White type on white paper: the headline was set, positioned
  // and emitted, and could not be seen on any surface that draws the
  // composition. Only a double click showed it, because the inline editable
  // field styles from the stored value rather than from the composed ink.
  //
  // It needed a block with no deck and no kicker to reach this fallback at
  // all, which is why it survived: every fixture with a reversed headline
  // also had a subheading under it.
  const firstBody = composition.bodyLines?.[0];
  if (firstBody) return firstBody.y;
  return composition.content.bottom;
}

/**
 * The rectangle a coloured headline/deck panel draws into, for `key` (one of
 * `composition.bands`). Bled a hair past the band's own text top and bottom
 * (REVERSE_BLEED) so the type is not sitting on the panel's edge - but never
 * past the top of the block's own content box, and never closer than
 * `MIN_PANEL_GAP` to whatever the next display flow or the body starts at.
 * Both bounds are floors on the bleed, never a shrink of the band's own text
 * height - the panel can never be drawn smaller than the type it is behind.
 */
export function panelRect(composition, key) {
  const band = composition.bands?.[key];
  if (!band?.lines?.length) return null;
  const top = Math.max(0, band.top - REVERSE_BLEED);
  const naturalBottom = band.top + band.height;
  const bottom = Math.max(
    naturalBottom,
    Math.min(naturalBottom + REVERSE_BLEED, roomBelow(composition, key) - MIN_PANEL_GAP),
  );
  return { top, height: bottom - top };
}

/**
 * Every line of a composed block, as absolutely positioned spans.
 *
 * `composition` is what composeBlock() returned for this exact block. The
 * markup is in the block's own logical pixels; a surface that wants it larger
 * scales the element it is put inside.
 */
export function composedMarkup(composition, view, { datelinePrefix = '' } = {}) {
  const pieces = [];

  // A headline set REVERSED - white type out of a solid band - is one of the
  // three or four treatments a Marathi daily actually uses on a lead, and it
  // is drawn rather than composed: the band is ink laid behind type that was
  // already placed, so nothing about the composition changes and no line moves.
  //
  // The panel is the block's whole measure, not the headline's own line widths
  // - a reverse band that stopped at the end of the shortest line would read as
  // a highlighter, not as a printed panel - and it is taken a hair past the
  // band's own box top and bottom (REVERSE_BLEED) so the type has ink around
  // it rather than sitting on the panel's edge. `panelRect()` bounds that
  // bleed against the block's own content box and against whatever comes
  // next - see its own comment for why a fixed bleed cannot be trusted alone.
  const reversed = view.headlineStyle === 'reverse';
  if (reversed) {
    const rect = panelRect(composition, 'headline');
    if (rect) {
      pieces.push(
        `<i class="section-headline-reverse" style="left:${composition.content.left.toFixed(2)}px;`
        + `top:${rect.top.toFixed(2)}px;`
        + `width:${composition.content.measure.toFixed(2)}px;height:${rect.height.toFixed(2)}px;`
        + `background:${escapeHtml(view.accentColor || '#111111')}"></i>`,
      );
    }
  }

  // A SCREEN BEHIND A DISPLAY BAND. The same ink laid down lightly, with the
  // type left in its own colour - which is what a printed paper does behind a
  // standfirst, and what `reverse` cannot do because a screen light enough to
  // read black through is not light enough to read white through.
  //
  // Drawn exactly like the reverse panel above: ink behind type that has
  // already been placed, so no line moves and nothing about the composition
  // changes. Which bands get one comes from the one catalogue, so the press
  // model cannot disagree about it.
  for (const key of groundedBands(view.headlineStyle)) {
    const rect = panelRect(composition, key);
    if (!rect) continue;
    pieces.push(
      `<i class="section-band-screen" style="left:${composition.content.left.toFixed(2)}px;`
      + `top:${rect.top.toFixed(2)}px;`
      + `width:${composition.content.measure.toFixed(2)}px;height:${rect.height.toFixed(2)}px;`
      + `background:${escapeHtml(screenOf(view.accentColor || '#c8102e'))}"></i>`,
    );
  }

  // Rules and tabs use the compositor's final band/line rectangles. They are
  // furniture, not flow: painting one cannot change the line breaks or steal
  // a row from the story. The exact same rectangles are consumed by the
  // neutral print model and Scribus.
  for (const item of headlineFurniture(view.headlineStyle, composition)) {
    const ink = item.ink === 'screen'
      ? screenOf(view.accentColor || '#c8102e')
      : (view.accentColor || '#c8102e');
    pieces.push(
      `<i class="section-headline-furniture is-${item.kind}" style="left:${item.x.toFixed(2)}px;`
      + `top:${item.y.toFixed(2)}px;width:${item.width.toFixed(2)}px;height:${item.height.toFixed(2)}px;`
      + `background:${escapeHtml(ink)}"></i>`,
    );
  }

  for (const [key, band] of Object.entries(composition.bands || {})) {
    const className = BAND_CLASS[key] || 'section-flowed-band';
    const headlineSegments = key === 'headline' ? headlineBandSegments(band.lines, view) : null;
    band.lines.forEach((line, lineIndex) => {
      const bandMarks = band.marks || [];
      const html = key === 'headline'
        ? headlineLineHtml(line, view, headlineSegments?.[lineIndex], bandMarks)
        : (() => {
          const set = asSet(line.text, sliceRanges(bandMarks, line.at || 0, line.text.length));
          return renderPresentation(
            set.text,
            set.ranges,
            presentationRanges(set.text, view.editorialPresentation, key === 'deck' ? 'subheading' : key),
            escapeHtml,
          );
        })();
      // A justified display line stretches its word spaces and, past that,
      // its glyphs - exactly as a justified body line does, and painted the
      // same way. Absent on every left/centre/right line, so nothing is
      // emitted for the ordinary case.
      const wordSpacing = Number.isFinite(line.wordSpacingPx) ? `word-spacing:${line.wordSpacingPx.toFixed(2)}px;` : '';
      const glyphScale = Number.isFinite(line.glyphScaleX) && line.glyphScaleX !== 1
        ? `transform:scaleX(${line.glyphScaleX});transform-origin:left top;`
        : '';
      // Type out of a reverse band is white, and it is the band's own decision
      // rather than a mark - a desk that inked a word inside it still wins,
      // because that span carries its own colour further down the cascade.
      // A HEADING IN THE BLOCK'S OWN INK.
      //
      // The reference paper sets a dressed story's heading in the same hue as
      // the ground it sits on and the rule around it - that is what
      // `page-styles.js` calls a hue family, and `headline_ink` is where the
      // page's theme writes it. NULL is the paper's own black, so a block that
      // has said nothing draws exactly as it always has.
      //
      // The reverse band still wins, and must: type out of a solid panel is
      // white whatever hue the panel is, and a coloured heading on a coloured
      // panel would be unreadable. A desk's own inked WORD still beats both,
      // because that span carries its colour further down the cascade.
      const displayInk = !reversed && view.headlineInk && (key === 'headline' || key === 'kicker')
        ? `color:${escapeHtml(view.headlineInk)};` : '';
      const reverseInk = reversed && key === 'headline' ? 'color:#fff;' : displayInk;
      pieces.push(
        `<span class="section-composed ${className}" style="left:${line.x.toFixed(2)}px;top:${line.y.toFixed(2)}px;`
        + `width:${line.measure.toFixed(2)}px;height:${line.height.toFixed(2)}px;`
        + `font-size:${line.fontPx}px;line-height:${line.height.toFixed(2)}px;${wordSpacing}${glyphScale}${reverseInk}${faceStyle(line)}">${html}</span>`,
      );
    });
  }

  const { text: bodyText, marks: authoredMarks } = textWithMarks(view.body);
  const marks = marksWithDateline(authoredMarks, datelinePrefix.length);
  const semantic = presentationRanges(bodyText, view.editorialPresentation, 'body');

  // THE INITIAL LETTER. Painted, not composed - it is one glyph in its own
  // box rather than a flow, and the copy already runs round it because the
  // pour treated it as an obstacle (compose.js's dropCapOf). Emitted BEFORE
  // the body lines so a cap that overhangs its own box by a hair sits under
  // the type rather than over it.
  if (composition.dropCap) {
    const capitalise = composition.dropCap;
    pieces.push(
      `<span class="section-composed section-drop-cap" style="left:${capitalise.x.toFixed(2)}px;`
      + `top:${capitalise.y.toFixed(2)}px;width:${capitalise.width.toFixed(2)}px;`
      + `height:${capitalise.height.toFixed(2)}px;font-size:${capitalise.fontPx.toFixed(2)}px;`
      + `line-height:${(capitalise.lineBoxPx || capitalise.height).toFixed(2)}px;${faceStyle(capitalise)}">${escapeHtml(capitalise.text)}</span>`,
    );
  }

  // A list's markers, hung beside the copy. Emitted with the drop cap and for
  // the same reason: each is one short piece of furniture in its own box, not
  // a flow, and neither is in the body text - so neither can move a line or
  // shift a `line.at` a sub-editor's marks are held against.
  for (const marker of composition.listMarkers || []) {
    pieces.push(
      `<span class="section-composed section-list-marker" style="left:${marker.x.toFixed(2)}px;`
      + `top:${marker.y.toFixed(2)}px;width:${marker.width.toFixed(2)}px;`
      + `height:${marker.height.toFixed(2)}px;font-size:${marker.fontPx}px;`
      + `line-height:${marker.height.toFixed(2)}px;${faceStyle(marker)}">${escapeHtml(marker.text)}</span>`,
    );
  }

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
      // `data-at` is the compositor's own source offset for this line. It is
      // emitted so the caret and the selection can be drawn where the type is
      // actually SET (external-editor/body-caret.js) rather than estimated -
      // the same number `bodyOffsetAt()` reads going the other way. Identical
      // on the canvas and in the Block Editor, because this is the one
      // renderer both use.
      `<span class="section-composed section-body-line${dateline ? ' has-dateline' : ''}"`
      + ` data-at="${line.at || 0}"`
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
