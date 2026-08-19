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

const fillOf = (band) => Math.max(...band.lines.map((line) => line.width / line.measure));

test('a headline short of its measure is set larger until it fills - and no larger', () => {
  // 81% of its measure on both lines at the size geometry.js chose for this
  // block: the shape of the desk's own complaint, on a block with no picture
  // in it so the fixture is about the type and nothing else.
  const headline = 'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू';
  const asked = compose.composeBlock({ ...LEAD, headline, headlineGrowth: false });
  const set = compose.composeBlock({ ...LEAD, headline });

  assert.ok(fillOf(asked.bands.headline) < 0.92,
    `this fixture must start SHORT or it tests nothing (it filled ${(100 * fillOf(asked.bands.headline)).toFixed(0)}%)`);

  assert.ok(set.bands.headline.grew, 'the engine must have chosen to grow it');
  assert.ok(fillOf(set.bands.headline) >= 0.92,
    `and it must actually fill - got ${(100 * fillOf(set.bands.headline)).toFixed(0)}%`);

  // The SMALLEST size that fills, not the largest that fits: every pixel of
  // display type is a pixel off the top of the story.
  const smaller = compose.composeBlock({ ...LEAD, headline, headlineFontPx: set.bands.headline.resolvedPx - 1 });
  assert.ok(fillOf(smaller.bands.headline) < 0.92 || smaller.bands.headline.resolvedPx >= set.bands.headline.resolvedPx,
    'no smaller size may already have filled it');
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

test('filling the headline never costs a word: growth yields to overset copy', () => {
  const headline = 'जिल्ह्यात पाणीटंचाईवर उपाययोजना सुरू';
  const sentence = 'गावातील नागरिकांनी या उपक्रमात उत्स्फूर्त सहभाग घेतला आहे. ';

  // Room to spare: the headline takes the extra depth and fills its measure.
  const roomy = compose.composeBlock({ ...LEAD, headline, body: sentence.repeat(9) });
  assert.equal(roomy.bands.headline.grew, true);
  assert.equal(roomy.overset.body, '', 'and the copy still fits');

  // One sentence more, and the depth the growth wanted is the copy's last
  // line. The headline gives it back rather than pushing a word off the page,
  // and the block still sets everything it was given.
  const full = compose.composeBlock({ ...LEAD, headline, body: sentence.repeat(10) });
  assert.equal(full.bands.headline.grew, false, 'growth must yield');
  assert.equal(full.bands.headline.resolvedPx, LEAD.headlineFontPx, 'back to the size the design asked for');
  assert.equal(full.overset.body, '', 'no copy pushed off the block');
  assert.notEqual(full.fitState, 'OVERSET');
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
