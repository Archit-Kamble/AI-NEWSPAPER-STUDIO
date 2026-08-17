// #6 closure: the headline's accent phrase ("*word*") and its no-asterisk
// fallback (`headline_style: 'accent'`, colouring the true last word) were
// both decided one composed LINE at a time. compose.js breaks a headline
// into display lines with no idea where the desk's asterisks fall, so:
//
//   - an accent phrase that happens to straddle that break matched neither
//     half against `/\*([^*]+)\*/`, and both literal asterisks printed; and
//   - the last-word fallback coloured the last word of EVERY line on a
//     multi-line headline, not just the headline's true last word.
//
// accent.js's accentSegments()/headlineSegments() decide this once per
// BAND instead, and render.js (the browser) and scribus.service.js (the
// press) both call the same functions - this file proves the two agree,
// using a real narrow frame that genuinely splits a real Marathi accent
// phrase across a line break, not a synthetic string.
//
// Alongside it: a hard-overset unbreakable word (wider than every legal
// gap in its own frame) is drawn anyway by the browser
// (`.section-composed{overflow:visible}`, styles.css) rather than wrapped
// or clipped. A Scribus frame sized to the band's measure alone would let
// the press wrap or clip exactly that word - this file also proves the
// press frame is at least as wide as what was actually drawn.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const scribus = require('../src/services/scribus.service');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', file));

let sectionAdapter;
let render;
let accent;

test.before(async () => {
  const ready = await scribus.ensureComposeReady();
  sectionAdapter = ready.adapter;
  accent = ready.accent;
  render = await load('compose/render.js');
});

// Narrow enough that a real multi-word accent phrase ("*५०० कोटींचे*") is
// forced onto two different headline lines - confirmed by inspection: this
// exact width splits it as "...*५००" / "कोटींचे*...".
function splitAccentSection(overrides = {}) {
  return {
    x_px: 0, y_px: 0, width_px: 60, height_px: 220, margin_px: 4,
    kicker: '', headline: 'शेतकऱ्यांसाठी *५०० कोटींचे* मदत पॅकेज जाहीर',
    headline_font_px: 20, subheading: '', subheading_font_px: 14, body_font_px: 14,
    body: '', location: '', reporter_name: '', images: [],
    ...overrides,
  };
}

function accentColourRuns(xml) {
  const runs = [];
  const re = /<ITEXT[^>]*CH="([^"]*)"[^>]*>/g;
  let match = re.exec(xml);
  while (match) {
    runs.push({ text: match[1], accented: match[0].includes('TXTFILL="SahasRed"') });
    match = re.exec(xml);
  }
  return runs;
}

test('accent.js: a phrase split by a line break is coloured on both halves', () => {
  const segments = accent.accentSegments(['शेतकऱ्यांसाठी *५००', 'कोटींचे* मदत पॅकेज जाहीर']);
  assert.equal(segments.length, 2, 'one segment array per input line');
  assert.deepEqual(segments[0].map((s) => s.accent), [false, true], 'line 1 ends inside the phrase');
  assert.deepEqual(segments[1].map((s) => s.accent), [true, false], 'line 2 opens still inside the phrase');
  assert.equal(segments[0].filter((s) => s.accent)[0].text, '५००');
  assert.equal(segments[1].filter((s) => s.accent)[0].text, 'कोटींचे');
});

test('accent.js: headlineSegments colours only the TRUE last word across multiple lines', () => {
  const segments = accent.headlineSegments(['पहिली ओळ', 'शेवटची ओळ'], { accentStyle: true });
  assert.equal(segments[0].every((s) => !s.accent), true, 'the first line has no accent at all');
  const lastLineAccented = segments[1].filter((s) => s.accent);
  assert.equal(lastLineAccented.length, 1);
  assert.equal(lastLineAccented[0].text, 'ओळ', 'only the headline\'s true last word is coloured');
});

test('accent.js: a headline with no asterisks and no accent style returns null (caller falls back to plain)', () => {
  assert.equal(accent.headlineSegments(['साधा मथळा'], { accentStyle: false }), null);
});

test('render.js composedMarkup: a real split accent phrase is coloured on both composed lines, no literal asterisks', () => {
  const section = splitAccentSection();
  const composition = sectionAdapter.composeSection(section, section);
  const headlineLines = composition.bands.headline.lines.map((l) => l.text);
  assert.ok(headlineLines.some((t) => t.includes('*५००')), 'fixture must actually split the phrase - test the real gap, not a synthetic one');

  const html = render.composedMarkup(composition, section, { datelinePrefix: '' });
  assert.ok(!html.includes('*'), 'no literal asterisk should ever reach the page');
  const colourSpans = html.match(/<span style="color:#c8102e">([^<]*)<\/span>/g) || [];
  const coloured = colourSpans.map((s) => s.replace(/<[^>]+>/g, ''));
  assert.ok(coloured.includes('५००'), 'the first half of the split phrase must be coloured');
  assert.ok(coloured.includes('कोटींचे'), 'the second half of the split phrase must be coloured');
});

test('render.js composedMarkup: headline_style accent colours only the headline\'s true last word, not one per line', () => {
  const section = {
    x_px: 0, y_px: 0, width_px: 90, height_px: 220, margin_px: 4,
    kicker: '', headline: 'शेतकऱ्यांसाठी राज्य सरकारची नवी मोठी योजना जाहीर',
    headline_font_px: 18, headline_style: 'accent', headlineStyle: 'accent', subheading: '', body: '',
  };
  const composition = sectionAdapter.composeSection(section, section);
  assert.ok(composition.bands.headline.lineCount >= 2, 'fixture must actually wrap to more than one line');

  const html = render.composedMarkup(composition, section, { datelinePrefix: '' });
  const colourSpans = html.match(/<span style="color:#c8102e">([^<]*)<\/span>/g) || [];
  assert.equal(colourSpans.length, 1, 'exactly one coloured span across the whole headline, not one per line');
  const lastComposedLine = composition.bands.headline.lines.at(-1).text;
  const trueLastWord = lastComposedLine.trim().split(/\s+/).pop();
  assert.equal(colourSpans[0].replace(/<[^>]+>/g, ''), trueLastWord, 'it is the true last word of the LAST COMPOSED line, not a per-line guess');
});

test('press: the same split accent phrase is coloured on both press lines, matching the browser exactly', async () => {
  const section = splitAccentSection();
  const xml = await scribus.blockFrames(section);
  const runs = accentColourRuns(xml);
  const accented = runs.filter((r) => r.accented).map((r) => r.text);
  assert.ok(accented.includes('५००'), 'first half of the phrase must carry SahasRed in the press file');
  assert.ok(accented.includes('कोटींचे'), 'second half of the phrase must carry SahasRed in the press file');
  assert.ok(!xml.includes('CH="*'), 'no literal asterisk should ever reach the press file');
});

test('press: headline_style accent colours only the true last word in the press file too', async () => {
  const section = {
    x_px: 0, y_px: 0, width_px: 90, height_px: 220, margin_px: 4,
    kicker: '', headline: 'शेतकऱ्यांसाठी राज्य सरकारची नवी मोठी योजना जाहीर',
    headline_font_px: 18, headline_style: 'accent', subheading: '', body: '', images: [],
  };
  const composition = sectionAdapter.composeSection(section, section);
  const lastComposedLine = composition.bands.headline.lines.at(-1).text;
  const trueLastWord = lastComposedLine.trim().split(/\s+/).pop();

  const xml = await scribus.blockFrames(section);
  const runs = accentColourRuns(xml);
  const accented = runs.filter((r) => r.accented);
  assert.equal(accented.length, 1, 'exactly one press run carries the accent colour');
  assert.equal(accented[0].text, trueLastWord, 'it is the true last word of the LAST COMPOSED line, matching the browser exactly');
});

test('press: a hard-overset unbreakable headline word is not wrapped or clipped - the frame is at least as wide as the real drawn word', async () => {
  const section = {
    x_px: 0, y_px: 0, width_px: 40, height_px: 200, margin_px: 4,
    kicker: '', headline: 'शेतकऱ्यांसाठी', headline_font_px: 20,
    subheading: '', body: '', images: [],
  };
  const composition = sectionAdapter.composeSection(section, section);
  const line = composition.bands.headline.lines[0];
  assert.ok(line.width > line.measure, 'fixture must actually be hard-overset - test the real gap, not a synthetic one');

  const xml = await scribus.blockFrames(section);
  const frameMatch = xml.match(/<PAGEOBJECT XPOS="[^"]*" YPOS="[^"]*" WIDTH="([^"]*)"/);
  assert.ok(frameMatch, 'a text frame must exist for the headline');
  const widthMm = Number(frameMatch[1]);
  assert.ok(widthMm >= scribus.mm(line.width) - 0.01,
    `press frame (${widthMm}mm) must be at least as wide as the real drawn word (${scribus.mm(line.width)}mm), or Scribus will wrap/clip what the browser draws in full`);
});

test('press: an ordinary (non-overset) body line still gets exactly its composed measure, unchanged', async () => {
  const section = {
    x_px: 40, y_px: 60, width_px: 260, height_px: 400, margin_px: 12,
    kicker: '', headline: 'मथळा', headline_font_px: 20, subheading: '', subheading_font_px: 14, body_font_px: 12,
    body: 'शेतकऱ्यांसाठी नवी योजना जाहीर करण्यात आली.',
    location: '', reporter_name: '', images: [],
  };
  const composition = sectionAdapter.composeSection(section, section);
  const line = composition.bodyLines[0];
  assert.ok(line.width <= line.measure + 0.5, 'this fixture must NOT be hard-overset, to prove the ordinary path is untouched');

  const xml = await scribus.blockFrames(section);
  const bodyFrameWidths = [...xml.matchAll(/<PAGEOBJECT XPOS="[^"]*" YPOS="[^"]*" WIDTH="([^"]*)"/g)].map((m) => Number(m[1]));
  const expected = Number(scribus.mm(line.measure + 1).toFixed(6));
  assert.ok(bodyFrameWidths.some((w) => Math.abs(w - expected) < 0.01), 'an ordinary line keeps its measure+1 width exactly as before');
});
