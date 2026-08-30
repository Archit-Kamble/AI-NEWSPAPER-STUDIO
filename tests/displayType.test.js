// How the headline, the kicker and the deck are SET - the three things a desk
// reported about them in one sitting, and one file that holds all three.
//
//   1. "right side of headline a big gap"    - it did not fill its measure
//   2. "align-right/left ... does not apply
//       on that section, it applies on body" - the controls were aimed at the
//                                              wrong object
//   3. marking a word inside a headline      - the marks toolbar was Quill's,
//                                              and Quill owns only the body
//
// All three are properties of the ENGINE, not of the controls: whatever a
// button is wired to, a headline either fills its measure or it does not, and
// either obeys its own alignment or does not.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', 'compose', file));

let compose;
let metrics;
let shaper;

test.before(async () => {
  metrics = await load('font-metrics.js');
  compose = await load('compose.js');
  shaper = await load('shaper.js');
  assert.equal(await metrics.ensureFontsLoaded(), true, 'the publication fonts must be measurable');
  assert.equal(await shaper.ensureShaperReady(), true, 'the real shaper must be ready - these are SHAPED widths');
});

// The desk's own block: a 268x248 lead, whose headline set 85% and 52% of
// their measures at the size geometry.js chose for it.
const LEAD = {
  width: 268, height: 248, padding: 4,
  headlineFontPx: 24, subheadingFontPx: 13, bodyFontPx: 10, lineHeight: 1.45,
};

const fillOf = (band) => compose.headlineBandFit(band).fill;

test('a headline short of its measure auto-fits toward a fillable line shape', () => {
  // 81% of its measure on both lines at the size geometry.js chose for this
  // block: the shape of the desk's own complaint, on a block with no picture
  // in it so the fixture is about the type and nothing else.
  const headline = 'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू';
  const frame = { ...LEAD, width: 270 };
  const asked = compose.composeBlock({ ...frame, headline, headlineLocked: true });
  const set = compose.composeBlock({ ...frame, headline });

  assert.ok(fillOf(asked.bands.headline) < 0.95,
    `this fixture must start SHORT or it tests nothing (it filled ${(100 * fillOf(asked.bands.headline)).toFixed(0)}%)`);

  assert.ok(set.bands.headline.grew || set.bands.headline.shrunk, 'the engine must have adjusted it');
  // NOT the 95% bar. That is what the search AIMS at; four Marathi words of
  // these widths cannot reach it at any size, and headlineBandFit() now
  // charges every line rather than only the working ones, so the same
  // professional 97%/74% descending shape reads 0.74 here where it read 0.97
  // before. What is held is that the engine found a shape worth setting.
  assert.ok(fillOf(set.bands.headline) >= compose.HEADLINE_NEAR_FULL,
    `and it must reach a setting worth having - got ${(100 * fillOf(set.bands.headline)).toFixed(0)}%`);
  assert.ok(!compose.headlineBandFit(set.bands.headline).ascends,
    'and it must not strand its first line');

  // The search runs OUTWARD from the requested rung and keeps the first size
  // that passes, so the size half a pixel NEARER the rung must be worse. It
  // used to run downward only, which is why this used to read "the largest
  // size below the requested rung".
  const requested = frame.headlineFontPx;
  const resolved = set.bands.headline.resolvedPx;
  const nearer = resolved > requested ? resolved - 0.5 : resolved + 0.5;
  const nearerSet = compose.composeBlock({ ...frame, headline, headlineFontPx: nearer, headlineLocked: true });
  assert.ok(fillOf(nearerSet.bands.headline) < fillOf(set.bands.headline),
    `${nearer}px is nearer the rung than ${resolved}px and should have been kept if it were as good`);
});

test('headline working lines fill, the close is not a widow, and the deck stays one-line and subordinate', () => {
  const headline = 'सातारकरांच्या सुरक्षिततेसाठी खड्डेमुक्त रस्ते';
  const subheading = 'सुरक्षित प्रवास आणि नागरिकांचे आरोग्य जपण्याची गरज';
  const shapes = [
    { width: 307, height: 296, padding: 1, headlineFontPx: 28, subheadingFontPx: 15 },
    { width: 190, height: 264, padding: 1, headlineFontPx: 17, subheadingFontPx: 11 },
    { width: 150, height: 264, padding: 1, headlineFontPx: 14, subheadingFontPx: 11 },
  ];

  for (const frame of shapes) {
    const set = compose.composeBlock({
      ...frame, headline, subheading, bodyFontPx: 6.4, lineHeight: 1.45,
    });
    const quality = compose.headlineBandFit(set.bands.headline);
    const close = set.bands.headline.lines.at(-1);
    const closeWords = close.text.trim().split(/\s+/u).length;

    // Not a fill bar. This headline is four long Marathi words and on a narrow
    // measure they simply will not divide into two full lines at any size -
    // what matters is the SHAPE the engine settles on. Held instead: the lines
    // descend (no stranded first line), and the close is not a widow.
    assert.ok(!quality.ascends,
      `${frame.width}px headline strands its first line: ${quality.fills.map((f) => Math.round(100 * f)).join('/')}`);
    assert.ok(set.bands.headline.lineCount === 1 || closeWords >= 2,
      `${frame.width}px headline must not close on one word`);
    assert.equal(set.bands.deck.lineCount, 1, `${frame.width}px deck is a subordinate one-line flow`);
    // The deck stays subordinate OR sits on its own legibility floor - which
    // is what the engine does (`Math.max(flow.min, ...)`). On the 150px block
    // the headline resolves to 9px, and 65% of that is below the smallest type
    // this paper sets; the floor wins, and it must.
    assert.ok(
      set.bands.deck.resolvedPx <= set.bands.headline.resolvedPx * 0.65 + 0.05
      || set.bands.deck.resolvedPx <= Math.max(compose.MIN_LEGIBLE_PX, 6.4) + 0.05,
      `${frame.width}px deck must stay below the headline's rung unless it is already at its own floor`,
    );
    assert.equal(set.overset.headline, '');
    assert.equal(set.overset.deck, '');
  }
});

test('a full-width one-word close still fails the shared headline gate', () => {
  const quality = compose.headlineBandFit({
    lines: [
      { text: 'पहिली कार्यरत ओळ', width: 96, measure: 100 },
      { text: 'दीर्घशब्द', width: 98, measure: 100 },
    ],
  });

  assert.equal(quality.closeAcceptable, false);
  assert.equal(quality.fill, 0,
    'proposal acceptance must not mistake one wide closing word for a professional headline');
});

test('each transition uses the resolved line BELOW it, baseline to baseline', () => {
  const result = compose.composeBlock({
    width: 240, height: 420, padding: 1,
    headline: 'सातारकरांच्या सुरक्षिततेसाठी खड्डेमुक्त रस्ते',
    subheading: 'नागरिकांच्या सुरक्षिततेसाठी प्रशासनाने तातडीच्या उपाययोजना करण्याची आवश्यकता',
    body: 'सातारा शहरातील नागरिकांनी रस्त्यांची दुरुस्ती करण्याची मागणी केली आहे. '.repeat(12),
    headlineFontPx: 28, subheadingFontPx: 15, bodyFontPx: 6.4, lineHeight: 1.45,
  });
  const headline = result.bands.headline;
  const deck = result.bands.deck;
  const headlineLast = headline.lines.at(-1);
  const deckFirst = deck.lines[0];
  const deckLast = deck.lines.at(-1);
  const bodyFirst = result.bodyLines[0];
  const displayLeading = Math.max(1.1, result.typography.lineHeight - 0.15);

  assert.ok(deck.resolvedPx < Math.min(15, headline.resolvedPx * 0.65) - 0.5,
    'fixture: the one-line deck must resolve below both its request and hierarchy cap');

  const headlineToDeck = Math.max(
    1.35 * deck.resolvedPx * displayLeading,
    headlineLast.fontPx * metrics.faceDescent('sans', 700)
      + deckFirst.fontPx * metrics.faceAscent('sans', 400),
  );
  assert.ok(Math.abs((deckFirst.baseline - headlineLast.baseline) - headlineToDeck) < 0.02,
    'headline→deck spacing must use the resolved deck line, never its larger requested size');

  const deckToBody = Math.max(
    1.50 * result.typography.bodyPx * result.typography.lineHeight,
    deckLast.fontPx * metrics.faceDescent('sans', 400)
      + result.typography.bodyPx * metrics.faceAscent('serif', 400),
  );
  assert.ok(Math.abs((bodyFirst.baseline - deckLast.baseline) - deckToBody) < 0.02,
    'deck→body spacing must be the body line below, not the deck box above');
});

test('Devanagari lines keep a steady safe baseline through matras and velantis', () => {
  const result = compose.composeBlock({
    width: 230, height: 360, padding: 1, bodyFontPx: 8, lineHeight: 1,
    headline: 'शिक्षिकेने विद्यार्थिनींसाठी ज्ञानेश्वरीचे वाचन केले',
    headlineFontPx: 18,
    body: 'शिक्षिकेने विद्यार्थिनींसाठी ज्ञानेश्वरीचे वाचन केले. क्षेत्रातील शेतकऱ्यांनी पिकांची माहिती दिली. '.repeat(6),
  });

  assert.ok(result.typography.lineHeight >= metrics.minLineHeightFor('serif', 400),
    'the body leading must clear the publication face design box, including upper/lower vowel signs');
  for (let i = 1; i < result.bodyLines.length; i += 1) {
    if (Math.abs(result.bodyLines[i].x - result.bodyLines[i - 1].x) > 0.1) continue;
    assert.ok(result.bodyLines[i].baseline - result.bodyLines[i - 1].baseline
      >= result.typography.bodyPx * metrics.minLineHeightFor('serif', 400) - 0.02,
    'a matra-heavy lower line must never collide with the line above');
  }
});

test('a headline whose words cannot fill the measure is left at the size the design gave it', () => {
  // One short word across a full-width block. No legible size fills 296px of
  // measure with it, and inflating it a quarter to go from a fifth of the
  // measure to a quarter buys a bigger headline and a shorter story.
  const wide = { width: 320, height: 500, padding: 12, headlineFontPx: 30, bodyFontPx: 11 };
  const set = compose.composeBlock({ ...wide, headline: 'छोटी', body: 'बातमी. '.repeat(120) });
  assert.equal(set.bands.headline.grew, false, 'nothing to gain, so nothing is spent');
  assert.equal(set.bands.headline.resolvedPx, 30);
});

test('growth is capped, so a small block cannot out-shout a big one', () => {
  const headline = 'सातारा जिल्ह्यात नवा प्रकल्प';
  const set = compose.composeBlock({ ...LEAD, headline });
  assert.ok(set.bands.headline.resolvedPx <= LEAD.headlineFontPx * 1.25 + 0.001,
    `a headline may not grow past a quarter - got ${set.bands.headline.resolvedPx} from ${LEAD.headlineFontPx}`);
});

test('filling the headline never costs a word', () => {
  const headline = 'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू';
  const sentence = 'गावातील नागरिकांनी या उपक्रमात उत्स्फूर्त सहभाग घेतला आहे. ';
  const frame = { ...LEAD, height: 204, headline };

  // Room to spare: the headline takes the extra depth and fills its measure.
  const roomy = compose.composeBlock({ ...frame, body: sentence.repeat(4) });
  assert.ok(roomy.bands.headline.grew || roomy.bands.headline.shrunk);
  assert.ok(fillOf(roomy.bands.headline) >= compose.HEADLINE_NEAR_FULL,
    'when the hierarchy cap makes 95% unreachable, the best near-full legal setting is retained');
  assert.equal(roomy.overset.body, '', 'and the copy still fits');

  // The same block filled to its foot - the longest body it can carry at the
  // size the design asked for. The depth the growth wanted is now somebody's
  // last line, so the headline gives it back rather than pushing a word off
  // the page, and the block still sets everything it was given.
  const source = sentence.repeat(20);
  let fits = 0;
  for (let length = source.length; length > 0; length -= 1) {
    if (!compose.composeBlock({ ...frame, body: source.slice(0, length), headlineGrowth: false }).overset.body) {
      fits = length;
      break;
    }
  }
  assert.ok(fits > 0, 'the fixture must hold some copy');

  const full = compose.composeBlock({ ...frame, body: source.slice(0, fits) });
  assert.equal(full.overset.body, '', 'no copy pushed off the block');
  assert.notEqual(full.fitState, 'OVERSET');

  // If reaching the measure would cost copy, the headline yields and the
  // choice is reported to the desk rather than silently losing a sentence.
  if (fillOf(full.bands.headline) < 0.95) {
    const told = full.warnings.find((w) => w.code === 'HEADLINE_COULD_FILL');
    assert.ok(told, 'a denied fill must be reported');
  }
});

// ------------------------------------------------------------- alignment ---

test('display type obeys its OWN alignment, not the body\'s', () => {
  const base = { ...LEAD, headline: 'शाळकरी मुलांचे वृक्षारोपण', subheading: 'पुढील आठवड्यात अंमलबजावणी', headlineLocked: true };

  const left = compose.composeBlock({ ...base, headlineAlign: 'left' });
  const right = compose.composeBlock({ ...base, headlineAlign: 'right' });
  const centre = compose.composeBlock({ ...base, headlineAlign: 'center' });

  const firstOf = (r) => r.bands.headline.lines[0];
  assert.ok(right.bands.headline.lines.length, 'the fixture must actually set a headline');

  assert.ok(firstOf(right).x > firstOf(left).x, 'flush right must move the line right');
  assert.ok(firstOf(centre).x > firstOf(left).x && firstOf(centre).x < firstOf(right).x,
    'centred must sit between the two');
  // The line's right edge lands on the measure's right edge, to the pixel.
  assert.ok(Math.abs((firstOf(right).x + firstOf(right).width) - (firstOf(left).x + firstOf(left).measure)) < 0.5,
    'a flush-right line ends exactly at its measure');

  // And the words did not move between lines - alignment places a line, it
  // never re-breaks one.
  assert.deepEqual(right.bands.headline.lines.map((l) => l.text), left.bands.headline.lines.map((l) => l.text));
});

test('the headline can be centred while the body stays justified', () => {
  const set = compose.composeBlock({
    ...LEAD, headline: 'शाळकरी मुलांचे वृक्षारोपण', headlineAlign: 'center',
    textAlign: 'justify', body: 'गावातील नागरिकांनी या उपक्रमात सहभाग घेतला. '.repeat(6),
  });
  const flush = compose.composeBlock({
    ...LEAD, headline: 'शाळकरी मुलांचे वृक्षारोपण', headlineAlign: 'left',
    textAlign: 'justify', body: 'गावातील नागरिकांनी या उपक्रमात सहभाग घेतला. '.repeat(6),
  });
  assert.ok(set.bands.headline.lines[0].x > flush.bands.headline.lines[0].x, 'the headline moved');
  assert.deepEqual(
    set.bodyLines.map((line) => Number(line.x.toFixed(2))),
    flush.bodyLines.map((line) => Number(line.x.toFixed(2))),
    'and the copy did not - one object per alignment field',
  );
});

test('a justified headline stretches every line but its last', () => {
  const base = { ...LEAD, headline: 'शाळकरी मुलांचे मोठे वृक्षारोपण अभियान', headlineLocked: true };
  const set = compose.composeBlock({ ...base, headlineAlign: 'justify' });
  const lines = set.bands.headline.lines;
  assert.ok(lines.length > 1, 'the fixture must wrap, or there is no interior line to justify');
  assert.ok(lines.slice(0, -1).some((line) => Number.isFinite(line.wordSpacingPx) || Number.isFinite(line.glyphScaleX)),
    'an interior line must have been opened out');
  const last = lines[lines.length - 1];
  assert.equal(Number.isFinite(last.wordSpacingPx), false, 'the last line of a headline is never stretched');
});

test('the kicker follows the headline - it is the headline\'s own overline', () => {
  const set = compose.composeBlock({
    ...LEAD, kicker: 'पर्यावरण', headline: 'शाळकरी मुलांचे वृक्षारोपण', headlineAlign: 'right', headlineLocked: true,
  });
  const flush = compose.composeBlock({
    ...LEAD, kicker: 'पर्यावरण', headline: 'शाळकरी मुलांचे वृक्षारोपण', headlineAlign: 'left', headlineLocked: true,
  });
  assert.ok(set.bands.kicker.lines[0].x > flush.bands.kicker.lines[0].x);
});

// ----------------------------------------------------------------- marks ---

test('a display line knows where it starts, so a mark can be put back on it', () => {
  const headline = 'शाळकरी मुलांचे मोठे वृक्षारोपण अभियान';
  const set = compose.composeBlock({ ...LEAD, headline, headlineLocked: true });
  const lines = set.bands.headline.lines;
  assert.ok(lines.length > 1, 'the fixture must wrap');
  for (const line of lines) {
    assert.equal(typeof line.at, 'number');
    assert.equal(headline.slice(line.at, line.at + line.text.length), line.text,
      'line.at must be the line\'s real offset in the flow');
  }
  assert.equal(lines[0].at, 0);
});

test('a bold word inside a headline is measured bold, not as its regular ghost', () => {
  const text = 'शाळकरी मुलांचे वृक्षारोपण';
  const plain = compose.composeBlock({ ...LEAD, headline: text, headlineLocked: true });
  const bold = compose.composeBlock({
    ...LEAD, headlineLocked: true,
    headline: { text, marks: [{ tag: 'b', start: 0, end: 7 }] },
  });
  // The headline face is already 700, so a <b> inside it cannot get any
  // heavier - what must hold is that the mark travels with the band and is
  // available to every renderer, rather than being flattened at the door.
  assert.deepEqual(bold.bands.headline.marks, [{ tag: 'b', start: 0, end: 7 }]);
  assert.deepEqual(plain.bands.headline.marks, []);
  assert.deepEqual(
    bold.bands.headline.lines.map((l) => l.text),
    plain.bands.headline.lines.map((l) => l.text),
    'a mark is presentation - it must not change where the line breaks fall',
  );
});

test('a selected-size mark in a deck really does change what fits', () => {
  const text = 'पुढील आठवड्यात अंमलबजावणी होणार';
  const plain = compose.composeBlock({ ...LEAD, subheading: text, subheadingLocked: true });
  const sized = compose.composeBlock({
    ...LEAD, subheadingLocked: true,
    subheading: { text, marks: [{ tag: 'size', start: 0, end: 5, value: 40 }] },
  });
  assert.ok(sized.bands.deck.lines[0].width > plain.bands.deck.lines[0].width,
    'a word set at 40px is wider than the same word at the deck\'s own size');
});

// --- a headline too short for its measure must SAY so ---------------------
//
// HEADLINE_COULD_FILL only ever fired when a bigger size WOULD have filled the
// measure and was withheld because the copy was already at the foot. The
// ordinary short headline - too few words to fill at any legible size, which
// is the commonest case by far - reported nothing at all. Measured across a
// properly filled fixture edition: eight headlines under the 95% bar, setting
// at 58-75% of their own measure, seven of them silent. A one-line headline
// two-fifths short of its column is the single most obvious thing that makes a
// made-up page read as a mock-up, and a sub-editor who is never told cannot
// write the three words that would fix it.
test('a headline that cannot fill its measure reports how short it is', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const { composeSection } = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  const section = { section_key: 'short-head', width_px: 307, height_px: 264, block_type: 'article', images: [] };
  const view = {
    headline: 'नवीन नोंदणी',
    subheading: 'तपशील लवकरच',
    body: 'सातारा : जिल्हा प्रशासनाने नवीन नोंदणी प्रक्रिया सुरू केली आहे. नागरिकांना ऑनलाइन अर्ज करता येणार आहे.',
    headlineFontPx: 23, subheadingFontPx: 14, bodyFontPx: 12, lineHeight: 1.45, marginPx: 1,
  };

  const composed = composeSection(section, view);
  const warning = (composed.warnings || []).find((w) => w.code === 'HEADLINE_SHORT_OF_MEASURE');
  assert.ok(warning, 'a headline well short of its measure is reported');
  assert.match(warning.detail, /fills \d+% of its column/);
  assert.match(warning.detail, /more characters would fill it/);
  // Growing the type is deliberately NOT offered as the remedy: a short
  // headline blown up is still short, and it costs the story a line.
  assert.match(warning.detail, /No size change can repair this/);
});

test('a headline that already fills its measure is not nagged about', async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  const { composeSection } = await import('../public/editor/compose/section-adapter.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);

  const section = { section_key: 'full-head', width_px: 307, height_px: 264, block_type: 'article', images: [] };
  const view = {
    subheading: 'तपशील लवकरच',
    body: 'सातारा : जिल्हा प्रशासनाने नवीन नोंदणी प्रक्रिया सुरू केली आहे.',
    headlineFontPx: 23, subheadingFontPx: 14, bodyFontPx: 12, lineHeight: 1.45, marginPx: 1,
  };
  const codesFor = (headline) => (composeSection(section, { ...view, headline }).warnings || []).map((w) => w.code);

  // A headline that reaches its measure is left alone.
  assert.ok(!codesFor('साताऱ्यात नवी नोंदणी प्रक्रिया सुरू').includes('HEADLINE_SHORT_OF_MEASURE'),
    'a headline that fills its column must not be nagged about');

  // And one that genuinely does not IS told, with the number. Both directions,
  // because the fixture this test used to carry stopped filling when
  // headlineBandFit() began charging the closing line - it sets 96%/77%, which
  // is a good headline and still not a full one, and a test that only checked
  // the quiet case could not tell the difference.
  assert.ok(codesFor('घनकचऱ्यावर चर्चा').includes('HEADLINE_SHORT_OF_MEASURE'),
    'a headline that leaves half its column empty must be reported');
});

// ------------------------------------------------- balanced display lines ---
//
// The desk's report: "most of them are 2 lines, 1 line is full but second line
// is 20% filled only having a lot of blank space - it should 1 line full or 2
// lines full". Measured on their own front page and it was every block, not
// some: 97/42, 97/42, 97/41, 97/43.

test('a two-line headline breaks EVENLY, not greedily', () => {
  // Four words that cannot make two full lines at any size - so the question
  // is only how the shortfall is shared out. Greedy filling puts all of it on
  // the last line; a compositor spreads it.
  const headline = 'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू';
  const set = compose.composeBlock({ ...LEAD, width: 270, headline });
  const band = compose.headlineBandFit(set.bands.headline);
  if (set.bands.headline.lines.length < 2) return; // it filled one line, which is the other good answer

  const spread = Math.max(...band.fills) - Math.min(...band.fills);
  assert.ok(spread <= 0.35,
    `the lines must be within a third of each other, got ${band.fills.map((f) => Math.round(100 * f)).join('/')}`);
});

test('a band whose lines ASCEND is refused - a stranded first line is worse than a short close', () => {
  // Scored directly: no size search, no fixture that has to reproduce the
  // shape. 49%/100% is the case headlineBandFit()'s own header names, and
  // neither a max, a working-line minimum nor a whole-band minimum can see it.
  const ascending = compose.headlineBandFit({
    lines: [{ width: 49, measure: 100, text: 'सातारकरांच्या' }, { width: 100, measure: 100, text: 'सुरक्षिततेसाठी खड्डेमुक्त रस्ते' }],
  });
  assert.equal(ascending.ascends, true);
  assert.equal(ascending.fill, 0, 'an ascending band must fail the same gate every caller already uses');

  // The professional descending shape it should lose to still passes.
  const descending = compose.headlineBandFit({
    lines: [{ width: 98, measure: 100, text: 'सातारकरांच्या सुरक्षिततेसाठी' }, { width: 45, measure: 100, text: 'खड्डेमुक्त रस्ते' }],
  });
  assert.equal(descending.ascends, false);
  assert.ok(descending.fill > 0);

  // And an evenly broken band is not condemned for wobbling a point or two.
  const even = compose.headlineBandFit({
    lines: [{ width: 77, measure: 100, text: 'एक दोन' }, { width: 79, measure: 100, text: 'तीन चार' }],
  });
  assert.equal(even.ascends, false, 'a balanced band wobbles either way and must stay legal');
});

test('a badly short band may leave the hierarchy range, but only for a FULL line', () => {
  // The shrink bound protects the page's hierarchy against chasing points. It
  // must not also trap a block whose only good answer is outside it: measured
  // on the desk's own page, a 17px brief set 64%/68% inside the range and 99%
  // on one line at 12.6px, and the bound was keeping the worse of the two.
  const headline = 'नगरपालिकेची स्वच्छता मोहीम राबवण्यात आली';
  const frame = { width: 111, height: 160, padding: 1, headlineFontPx: 17, subheadingFontPx: 11, bodyFontPx: 6.4, lineHeight: 1.45 };
  const set = compose.composeBlock({ ...frame, headline });
  const band = compose.headlineBandFit(set.bands.headline);

  assert.ok(band.fill >= compose.HEADLINE_NEAR_FULL || set.bands.headline.lines.length === 1,
    `a block left below the near-full bar must at least have been given a full single line, got `
    + `${band.fills.map((f) => Math.round(100 * f)).join('/')} at ${set.bands.headline.resolvedPx}px`);
  assert.equal(set.overset.headline, '', 'and never at the cost of a word');
});

test('a resolved display size is a real size, not a float accumulation', () => {
  // The search steps outward by adding 0.5 to a distance, so a base of 14
  // reached 8.700000000000001 - which is what the band reported, what a
  // read-out printed, and what any test comparing sizes had to match.
  // headline_font_px is NUMERIC(5,1).
  for (const headline of [
    'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू',
    'नगरपालिकेची स्वच्छता मोहीम राबवण्यात आली',
    'रस्ते दुरुस्तीसाठी निधी मंजूर',
  ]) {
    for (const width of [111, 150, 190, 268, 307]) {
      const set = compose.composeBlock({
        width, height: 264, padding: 1, headlineFontPx: 14, subheadingFontPx: 11,
        bodyFontPx: 6.4, lineHeight: 1.45, headline,
      });
      const px = set.bands.headline?.resolvedPx;
      if (px === undefined) continue;
      assert.equal(Math.round(px * 10), px * 10,
        `${width}px block resolved ${px}, which is not a tenth`);
    }
  }
});
