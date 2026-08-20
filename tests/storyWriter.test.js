// A few words in, a block-sized story out.
//
// What matters here is not that a model can write - it is that the brief it is
// given is built from THIS block's real measurement, that nothing reaches the
// database without a person accepting it, and that the model is told in plain
// words not to invent facts.

const test = require('node:test');
const assert = require('node:assert/strict');

const writer = require('../src/services/storyWriter.service');

test('the brief carries the block\'s real character budget, not a word count', () => {
  const brief = writer.briefFor({
    seed: 'जंतरमंतर आंदोलन',
    notes: '',
    fit: { bodyCharBudget: 812, bodyWordBudget: 135, cols: 54, rows: 30, hasPictures: false },
    section: { width_px: 268, height_px: 248 },
    language: 'Marathi',
    isLead: true,
  });

  assert.match(brief, /812 characters/, 'the exact budget is stated');
  assert.match(brief, /जंतरमंतर आंदोलन/, 'the seed is the subject');
  assert.match(brief, /Marathi/, 'the language is named');
  // A floor as well as a ceiling, and a tight one: copy that fills three
  // quarters of a block leaves a white hole for somebody to fill at 11pm.
  assert.match(brief, /between 747 and 812/, 'a range, so the block is actually filled');
  assert.doesNotMatch(brief, /\babout \d+ words\b/i, 'never a vague word count');
});

test('the brief forbids inventing facts, in words a model will not skim', () => {
  const brief = writer.briefFor({
    seed: 'protest',
    notes: '',
    fit: { bodyCharBudget: 400, bodyWordBudget: 66, cols: 40, rows: 20, hasPictures: false },
    section: { width_px: 200, height_px: 200 },
    language: 'Marathi',
    isLead: false,
  });

  for (const forbidden of [/casualty figures/i, /rupee amounts/i, /dates/i, /named officials/i, /quotations/i]) {
    assert.match(brief, forbidden, `the brief names ${forbidden} as off limits`);
  }
  assert.match(brief, /do not know a specific/i, 'and says what to do instead');
});

test('a block with pictures is briefed on the room LEFT, and told why', () => {
  const brief = writer.briefFor({
    seed: 'protest',
    notes: '',
    fit: { bodyCharBudget: 300, guaranteedChars: 300, reservoirChars: 700, bodyWordBudget: 50, cols: 40, rows: 20, hasPictures: true },
    section: { width_px: 200, height_px: 200 },
    language: 'Marathi',
    isLead: false,
  });
  assert.match(brief, /the pictures are placed/);
});

test('the desk\'s extra instructions reach the brief', () => {
  const brief = writer.briefFor({
    seed: 'protest',
    notes: 'Mention that the road stayed open.',
    fit: { bodyCharBudget: 300, bodyWordBudget: 50, cols: 40, rows: 20, hasPictures: false },
    section: { width_px: 200, height_px: 200 },
    language: 'Marathi',
    isLead: false,
  });
  assert.match(brief, /the road stayed open/i);
});

// Bug #10 (PROJECT_STATUS.md): a block styled headline: "accent" used to get
// no instruction about the *asterisk* emphasis convention at all, so the
// renderer's own fallback - highlight the LAST word - did 100% of the work,
// with no semantic basis. Confirmed live against a real AI-written headline
// ("...देण्याचा *संकल्प*" instead of "*नरेंद्र मोदी* यांचा...").
test('an accent-styled block is told the asterisk convention; a plain one is not', () => {
  const args = {
    seed: 'protest', notes: '', fit: { bodyCharBudget: 300, bodyWordBudget: 50, cols: 40, rows: 20, hasPictures: false },
    section: { width_px: 200, height_px: 200 }, language: 'Marathi', isLead: false,
  };
  assert.match(writer.briefFor({ ...args, accentStyle: true }), /wrapping it in asterisks/i);
  assert.doesNotMatch(writer.briefFor({ ...args, accentStyle: false }), /wrapping it in asterisks/i);
  assert.doesNotMatch(writer.briefFor(args), /wrapping it in asterisks/i, 'omitted entirely defaults to no instruction');
});

test('sanitiseAccentMarks: a well-formed single emphasis is kept as-is', () => {
  const headline = '*नरेंद्र मोदी* यांचा तिसरा कार्यकाळ: देशाच्या विकासाला नवी गती देण्याचा संकल्प';
  assert.equal(writer.sanitiseAccentMarks(headline, true), headline);
});

test('sanitiseAccentMarks: no asterisks at all is left untouched', () => {
  assert.equal(writer.sanitiseAccentMarks('साध्या मथळा', true), 'साध्या मथळा');
});

test('sanitiseAccentMarks: an odd number of asterisks is a malformed pair, stripped', () => {
  assert.equal(writer.sanitiseAccentMarks('नरेंद्र * मोदी यांचा', true), 'नरेंद्र  मोदी यांचा');
});

test('sanitiseAccentMarks: emphasising almost the whole headline defeats the point, stripped', () => {
  const headline = '*नरेंद्र मोदी यांचा तिसरा कार्यकाळ सुरू*';
  assert.equal(writer.sanitiseAccentMarks(headline, true), 'नरेंद्र मोदी यांचा तिसरा कार्यकाळ सुरू');
});

test('sanitiseAccentMarks: a block whose template did not ask for accent styling keeps no emphasis', () => {
  assert.equal(writer.sanitiseAccentMarks('*नरेंद्र मोदी* यांचा निर्णय', false), 'नरेंद्र मोदी यांचा निर्णय');
});

test('nothing is written without a subject', async () => {
  const result = await writer.write(1, 'lead', { seed: '   ' });
  assert.match(result.error, /what the story is about/i);
});

test('the schema allows exactly the three things a block holds', () => {
  assert.deepEqual(Object.keys(writer.STORY_SCHEMA.properties).sort(), ['body', 'headline', 'subheading']);
  assert.equal(writer.STORY_SCHEMA.additionalProperties, false, 'no extra keys may come back');
  assert.deepEqual(writer.STORY_SCHEMA.required.sort(), ['body', 'headline', 'subheading']);
});

test('the writer never writes to the database', () => {
  // The whole file, read as text: a service that proposes must not contain a
  // single statement that changes a row. AI assists, it never owns (VISION.md).
  const source = require('node:fs').readFileSync(
    require.resolve('../src/services/storyWriter.service'), 'utf8',
  );
  const statements = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(statements, /\bUPDATE\s+\w/i, 'no UPDATE');
  assert.doesNotMatch(statements, /\bINSERT\s+INTO\b/i, 'no INSERT');
  assert.doesNotMatch(statements, /\bDELETE\s+FROM\b/i, 'no DELETE');
});

// Found live: a block with a picture taking roughly half its height was
// planned against text-flow.js's approximate grid at 361 characters,
// briefed to the model at that size, and still overflowed - the SAME
// block's real, exact capacity was 138-233. The grid's exclusion math for a
// placed picture is approximate; the exact engine's is not, and the exact
// engine is what the editor panel and preflight actually measure against
// (see layout-panel.js, fit.service.js, preflight.service.js) - this file's
// OWN header comment used to claim otherwise ("the same one... fit action,
// the jump and preflight all measure with"), which was true once and quietly
// stopped being true when those callers migrated and this one did not. The
// grid still answers `cols`/`rows`/`bodyWordBudget` (heuristics, never the
// number that decides whether the model's copy will actually fit).
test('the budget the AI is briefed with is the SAME exact-engine number the editor panel and preflight actually check the copy against - not the approximate grid', async () => {
  const section = {
    width_px: 300, height_px: 300, margin_px: 12, column_count: 1,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    headline: 'मथळा', subheading: '', body: '',
  };
  const mine = await writer.measure(section, []);

  const adapter = await import('../public/editor/compose/section-adapter.js');
  const fontMetrics = await import('../public/editor/compose/font-metrics.js');
  const shaper = await import('../public/editor/compose/shaper.js');
  await fontMetrics.ensureFontsLoaded();
  await shaper.ensureShaperReady();
  const view = {
    headline: 'मथळा', subheading: '', body: '',
    marginPx: 12, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 24, subheadingFontPx: 14, bodyFontPx: 10,
  };
  const composed = adapter.composeSection({ ...section, images: [] }, view);

  const copyFit = require('../src/services/copyFit.service');
  assert.equal(mine.bodyCharBudget, copyFit.openingTarget(composed.capacity),
    'the AI is briefed off the exact composition, not the approximate grid');
  // ...and specifically NOT the conservative floor: briefing with the floor
  // is what left ordinary copy short of the block by the width of the range.
  assert.notEqual(mine.bodyCharBudget, composed.capacity.bodyCharRange.min);
  assert.equal(mine.bodyCharFloor, composed.capacity.bodyCharRange.min,
    'the floor is still available to a caller that must not be wrong');
  assert.ok(mine.bodyCharBudget > 0);
});

test('pictures on the block reduce the budget the AI is given', async () => {
  const section = {
    width_px: 300, height_px: 300, margin_px: 12, column_count: 1,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    headline: '', subheading: '', body: '',
  };
  const empty = await writer.measure(section, []);
  const withPicture = await writer.measure(section, [
    { x_px: 0, y_px: 0, width_px: 150, height_px: 150, shape: 'rect' },
  ]);

  assert.ok(withPicture.bodyCharBudget < empty.bodyCharBudget,
    'a picture takes cells, so there is less room for copy');
  assert.equal(withPicture.hasPictures, true);
});

// NULL is the persisted meaning of Auto. The page adapter infers two columns
// for this 268 px measure; coercing NULL with `Number(null) || 1` made the AI
// brief measure a different, one-column page from the one the desk saw.
test('an Auto-column AI brief uses the same inferred columns as the page', async () => {
  const section = {
    width_px: 268, height_px: 304, margin_px: 1, column_count: null,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 12,
    headline: 'मथळा', subheading: '', body: '',
  };

  const auto = await writer.measure(section, []);
  const one = await writer.measure({ ...section, column_count: 1 }, []);
  const two = await writer.measure({ ...section, column_count: 2 }, []);

  assert.deepEqual(auto, two, 'Auto must use the adapter\'s inferred two-column composition');
  assert.notDeepEqual(auto, one, 'an explicit one-column instruction must remain distinct');
});

// Filling the block accurately is the whole job. Three things were wrong: the
// budget was measured on a block with no headline on it, the deck was optional
// so it came back empty, and a body that came back short was accepted.

test('the budget reserves the headline the model has not written yet', async () => {
  const section = {
    width_px: 268, height_px: 304, margin_px: 12, column_count: 1,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    headline: '', subheading: '', body: '',
  };

  const empty = await writer.measure(section, []);
  const planned = await writer.planningFit(section, []);

  assert.ok(
    planned.bodyCharBudget < empty.bodyCharBudget,
    `an empty block is not the hole the body gets: ${empty.bodyCharBudget} vs ${planned.bodyCharBudget}`,
  );
  assert.ok(planned.bodyCharBudget > 0, 'but there is still a story to write');
});

test('the deck is required, and the body has a floor as well as a ceiling', () => {
  const brief = writer.briefFor({
    seed: 'जंतरमंतर आंदोलन',
    notes: '',
    fit: { bodyCharBudget: 500, guaranteedChars: 500, reservoirChars: 1200, bodyWordBudget: 83, cols: 48, rows: 19, hasPictures: false },
    section: { width_px: 268, height_px: 304 },
    language: 'Marathi',
    isLead: false,
  });

  assert.match(brief, /subheading is REQUIRED/i, 'the deck is not optional');
  assert.match(brief, /never empty/i);
  assert.doesNotMatch(brief, /Leave it empty/i, 'the old escape hatch is gone');

  // The RESERVOIR, not a target - and it is the reservoir that is quoted as
  // the upper figure, never the reservation. Measured across 400 real blocks,
  // the reservation was typically 63% below what the finished block held, so
  // asking the model to stop there is what produced blocks a third full.
  assert.match(brief, /between 460 and 1200 characters/, 'the floor is the safe bound, the ceiling is the reservoir');
  assert.match(brief, /MORE than this block will print/i, 'and overshooting is explicitly invited');
  assert.match(brief, /most important material FIRST/i, 'because the compositor cuts from the bottom');

  // The claim that was not true, and had to go: the space left cannot be
  // known before the headline and the deck exist, which is after this brief.
  assert.doesNotMatch(brief, /exact space left on the block/i,
    'the brief may not claim to know a number it cannot know yet');
});

test('a repair asks only for FURTHER paragraphs - it is never asked to cut, and never to rewrite', () => {
  const proposal = { headline: 'H', subheading: 'S', body: 'एक ओळ.' };

  const repair = writer.resizeBriefFor({ proposal, used: 300, budget: 500, language: 'Marathi' });

  // A repair asks for FURTHER PARAGRAPHS and nothing else. It is never asked
  // to cut - cutting is deterministic, free and always converges
  // (copyFit.trimToFit), so paying a model to do it was waste that also came
  // with no guarantee the answer fit.
  assert.match(repair, /further paragraphs/i);
  assert.match(repair, /200 more/, 'and it is told how much more, measured from the real composition');
  assert.match(repair, /Do NOT rewrite it/i, 'copy the desk may already have read is never thrown away');
  assert.doesNotMatch(repair, /Cut it to at most/i, 'nobody pays a model to cut any more');

  // And it is allowed to say there is nothing more to say. A block that is
  // honestly short is a production state; a paragraph of invention is not.
  assert.match(repair, /return an empty/i);

  // The rule that matters most survives the second pass.
  for (const forbidden of [/casualty figures/i, /rupee amounts/i, /quotations/i]) {
    assert.match(repair, forbidden);
  }
});

test('the repair schema returns paragraphs to APPEND, never a rewritten story', () => {
  assert.deepEqual(Object.keys(writer.ADDITIONS_SCHEMA.properties), ['additions']);
  assert.equal(writer.ADDITIONS_SCHEMA.properties.additions.type, 'array');
  assert.equal(writer.ADDITIONS_SCHEMA.additionalProperties, false);
});

test('the resize schema returns copy and nothing else', () => {
  assert.deepEqual(Object.keys(writer.BODY_SCHEMA.properties), ['body']);
  assert.equal(writer.BODY_SCHEMA.additionalProperties, false);
});
