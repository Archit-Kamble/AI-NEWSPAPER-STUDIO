// The block is set like a newspaper, not like a web page.
//
// A desk screenshot of a 190x264 lead showed roughly a third of the block
// standing empty while the Space panel called it balanced. None of it was the
// copy's fault - it was all typography defaults that came from the web:
//
//   margin_px 12           6 mm each side at this page's 2 px/mm. A newspaper
//                          separates two stories by a ~4 mm gutter, SHARED, so
//                          2 mm (4 px) each. 12 px took 24 of 190 px of
//                          measure and 24 of 264 px of depth before a word.
//   paragraph_spacing_px 8 a blank line between paragraphs. Measured on that
//                          block: 0.7 of 5.83 body lines, 12% of it, empty. No
//                          printed newspaper spends a row of a column that way
//                          - it indents the first line instead.
//   subheadingLimit()      derived from the BODY's characters per line, so it
//                          asked for two body lines' worth of characters set
//                          in deck type: three deck lines, 18% of the block,
//                          and the "second headline" the desk reported.
//
// What did NOT change is line_height. It looks generous at 1.45, and it is
// not: the serif face's worst-case ink box was measured exhaustively across
// every consonant, every vowel sign and every virama conjunct and comes to
// 1.475 em (ascent 0.905 from the candrabindu, descent 0.570 from stacks like
// "ड़्रु"). 1.45 is already at the edge of cropping Marathi. This file exists
// partly so that nobody "tidies" it downward later.

const test = require('node:test');
const assert = require('node:assert/strict');

const { headlineLimit, subheadingLimit, measuredSubheadingLimit, limitProbeView } =
  require('../public/editor/layout/headline-reserve');
let adapter;
test.before(async () => {
  adapter = await import('../public/editor/compose/section-adapter.js');
  const m = await import('../public/editor/compose/font-metrics.js');
  const sh = await import('../public/editor/compose/shaper.js');
  await Promise.all([m.ensureFontsLoaded(), sh.ensureShaperReady()]);
});

const BLOCK = {
  width_px: 190, height_px: 264, margin_px: 4, column_count: 1,
  line_height: 1.45, headline_font_px: 17, subheading_font_px: 11, body_font_px: 9,
  text_align: 'justify', paragraph_spacing_px: 0,
};
const SENTENCE = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे. ';

test('the deck is ONE line, measured in the deck\'s own type - not two body lines of it', () => {
  const probe = adapter.composeSection({ ...BLOCK, images: [] }, { ...limitProbeView(), body: '' });
  assert.equal(probe.bands.deck.lineCount, 1, 'a deck is one line; more than that is a second headline');

  const measured = measuredSubheadingLimit(probe, 46);
  const guessed = subheadingLimit(46);
  assert.ok(measured < guessed,
    `the measured limit (${measured}) must be under the body-grid guess (${guessed}) - `
    + 'that guess is what asked for a three-line deck');

  // And a deck written to the measured limit really does set one line.
  const { standIn } = require('../public/editor/layout/headline-reserve');
  const real = adapter.composeSection({ ...BLOCK, images: [] },
    { headline: standIn(headlineLimit(46)), subheading: standIn(measured), body: '' });
  assert.equal(real.bands.deck.lineCount, 1, 'a deck at its own measured limit sets one line');
});

test('a tighter margin gives the story its room back, and that is where the room came from', () => {
  const web = adapter.composeSection({ ...BLOCK, margin_px: 12, images: [] }, { headline: '', subheading: '', body: '' });
  const paper = adapter.composeSection({ ...BLOCK, margin_px: 4, images: [] }, { headline: '', subheading: '', body: '' });
  const room = (r) => r.content.bottom - r.bodyTop;
  assert.ok(room(paper) > room(web), `4px margin must leave more room than 12px: ${room(paper)} vs ${room(web)}`);
  assert.ok(paper.capacity.bodyCharCapacity > web.capacity.bodyCharCapacity * 1.1,
    'and it is not a rounding difference - it is over a tenth of the block');
});

test('a paragraph is marked by an INDENT, and the indent is not counted as a hole', () => {
  const body = `${SENTENCE}\n\n${SENTENCE}\n\n${SENTENCE}`;
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });

  assert.equal(r.whitespace.occupancy.intentionalEquivalentLines, 0,
    'with paragraph_spacing_px at 0 there is no blank-line air at all');

  // The first line of a later paragraph starts further in than the ones
  // around it; the opening paragraph is never indented.
  const xs = r.bodyLines.map((l) => Math.round(l.x));
  const leftmost = Math.min(...xs);
  assert.ok(xs.some((x) => x > leftmost + 2), 'some line must be indented - that is the paragraph mark');
  assert.equal(xs[0], leftmost, 'but never the opening line of the story');

  // An indented line still occupies its whole row. Counting the indent as
  // empty would offer the desk "fill this" for a compositor's own mark.
  const occ = r.whitespace.occupancy;
  assert.ok(occ.occupiedEquivalentLines >= r.bodyLines.length - 0.01,
    'an indented first line is a set line, not a partly empty one');
});

test('body copy is justified by default, the way a printed column is set', () => {
  const r = adapter.composeSection({ ...BLOCK, images: [] },
    { headline: '', subheading: '', body: SENTENCE.repeat(4) });
  const stretched = r.bodyLines.filter((l) => l.wordSpacingPx);
  assert.ok(stretched.length > 0, 'justification must actually reach the composed lines');
});

test('the leading floor is NOT lowered - Marathi really needs it', () => {
  // 1.45 against a measured worst-case ink box of 1.475 em. Lowering this
  // crops vowel signs against the line above, which is a property of the
  // script and not a taste setting.
  const flow = require('fs').readFileSync('public/editor/layout/text-flow.js', 'utf8');
  const match = flow.match(/export const MIN_LINE_HEIGHT = ([\d.]+)/);
  assert.ok(match, 'MIN_LINE_HEIGHT must still be declared in one place');
  assert.ok(Number(match[1]) >= 1.4, `the leading floor may not drop below 1.4, found ${match[1]}`);
});

// ---------------------------------------------------------- the type itself ---
//
// Everything below is about how the copy is SET, not how much of it there is.
// The desk's report was "uneven gap ... not touching right side properly", and
// measuring the block it came from found four of thirteen lines where the
// justifier had silently given up: 17%, 36%, 29% and 17% short of their own
// measure, sitting among lines that were flush. A right edge that is
// sometimes straight is worse than one that is never straight - the reader
// sees a mistake rather than a style.

const LONG = [
  'पंतप्रधान नरेंद्र मोदी यांनी लाल किल्ल्यावरून देशवासीयांना संबोधित केले.',
  'स्वातंत्र्यदिनाच्या या मुख्य सोहळ्यात त्यांनी देशाच्या प्रगतीचा आढावा घेतला.',
  'आपल्या भाषणात त्यांनी आत्मनिर्भर भारत आणि औद्योगिक विकासावर भर दिला.',
  'नागरिकांनी देशाच्या विकासात सक्रिय योगदान देण्याचे आवाहन त्यांनी केले.',
].join(' ');

const WIDE = { ...BLOCK, width_px: 400, height_px: 300, body_font_px: 10 };

function bodyLinesOf(section, images, body) {
  return adapter.composeSection({ ...section, images }, { headline: '', subheading: '', body });
}

test('every non-final line of a justified block reaches its measure - no silent surrender', () => {
  const r = bodyLinesOf(WIDE, [], LONG);
  const px = Number(r.typography.bodyPx);
  let worst = 0;
  r.bodyLines.forEach((l, i) => {
    const spaces = (l.text.match(/\s/gu) || []).length;
    const set = l.width + (l.wordSpacingPx || 0) * spaces;
    const isLast = i === r.bodyLines.length - 1 || (r.bodyLines[i + 1] && r.bodyLines[i + 1].paragraphBreak);
    if (!isLast) worst = Math.max(worst, (l.measure - set) / l.measure);
  });
  assert.ok(worst < 0.05, `worst non-final line is ${Math.round(worst * 100)}% short of its measure`);
  assert.ok(px > 0);
});

test('justification uses two levers, in order - word spaces first, then the glyphs', () => {
  const r = bodyLinesOf(WIDE, [], LONG);
  const stretched = r.bodyLines.filter((l) => l.wordSpacingPx);
  assert.ok(stretched.length > 0, 'word spacing must actually be applied');
  // Glyph scaling is the second lever and is bounded to the range a newspaper
  // really uses. Letter-spacing is NOT a lever here: tracking a Devanagari
  // word pulls its shirorekha apart.
  for (const l of r.bodyLines) {
    if (l.glyphScaleX) assert.ok(l.glyphScaleX <= 1.031, `glyph scale ${l.glyphScaleX} is outside the newspaper range`);
  }
});

test('a paragraph never closes on a single word', () => {
  const body = `${LONG}\n\n${LONG}`;
  const r = bodyLinesOf(WIDE, [], body);
  r.bodyLines.forEach((l, i) => {
    const isLast = i === r.bodyLines.length - 1 || (r.bodyLines[i + 1] && r.bodyLines[i + 1].paragraphBreak);
    if (isLast && i > 0) {
      const words = l.text.trim().split(/\s+/).length;
      assert.ok(words >= 2, `a paragraph closed on "${l.text.trim()}" - one word under a full column is a widow`);
    }
  });
});

test('a column too narrow to justify is set flush left, as a printed newspaper sets one', () => {
  // 11 em is two or three Marathi words to the line - there is nowhere to put
  // the slack, and 55% of the real blocks in this database are that narrow.
  const narrow = { ...BLOCK, width_px: 111, height_px: 200, body_font_px: 9, text_align: 'justify' };
  const r = bodyLinesOf(narrow, [], LONG);
  assert.ok(r.bodyLines.length > 1, 'precondition: it has to set some lines');
  assert.ok(r.bodyLines.every((l) => l.wordSpacingPx == null),
    'a column this narrow must not be justified at all');
  assert.ok((r.warnings || []).some((w) => w.code === 'SET_FLUSH_LEFT'), 'and the desk is told why');
});

test('the last fraction of a column is closed with the LEADING, not with more words', () => {
  // Copy is written in whole sentences, so a writer can only ever get within
  // about a line of the foot: one more sentence overflows and trimming takes
  // it straight back out. A compositor opens the leading a point or two and
  // lets the copy fill the column - InDesign calls it vertical justification.
  // Measured on a real block, this took it from 86% set to 97.5%.
  const tall = { ...BLOCK, width_px: 300, height_px: 260, body_font_px: 10 };
  const band = (r) => Number(r.typography.bodyPx) * Number(r.typography.lineHeight);

  // Copy grown until one more sentence would not fit - which is exactly where
  // the writer has to stop, and exactly the case this exists for.
  let body = '';
  for (let i = 0; i < 12; i += 1) {
    const next = body ? `${body} ${LONG}` : LONG;
    if (bodyLinesOf(tall, [], next).overset.body) break;
    body = next;
  }
  assert.ok(body, 'precondition: some copy has to fit');

  const r = bodyLinesOf(tall, [], body);
  const occ = r.whitespace.occupancy;
  const foot = r.content.bottom - Math.max(...r.bodyLines.map((l) => l.y + l.height));

  assert.ok(foot < band(r), `the copy ends ${(foot / band(r)).toFixed(2)} of a line from the foot`);
  assert.ok(occ.ratio >= 0.95, `${Math.round(occ.ratio * 100)}% set - the desk's bar is 95%`);

  // Bounded twice, so it can never hide a hole a writer should be filling
  // with words, and never visibly loosens the page.
  if (occ.leadingAbsorbedLines) {
    assert.ok(occ.leadingAbsorbedLines <= 1.001, 'never more than one line of residual is absorbed');
    const rows = [...new Set(r.bodyLines.map((l) => Number(l.y.toFixed(2))))].sort((a, b) => a - b);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i] - rows[i - 1] <= band(r) * 1.121,
        `a line gap opened to ${((rows[i] - rows[i - 1]) / band(r)).toFixed(3)} of the band`);
    }
  }
});

test('re-breaking a paragraph never loses or reorders a word', () => {
  const r = bodyLinesOf(WIDE, [], LONG);
  const set = r.bodyLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
  const source = LONG.replace(/\s+/g, ' ').trim();
  assert.equal(set, source, 'every word must survive the re-break, in order');
});
