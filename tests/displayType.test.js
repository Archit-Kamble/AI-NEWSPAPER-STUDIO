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

test('a headline short of its measure auto-fits until its complete line shape reaches the 95% bar', () => {
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
  assert.ok(fillOf(set.bands.headline) >= 0.95,
    `and it must actually fill - got ${(100 * fillOf(set.bands.headline)).toFixed(0)}%`);

  const nearerRequested = compose.composeBlock({
    ...frame, headline, headlineFontPx: set.bands.headline.resolvedPx + 0.5, headlineLocked: true,
  });
  assert.ok(fillOf(nearerRequested.bands.headline) < 0.95,
    'the selected down-fit is the largest size below the requested rung whose whole line shape passes');
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

    assert.ok(quality.fill >= 0.95, `${frame.width}px headline working lines must reach 95%`);
    assert.ok(set.bands.headline.lineCount === 1 || closeWords >= 2,
      `${frame.width}px headline must not close on one word`);
    assert.equal(set.bands.deck.lineCount, 1, `${frame.width}px deck is a subordinate one-line flow`);
    assert.ok(set.bands.deck.resolvedPx <= set.bands.headline.resolvedPx * 0.65 + 0.05,
      `${frame.width}px deck must stay below the headline's resolved hierarchy rung`);
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
  assert.ok(fillOf(roomy.bands.headline) >= 0.9,
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
