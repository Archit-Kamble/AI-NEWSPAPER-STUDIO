// The paper's colours: an ink on words, a ground behind a block, and a
// headline reversed out of a panel.
//
// Every colour in this product is bounded to a palette the press can separate
// (public/editor/layout/inks.js). These checks hold the two things that make
// that true: nothing outside the palette can be stored, and everything inside
// it reaches the press file - the "the browser printed it and the paper did
// not" class of failure this codebase treats as the worst one.

const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();
const scribus = require('../src/services/scribus.service');

let richText;
let inks;
test.before(async () => {
  richText = await import('../public/editor/layout/rich-text.js');
  inks = await import('../public/editor/layout/inks.js');
  await scribus.ensureComposeReady();
});

test('an ink is one of the paper\'s own, in either form a browser hands it back', () => {
  assert.equal(inks.sanitiseInk('#c8102e'), '#c8102e');
  // A colour that has been through the DOM comes back normalised. Both forms
  // must resolve, or a mark applied in Quill is dropped on the way to storage
  // while the screen goes on showing it - measured exactly that way.
  assert.equal(inks.sanitiseInk('rgb(200, 16, 46)'), '#c8102e');
  assert.equal(inks.sanitiseInk('RGB(200,16,46)'), '#c8102e');
  // Not one of the four, so it is not an ink. A page is separated into plates.
  assert.equal(inks.sanitiseInk('#7f3fbf'), null);
  assert.equal(inks.sanitiseInk('rebeccapurple'), null);
  assert.equal(inks.sanitiseInk(''), null);
  assert.equal(inks.sanitiseInk(null), null);
});

test('a ground is one of the paper\'s tints, and white is stored as nothing', () => {
  assert.equal(inks.sanitiseTint('#fbf3e9'), '#fbf3e9');
  assert.equal(inks.sanitiseTint('#ffffff'), null, 'white is the paper, not a tint');
  assert.equal(inks.sanitiseTint('#123456'), null);
  assert.equal(inks.tintSeparation('#fbf3e9'), 'SahasTintCream');
  assert.equal(inks.tintSeparation(null), 'None');
});

test('an ABSENT size is not a size of zero', () => {
  // `getAttribute` returns null for a span carrying no size; Number(null) is 0
  // and Number.isFinite(0) is true, so the clamp turned every stray <span>
  // into a 6px mark and set the words inside it in 3pt type. Found the moment
  // a second span attribute existed: an inked headline came back stored as
  // `<span data-sahas-size="6" data-sahas-ink="...">`.
  assert.equal(richText.sanitiseSize(null), null);
  assert.equal(richText.sanitiseSize(undefined), null);
  assert.equal(richText.sanitiseSize(''), null);
  assert.equal(richText.sanitiseSize('   '), null);
  assert.equal(richText.sanitiseSize('20'), 20);
  assert.equal(richText.sanitiseSize('2'), 6, 'still clamped when a real number is given');
});

test('one span can carry a size and an ink, and its closing tag closes both', () => {
  const { text, marks } = richText.textWithMarks(
    'एक <span data-sahas-size="20" data-sahas-ink="#17458f">दोन</span> तीन',
  );
  assert.equal(text, 'एक दोन तीन');
  const size = marks.find((mark) => mark.tag === 'size');
  const ink = marks.find((mark) => mark.tag === 'ink');
  assert.deepEqual({ start: size.start, end: size.end, value: size.value }, { start: 3, end: 6, value: 20 });
  assert.deepEqual({ start: ink.start, end: ink.end, value: ink.value }, { start: 3, end: 6, value: '#17458f' });
});

test('a span carrying neither still balances, and marks nothing', () => {
  const { text, marks } = richText.textWithMarks('अ <span>ब</span> <b>क</b>');
  assert.equal(text, 'अ ब क');
  assert.deepEqual(marks.map((mark) => mark.tag), ['b']);
});

test('a run carries the SEPARATION, not the screen colour - a press file names a plate', () => {
  const marks = [{ start: 0, end: 3, tag: 'ink', value: '#c8102e' }];
  const runs = richText.styledRuns('लाल शब्द', 0, marks, 16);
  assert.equal(runs[0].colour, 'SahasRed');
  assert.equal(runs[1].colour, undefined, 'the rest of the line is the block\'s own ink');
});

test('the ground, the reverse panel and every ink reach the press file', async () => {
  const section = {
    section_key: 'test', x_px: 20, y_px: 200, width_px: 268, height_px: 248,
    block_type: 'article', margin_px: 1, line_height: 1.45, column_count: 1,
    headline: 'शहरात नवीन <span data-sahas-ink="#17458f">उद्यान</span> मंजूर',
    headline_font_px: 26, subheading: 'निधी उपलब्ध', subheading_font_px: 14,
    body: '<p>पुणे : महापालिकेने <span data-sahas-ink="#c8102e">नव्या</span> उद्यानाला मंजुरी दिली आहे. निधीची तरतूद करण्यात आली आहे.</p>',
    body_font_px: 16, text_align: 'justify', border_style: 'none',
    background_color: '#fbf3e9', headline_style: 'reverse', accent_color: '#c8102e',
    font_family: 'theme', font_weight: 400, paragraph_spacing_px: 0, letter_spacing_px: 0,
    images: [],
  };
  const xml = await scribus.blockFrames(section, { pageIndex: 0, pageOffsetMm: 0 });
  const count = (re) => (xml.match(re) || []).length;

  assert.equal(count(/PCOLOR="SahasTintCream"/g), 1, 'the block\'s ground is laid down once');
  assert.equal(count(/PCOLOR="SahasRed"/g), 1, 'and the reverse panel once');
  assert.ok(count(/TXTFILL="White"/g) >= 1, 'the headline is set out of the panel');
  assert.equal(count(/TXTFILL="SahasBlue"/g), 1, 'a desk\'s own ink inside a reversed headline still wins');
  assert.equal(count(/TXTFILL="SahasRed"/g), 1, 'and the inked word in the body prints in its ink');

  // Order matters: a .sla paints in document order, so a ground emitted after
  // the type would paint over the story.
  assert.ok(
    xml.indexOf('PCOLOR="SahasTintCream"') < xml.indexOf('PCOLOR="SahasRed"'),
    'the ground goes down before the panel',
  );
  assert.ok(
    xml.indexOf('PCOLOR="SahasRed"') < xml.indexOf('TXTFILL="White"'),
    'and the panel before the type that is reversed out of it',
  );
});

test('a block nobody tinted lays no ground at all', async () => {
  const section = {
    section_key: 'test', x_px: 20, y_px: 200, width_px: 268, height_px: 248,
    block_type: 'article', margin_px: 1, line_height: 1.45, column_count: 1,
    headline: 'साधा मथळा', headline_font_px: 26, subheading: '', subheading_font_px: 14,
    body: '<p>पुणे : साधी बातमी येथे आहे.</p>', body_font_px: 16, text_align: 'justify',
    border_style: 'none', background_color: null, headline_style: 'plain',
    accent_color: '#c8102e', font_family: 'theme', font_weight: 400,
    paragraph_spacing_px: 0, letter_spacing_px: 0, images: [],
  };
  const xml = await scribus.blockFrames(section, { pageIndex: 0, pageOffsetMm: 0 });
  assert.equal((xml.match(/PTYPE="6"/g) || []).length, 0, 'no fills at all');
});
