// The reservation must never promise more room than a block will actually
// have.
//
// `planningFit` reserves the headline and deck at their full stated limit
// before the model has written either. This is the guarantee that makes that
// safe: row count in the character grid is `ceil(text.length / charsPerLine)`,
// which is monotonic in length, so a stand-in AT the limit takes at least as
// many rows as any shorter, legal headline the model could write. A block
// measured afterwards, against whatever the model actually wrote, can
// therefore never hold LESS body room than the model was briefed on.
//
// This used to be a trimmed stand-in - the reasoning was that a headline
// should look like a headline - and it cost the guarantee for nothing: the
// grid does not read spaces, only length, and the trim could leave the
// reservation as low as 72% of the limit. On the narrow blocks where a line of
// headline type costs several rows of body type, that shortfall was the cause
// of 27 of the 32 second calls still firing after the first pass at this bug.

const test = require('node:test');
const assert = require('node:assert/strict');

const writer = require('../src/services/storyWriter.service');

// A block wide enough to have real headline/body room, at a few different
// widths - the quantisation that broke the trimmed version is sharpest on
// narrow blocks, so those are exercised specifically.
const SECTIONS = [
  { width_px: 268, height_px: 248, margin_px: 12, column_count: 1, line_height: 1.25, headline_font_px: 24, subheading_font_px: 13, body_font_px: 10 },
  { width_px: 180, height_px: 200, margin_px: 10, column_count: 1, line_height: 1.45, headline_font_px: 18, subheading_font_px: 12, body_font_px: 9 },
  { width_px: 660, height_px: 500, margin_px: 12, column_count: 1, line_height: 1.3, headline_font_px: 28, subheading_font_px: 15, body_font_px: 10 },
];

const WORDS = 'पुणे शहरातील नव्या पायाभूत सुविधा प्रकल्पाचे काम वेगाने सुरू असून नागरिकांना लवकरच मोठा दिलासा मिळणार आहे'.split(' ');
const SOURCE = WORDS.join(' ');

// EXACTLY n characters, real words where they fit - matching `standIn` itself,
// which slices to the limit rather than stopping at the last whole word (row
// count depends only on length, so there is nothing to gain by stopping short).
function textOfLength(n) {
  if (n <= 0) return '';
  const source = SOURCE.length >= n ? SOURCE : `${SOURCE} `.repeat(Math.ceil(n / (SOURCE.length + 1)));
  return source.slice(0, n);
}

test('a headline/deck at any legal length never leaves LESS body room than planningFit briefed', async () => {
  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const measure = (section, over) => buildFlowMap(section, {
    headline: over.headline ?? '', subheading: over.subheading ?? '', body: '',
    marginPx: section.margin_px, columnCount: section.column_count, lineHeight: section.line_height,
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px, bodyFontPx: section.body_font_px,
  }, []);
  const hLimit = (cols) => Math.max(24, Math.min(90, Math.round(cols * 0.9)));
  const dLimit = (cols) => Math.max(40, Math.min(140, cols * 2));

  let checked = 0;
  for (const section of SECTIONS) {
    const cols = measure(section, {}).cols || 1;
    const briefed = await writer.planningFit(section, []);
    if (!briefed.bodyCharBudget) continue;

    for (const hf of [0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
      for (const df of [0.1, 0.5, 1.0]) {
        const headline = textOfLength(Math.round(hLimit(cols) * hf));
        const subheading = textOfLength(Math.round(dLimit(cols) * df));
        const real = measure(section, { headline, subheading });
        checked += 1;
        assert.ok(
          real.bodyCharBudget >= briefed.bodyCharBudget,
          `briefed ${briefed.bodyCharBudget} > real ${real.bodyCharBudget} at headline ${hf * 100}%, deck ${df * 100}% - `
          + 'a compliant model was told more room existed than the block will actually have',
        );
      }
    }
  }
  assert.ok(checked > 30, 'the guarantee was actually exercised, not vacuously true');
});

test('the stand-in reserves the full limit, not a word-trimmed length short of it', async () => {
  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const measure = (section, over) => buildFlowMap(section, {
    headline: over.headline ?? '', subheading: over.subheading ?? '', body: '',
    marginPx: section.margin_px, columnCount: section.column_count, lineHeight: section.line_height,
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px, bodyFontPx: section.body_font_px,
  }, []);
  const hLimit = (cols) => Math.max(24, Math.min(90, Math.round(cols * 0.9)));
  const dLimit = (cols) => Math.max(40, Math.min(140, cols * 2));

  for (const section of SECTIONS) {
    const cols = measure(section, {}).cols || 1;
    const fit = await writer.planningFit(section, []);
    if (!fit.bodyCharBudget) continue;

    // Reserving headline/deck at EXACTLY their stated limits, real words, no
    // trim - the reservation `planningFit` is supposed to use.
    const atFullLimit = measure(section, {
      headline: textOfLength(hLimit(cols)),
      subheading: textOfLength(dLimit(cols)),
    });

    assert.equal(fit.bodyCharBudget, atFullLimit.bodyCharBudget,
      'planningFit must reserve exactly what a headline/deck AT the limit would take - '
      + 'a shorter, word-trimmed stand-in would report more room than the guarantee allows for');
  }
});
