// THREE THINGS A PANEL MEASURED OFF A PRINTED PAGE NEEDED, and a fourth the
// body needed with them. Every one was found by setting the reference's own
// words in our faces and reading where the two first parted company, so each
// test here is the shape of a real divergence rather than a hypothetical:
//
//   * a hard hyphen is a break opportunity - the reference sets
//     "सार्वजनिक-/खासगी" across two lines, and a wrapper that only breaks at
//     spaces kept the pair together and lost a line at the panel's foot;
//   * a bold entry is set in ITS OWN FACE. Measured over the scholarship
//     panel's bold paragraph, Mukta Bold reproduces 8 of 8 of the reference's
//     breaks and the sans at 700 reproduces 6 - it sets about 9% wide, which
//     is a word a line;
//   * a byline FOLLOWS the display type it sits under, so a deck one line
//     shorter than the reference's moves it up rather than leaving the story's
//     first lines standing above it;
//   * and the reference's body is set GREEDILY - take words until the next
//     will not fit - where this compositor balances a paragraph by default.
//     Balanced is right for a page this paper makes up; a page copied from
//     print has to break where the printed page broke.

const test = require('node:test');
const assert = require('node:assert/strict');
const { panelOf, panelLayout, panelTop } = require('../public/editor/layout/inset-panels');
const pool = require('../src/config/db');

// Closed once every test in this file is done. Registered here, at load, so it
// can never run before a test's own cleanup - a pool closed first leaves the
// fixture edition in the database and the next run reads its leftovers as the
// block's own state, which is exactly what happened while writing this.
test.after(() => pool.end());

// Every cluster the same width, so a test asserts the RULE and never the face.
const measure = (text, px) => String(text).length * px * 0.5;
const frame = { width: 300, height: 400 };

test('a hard hyphen inside a word is a break opportunity, and keeps its hyphen', () => {
  const panel = panelOf({
    // Narrow enough that the pair cannot stand on one line - which is the
    // case the reference's own column puts it in.
    kind: 'sidebar', x: 0, y: 0, width: 40, height: 200,
    lines: ['सार्वजनिक-खासगी भागीदारीतून वसतिगृहे'],
  }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  const first = solved.lines[0].text;
  assert.ok(first.endsWith('-'), `a broken pair keeps its hyphen on the first line: ${first}`);
  assert.equal(solved.lines[1].text.startsWith('खासगी'), true);
  // And nothing is invented or lost on the way through the wrap.
  assert.equal(solved.lines.map((line) => line.text).join('').replace(/\s/g, ''),
    'सार्वजनिक-खासगीभागीदारीतूनवसतिगृहे');
});

test('a panel with no hyphen in it wraps exactly as it always did', () => {
  const panel = panelOf({ kind: 'sidebar', x: 0, y: 0, width: 60, height: 200, lines: ['एक दोन तीन चार पाच सहा'] }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  assert.ok(solved.lines.length > 1);
  assert.ok(solved.lines.every((line) => !line.text.endsWith('-')));
});

test('a bold entry is set in the panel\'s own bold face, on the line and in its runs', () => {
  const panel = panelOf({
    kind: 'sidebar', x: 0, y: 0, width: 120, height: 200,
    lineFamily: 'sans', boldFamily: 'mukta-text', boldLines: [1],
    lines: ['साधी ओळ', 'ठळक ओळ'],
  }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  const [plain, bold] = solved.lines;
  assert.equal(plain.family, 'sans');
  assert.equal(bold.family, 'mukta-text', 'the bold entry takes the bold face');
  assert.equal(bold.bold, true);
});

test('a *marked* run inside an ordinary entry takes the bold face too', () => {
  const panel = panelOf({
    kind: 'sidebar', x: 0, y: 0, width: 200, height: 200,
    lineFamily: 'sans', boldFamily: 'mukta-text', lines: ['*मुंबई :* बैठक झाली'],
  }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  const runs = solved.lines[0].runs || [];
  assert.ok(runs.length > 1, 'the mark makes two runs');
  assert.equal(runs.find((run) => run.bold).family, 'mukta-text');
  assert.equal(runs.find((run) => !run.bold).family, undefined, 'and the rest is left to the panel\'s own face');
});

test('a panel with no bold face of its own is unchanged', () => {
  const panel = panelOf({
    kind: 'sidebar', x: 0, y: 0, width: 120, height: 200,
    lineFamily: 'sans', boldLines: [0], lines: ['ठळक ओळ'],
  }, frame);
  const solved = panelLayout(panel, 6.4, measure);
  assert.equal(solved.lines[0].family, 'sans');
  assert.equal(solved.lines[0].bold, true);
});

test('a following panel sits under where the copy starts, not at its own y', () => {
  const panel = panelOf({
    kind: 'sidebar', x: 0, y: 0, width: 120, height: 40, lines: ['लोकमत न्यूज नेटवर्क'],
    followDisplay: true, followGapPx: 3.8,
  }, frame);
  assert.equal(panelTop(panel, { bodyTop: 107.21 }).toFixed(2), '111.01');
  // No composition to follow - the panel's own y, so nothing can land at NaN.
  assert.equal(panelTop(panel, null), panel.y);
  assert.equal(panelTop(panel, { bodyTop: null }), panel.y);
  // And a panel that does not follow is where it was put, composition or not.
  const fixed = panelOf({ kind: 'sidebar', x: 0, y: 55, width: 120, height: 40, lines: ['x'] }, frame);
  assert.equal(panelTop(fixed, { bodyTop: 107.21 }), 55);
});

// The body's half. `lineBreaking` is NULL for every block in the database, so
// balanced stays the default and nothing already set moves.
test('greedy breaking fills each line, and balanced stays the default', async () => {
  require('../public/editor/layout/typefaces.js');
  const metrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await Promise.all([metrics.ensureFontsLoaded(), shaper.ensureShaperReady()]);
  const { composeBlock } = await import('../public/editor/compose/compose.js');

  const body = 'तालुका प्रशासनाने पावसाळ्यापूर्वी नाले सफाईची कामे पूर्ण करण्याचे आदेश दिले असून '
    + 'आरोग्य केंद्रात नव्याने रुग्णवाहिका दाखल झाल्याने नागरिकांना दिलासा मिळाला आहे.';
  const input = { width: 200, height: 300, marginPx: 1, bodyFontPx: 6.4, body, textAlign: 'left' };
  const balanced = composeBlock({ ...input });
  const greedy = composeBlock({ ...input, lineBreaking: 'greedy' });
  assert.deepEqual(composeBlock({ ...input, lineBreaking: null }).bodyLines.map((l) => l.text),
    balanced.bodyLines.map((l) => l.text), 'an unstated policy is the balanced one');

  const width = (text, line) => shaper.shapeWidthPx(text, line.fontPx, line.family, line.weight)
    ?? metrics.measureWidth(text, line.fontPx, line.family, line.weight);
  // THE GREEDY PROPERTY: no line could have taken the first word of the next.
  const lines = greedy.bodyLines;
  assert.ok(lines.length > 2, 'the fixture must set several lines');
  for (let i = 0; i < lines.length - 1; i += 1) {
    const next = lines[i + 1].text.trim().split(/\s+/)[0];
    const joined = `${lines[i].text.trim()} ${next}`;
    assert.ok(width(joined, lines[i]) > lines[i].measure,
      `greedy line ${i + 1} left room for "${next}"`);
  }
  // And the balanced pour is a real alternative to it, not the same answer.
  assert.notDeepEqual(balanced.bodyLines.map((l) => l.text), lines.map((l) => l.text));
});

// AND THE COLUMN BEHIND IT. `line_breaking` is NULL everywhere, so every
// existing block still balances; a measured page states 'greedy' and it has to
// survive the round trip through the service, the repository and the draft.
test('line_breaking is stored, read back, and refuses anything else', async (t) => {
  const { createApp } = require('../server');
  const { signIn, removeEdition } = require('./helpers/desk');
  const pageSectionService = require('../src/services/pageSection.service');
  const pageService = require('../src/services/page.service');
  const { draftFromSection, payloadFromDraft } = await import('../public/editor/section-model.js');

  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2099-08-26', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));
  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const page = pages.find((p) => p.page_number === 1);
  const section = page.sections.find((s) => s.block_type === 'article');
  // Asserted as a CHANGE rather than against the block's initial state: the
  // start route is idempotent per date, so a fixture from an earlier run
  // arrives carrying whatever that run left on it.
  const first = await pageSectionService.saveSection(page.id, section.section_key, {
    headline: section.headline || '', subheading: '', body: section.body || '', lineBreaking: 'balanced',
  });
  assert.ok(!first.error, first.error);
  assert.equal((await pageService.listPages(started.newspaper.id))
    .find((p) => p.page_number === 1).sections
    .find((s) => s.section_key === section.section_key).line_breaking, 'balanced');

  const saved = await pageSectionService.saveSection(page.id, section.section_key, {
    headline: section.headline || '', subheading: '', body: section.body || '', lineBreaking: 'greedy',
  });
  assert.ok(!saved.error, saved.error);
  const after = (await pageService.listPages(started.newspaper.id))
    .find((p) => p.page_number === 1).sections.find((s) => s.section_key === section.section_key);
  assert.equal(after.line_breaking, 'greedy');
  assert.equal(draftFromSection(after).lineBreaking, 'greedy');
  assert.equal(payloadFromDraft(draftFromSection(after)).lineBreaking, 'greedy');

  // A payload that does not mention it leaves it alone (COALESCE), and a value
  // outside the two the compositor knows is dropped rather than stored.
  await pageSectionService.saveSection(page.id, section.section_key, { headline: '', subheading: '', body: '' });
  const untouched = (await pageService.listPages(started.newspaper.id))
    .find((p) => p.page_number === 1).sections.find((s) => s.section_key === section.section_key);
  assert.equal(untouched.line_breaking, 'greedy', 'an unmentioned column must not be cleared');
  await pageSectionService.saveSection(page.id, section.section_key, {
    headline: '', subheading: '', body: '', lineBreaking: 'sideways',
  });
  const refused = (await pageService.listPages(started.newspaper.id))
    .find((p) => p.page_number === 1).sections.find((s) => s.section_key === section.section_key);
  assert.equal(refused.line_breaking, 'greedy');
  // And the draft leaves a block that never asked exactly as it is.
  assert.equal(draftFromSection({}).lineBreaking, null);
  assert.equal(payloadFromDraft(draftFromSection({})).lineBreaking, undefined);
});
