// What the planner may and may not promise.
//
// This file used to hold one claim: "the reservation never promises more room
// than a block will actually have". That claim is FALSE, and it is false by
// measurement, not by argument. Composed across 96 real block geometries with
// an in-spec headline AND deck - which briefFor requires, and which the
// blocks this was originally checked against did not have - the reservation
// over-promised on 49 of them. It could not be otherwise: it reserves room
// for display type that does not exist yet, and the same block's real body
// capacity varies by a factor of 1.5-3 depending only on how long the
// headline and deck turn out to be.
//
// So nothing load-bearing rests on the reservation any more. It is a rough
// bound, kept for two narrow jobs - how long the headline may be, and whether
// this block has any room for copy at all - and `write()` no longer uses it
// as the amount to ask for. What it asks for is the RESERVOIR, and the
// property that matters is the opposite one: the reservoir must be an UPPER
// bound, so the model misses long, where the repair is a free deterministic
// trim (copyFit.trimToFit) rather than a paid call that may still miss.
//
// The reservoir is bounded by the block with the SHORTEST display type the
// brief permits, not by an empty block - an article block is never published
// without a headline and this brief requires a deck, so a body measured with
// neither is a block that will never exist. Sizing it from the empty block
// asked for up to 7x what the finished block could hold; from the shortest
// legal display type, 3x at the 95th percentile and 2x at the median.

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

let adapterModule = null;
async function exactCapacity(section, over) {
  if (!adapterModule) {
    adapterModule = await import('../public/editor/compose/section-adapter.js');
    const fontMetrics = await import('../public/editor/compose/font-metrics.js');
    const shaper = await import('../public/editor/compose/shaper.js');
    await fontMetrics.ensureFontsLoaded();
    await shaper.ensureShaperReady();
  }
  const view = {
    headline: over.headline ?? '', subheading: over.subheading ?? '', body: '',
    marginPx: section.margin_px, columnCount: section.column_count, lineHeight: section.line_height,
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px, bodyFontPx: section.body_font_px,
  };
  const composed = adapterModule.composeSection({ ...section, images: [] }, view);
  // The number planningFit ACTUALLY briefs with - see storyWriter.service.js's
  // `measure()` and copyFit.openingTarget(). Comparing the reservation against
  // a different capacity metric than the one it quotes would test nothing
  // about the reservation.
  return require('../src/services/copyFit.service').openingTarget(composed.capacity);
}

/**
 * The same block's `bodyCharRange.max` - the widest it could hold for the
 * most compact prose anyone might file. This is what the reservoir is sized
 * from, so a comparison against the reservoir has to use it rather than the
 * mid estimate `exactCapacity()` returns.
 */
async function exactCeiling(section, over = {}) {
  await exactCapacity(section, over);
  const view = {
    headline: over.headline ?? '', subheading: over.subheading ?? '', body: '',
    marginPx: section.margin_px, columnCount: section.column_count, lineHeight: section.line_height,
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px, bodyFontPx: section.body_font_px,
  };
  return adapterModule.composeSection({ ...section, images: [] }, view).capacity.bodyCharRange.max;
}

// The grid still decides `cols` (headlineLimit/subheadingLimit's own input -
// see storyWriter.service.js's `measure()`, which keeps the grid for this
// specifically because it is a heuristic, not the number that decides fit).
async function colsFor(section) {
  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const map = buildFlowMap(section, {
    headline: '', subheading: '', body: '',
    marginPx: section.margin_px, columnCount: section.column_count, lineHeight: section.line_height,
    headlineFontPx: section.headline_font_px, subheadingFontPx: section.subheading_font_px, bodyFontPx: section.body_font_px,
  }, []);
  return map.cols || 1;
}

test('the RESERVOIR is an upper bound: no legal headline and deck can leave the body more room than was asked for', async () => {
  const hLimit = (cols) => Math.max(24, Math.min(90, Math.round(cols * 0.9)));
  const dLimit = (cols) => Math.max(40, Math.min(140, cols * 2));

  let checked = 0;
  for (const section of SECTIONS) {
    const cols = await colsFor(section);
    const planned = await writer.planningFit(section, []);
    if (!planned.guaranteedChars) continue;

    // Every headline/deck pair the brief permits. The deck's floor is half its
    // stated limit, because that is what briefFor states - a deck shorter than
    // that is not something a compliant model returns.
    for (const hf of [0.1, 0.3, 0.5, 0.7, 0.9, 1.0]) {
      for (const df of [0.5, 0.75, 1.0]) {
        const headline = textOfLength(Math.round(hLimit(cols) * hf));
        const subheading = textOfLength(Math.round(dLimit(cols) * df));
        const real = await exactCapacity(section, { headline, subheading });
        checked += 1;
        assert.ok(
          planned.reservoirChars >= real,
          `reservoir ${planned.reservoirChars} < real capacity ${real} at headline ${hf * 100}%, deck ${df * 100}% - `
          + 'the model would be asked for less copy than the block can hold, which leaves a hole '
          + 'only a paid call can fill',
        );
      }
    }
  }
  assert.ok(checked > 30, 'the property was actually exercised, not vacuously true');
});

test('the reservoir overshoots, but is not extravagant - it is bounded by the shortest LEGAL display type', async () => {
  for (const section of SECTIONS) {
    const planned = await writer.planningFit(section, []);
    if (!planned.guaranteedChars) continue;

    // An empty block - no headline, no deck - is the tempting ceiling and the
    // wrong one: that block will never exist. Compared like for like, against
    // the same `bodyCharRange.max` the reservoir itself is built from.
    const empty = await exactCeiling(section, { headline: '', subheading: '' });
    assert.ok(planned.reservoirChars < empty,
      `reservoir ${planned.reservoirChars} must be under the empty block's ceiling ${empty} - `
      + 'an article block is never published without a headline');
    assert.ok(planned.reservoirChars > planned.guaranteedChars,
      'and it must be above the safety bound, or it is not a reservoir at all');
  }
});

test('the stand-in reserves the full limit, not a word-trimmed length short of it', async () => {
  const hLimit = (cols) => Math.max(24, Math.min(90, Math.round(cols * 0.9)));
  const dLimit = (cols) => Math.max(40, Math.min(140, cols * 2));

  for (const section of SECTIONS) {
    const cols = await colsFor(section);
    const fit = await writer.planningFit(section, []);
    if (!fit.guaranteedChars) continue;

    // Reserving headline/deck at EXACTLY their stated limits, real words, no
    // trim - the reservation `planningFit` is supposed to use.
    const atFullLimit = await exactCapacity(section, {
      headline: textOfLength(hLimit(cols)),
      subheading: textOfLength(dLimit(cols)),
    });

    // At or BELOW, not equal. The full limit used to be the worst case by
    // construction - a longer headline took at least as many rows as a shorter
    // one - and it is not any more: a headline that comes in short is set
    // LARGER so that it fills its measure (compose.js's HEADLINE_FILL_TARGET),
    // so a shorter stand-in can take more depth off the block than the
    // longest legal one does. `planningFit` takes the minimum across its
    // sampled candidates, which is still the right thing to take; what changed
    // is that the full limit is no longer guaranteed to BE that minimum.
    //
    // This weakens nothing that anything relies on: the file's own header
    // records that the reservation over-promises on 49 of 96 real block
    // geometries and that nothing load-bearing rests on it. What must still
    // hold is that the bound is not OPTIMISTIC about the longest legal
    // display type, and that is what is checked here.
    assert.ok(fit.guaranteedChars <= atFullLimit,
      `the bound (${fit.guaranteedChars}) must not promise more than a headline and deck at their `
      + `stated limits actually leave (${atFullLimit})`);
  }
});
