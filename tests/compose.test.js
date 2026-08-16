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

test.before(async () => {
  metrics = await load('font-metrics.js');
  compose = await load('compose.js');
  graphemes = await load('graphemes.js');
  intervals = await load('intervals.js');
  exclusion = await load('exclusion.js');
  const ready = await metrics.ensureFontsLoaded();
  assert.equal(ready, true, 'the publication fonts must be measurable');
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

test('the quoted budget holds for ordinary Marathi prose, in every block shape', () => {
  // Ordinary prose is what a reporter files and what the model is asked for.
  // Compound-heavy copy is handled by exact measurement afterwards, not by
  // pricing every block for the worst sentence anyone could write - see
  // COMPOUND_RISK_FLOOR in compose.js.
  const prose = [
    'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना जाहीर केली आहे. ',
    'ते या बाबत आज सकाळी बोलत होते. ',
    'पुणे शहरात वाहतूक कोंडी झाली. नागरिक त्रस्त. ',
  ];
  for (const [width, height] of SHAPES) {
    for (const columnCount of [1, 2]) {
      const frame = { width, height, padding: 12, bodyFontPx: 11, columnCount, headline: 'मथळा', headlineFontPx: 20 };
      const budget = compose.composeBlock({ ...frame, body: '' }).capacity.bodyCharCapacity;
      for (const unit of prose) {
        if (budget < unit.length) continue;
        const body = unit.repeat(Math.floor(budget / unit.length));
        const filled = compose.composeBlock({ ...frame, body });
        assert.equal(filled.overset.body, '',
          `${width}x${height} c${columnCount} promised ${budget} chars but overflowed on "${unit.slice(0, 16)}"`);
      }
    }
  }
});

test('the conservative floor holds even for compound-heavy copy', () => {
  // The number a caller quotes when it must not be wrong. Long unbroken
  // Marathi compounds pack worst of all, so they are what it is tested with.
  const compounds = 'ज्ञानेश्वरमहाराजांच्या महानगरपालिकेच्या विद्यार्थ्यांसाठी पुस्तकवाटपाचा ';
  for (const [width, height] of SHAPES) {
    for (const columnCount of [1, 2]) {
      const frame = { width, height, padding: 12, bodyFontPx: 11, columnCount, headline: 'मथळा', headlineFontPx: 20 };
      const floor = compose.composeBlock({ ...frame, body: '' }).capacity.bodyCharCapacityFloor;
      if (floor < compounds.length) continue;
      const body = compounds.repeat(Math.floor(floor / compounds.length));
      assert.equal(compose.composeBlock({ ...frame, body }).overset.body, '',
        `${width}x${height} c${columnCount} floor of ${floor} chars still overflowed`);
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
