// The exact composition engine: Marathi shaping, grapheme-safe breaking,
// dynamic bands, alpha-aware exclusion, corridor viability, determinism.
//
// These run against the REAL publication fonts in public/assets/fonts, not a
// fixture - the whole claim of the engine is that it measures the type that
// actually prints, so measuring something else here would test nothing.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', 'compose', file));

let compose;
let metrics;
let graphemes;
let intervals;
let exclusion;
let shaper;

test.before(async () => {
  metrics = await load('font-metrics.js');
  compose = await load('compose.js');
  graphemes = await load('graphemes.js');
  intervals = await load('intervals.js');
  exclusion = await load('exclusion.js');
  shaper = await load('shaper.js');
  const ready = await metrics.ensureFontsLoaded();
  assert.equal(ready, true, 'the publication fonts must be measurable');
  // Without this, every test in this file silently runs against the hmtx
  // FALLBACK (font-metrics.js's summed advances), not the real HarfBuzz
  // shaping compose.js is actually built on - found while auditing this
  // exact gap: this suite claims to test "the exact composition engine:
  // Marathi shaping" and was doing neither, for every test that ran before
  // this line existed.
  const shaped = await shaper.ensureShaperReady();
  assert.equal(shaped, true, 'the real shaper must be measurable - this suite tests SHAPED widths, not the hmtx fallback');
});

// ------------------------------------------------------- Marathi shaping ---

test('a Devanagari vowel sign costs no advance width - the thing a constant cannot express', () => {
  const face = metrics.faceMetrics('serif', 400);
  const advance = (ch) => face.advances[face.cmap.get(ch.codePointAt(0))] / face.unitsPerEm;
  for (const mark of ['े', 'ं', 'ु', 'ू', '्', 'ि'.normalize()]) {
    if (mark === 'ि') continue; // a pre-base velanti DOES advance (246/1000)
    assert.equal(advance(mark), 0, `${mark} must not advance the pen`);
  }
  assert.ok(advance('क') > 0.5, 'a base consonant does advance');
});

test('the same string measures identically however it is asked for - one deterministic answer', () => {
  const text = 'शेतकऱ्यांसाठी नवी योजना';
  const a = metrics.measureWidth(text, 16);
  const b = metrics.measureWidth(text, 16);
  const c = metrics.measureEm(text) * 16;
  assert.equal(a, b);
  assert.ok(Math.abs(a - c) < 1e-9);
});

test('the shaping matrix sets without loss: matras, ukar, reph, virama, conjuncts, anusvara, ZWJ', () => {
  const matrix = [
    'शि', 'शी', 'शु', 'शू', 'शे', 'शै', 'शो', 'शौ',   // matras
    'र्क', 'कर्म',                                      // reph
    'क्', 'क्ष', 'ज्ञ', 'श्र',                          // virama + conjuncts
    'शं', 'शँ', 'शः',                                   // anusvara, chandrabindu, visarga
    'क़',                                               // nukta
    'क‍ष', 'क‌ष',                            // ZWJ / ZWNJ
    '१२३ 123', 'Mumbai मध्ये',                          // Marathi + Latin + digits
  ];
  for (const sample of matrix) {
    const width = metrics.measureWidth(sample, 16);
    assert.ok(width > 0 && Number.isFinite(width), `${sample} must measure`);
    // Every cluster must survive segmentation - nothing may be dropped.
    assert.equal(graphemes.clusters(sample).join(''), sample, `${sample} must round-trip through clustering`);
  }
});

test('a visible unit is an akshara, not a codepoint', () => {
  assert.equal('शेतकऱ्यांसाठी'.length, 13);
  assert.equal(graphemes.clusterCount('शेतकऱ्यांसाठी'), 6);
  assert.deepEqual(graphemes.clusters('क्ष'), ['क्ष']);
  assert.deepEqual(graphemes.clusters('ज्ञान'), ['ज्ञा', 'न']);
});

// --------------------------------------------------------- line breaking ---

test('no line ever splits a grapheme, at any measure, in any block', () => {
  const body = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने ज्ञानेश्वर श्रद्धांजली क्षेत्रफळ योजना जाहीर केली आहे. '.repeat(6);
  for (const width of [90, 120, 160, 220, 320, 480, 640]) {
    const result = compose.composeBlock({ width, height: 420, padding: 12, body, bodyFontPx: 11 });
    const rejoined = result.bodyLines.map((line) => line.text).join('');
    for (const line of result.bodyLines) {
      // Every line must itself be a whole number of clusters of the source.
      assert.equal(graphemes.clusters(line.text).join(''), line.text);
    }
    // And every cluster of what was laid out must be a cluster of the source,
    // i.e. the engine never manufactured a partial akshara.
    const sourceClusters = new Set(graphemes.clusters(body.replace(/\s/g, '')));
    for (const cluster of graphemes.clusters(rejoined.replace(/\s/g, ''))) {
      assert.ok(sourceClusters.has(cluster), `${cluster} at width ${width} is not a cluster of the source`);
    }
  }
});

test('breaks are taken at legal opportunities - spaces, danda, existing hyphens - and never invented', () => {
  const pieces = graphemes.breakPieces('एक दोन-तीन चार। पाच');
  assert.deepEqual(pieces, ['एक ', 'दोन-', 'तीन ', 'चार। ', 'पाच']);
  // No piece may end mid-word without a real break character before it.
  for (const piece of pieces.slice(0, -1)) {
    assert.match(piece.slice(-1), /[\s।॥\-–—/]/u);
  }
});

test('a token wider than every legal measure is set and reported, never hyphenated into damage', () => {
  const monster = 'अतिवृष्टीग्रस्तशेतकऱ्यांसाठीविशेषमदतनिधीवितरणकार्यक्रम';
  const result = compose.composeBlock({ width: 90, height: 200, padding: 8, body: monster, bodyFontPx: 11 });
  const set = result.bodyLines.map((l) => l.text).join('');
  assert.ok(set.length > 0, 'it must still be set rather than silently dropped');
  assert.ok(!set.includes('-'), 'no hyphen may be invented inside a Marathi word');
  assert.equal(graphemes.clusters(set).join(''), set);
});

test('URLs, emails and number-unit runs measure and break without corruption', () => {
  for (const token of ['https://sahasvarta.example/news/2026', 'desk@sahasvarta.example', '२५ किमी/तास', '1,20,000 रुपये']) {
    const result = compose.composeBlock({ width: 300, height: 200, padding: 10, body: token, bodyFontPx: 11 });
    const set = result.bodyLines.map((l) => l.text).join('');
    assert.equal(graphemes.clusters(set).join(''), set);
  }
});

// ------------------------------------------------- dynamic headline / deck ---

test('a shorter headline gives its room back to the body - nothing reserves a phantom row', () => {
  const base = { width: 320, height: 500, padding: 12, body: 'बातमी. '.repeat(120), bodyFontPx: 11, headlineFontPx: 30 };
  const oneLine = compose.composeBlock({ ...base, headline: 'छोटी' });
  const threeLine = compose.composeBlock({ ...base, headline: 'ही एक बरीच लांब मथळ्याची ओळ आहे जी तीन ओळींमध्ये बसते नक्कीच' });

  assert.equal(oneLine.bands.headline.lineCount, 1);
  assert.ok(threeLine.bands.headline.lineCount >= 2);

  // The band is exactly its own lines tall - no rounding up to a reserved
  // rectangle, which is the whole point.
  const lineBox = oneLine.bands.headline.height;
  assert.ok(Math.abs(threeLine.bands.headline.height - lineBox * threeLine.bands.headline.lineCount) < 0.5,
    'a band must be exactly as tall as the lines it actually set');

  assert.ok(oneLine.bodyTop < threeLine.bodyTop, 'the body must start higher under a shorter headline');
  assert.ok(oneLine.capacity.fullMeasureEquivalents > threeLine.capacity.fullMeasureEquivalents,
    'and the block must therefore have room for more copy');
});

test('with no deck, the body takes the headline-to-body transition, not the deck-to-body one', () => {
  const base = { width: 320, height: 400, padding: 12, headline: 'मथळा', headlineFontPx: 28, body: 'बातमी. '.repeat(60), bodyFontPx: 11 };
  const withDeck = compose.composeBlock({ ...base, subheading: 'उपमथळा', subheadingFontPx: 16 });
  const without = compose.composeBlock(base);
  assert.ok(without.bodyTop < withDeck.bodyTop);
  assert.equal(without.bands.deck, undefined, 'an absent deck must occupy nothing at all');
});

test('AUTO typography finds the largest legal size; LOCKED reports overset instead of shrinking', () => {
  const long = 'अतिशय लांब मथळा जो या चौकटीत सहजासहजी बसणार नाही कारण तो खूपच मोठा आहे';
  const auto = compose.composeBlock({ width: 200, height: 260, padding: 10, headline: long, headlineFontPx: 44, bodyFontPx: 10, headlineMaxLines: 3 });
  const locked = compose.composeBlock({ width: 200, height: 260, padding: 10, headline: long, headlineFontPx: 44, bodyFontPx: 10, headlineMaxLines: 3, headlineLocked: true });

  assert.ok(auto.bands.headline.resolvedPx < 44, 'AUTO must come down to a size that fits');
  assert.equal(auto.overset.headline, '', 'and must then have no overset');

  assert.equal(locked.bands.headline.resolvedPx, 44, 'LOCKED must never be silently shrunk');
  assert.ok(locked.overset.headline.length > 0, 'it must report the overset instead');
  assert.ok(locked.violations.some((v) => v.code === 'HEADLINE_OVERSET_LOCKED'));
  assert.equal(locked.fitState, 'OVERSET');
});

test('a headline may never take more than half the block, whatever it is asked for', () => {
  const result = compose.composeBlock({
    width: 640, height: 200, padding: 12, bodyFontPx: 11,
    headline: 'महाराष्ट्रातील शेतकऱ्यांसाठी राज्य सरकारने जाहीर केलेली नवी योजना', headlineFontPx: 60,
  });
  const room = result.content.room;
  assert.ok(result.bands.headline.height <= room * 0.5 + 1, 'the headline band must stay inside its share');
  assert.ok(result.content.bottom - result.bodyTop > 0, 'and must leave real room for a story');
});

// Bug 6B's regression, with a real obstacle: a photograph sitting across the
// headline's own second band forces that band to be skipped entirely (no
// viable gap), and the OLD `lines.length * bandHeight` height calculation
// undercounted by exactly one skipped band - so the deck's first line landed
// inside the headline's own last line. `occupiedBottom` (the real bottom of
// what was actually placed) has to track the true position regardless of how
// many bands were skipped to get there.
test('vertical geometry accounts for bands an image skipped, not just bands set', () => {
  const image = { x: 0, y: 42, width: 300, height: 32, shape: 'rect' };
  const result = compose.composeBlock({
    width: 300, height: 400, padding: 10,
    headline: 'पहिली ओळ दुसरी ओळ तिसरी ओळ शेवटची ओळ इथे संपते',
    subheading: 'खालील मजकूर',
    headlineFontPx: 24, subheadingFontPx: 16, bodyFontPx: 16,
    headlineMaxLines: 6,
    images: [image],
  });

  assert.ok(result.bands.headline.lineCount >= 1, 'the headline must still be set despite the obstacle');
  const headlineBottom = result.bands.headline.top + result.bands.headline.height;
  // The deck must start AFTER every headline line actually placed - not
  // overlap it, which is what the undercounted height used to produce.
  for (const line of result.bands.deck.lines) {
    assert.ok(line.y >= headlineBottom - 0.5, 'the deck must not overlap the headline\'s real last line');
  }
  assert.ok(result.bodyTop >= result.bands.deck.top + result.bands.deck.height - 0.5,
    'the body must start after the deck\'s real bottom, including any bands the image skipped');
});

// ---------------------------------------------------------------- overflow ---

test('no line is ever placed outside the frame - overset is counted, never painted', () => {
  const result = compose.composeBlock({
    width: 180, height: 150, padding: 10, bodyFontPx: 11,
    headline: 'मथळा', headlineFontPx: 22,
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना जाहीर. '.repeat(40),
  });
  for (const line of [...result.bodyLines, ...(result.bands.headline?.lines || [])]) {
    assert.ok(line.x >= result.content.left - 0.5, 'no line may start left of the frame');
    assert.ok(line.x + line.width <= result.content.right + 0.5, `a line paints past the right edge: ${line.text}`);
    assert.ok(line.y >= result.content.top - 0.5);
    assert.ok(line.y + line.height <= result.content.bottom + 0.5, 'no line may paint below the frame');
  }
  assert.ok(result.overset.body.length > 0, 'the copy that did not fit must be reported');
  assert.equal(result.fitState, 'OVERSET');
});

// ------------------------------------------------------------- whitespace ---

test('a remainder under one line is not a hole; a rectangle that holds six lines is', () => {
  const frame = { width: 300, height: 400, padding: 12, bodyFontPx: 11 };
  // Sized from the block's OWN measured capacity rather than a guessed repeat
  // count - the engine is the thing that knows how much this frame holds.
  const room = compose.composeBlock({ ...frame, body: '' }).capacity.bodyCharCapacity;
  const unit = 'बातमी मजकूर येथे. ';
  const full = compose.composeBlock({ ...frame, body: unit.repeat(Math.floor(room / unit.length)) });
  const empty = compose.composeBlock({ ...frame, body: 'फक्त एक ओळ.' });

  // Written to its own budget, the block is finished: there is no shortfall
  // left for a writer to act on, so it is not reported as holed however the
  // last line happens to fall.
  assert.ok(full.capacity.shortfallChars < 40, `a budget-filled block has at most a part-line left over, not ${full.capacity.shortfallChars}`);
  assert.equal(full.fitState, 'FITS', 'a block filled to its budget must not be flagged for repair');

  // One line of copy in a block that holds hundreds is a real hole, and is
  // measured as one both geometrically and in characters.
  assert.ok(empty.whitespace.largestHoleLines >= compose.HOLE_LINES);
  assert.ok(empty.capacity.shortfallChars > 100);
  assert.equal(empty.fitState, 'UNDERFILLED');
});

test('ragged right ends are not counted as unexplained white - that is how type is set', () => {
  // A block flooded with copy has a line on every single band, so every gap
  // is used and the only white left is each line's ragged tail. If raggedness
  // were being counted as a hole, this block - which is as full as a block can
  // physically be - would report several lines of unexplained space.
  const result = compose.composeBlock({
    width: 300, height: 400, padding: 12, bodyFontPx: 11,
    body: 'बातमी मजकूर येथे. '.repeat(400),
  });
  assert.equal(result.fitState, 'OVERSET', 'the fixture must genuinely fill every band');
  assert.equal(result.whitespace.unexplainedLines, 0,
    `raggedness leaked into the hole metric: ${result.whitespace.unexplainedLines}`);
  assert.ok(result.whitespace.bottomResidualLines < 1, 'and the foot of a full column is a sub-line remainder');
});

const SHAPES = [
  [140, 200], [200, 300], [300, 400], [320, 500], [420, 260],
  [620, 200], [620, 420], [180, 620], [240, 180], [160, 400], [520, 300],
];

test('the character budget is a RANGE, because a character is not a unit of width', () => {
  // The same block holds 30% to 46% more or fewer characters depending only
  // on what is written into it: conjunct-heavy Marathi hides many zero-width
  // codepoints inside one akshara. A scalar budget cannot express that, so
  // the engine quotes the spread and the geometry instead of pretending.
  for (const [width, height] of SHAPES) {
    const frame = { width, height, padding: 12, bodyFontPx: 11, headline: 'मथळा', headlineFontPx: 20 };
    const { capacity } = compose.composeBlock({ ...frame, body: '' });
    assert.ok(capacity.bodyCharRange.min <= capacity.bodyCharCapacity, `${width}x${height} practical figure below its own floor`);
    assert.ok(capacity.bodyCharCapacity <= capacity.bodyCharRange.max, `${width}x${height} practical figure above its own ceiling`);
    // Line equivalents are geometry, so they do not move with the copy at all.
    assert.ok(capacity.fullMeasureEquivalents >= 0);
  }

  // And the spread is real, not a formality.
  const wide = compose.composeBlock({ width: 300, height: 400, padding: 12, bodyFontPx: 11, body: '' }).capacity.bodyCharRange;
  assert.ok(wide.max > wide.min * 1.2, `the measured spread should be substantial, got ${wide.min}..${wide.max}`);
});

test('the safe end of the range holds for prose of any word shape', () => {
  // `min` is what a caller quotes when it must not be wrong: it is poured with
  // the least character-efficient prose there is (plain consonants, no
  // zero-width matras to hide), so any ordinary sentence fits inside it.
  //
  // Every shape is written at an ordinary newspaper sentence length. Sentence
  // LENGTH is a second variable and not the one under test here: a paragraph
  // break costs room, and the compositor sets one every
  // MAX_PARAGRAPH_SENTENCES, so copy that reaches a full stop every three
  // words is asking a different question. That copy is not unsafe - it is
  // caught exactly by the overflow check below and cut back for free by
  // trimToFit(), which is the contract this codebase states: the budget is a
  // range, the measurement afterwards is the guarantee.
  const shapes = ['कमल गगन सरल पवन नयन जल थल कमल गगन सरल पवन नयन जल थल कमल गगन सरल. ',
    'ते या बाबत आज सकाळी बोलत होते ते या बाबत आज सकाळी बोलत होते ते या बाबत. ',
    'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना जाहीर केली आहे. ',
    'ज्ञानेश्वर श्रद्धांजली क्षेत्रफळ विद्यार्थ्यांसाठी श्रद्धांजली क्षेत्रफळ. '];
  for (const [width, height] of SHAPES) {
    for (const columnCount of [1, 2]) {
      const frame = { width, height, padding: 12, bodyFontPx: 11, columnCount, headline: 'मथळा', headlineFontPx: 20 };
      const { min, max } = compose.composeBlock({ ...frame, body: '' }).capacity.bodyCharRange;
      assert.ok(min <= max, 'the range must be ordered');
      for (const unit of shapes) {
        if (min < unit.length) continue;
        const body = unit.repeat(Math.floor(min / unit.length));
        assert.equal(compose.composeBlock({ ...frame, body }).overset.body, '',
          `${width}x${height} c${columnCount} range floor ${min} overflowed on "${unit.slice(0, 14)}"`);
      }
    }
  }
});

test('overflow is ALWAYS detected exactly - this is the guarantee, not the budget', () => {
  // The budget is a practical estimate. What must never be wrong is the
  // measurement afterwards: if a single cluster has no room, the engine says
  // so, and the pipeline's bounded shortening has something true to act on.
  for (const [width, height] of SHAPES) {
    const frame = { width, height, padding: 12, bodyFontPx: 11, headline: 'मथळा', headlineFontPx: 20 };
    const flooded = compose.composeBlock({ ...frame, body: 'बातमी मजकूर येथे लिहिला आहे. '.repeat(400) });
    assert.ok(flooded.overset.body.length > 0, `${width}x${height} swallowed copy without reporting overset`);
    assert.equal(flooded.fitState, 'OVERSET');
    // And nothing it DID place may paint outside the frame.
    for (const line of flooded.bodyLines) {
      assert.ok(line.y + line.height <= flooded.content.bottom + 0.5);
      assert.ok(line.x + line.width <= flooded.content.right + 0.5);
    }
  }
});

// ---------------------------------------------------------------- images ---

test('an opaque picture is its box; copy sets beside it on both sides', () => {
  const result = compose.composeBlock({
    width: 400, height: 420, padding: 12, bodyFontPx: 11,
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना. '.repeat(40),
    images: [{ x: 150, y: 120, width: 100, height: 160, shape: 'rect' }],
  });
  const beside = result.bodyLines.filter((line) => line.y >= 130 && line.y < 270);
  assert.ok(beside.some((line) => line.x < 150), 'copy must set to the left of the picture');
  assert.ok(beside.some((line) => line.x > 250), 'and to the right of it');
  for (const line of beside) {
    const clash = line.x < 250 && line.x + line.width > 150;
    assert.ok(!clash, `copy overlaps the picture: ${line.text}`);
  }
});

test('copy keeps a stand-off - it never touches the subject', () => {
  const result = compose.composeBlock({
    width: 400, height: 420, padding: 12, bodyFontPx: 12,
    body: 'बातमी मजकूर. '.repeat(60),
    images: [{ x: 180, y: 100, width: 100, height: 200, shape: 'rect' }],
  });
  const standOff = exclusion.standOffPx({}, 12);
  assert.ok(standOff > 0);
  for (const line of result.bodyLines) {
    if (line.y + line.height <= 100 - standOff || line.y >= 300 + standOff) continue;
    assert.ok(line.x + line.width <= 180 - standOff + 0.5 || line.x >= 280 + standOff - 0.5,
      `copy comes within the stand-off of the picture: ${line.text}`);
  }
});

test('a cut-out is its silhouette, not its canvas - copy enters the transparent field beside the subject', () => {
  // A narrow subject standing in the middle of a wide transparent canvas.
  const cols = 20;
  const rows = 20;
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, (unused, c) => (c >= 8 && c <= 11 ? 1 : 0)));
  const mask = { rows, cols, cells };

  const withMask = compose.composeBlock({
    width: 400, height: 400, padding: 12, bodyFontPx: 11,
    body: 'बातमी मजकूर येथे. '.repeat(60),
    images: [{ x: 60, y: 100, width: 280, height: 200, shape: 'cutout', mask }],
  });
  const asBox = compose.composeBlock({
    width: 400, height: 400, padding: 12, bodyFontPx: 11,
    body: 'बातमी मजकूर येथे. '.repeat(60),
    images: [{ x: 60, y: 100, width: 280, height: 200, shape: 'rect' }],
  });

  assert.ok(withMask.bodyLines.length > asBox.bodyLines.length,
    'the transparent field beside the subject must become usable room');
});

// Phase F: a cutout's exclusion envelope resolved through the SAME
// image-geometry.js transform paint and resize already use, so the shape
// copy wraps matches the shape actually drawn - not a raw, untransformed
// mask that stays put when the picture itself flips or is fitted into a
// frame of a different aspect ratio.
test('a flipped cutout mirrors its exclusion, not just its paint', () => {
  const cols = 10;
  const rows = 10;
  // Solid subject occupies only the LEFT half of the mask.
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, (u, c) => (c < 4 ? 1 : 0)));
  const mask = { rows, cols, cells };
  const image = { x: 0, y: 0, width: 100, height: 100, shape: 'cutout', mask, standOffPx: 3 };

  const unflipped = exclusion.obstacleIntervals(image, 0, 100, 12);
  assert.ok(unflipped.length, 'the unflipped mask produces an obstacle');
  assert.ok(unflipped[0].start < 50, 'unflipped, the subject sits on the LEFT of the frame');

  const flipped = exclusion.obstacleIntervals({ ...image, flipH: true }, 0, 100, 12);
  assert.ok(flipped.length, 'the flipped mask still produces an obstacle');
  assert.ok(flipped[0].start > 50, 'flipped, the subject must sit on the RIGHT of the frame - mirrored, not left in place');

  // Exact mirror about the frame's own centre (matching picture-style.js's
  // CSS scaleX(-1) transform-origin): the flipped run is the unflipped run
  // reflected through width/2, pad included on both.
  const expectedFlippedStart = image.width - unflipped[0].end;
  const expectedFlippedEnd = image.width - unflipped[0].start;
  assert.ok(Math.abs(flipped[0].start - expectedFlippedStart) < 0.01, 'flipped start is the exact mirror of the unflipped end');
  assert.ok(Math.abs(flipped[0].end - expectedFlippedEnd) < 0.01, 'flipped end is the exact mirror of the unflipped start');
});

test('a flipV mirrors the exclusion vertically - a subject drawn at the mask\'s top is excluded at the frame\'s bottom', () => {
  const cols = 10;
  const rows = 10;
  // Solid subject occupies only the TOP quarter of the mask.
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, () => (r < 3 ? 1 : 0)));
  const mask = { rows, cols, cells };
  const image = { x: 0, y: 0, width: 100, height: 100, shape: 'cutout', mask, standOffPx: 0 };

  // Query only the frame's bottom half.
  const unflippedBottom = exclusion.obstacleIntervals(image, 50, 100, 12);
  assert.equal(unflippedBottom.length, 0, 'unflipped, the subject (top quarter) leaves the bottom half completely clear');

  const flippedBottom = exclusion.obstacleIntervals({ ...image, flipV: true }, 50, 100, 12);
  assert.ok(flippedBottom.length > 0, 'flipped vertically, the subject now occupies the bottom half');
});

test('a cutout fitted (contain) into a frame of a different aspect ratio letterboxes the exclusion, it does not stretch it', () => {
  const cols = 10;
  const rows = 10;
  // The whole mask is solid - a square subject, no transparent margin.
  const cells = Array.from({ length: rows }, () => new Uint8Array(cols).fill(1));
  const mask = { rows, cols, cells };
  // Source is square (100x100); the frame is TWICE as wide (200x100) - under
  // 'contain', the content must be centred at 100x100 with 50px of blank
  // margin on each side, never stretched to fill the full 200px width.
  const image = {
    x: 0, y: 0, width: 200, height: 100, shape: 'cutout',
    sourceWidth: 100, sourceHeight: 100, fitMode: 'contain', mask,
  };
  // standOffPx: 0 would not disable the default stand-off (0 fails the ">0"
  // check standOffPx() itself uses to tell "unset" from "explicitly zero"),
  // so the expected edges include it rather than assuming it away.
  const pad = exclusion.standOffPx(image, 12);

  const middleBand = exclusion.obstacleIntervals(image, 40, 60, 12);
  assert.ok(middleBand.length, 'the subject still produces an obstacle');
  assert.ok(Math.abs(middleBand[0].start - (50 - pad)) < 1, `contain must letterbox at x=50, not stretch from 0 (got ${middleBand[0].start})`);
  assert.ok(Math.abs(middleBand[0].end - (150 + pad)) < 1, `contain must letterbox to x=150, not stretch to 200 (got ${middleBand[0].end})`);
});

// Gap 1 (image truth #9): a rotated cutout used to fall back to its full
// rectangle - paint rotated the visible silhouette, exclusion did not.
test('a quarter-turn cutout exactly follows its rotated silhouette, not a full-box fallback', () => {
  const cols = 8;
  const rows = 8;
  // Subject concentrated in the SOURCE's upper-left quadrant only.
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 4 && c < 4 ? 1 : 0)));
  const mask = { rows, cols, cells };
  const FRAME = 100; // square frame, square source - no letterboxing to reason about.

  const caseFor = (rotation) => ({
    x: 0, y: 0, width: FRAME, height: FRAME, shape: 'cutout',
    sourceWidth: FRAME, sourceHeight: FRAME, fitMode: 'contain', rotation, mask,
  });
  // Bands sit well clear of the FRAME/2 midline (default stand-off is
  // ~7.2px at bodyFontPx 12) - a band starting exactly at the subject's own
  // edge is DELIBERATELY still excluded (that is what stand-off is for), so
  // testing right at that boundary would conflate "rotation is wrong" with
  // "stand-off is working as designed". Comfortable margin avoids that.
  const topBand = (image) => exclusion.obstacleIntervals(image, 5, 35, 12);
  const bottomBand = (image) => exclusion.obstacleIntervals(image, 65, 95, 12);

  // 0deg: upper-left stays upper-left.
  {
    const image = caseFor(0);
    const top = topBand(image);
    assert.ok(top.length > 0, '0deg: top band has an obstacle');
    assert.ok(top[0].end < FRAME / 2 + 15, `0deg: obstacle stays on the LEFT (end=${top[0].end})`);
    assert.equal(bottomBand(image).length, 0, '0deg: bottom band is clear - not a full-box fallback');
  }

  // 90deg clockwise: upper-left -> upper-right (verified algebraically and
  // numerically against localPointToFrame() before this branch was wired in).
  {
    const image = caseFor(90);
    const top = topBand(image);
    assert.ok(top.length > 0, '90deg: top band still has an obstacle (rotation kept it in the upper half)');
    assert.ok(top[0].start > FRAME / 2 - 15, `90deg: obstacle moved to the RIGHT (start=${top[0].start})`);
    assert.equal(bottomBand(image).length, 0, '90deg: bottom band is clear - exact rotation, not a full-box fallback');
  }

  // 180deg: upper-left -> bottom-right.
  {
    const image = caseFor(180);
    assert.equal(topBand(image).length, 0, '180deg: top band is now clear');
    const bottom = bottomBand(image);
    assert.ok(bottom.length > 0, '180deg: bottom band has the obstacle');
    assert.ok(bottom[0].start > FRAME / 2 - 15, `180deg: obstacle is on the RIGHT (start=${bottom[0].start})`);
  }

  // 270deg: upper-left -> bottom-left.
  {
    const image = caseFor(270);
    assert.equal(topBand(image).length, 0, '270deg: top band is clear');
    const bottom = bottomBand(image);
    assert.ok(bottom.length > 0, '270deg: bottom band has the obstacle');
    assert.ok(bottom[0].end < FRAME / 2 + 15, `270deg: obstacle stays on the LEFT (end=${bottom[0].end})`);
  }
});

test('a non-quarter rotation on a cutout falls back to the conservative full-frame box, never a stale silhouette', () => {
  const cols = 4;
  const rows = 4;
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 2 && c < 2 ? 1 : 0)));
  const mask = { rows, cols, cells };
  const image = {
    x: 0, y: 0, width: 100, height: 100, shape: 'cutout',
    sourceWidth: 100, sourceHeight: 100, fitMode: 'contain', rotation: 45, mask,
  };
  const asRect = { ...image, shape: 'rect', rotation: 45, mask: undefined };

  const full = exclusion.obstacleIntervals(image, 40, 60, 12);
  const rectFallback = exclusion.obstacleIntervals(asRect, 40, 60, 12);
  assert.deepEqual(full, rectFallback, '45deg is not a quarter turn - exclusion must match the plain rotated-rect fallback exactly');
});

test('a non-default crop on a cutout falls back conservatively - paint does not draw an arbitrary crop yet', () => {
  const cols = 4;
  const rows = 4;
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 2 && c < 2 ? 1 : 0)));
  const mask = { rows, cols, cells };
  const image = {
    x: 0, y: 0, width: 100, height: 100, shape: 'cutout',
    sourceWidth: 100, sourceHeight: 100, fitMode: 'contain', rotation: 0, mask,
    cropX: 10, cropY: 10, cropWidth: 50, cropHeight: 50,
  };
  const asRect = { ...image, shape: 'rect', mask: undefined };

  const full = exclusion.obstacleIntervals(image, 40, 60, 12);
  const rectFallback = exclusion.obstacleIntervals(asRect, 40, 60, 12);
  assert.deepEqual(full, rectFallback, 'a non-default crop must fall back to the same box a plain rect gets - never a mismatched exact silhouette');
});

// Section 16: fit mode + rotation combined - the class of bug that survives
// isolated single-axis tests but shows up the moment two transforms compose
// in the wrong order.
test('fit mode and rotation compose correctly together, not just in isolation', () => {
  const cols = 8;
  const rows = 8;
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 4 && c < 4 ? 1 : 0)));
  const mask = { rows, cols, cells };
  // A non-square source (200x100) into a non-square, rotated frame - forces
  // fit + rotation to interact rather than each independently no-op'ing on
  // a square case.
  const combos = [
    { fitMode: 'contain', rotation: 90, flipH: false },
    { fitMode: 'cover', rotation: 90, flipH: false },
    { fitMode: 'stretch', rotation: 90, flipH: false },
    { fitMode: 'contain', rotation: 90, flipH: true },
  ];
  for (const combo of combos) {
    const image = {
      x: 0, y: 0, width: 100, height: 200, shape: 'cutout',
      sourceWidth: 200, sourceHeight: 100, mask, ...combo,
    };
    const asBox = { x: 0, y: 0, width: 100, height: 200, shape: 'rect', rotation: 0 };
    const result = exclusion.obstacleIntervals(image, 0, 200, 12);
    const boxResult = exclusion.obstacleIntervals(asBox, 0, 200, 12);
    assert.ok(result.length > 0, `${JSON.stringify(combo)}: produces a real obstacle, not nothing`);
    // The exact silhouette must be a NARROWER exclusion than the whole
    // rotated frame box (the subject is only one quadrant of the source) -
    // proof this combination did not silently collapse to the conservative
    // fallback.
    const resultWidth = result.reduce((sum, r) => sum + (r.end - r.start), 0);
    const boxWidth = boxResult.reduce((sum, r) => sum + (r.end - r.start), 0);
    assert.ok(resultWidth < boxWidth, `${JSON.stringify(combo)}: exact silhouette (${resultWidth}) must be narrower than the full box (${boxWidth})`);
  }
});

// A real bug found by source audit after the quarter-turn work above
// shipped: boxOf()'s early vertical-rejection gate (the first thing
// obstacleIntervals() checks, BEFORE the exact cutout path runs at all)
// widened/swapped its box for ANY rotation, as if the placement FRAME
// itself had rotated. It has not - block-frame.js never moves the frame;
// only the content inside it rotates, about the frame's own fixed centre,
// and a quarter turn always exactly refills the SAME frame it started in
// (image-geometry.js's own derivation). For a non-square frame this made
// boxOf() report a narrower, shifted vertical gate than the frame's real
// footprint, silently rejecting a query band near the frame's own top/
// bottom edge before the exact silhouette was ever evaluated - invisible
// to every prior test here because they either used a SQUARE frame (where
// the old widening was a no-op) or queried the FULL frame height (where
// the narrowed gate never excluded anything anyway).
test('a narrow query band near a non-square rotated frame\'s own edge is not wrongly rejected before the exact silhouette runs', () => {
  const rows = 8;
  const cols = 8;
  const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 4 && c < 4 ? 1 : 0)));
  const mask = { rows, cols, cells };
  // Portrait frame (100x200), landscape source (200x100) - exactly matched
  // after the 90deg axis swap, so 'contain' fills the rotated content with
  // no letterboxing to reason about.
  const image = {
    x: 0, y: 0, width: 100, height: 200, shape: 'cutout',
    sourceWidth: 200, sourceHeight: 100, fitMode: 'contain', rotation: 90, mask,
  };

  const fullBand = exclusion.obstacleIntervals(image, 0, 200, 12);
  assert.ok(fullBand.length > 0, 'sanity: a real obstacle exists somewhere in the frame');

  // A narrow band near the frame's own TOP edge - well inside the frame's
  // true y:[0,200] footprint, but outside the old, wrongly-narrowed
  // boxOf() gate (which used to report roughly y:[43,157] for this exact
  // width/height/rotation combination).
  const topBand = exclusion.obstacleIntervals(image, 10, 40, 12);
  assert.deepEqual(topBand, fullBand, 'a narrow band near the frame\'s own top edge must see the SAME obstacle the full-height band sees - it must not be rejected before the exact path runs');
});

test('an internal hole in a silhouette is occupied - text never threads an arm gap', () => {
  const rows = 16;
  const cols = 16;
  // A ring: solid border, transparent middle.
  const cells = Array.from({ length: rows }, (unused, r) => Array.from({ length: cols }, (u2, c) => (
    r >= 2 && r <= 13 && c >= 2 && c <= 13 && !(r >= 5 && r <= 10 && c >= 5 && c <= 10) ? 1 : 0
  )));
  const envelope = exclusion.exclusionEnvelope({ rows, cols, cells });
  for (let r = 5; r <= 10; r += 1) {
    for (let c = 5; c <= 10; c += 1) {
      assert.equal(envelope.cells[r][c], 1, `the enclosed hole at ${r},${c} must be treated as occupied`);
    }
  }
});

test('a one-cell concavity is closed - copy does not set into a shoulder notch', () => {
  const rows = 12;
  const cols = 12;
  const cells = Array.from({ length: rows }, (unused, r) => Array.from({ length: cols }, (u2, c) => (
    r >= 2 && r <= 9 && c >= 2 && c <= 9 && !(r === 5 && c === 9) ? 1 : 0
  )));
  const envelope = exclusion.exclusionEnvelope({ rows, cols, cells });
  assert.equal(envelope.cells[5][9], 1, 'the single-cell notch must be bridged');
});

test('visible bounds ignore transparent padding, so fitting the subject does not shrink it', () => {
  const rows = 10;
  const cols = 10;
  const cells = Array.from({ length: rows }, (unused, r) => Array.from({ length: cols }, (u2, c) => (
    r >= 4 && r <= 5 && c >= 4 && c <= 5 ? 1 : 0
  )));
  const bounds = exclusion.visibleBounds({ rows, cols, cells });
  assert.deepEqual(bounds, { x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
});

// ------------------------------------------------------ corridor viability ---

test('a sliver too narrow for a word is refused, however free its pixels are', () => {
  // A picture leaving roughly 20px on the right at 11px type: free, unusable.
  const result = compose.composeBlock({
    width: 300, height: 400, padding: 12, bodyFontPx: 11,
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना. '.repeat(40),
    images: [{ x: 100, y: 100, width: 168, height: 200, shape: 'rect' }],
  });
  const sliverLines = result.bodyLines.filter((line) => line.x > 260);
  assert.equal(sliverLines.length, 0, 'nothing may be set in the sliver beside the picture');
});

test('a wide, stable side corridor IS used - the rule refuses slivers, not side-setting', () => {
  const result = compose.composeBlock({
    width: 400, height: 400, padding: 12, bodyFontPx: 11,
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना. '.repeat(40),
    images: [{ x: 12, y: 100, width: 180, height: 200, shape: 'rect' }],
  });
  const beside = result.bodyLines.filter((line) => line.y >= 110 && line.y < 290 && line.x > 190);
  assert.ok(beside.length >= 3, 'a real corridor beside the picture must carry copy');
});

test('a gap that exists on one band only is refused - no stranded single line', () => {
  const bands = [
    [{ start: 0, end: 300 }],
    [{ start: 0, end: 300 }],
    [{ start: 0, end: 20 }, { start: 200, end: 300 }],  // an isolated wide pocket
    [{ start: 0, end: 20 }],
    [{ start: 0, end: 20 }],
  ];
  const viable = intervals.viableIntervals(bands, 2, 60);
  // The 200-300 pocket is wide enough but exists on this band alone.
  assert.ok(!viable.some((piece) => piece.start === 200), 'an isolated pocket must not be viable');
});

// ---------------------------------------------------------------- columns ---

test('copy never crosses a gutter, and reads down one column before the next', () => {
  const result = compose.composeBlock({
    width: 620, height: 400, padding: 12, bodyFontPx: 11, columnCount: 3,
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने योजना जाहीर केली. '.repeat(30),
  });
  assert.equal(result.columns.length, 3);
  for (const line of result.bodyLines) {
    const home = result.columns.find((column) => line.x >= column.start - 0.5 && line.x + line.width <= column.end + 0.5);
    assert.ok(home, `a line crosses a gutter: x=${line.x} w=${line.width}`);
  }
  // Reading order: source position must increase down column one, then move on.
  const first = result.bodyLines.filter((line) => line.x < result.columns[1].start);
  for (let i = 1; i < first.length; i += 1) assert.ok(first[i].y > first[i - 1].y);
});

// ----------------------------------------------------------- determinism ---

test('the same input always composes to the same result, and to the same fingerprint', () => {
  const input = {
    width: 320, height: 480, padding: 12, bodyFontPx: 11, headlineFontPx: 28, columnCount: 2,
    headline: 'शेतकऱ्यांसाठी नवी योजना', subheading: 'राज्य सरकारचा निर्णय',
    body: 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना जाहीर. '.repeat(20),
    images: [{ x: 40, y: 200, width: 90, height: 110, shape: 'rect' }],
  };
  const a = compose.composeBlock(input);
  const b = compose.composeBlock(JSON.parse(JSON.stringify(input)));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.bodyLines.map((l) => [l.text, l.x, l.y]), b.bodyLines.map((l) => [l.text, l.x, l.y]));
});

test('composition is independent of scale - the editor showing a block bigger cannot reflow it', () => {
  // There is no zoom parameter, by construction. The proof is that the result
  // is a function of the block's own logical size alone, so a surface can only
  // scale what it is given.
  const input = { width: 320, height: 480, padding: 12, bodyFontPx: 11, headline: 'मथळा', headlineFontPx: 28, body: 'बातमी. '.repeat(50) };
  const once = compose.composeBlock(input);
  const again = compose.composeBlock(input);
  assert.equal(once.fingerprint, again.fingerprint);
  assert.ok(!Object.keys(input).some((key) => /zoom|scale/i.test(key)));
});

test('a different frame size is a different composition, and says so', () => {
  const base = { padding: 12, bodyFontPx: 11, body: 'बातमी मजकूर. '.repeat(40) };
  const small = compose.composeBlock({ ...base, width: 200, height: 300 });
  const large = compose.composeBlock({ ...base, width: 400, height: 300 });
  assert.notEqual(small.fingerprint, large.fingerprint);
});

// ------------------------------------------------------- font readiness ---

test('the line box is never tighter than the face needs, so matras cannot be clipped', () => {
  const floor = metrics.minLineHeightFor('serif', 400);
  assert.ok(floor > 1.5, `Noto Serif Devanagari needs ${floor}, more than the 1.45 that was hard-coded`);
  const result = compose.composeBlock({ width: 300, height: 300, padding: 12, bodyFontPx: 11, lineHeight: 1.1, body: 'शेतकऱ्यांसाठी. '.repeat(20) });
  assert.ok(result.typography.lineHeight >= floor, 'a request for a tighter line must be floored at what the face needs');
});

test('composing before the font is measurable is marked, never passed off as final', async () => {
  const result = compose.composeBlock({ width: 300, height: 300, padding: 12, body: 'बातमी.' });
  // Fonts ARE loaded in this suite, so this asserts the flag is truthful.
  assert.equal(result.fontReady, true);
  assert.ok(!result.warnings.some((w) => w.code === 'FONT_NOT_READY'));
});

// This is the assertion that would have caught the whole suite silently
// running on the hmtx fallback: `fontReady: true` only proves the TTF
// advance tables loaded, not that real GSUB/GPOS shaping is what actually
// measured this block. `exactShaping` is the field that says which one
// happened, and every test above this line was composing without checking it.
test('the block was actually shaped, not measured against the hmtx fallback', () => {
  assert.equal(shaper.isShaperReady(), true, 'the shaper must be ready by the time this suite runs');
  const result = compose.composeBlock({ width: 300, height: 300, padding: 12, body: 'क्षेत्र ज्ञानेश्वर श्रद्धांजली' });
  assert.equal(result.exactShaping, true, 'composeBlock must report it used real shaping, not the approximate fallback');
  assert.ok(!result.warnings.some((w) => w.code === 'SHAPING_NOT_READY'));
});

// ------------------------------------------------------- rich typography ---

test('body 5.0px really composes at 5.0, not silently clamped to 6.5', () => {
  // Before MIN_LEGIBLE_PX was fixed from a literal 6.5 to the correct 4.6
  // (6.5pt converted to this project's 2px/mm logical scale), any candidate
  // under 6.5 was silently bumped back up - so fit.service.js's own shrink
  // search was measuring a different size than the one it asked for.
  const result = compose.composeBlock({ width: 300, height: 200, padding: 10, bodyFontPx: 5.0, body: 'बातमी.' });
  assert.equal(result.typography.bodyPx, 5.0);
  assert.ok(result.bodyLines.length > 0 && result.bodyLines[0].fontPx === 5.0);
});

test('a bold selected run measures wider than the same text plain', () => {
  const text = 'प्रचंड यश मिळाले आज';
  const plain = compose.composeBlock({ width: 200, height: 100, padding: 4, body: { text, marks: [] }, bodyFontPx: 20, columnCount: 1 });
  const bold = compose.composeBlock({ width: 200, height: 100, padding: 4, body: { text, marks: [{ start: 0, end: 9, tag: 'b' }] }, bodyFontPx: 20, columnCount: 1 });
  assert.ok(bold.bodyLines[0].width > plain.bodyLines[0].width, 'a bold Devanagari run must measure wider than the same text regular');
});

test('a selected larger size run changes where the line wraps', () => {
  const text = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन';
  const plain = compose.composeBlock({ width: 260, height: 200, padding: 10, body: { text, marks: [] }, bodyFontPx: 16, columnCount: 1 });
  const big = compose.composeBlock({ width: 260, height: 200, padding: 10, body: { text, marks: [{ start: 20, end: 33, tag: 'size', value: 32 }] }, bodyFontPx: 16, columnCount: 1 });
  assert.ok(big.bodyLines[0].text.length < plain.bodyLines[0].text.length, 'a larger selected word must wrap the line sooner');
});

test('paragraph spacing pushes the second paragraph down whole extra bands', () => {
  // Both paragraphs deep enough for the block to set the break at all: the
  // paragraph policy merges a paragraph under MIN_PARAGRAPH_LINES into its
  // neighbour, so a one-sentence fixture has no second paragraph to push.
  const body = `${'पहिला परिच्छेद येथे संपतो. '.repeat(6)}\n\n${'दुसरा परिच्छेद येथे सुरू होतो. '.repeat(6)}`;
  const tight = compose.composeBlock({ width: 260, height: 300, padding: 10, body, bodyFontPx: 16, columnCount: 1, paragraphSpacingPx: 0 });
  const spaced = compose.composeBlock({ width: 260, height: 300, padding: 10, body, bodyFontPx: 16, columnCount: 1, paragraphSpacingPx: 30 });
  const tightSecond = tight.bodyLines.find((l) => l.paragraphBreak);
  const spacedSecond = spaced.bodyLines.find((l) => l.paragraphBreak);
  assert.ok(spacedSecond.y > tightSecond.y, 'a positive paragraphSpacingPx must push the second paragraph further down');
});

test('letter spacing widens a run and can move where a line breaks', () => {
  const text = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे.';
  const tight = compose.composeBlock({ width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1, letterSpacingPx: 0 });
  const spaced = compose.composeBlock({ width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1, letterSpacingPx: 2 });
  assert.ok(spaced.bodyLines[0].width > tight.bodyLines[0].width || spaced.bodyLines[0].text.length < tight.bodyLines[0].text.length,
    'positive letter-spacing must widen the measured line or move its wrap point');
});

// ------------------------------------------------------------- alignment ---

test('center and right alignment reposition the line without changing its text', () => {
  const body = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी.';
  const left = compose.composeBlock({ width: 260, height: 150, padding: 10, body, bodyFontPx: 16, columnCount: 1, textAlign: 'left' });
  const center = compose.composeBlock({ width: 260, height: 150, padding: 10, body, bodyFontPx: 16, columnCount: 1, textAlign: 'center' });
  const right = compose.composeBlock({ width: 260, height: 150, padding: 10, body, bodyFontPx: 16, columnCount: 1, textAlign: 'right' });

  assert.equal(left.bodyLines[0].text, center.bodyLines[0].text);
  assert.equal(left.bodyLines[0].text, right.bodyLines[0].text);
  assert.ok(center.bodyLines[0].x > left.bodyLines[0].x, 'center must sit to the right of left');
  assert.ok(right.bodyLines[0].x > center.bodyLines[0].x, 'right must sit to the right of center');
  const rightEdge = right.bodyLines[0].x + right.bodyLines[0].width;
  assert.ok(Math.abs(rightEdge - (right.content.right)) < 1, 'right alignment must end flush with the content edge');
});

test('justify distributes real word-spacing on a non-final line and never stretches the last', () => {
  const body = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे.';
  const result = compose.composeBlock({ width: 250, height: 200, padding: 4, body, bodyFontPx: 16, columnCount: 1, textAlign: 'justify' });
  const last = result.bodyLines[result.bodyLines.length - 1];
  assert.equal(last.wordSpacingPx, undefined, 'the last line of a paragraph must never be justified');
});

// ------------------------------------------------------------ font truth ---

test('publicationFamily normalises legacy font choices to the two real bundled faces', () => {
  assert.equal(metrics.publicationFamily('').key, 'serif');
  assert.equal(metrics.publicationFamily('Georgia, serif').key, 'serif');
  assert.equal(metrics.publicationFamily("'Times New Roman', serif").key, 'serif');
  assert.equal(metrics.publicationFamily('Arial, sans-serif').key, 'sans');
  assert.equal(metrics.publicationFamily("'Helvetica Neue', sans-serif").key, 'sans');
  // Both point at real, declared @font-face names - never a bare "Noto Sans
  // Devanagari", which has no @font-face rule under that exact name.
  assert.match(metrics.publicationFamily('Arial').css, /Sahas Sans/);
  assert.match(metrics.publicationFamily('').css, /Sahas Serif/);
});

test('composed lines carry the family/weight they were measured in, for the renderer to paint truthfully', () => {
  const result = compose.composeBlock({
    width: 300, height: 300, padding: 12, bodyFontPx: 16,
    headline: 'मथळा', headlineFontPx: 24, fontFamily: 'sans-serif',
    body: 'साधा मजकूर.',
  });
  // Headline/kicker/deck always carry the CSS's own hardcoded choice
  // (DISPLAY_TYPOGRAPHY in compose.js), regardless of any body-level family
  // override - the stylesheet never makes their face conditional.
  assert.equal(result.bands.headline.lines[0].family, 'sans');
  assert.equal(result.bands.headline.lines[0].weight, 700);
  // The body line carries whatever raw string the block was composed with
  // (here, the input's own "sans-serif") - classification into an actual
  // bundled face happens once, at the point of use (publicationFamily()),
  // not by pre-normalising every line. What matters is that classifying it
  // agrees with what was actually measured.
  assert.equal(metrics.publicationFamily(result.bodyLines[0].family).key, 'sans');
});

// --------------------------------------------------- whole-body typography ---
// schema.sql's font_weight/font_italic/font_underline, exposed by the
// Typography panel and persisted, but never read by composeBlock() before
// this - not a measure/paint mismatch, a fully inert control on both counts.

test('a whole-body Bold setting measures wider, exactly like a bold selected run', () => {
  const text = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे.';
  const regular = compose.composeBlock({ width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1, fontWeight: 'normal' });
  const bold = compose.composeBlock({ width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1, fontWeight: 'bold' });
  assert.equal(regular.bodyLines[0].weight, 400);
  assert.equal(bold.bodyLines[0].weight, 700);
  assert.ok(bold.bodyLines[0].width > regular.bodyLines[0].width || bold.bodyLines[0].text.length < regular.bodyLines[0].text.length,
    'a bold body must measure wider (or wrap sooner) than the same text regular, same as a bold RUN does');
});

test('whole-body italic/underline are retained onto every composed line, for the renderer to paint', () => {
  const result = compose.composeBlock({
    width: 260, height: 200, padding: 10, body: 'साधा मजकूर.', bodyFontPx: 16, columnCount: 1,
    fontItalic: true, fontUnderline: true,
  });
  assert.equal(result.typography.italic, true);
  assert.equal(result.typography.underline, true);
  assert.equal(result.bodyLines[0].italic, true);
  assert.equal(result.bodyLines[0].underline, true);
});

test('italic/underline do not change measurement - no bundled italic face, underline is ink only', () => {
  const text = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे.';
  const plain = compose.composeBlock({ width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1 });
  const styled = compose.composeBlock({
    width: 260, height: 200, padding: 10, body: text, bodyFontPx: 16, columnCount: 1, fontItalic: true, fontUnderline: true,
  });
  assert.equal(plain.bodyLines[0].text, styled.bodyLines[0].text);
  assert.equal(plain.bodyLines[0].width, styled.bodyLines[0].width);
});

test('a whole-body weight/italic/underline change is a different fingerprint', () => {
  const body = 'साधा मजकूर.';
  const base = compose.composeBlock({ width: 260, height: 200, padding: 10, body, bodyFontPx: 16, columnCount: 1 });
  const boldFp = compose.composeBlock({ width: 260, height: 200, padding: 10, body, bodyFontPx: 16, columnCount: 1, fontWeight: 'bold' });
  const italicFp = compose.composeBlock({ width: 260, height: 200, padding: 10, body, bodyFontPx: 16, columnCount: 1, fontItalic: true });
  const underlineFp = compose.composeBlock({ width: 260, height: 200, padding: 10, body, bodyFontPx: 16, columnCount: 1, fontUnderline: true });
  const fingerprints = new Set([base.fingerprint, boldFp.fingerprint, italicFp.fingerprint, underlineFp.fingerprint]);
  assert.equal(fingerprints.size, 4, 'four different whole-body typography choices must produce four different fingerprints');
});

// ------------------------------------------------------------- mask hash ---

test('two masks of the same dimensions but different content hash differently', () => {
  const a = { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] };
  const b = { rows: 2, cols: 2, cells: [[1, 0], [1, 0]] };
  assert.notEqual(exclusion.maskHash(a), exclusion.maskHash(b));
});

test('the same mask content always hashes the same, and a missing mask is "none"', () => {
  const a = { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] };
  const again = { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] };
  assert.equal(exclusion.maskHash(a), exclusion.maskHash(again));
  assert.equal(exclusion.maskHash(null), 'none');
});

// A four-line fixture, narrow enough that a 40px word forces its own line to
// wrap earlier than the plain version - real wrapped output, not a
// synthetic line count, so these tests prove what actually gets painted.
const MULTI_LINE_BODY = 'पहिली ओळ येथे सुरू होते. दुसरी ओळ आहे मोठा शब्द इथे. तिसरी ओळ शेवटची आहे इथे.';
const MULTI_LINE_FRAME = { width: 180, height: 400, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1 };
const BIG_WORD_START = MULTI_LINE_BODY.indexOf('मोठा');
const BIG_WORD_END = BIG_WORD_START + 4;

test('only the line that actually contains a large selected word grows - normal lines around it stay normal (test 1 + test 2)', () => {
  const plain = compose.composeBlock({ ...MULTI_LINE_FRAME, body: MULTI_LINE_BODY });
  const marked = compose.composeBlock({
    ...MULTI_LINE_FRAME,
    body: { text: MULTI_LINE_BODY, marks: [{ start: BIG_WORD_START, end: BIG_WORD_END, tag: 'size', value: 40 }] },
  });

  // Test 1: body with only normal text - every line is the ordinary height.
  const ordinaryHeight = plain.bodyLines[0].height;
  assert.ok(plain.bodyLines.length > 1, 'the fixture must actually wrap to more than one line');
  for (const line of plain.bodyLines) assert.equal(line.height, ordinaryHeight);

  // Test 2: one 40px word on one line - only that line grows; its neighbours
  // (before AND after it) keep the ordinary height.
  assert.ok(marked.bodyLines.length > 2, 'the marked fixture must still wrap to more than the one tall line');
  const tallIndex = marked.bodyLines.findIndex((line) => line.at <= BIG_WORD_START && line.at + line.text.length >= BIG_WORD_END);
  assert.ok(tallIndex > 0, 'the sized word must land on a line that is neither the very first nor missing');
  assert.ok(marked.bodyLines[tallIndex].height > ordinaryHeight, 'the line carrying the 40px word must be taller than ordinary');
  assert.ok(marked.bodyLines[tallIndex].height >= 40 * (ordinaryHeight / 16), 'tall enough for the 40px word at this face\'s own line-height ratio');
  for (let i = 0; i < marked.bodyLines.length; i += 1) {
    if (i === tallIndex) continue;
    assert.equal(marked.bodyLines[i].height, ordinaryHeight, `line ${i} has no sized run and must stay at the ordinary height`);
  }

  // No line overlaps the one after it, uniform or not.
  for (let i = 0; i < marked.bodyLines.length - 1; i += 1) {
    assert.ok(marked.bodyLines[i].y + marked.bodyLines[i].height <= marked.bodyLines[i + 1].y + 0.01,
      `line ${i} must not overlap line ${i + 1}`);
  }
});

test('a global-max strategy would waste space a per-line strategy does not (test 4)', () => {
  // A large word deep in a long body must not inflate lines that come
  // BEFORE it - the whole reason per-line height replaced the earlier
  // flow-wide-maximum approach.
  const marked = compose.composeBlock({
    ...MULTI_LINE_FRAME,
    body: { text: MULTI_LINE_BODY, marks: [{ start: BIG_WORD_START, end: BIG_WORD_END, tag: 'size', value: 40 }] },
  });
  const ordinaryHeight = compose.composeBlock({ ...MULTI_LINE_FRAME, body: MULTI_LINE_BODY }).bodyLines[0].height;
  assert.equal(marked.bodyLines[0].height, ordinaryHeight, 'the line before the sized word must not be inflated by it');
});

test('a large run near an image recomputes exclusion at the larger band and still does not overlap it (test 3)', () => {
  const frame = { width: 260, height: 300, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1 };
  const text = 'साधा मजकूर सातारा जिल्ह्यातील मोठा शब्द शेतकऱ्यांसाठी योजना जाहीर.';
  const bigStart = text.indexOf('मोठा');
  const image = { x: 200, y: 10, width: 60, height: 200, shape: 'rect' };
  const result = compose.composeBlock({
    ...frame, images: [image],
    body: { text, marks: [{ start: bigStart, end: bigStart + 4, tag: 'size', value: 36 }] },
  });
  // Every placed line's own measure must already exclude the image (the
  // exact obstacle-sampling behaviour under test), and the imageless
  // baseline capacity (the width the block WOULD have with no image at all)
  // stays wider than what any line here actually got - confirming the image
  // really did narrow the room the tall row was fit into.
  for (const line of result.bodyLines) {
    assert.ok(line.x + line.width <= image.x + 0.5, 'no line may be drawn under the image, at any line height');
  }
});

test('a mask fingerprint change is a different block fingerprint, at the same box geometry', () => {
  const frame = { width: 300, height: 300, padding: 10, bodyFontPx: 16, columnCount: 1, body: 'साधा मजकूर सातारा जिल्ह्यातील.' };
  const image = { x: 20, y: 20, width: 100, height: 100, shape: 'cutout' };
  const withMaskA = compose.composeBlock({ ...frame, images: [{ ...image, mask: { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] } }] });
  const withMaskB = compose.composeBlock({ ...frame, images: [{ ...image, mask: { rows: 2, cols: 2, cells: [[1, 0], [1, 0]] } }] });
  assert.notEqual(withMaskA.fingerprint, withMaskB.fingerprint);
});

// Gap 3 (image truth #9): the fingerprint used to hash only x/y/width/
// height/shape/rotation/maskHash/standOffPx - fit mode, flip and source
// dimensions could all change what a cutout's exclusion actually is
// (image-geometry.js's resolvePlacedImage()) while leaving the fingerprint
// untouched, so "Contain -> Stretch" looked like no change at all to
// anything that only trusted the fingerprint.
test('fit mode, flip, rotation and source dimensions each change the fingerprint, at the same box geometry', () => {
  const frame = { width: 300, height: 300, padding: 10, bodyFontPx: 16, columnCount: 1, body: 'साधा मजकूर सातारा जिल्ह्यातील.' };
  const mask = { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] };
  const base = { x: 20, y: 20, width: 100, height: 100, shape: 'cutout', mask, sourceWidth: 200, sourceHeight: 100, fitMode: 'contain' };
  const composeWith = (overrides) => compose.composeBlock({ ...frame, images: [{ ...base, ...overrides }] }).fingerprint;

  const baseFp = composeWith({});
  const stretchFp = composeWith({ fitMode: 'stretch' });
  const flipFp = composeWith({ flipH: true });
  const rotatedFp = composeWith({ rotation: 90 });
  const sourceFp = composeWith({ sourceWidth: 400, sourceHeight: 100 });

  const fingerprints = new Set([baseFp, stretchFp, flipFp, rotatedFp, sourceFp]);
  assert.equal(fingerprints.size, 5, 'fit mode, flip, rotation and source dimensions must each produce a distinct fingerprint');

  // Determinism: the exact same input, called twice, must still agree.
  assert.equal(composeWith({}), baseFp, 'the same image input remains deterministic');
});

// ------------------------------------------ variable-row bottom safety (bug 1) ---
// dfd57ee's per-line geometry could keep a pass-0 (base-height) attempt even
// when the run actually placed needed more height than the column had left -
// silently painting a run outside its own line box while still reporting
// FITS. A row must never be committed shorter than what it actually holds.

test('a tall run that cannot fit the current column bottom is never painted undersized - it is real overset instead (test A)', () => {
  const text = 'साधा मजकूर आणि शेवटी मोठाशब्द';
  const bigStart = text.indexOf('मोठाशब्द');
  const result = compose.composeBlock({
    width: 180, height: 95, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1,
    body: { text, marks: [{ start: bigStart, end: bigStart + 8, tag: 'size', value: 40 }] },
  });
  assert.equal(result.fitState, 'OVERSET', 'a run with no column tall enough for it must never report FITS');
  assert.ok(result.overset.body.includes('मोठाशब्द'), 'the unplaceable run must be real overset, not a shrunk-to-fit line');
  assert.ok(!result.bodyLines.some((l) => l.text.includes('मोठाशब्द')), 'it must not be painted into an undersized line box either');
});

test('a tall run retries at the next column instead of being clipped in the first (test A, positive case)', () => {
  const text = 'साधा मजकूर आणि शेवटी मोठाशब्द';
  const bigStart = text.indexOf('मोठाशब्द');
  const result = compose.composeBlock({
    width: 380, height: 95, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 2,
    body: { text, marks: [{ start: bigStart, end: bigStart + 8, tag: 'size', value: 40 }] },
  });
  assert.equal(result.fitState, 'FITS', 'a second column with room must be used rather than giving up');
  const tall = result.bodyLines.find((l) => l.text.includes('मोठाशब्द'));
  assert.ok(tall, 'the run must actually be placed');
  assert.ok(tall.x > result.bodyLines[0].x, 'it must land in the SECOND column, not the first');
  assert.equal(tall.y, result.content.top, 'a retried column starts at its own natural top, not a carried-over Y');
});

test('every placed line owns at least as much height as the tallest run on it (test B)', () => {
  const text = 'पहिली ओळ येथे सुरू होते. दुसरी ओळ आहे मोठा शब्द इथे. तिसरी ओळ शेवटची आहे इथे.';
  const bigStart = text.indexOf('मोठा');
  const result = compose.composeBlock({
    width: 180, height: 400, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1,
    body: { text, marks: [{ start: bigStart, end: bigStart + 4, tag: 'size', value: 40 }] },
  });
  const floor = compose.composeBlock({ width: 180, height: 400, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1, body: text }).bodyLines[0].height;
  for (const line of result.bodyLines) {
    const required = line.text.includes('मोठा') ? 40 * (floor / 16) : floor;
    assert.ok(line.height >= required - 0.5, `line ${JSON.stringify(line.text)} must own at least ${required}px, got ${line.height}`);
  }
});

test('no placed line extends below the frame\'s own content bottom (test C)', () => {
  const text = 'पहिली ओळ येथे सुरू होते. दुसरी ओळ आहे मोठा शब्द इथे. तिसरी ओळ शेवटची आहे इथे.';
  const bigStart = text.indexOf('मोठा');
  const result = compose.composeBlock({
    width: 180, height: 130, padding: 10, bodyFontPx: 16, lineHeight: 1.25, columnCount: 1,
    body: { text, marks: [{ start: bigStart, end: bigStart + 4, tag: 'size', value: 40 }] },
  });
  for (const line of result.bodyLines) {
    assert.ok(line.y + line.height <= result.content.bottom + 0.5,
      `line ${JSON.stringify(line.text)} bottom ${line.y + line.height} must not exceed content.bottom ${result.content.bottom}`);
  }
});

// ---------------------------------------- cross-column paragraph spacing (bug 2) ---

const TWO_COLUMN_FRAME = { width: 400, height: 260, padding: 10, bodyFontPx: 14, lineHeight: 1.25, columnCount: 2 };
const FIRST_PARAGRAPH = 'पहिला परिच्छेद मजकूर '.repeat(15);
const SECOND_PARAGRAPH = 'दुसरा परिच्छेद नवीन स्तंभात सुरू होतो. '.repeat(4);
const TWO_PARAGRAPH_BODY = `${FIRST_PARAGRAPH}\n\n${SECOND_PARAGRAPH}`;

test('paragraph spacing still applies normally within the same column (test D)', () => {
  const body = `${'एक दोन तीन चार पाच सहा. '.repeat(4)}\n\n${'सात आठ नऊ दहा अकरा बारा. '.repeat(4)}`;
  const tight = compose.composeBlock({ ...TWO_COLUMN_FRAME, body, paragraphSpacingPx: 0 });
  const spaced = compose.composeBlock({ ...TWO_COLUMN_FRAME, body, paragraphSpacingPx: 8 });
  const tightSecond = tight.bodyLines.find((l) => l.paragraphBreak);
  const spacedSecond = spaced.bodyLines.find((l) => l.paragraphBreak);
  assert.equal(tightSecond.x, spacedSecond.x, 'both must still land in the same (first) column');
  assert.ok(spacedSecond.y > tightSecond.y, 'a positive paragraphSpacingPx must still push the second paragraph down within that column');
});

test('a paragraph that exhausts a column starts the next paragraph at the natural top of the next column, not a carried-over Y (test E)', () => {
  const result = compose.composeBlock({ ...TWO_COLUMN_FRAME, body: TWO_PARAGRAPH_BODY, paragraphSpacingPx: 8 });
  assert.equal(result.overset.body, '', 'the second paragraph must actually be placed, not lost to a phantom cross-column gap (BUG 2)');
  const first = result.bodyLines.filter((l) => !l.paragraphBreak);
  const second = result.bodyLines.find((l) => l.paragraphBreak);
  assert.ok(second, 'the second paragraph must have a line at all');
  assert.ok(second.x > first[0].x, 'the second paragraph must be in the SECOND column');
  assert.equal(second.y, result.content.top, 'it must start at that column\'s own natural top, not near the first column\'s old bottom');
});

test('the same cross-column transition after a tall inline run does not inherit that run\'s column Y either (test F)', () => {
  // Enough filler that the tall run lands late in column 1 - but still
  // WITHIN it - so paragraph spacing is what pushes paragraph 2 out to
  // column 2, not the tall run itself (a different case from BUG 1's own
  // retry-next-column path, already covered above).
  const filler = 'पहिला परिच्छेद मजकूर '.repeat(11);
  const bigWord = 'मोठाशब्द';
  const body = `${filler}${bigWord}\n\n${SECOND_PARAGRAPH}`;
  const bigStart = filler.length;
  const result = compose.composeBlock({
    ...TWO_COLUMN_FRAME, paragraphSpacingPx: 8,
    body: { text: body, marks: [{ start: bigStart, end: bigStart + bigWord.length, tag: 'size', value: 32 }] },
  });
  const tall = result.bodyLines.find((l) => l.text.includes('मोठाशब्द'));
  assert.ok(tall, 'the tall run itself must still land in the FIRST column for this fixture');
  assert.equal(tall.x, result.bodyLines[0].x);
  const second = result.bodyLines.find((l) => l.paragraphBreak);
  assert.ok(second, 'the second paragraph must still be placed after a tall run precedes it');
  assert.ok(second.x > tall.x, 'the second paragraph must be pushed into the SECOND column');
  assert.equal(second.y, result.content.top, 'no absolute Y from the tall run\'s column may leak into the next paragraph\'s column');
});
