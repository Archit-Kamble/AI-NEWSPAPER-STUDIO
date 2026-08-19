// The hmtx fallback is a DIFFERENT PAGE, and it used to be silent.
//
// Without HarfBuzz the composition engine sums a font's raw hmtx advances,
// which overstates a Devanagari conjunct by up to 80% (shaper.js carries the
// per-word measurements). Nothing looked at `exactShaping`, so a caller that
// forgot `ensureShaperReady()` got a full, confident, wrong composition.
//
// Measured across 600 real article blocks, composing each one both ways:
//
//     set in a different number of lines      178 blocks   29.7%
//     mean fill-ratio difference                            3.7 points
//     blocks reporting an overset that is not real            3
//     blocks with a different PARAGRAPH count                  1
//     worst single block                       93.8% vs 58.7% full
//
// It had already been found and hand-fixed once in tests/compose.test.js and
// had come back in a script and a test by the time this file was written,
// which is why the refusal lives in the engine rather than in its callers.
//
// This file must load the shaper ONLY inside the test that wants it -
// node --test gives each file its own process, so the "not ready" state is
// only reachable here, and only before that point.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', 'compose', file));

const FRAME = {
  width: 260, height: 300, padding: 10, bodyFontPx: 11, columnCount: 1,
  headline: 'ज्ञानेश्वर श्री कर्म',
  body: 'क्षेत्रफळ ज्ञानेश्वर श्रद्धांजली विद्यार्थ्यांसाठी योजना जाहीर केली आहे. '.repeat(4),
};

test('composing in Node without the shaper is REFUSED, not silently approximated', async () => {
  const compose = await load('compose.js');
  const metrics = await load('font-metrics.js');
  await metrics.ensureFontsLoaded();

  assert.throws(
    () => compose.composeBlock(FRAME),
    /EXACT_SHAPER_NOT_READY/,
    'the hmtx fallback is never a legitimate state on the server - it must be a loud failure',
  );
});

test('and once the shaper is ready the same block composes, exactly', async () => {
  const compose = await load('compose.js');
  const shaper = await load('shaper.js');
  await shaper.ensureShaperReady();
  shaper.requireShaperReady();

  const result = compose.composeBlock(FRAME);
  assert.equal(result.exactShaping, true, 'this is the composition the browser and the press both use');
  assert.ok(result.bodyLines.length > 0, 'and it really sets the copy');
  assert.ok(!result.warnings.some((w) => w.code === 'SHAPING_NOT_EXACT'),
    'no approximation warning when the shaping is exact');
});

test('the two measurements really do disagree - this is what the refusal is protecting', async () => {
  const metrics = await load('font-metrics.js');
  const shaper = await load('shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);

  // Conjunct-heavy Marathi, measured both ways at the same size. The hmtx sum
  // is what compose.js falls back to; the shaped width is what prints.
  const word = 'ज्ञानेश्वर';
  const summed = metrics.measureWidth(word, 100, 'serif', 400);
  const shaped = shaper.shapeWidthPx(word, 100, 'serif', 400);
  assert.ok(summed > shaped * 1.3,
    `summing advances must visibly overstate a conjunct: ${summed} vs ${shaped}`);
});
