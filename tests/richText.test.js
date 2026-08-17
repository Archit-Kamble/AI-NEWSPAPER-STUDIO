// Marked-up copy, and the plain text underneath it.
//
// A story is written with the few marks a printer can set. Everything that
// MEASURES text must see the text; everything that PRINTS must see the marks;
// and nothing anywhere may ever set an angle bracket in type.

const test = require('node:test');
const assert = require('node:assert/strict');

let rt;
test.before(async () => { rt = await import('../public/editor/layout/rich-text.js'); });

test('a bold word takes exactly as much room as a plain one', () => {
  const plain = 'चार लाख हेक्टर वरील पीक';
  const bold = 'चार लाख <b>हेक्टर</b> वरील पीक';
  assert.equal(rt.plainText(bold), plain);
  assert.equal(rt.textLength(bold), plain.length, 'markup has no width on a page');
});

test('copy that contains a real angle bracket keeps it', () => {
  // This is the one that matters: stripping "anything between angle brackets"
  // would silently delete words from a story, and they would be gone from the
  // printed page with nothing to show they had ever been there.
  for (const copy of ['दर <वाढले> आहेत', 'a & b < c > d', 'नफा <२०% पेक्षा कमी']) {
    assert.equal(rt.plainText(copy), copy, copy);
  }
});

test('a paragraph ends with a blank line, a break with one', () => {
  // Everything downstream splits paragraphs on two newlines - the e-paper
  // renders them as <p>, the press file as separate paragraphs. Collapsing them
  // to one would set every story as a single unbroken block of type.
  assert.equal(rt.plainText('<p>पहिला</p><p>दुसरा</p>'), 'पहिला\n\nदुसरा');
  assert.equal(rt.plainText('एक<br>दोन'), 'एक\nदोन');
  assert.equal(rt.plainText('<ul><li>एक</li><li>दोन</li></ul>'), 'एक\nदोन');
});

test('entities become the characters they stand for', () => {
  assert.equal(rt.plainText('<p>अ&nbsp;ब &amp; क</p>'), 'अ ब & क');
});

test('marks come back as character ranges over the plain text, on both sides', () => {
  const { text, marks } = rt.textWithMarks('एक <b>दोन</b> तीन');
  assert.equal(text, 'एक दोन तीन');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].tag, 'b');
  assert.equal(text.slice(marks[0].start, marks[0].end), 'दोन');
});

test('the marks survive on the server too, so bold reaches the press file', () => {
  // Parsed by walking the string rather than through a DOM. The DOM version
  // returned no marks server-side, so a word marked bold printed bold on screen
  // and plain on paper - and nobody would find out until the paper was printed.
  const { marks } = rt.textWithMarks('<p>एक <b>दोन</b> तीन</p>');
  assert.equal(marks.length, 1, 'the server sees the mark');
  assert.equal(marks[0].tag, 'b');
});

test('unbalanced markup from a paste never loses the rest of the story', () => {
  const { text } = rt.textWithMarks('<b>सुरुवात आणि पुढचा सगळा मजकूर');
  assert.match(text, /पुढचा सगळा मजकूर/);
});

test('a mark is put back on a poured run, split at its boundaries', () => {
  const escape = (s) => s;
  const marks = [{ start: 3, end: 6, tag: 'b' }];
  // A run covering the whole thing.
  assert.equal(rt.markRun('एक दोन तीन', 0, marks, escape), 'एक <b>दोन</b> तीन');
  // A run that starts INSIDE the mark - the pour breaks copy anywhere, so the
  // mark has to be reopened on the piece that carries the rest of it.
  assert.equal(rt.markRun('ोन तीन', 4, marks, escape), '<b>ोन</b> तीन');
});

test('a run with no marks anywhere near it is simply escaped', () => {
  const escaped = rt.markRun('<script>', 0, [{ start: 40, end: 50, tag: 'b' }],
    (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  assert.equal(escaped, '&lt;script&gt;');
});

test('plain text written before the rich editor existed opens with its paragraphs', () => {
  const html = rt.fromPlainText('पहिला परिच्छेद\n\nदुसरा परिच्छेद');
  assert.match(html, /<p>पहिला परिच्छेद<\/p>/);
  assert.match(html, /<p>दुसरा परिच्छेद<\/p>/);
  // And it round-trips: what goes in comes back out.
  assert.equal(rt.plainText(html), 'पहिला परिच्छेद\n\nदुसरा परिच्छेद');
});

test('the character grid counts the story, not the markup', async () => {
  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const section = { width_px: 300, height_px: 300 };
  const base = { marginPx: 12, lineHeight: 1.25, headline: '', subheading: '', bodyFontPx: 12 };

  const plain = buildFlowMap(section, { ...base, body: 'चार लाख हेक्टर' }, []);
  const bold = buildFlowMap(section, { ...base, body: 'चार लाख <b>हेक्टर</b>' }, []);

  assert.equal(bold.usedChars, plain.usedChars, 'bolding a word must not make the story longer');
  assert.equal(bold.bodyCharBudget, plain.bodyCharBudget);
});

test('the server strips the same marks the browser does', async () => {
  const { load, strip } = require('../src/layout/plain-text');
  await load();
  for (const copy of [
    '<p>एक <b>ठळक</b> शब्द</p>',
    'दर <वाढले> आहेत',
    'अ&nbsp;ब',
    'साधा मजकूर',
  ]) {
    assert.equal(strip(copy), rt.plainText(copy), copy);
  }
});

test('the press file never sets an angle bracket in type', async () => {
  const scribus = require('../src/services/scribus.service');
  const xml = await scribus.blockFrames({
    x_px: 20, y_px: 20, width_px: 200, height_px: 200, margin_px: 12,
    headline: 'ठळक <b>मथळा</b>',
    headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    body: '<p>एक <b>दोन</b></p>', images: [],
  });
  assert.equal(/CH="[^"]*<[a-z/]/i.test(xml), false, 'a tag reaching a text frame would print as type');
});
