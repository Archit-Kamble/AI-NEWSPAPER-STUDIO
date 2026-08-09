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
  // A floor as well as a ceiling: copy that fills half a block leaves a hole.
  assert.match(brief, /between 690 and 812/, 'a range, so the block is actually filled');
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
    fit: { bodyCharBudget: 300, bodyWordBudget: 50, cols: 40, rows: 20, hasPictures: true },
    section: { width_px: 200, height_px: 200 },
    language: 'Marathi',
    isLead: false,
  });
  assert.match(brief, /after its pictures are placed/);
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

test('the budget is measured on the shared character grid, not a private copy', async () => {
  const section = {
    width_px: 300, height_px: 300, margin_px: 12, column_count: 1,
    line_height: 1.45, headline_font_px: 24, subheading_font_px: 14, body_font_px: 10,
    headline: 'मथळा', subheading: '', body: '',
  };
  const mine = await writer.measure(section, []);

  const { buildFlowMap } = await import('../public/editor/layout/text-flow.js');
  const theirs = buildFlowMap(section, {
    headline: 'मथळा', subheading: '', body: '',
    marginPx: 12, columnCount: 1, lineHeight: 1.45,
    headlineFontPx: 24, subheadingFontPx: 14, bodyFontPx: 10,
  }, []);

  assert.equal(mine.bodyCharBudget, theirs.bodyCharBudget,
    'the AI is briefed with the same number the editor and preflight use');
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
