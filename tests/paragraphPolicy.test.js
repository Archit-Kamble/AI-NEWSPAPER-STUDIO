// A paragraph is set in LINES, not written in sentences.
//
// Every one of these numbers came off the real database before the policy
// existed. Across 80 real multi-paragraph article blocks, 88.4% of the
// paragraphs the reporters wrote were setting in three lines or fewer and
// 51.1% were setting in ONE - a column of indents with a fragment after each.
// Across 600 real article blocks the other end was just as wrong: 77
// paragraphs ran past ten lines and the deepest ran 27, which is the grey
// slab the same style guides warn against.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

let compose;
let policy;
let adapter;

test.before(async () => {
  compose = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'compose.js'));
  policy = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'paragraph-policy.js'));
  adapter = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'section-adapter.js'));
  const metrics = await import(path.join(__dirname, '..', 'public', 'editor', 'compose', 'font-metrics.js'));
  await metrics.ensureFontsLoaded();
});

const SENTENCE = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे. ';
const BLOCK = {
  width_px: 190, height_px: 600, margin_px: 4, column_count: 1,
  line_height: 1.45, headline_font_px: 17, subheading_font_px: 11, body_font_px: 9,
  text_align: 'justify', paragraph_spacing_px: 0,
};

/** The set paragraphs of a composition, in equivalent lines. */
function depths(result) {
  return result.typography.paragraphs.depths;
}

// --------------------------------------------------------------- the plan ---

test('a paragraph too shallow to read as one is merged forward', () => {
  const plan = policy.planParagraphs({ text: 'x'.repeat(90), starts: [0, 30, 60], depths: [1, 1, 1] });
  assert.deepEqual(plan.starts, [0], 'three one-line paragraphs in one block are one paragraph');
  assert.equal(plan.merged, 2);
});

test('a story that ENDS on a stub merges it backwards - there is nothing to merge it into forwards', () => {
  const plan = policy.planParagraphs({ text: 'x'.repeat(90), starts: [0, 30, 60], depths: [4, 4, 1] });
  assert.deepEqual(plan.starts, [0, 30], 'the last break cannot be kept: nothing after it reaches the floor');
});

test('a break with a real paragraph on both sides of it is kept', () => {
  const plan = policy.planParagraphs({ text: 'x'.repeat(90), starts: [0, 30, 60], depths: [4, 4, 4] });
  assert.deepEqual(plan.starts, [0, 30, 60]);
  assert.equal(plan.changed, false, 'nothing to do is reported as nothing to do');
});

test('a slab is split, and only ever at a sentence end', () => {
  const text = 'एक दोन तीन. '.repeat(30);
  const plan = policy.planParagraphs({ text, starts: [0], depths: [24] });
  assert.ok(plan.split >= 2, '24 lines of thirty sentences is several paragraphs, not one');
  for (const at of plan.starts.slice(1)) {
    assert.match(text.slice(Math.max(0, at - 3), at), /[।॥.!?]\s+$/,
      'a compositor may choose where a PARAGRAPH starts, never where a sentence does');
  }
});

test('a slab with no sentence end in it is left alone rather than cut mid-sentence', () => {
  const plan = policy.planParagraphs({ text: 'एकदोनतीन '.repeat(60), starts: [0], depths: [24] });
  assert.deepEqual(plan.starts, [0]);
  assert.equal(plan.split, 0);
});

test('splitting never manufactures a paragraph the merger would take straight back', () => {
  // Seven lines over the ceiling is not two paragraphs of three and a bit; it
  // is one that stays, because the pieces would be under the floor.
  const text = 'एक दोन तीन. '.repeat(10);
  const plan = policy.planParagraphs({ text, starts: [0], depths: [7] });
  assert.equal(plan.starts.length, 2, 'seven lines affords two paragraphs, never three');
  const second = policy.planParagraphs({ text: 'एक दोन तीन चार पाच.', starts: [0], depths: [4] });
  assert.deepEqual(second.starts, [0], 'and a paragraph inside both bounds is never touched');
});

test('a wide block is bounded by SENTENCES, where the line bound never fires', () => {
  // The measured case: the front page's 268x248 lead set eight whole
  // sentences as ten lines. Inside the line ceiling, and still a wall.
  const text = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी योजना जाहीर केली आहे. '.repeat(8);
  const plan = policy.planParagraphs({ text, starts: [0], depths: [10] });
  assert.ok(plan.split >= 2, 'eight sentences is not one paragraph, however few lines they set');
  assert.equal(plan.starts.length, 3, 'three paragraphs of about three sentences each');
});

// ------------------------------------------------------ against real type ---

test('one-sentence paragraphs in a real block are SET as one paragraph', () => {
  const body = [SENTENCE, SENTENCE, SENTENCE].join('\n\n');
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
  assert.equal(r.typography.paragraphs.authored, 3, 'the reporter typed three');
  assert.equal(r.typography.paragraphs.set, 1, 'the block sets one');
  assert.equal(r.bodyLines.filter((l) => l.paragraphBreak).length, 0, 'and draws no break');
});

test('the stored copy is never edited - the same body sets differently in a wider block', () => {
  const body = [SENTENCE, SENTENCE, SENTENCE].join('\n\n');
  const narrow = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
  const wide = adapter.composeSection({ ...BLOCK, width_px: 90, height_px: 900, images: [] },
    { headline: '', subheading: '', body });
  assert.equal(narrow.typography.paragraphs.set, 1);
  assert.ok(wide.typography.paragraphs.set > 1,
    'the same three sentences are three real paragraphs once the measure is narrow enough');
});

test('no paragraph is set below the floor or above the ceiling in a real block', () => {
  const body = Array.from({ length: 12 }, () => SENTENCE).join('\n\n');
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
  const set = depths(r);
  assert.ok(set.length >= 2, 'a 600px block holds more than one paragraph');
  for (const d of set.slice(0, -1)) {
    assert.ok(d >= policy.MIN_PARAGRAPH_LINES - 0.05, `a set paragraph of ${d} lines is not a paragraph`);
  }
  for (const d of set) {
    assert.ok(d <= policy.MAX_PARAGRAPH_LINES + 1.5, `a set paragraph of ${d} lines is a slab`);
  }
});

test('a single long paragraph is broken up rather than printed as a slab', () => {
  const body = SENTENCE.repeat(14);
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
  assert.equal(r.typography.paragraphs.authored, 1);
  assert.ok(r.typography.paragraphs.split >= 1, 'the compositor breaks it');
  for (const d of depths(r)) {
    assert.ok(d <= policy.MAX_PARAGRAPH_LINES + 1.5, `${d} lines unbroken is the wall of type the rule exists to stop`);
  }
});

// ------------------------------------------------------------ correctness ---

test('merging a paragraph moves no character of the copy', () => {
  const body = [SENTENCE, SENTENCE, SENTENCE].join('\n\n');
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
  // Every line still points at the text it was taken from - this is what
  // render.js re-applies the sub-editor's bold/italic marks through.
  for (const line of r.bodyLines) {
    const source = body.slice(line.at, line.at + line.text.length).replace(/\n/g, ' ');
    assert.equal(source, line.text, `line at ${line.at} must be the body's own text at that offset`);
  }
});

test('a body that overflows still reports the overset text exactly, blank lines and all', () => {
  const body = [SENTENCE.repeat(3), SENTENCE.repeat(3), SENTENCE.repeat(3)].join('\n\n');
  const r = adapter.composeSection({ ...BLOCK, height_px: 120, images: [] },
    { headline: '', subheading: '', body });
  assert.ok(r.overset.body.length > 0, 'this block is far too small for the copy');
  assert.ok(body.endsWith(r.overset.body.trimEnd()) || body.includes(r.overset.body.trimEnd()),
    'the overset must be a real tail of the stored body, not a reassembly of it');
  assert.ok(r.overset.body.includes('\n\n'), 'including the blank lines the reporter typed');
});

test('an empty or blank-line-only body sets no paragraphs and does not crash', () => {
  for (const body of ['', '\n\n', '   \n\n   ']) {
    const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body });
    assert.equal(r.bodyLines.length, 0, `${JSON.stringify(body)} must set nothing`);
  }
});

test('the budget reserves the room the block\'s own paragraph cadence takes', () => {
  // A block deep enough that the geometry alone forces a paragraph break -
  // one every MAX_PARAGRAPH_LINES, whatever the copy says. Quoting a floor
  // that ignored that break wasted a line and overflowed.
  //
  // Only the GEOMETRY's breaks are reserved. How often the writer reaches a
  // full stop is the writer's, exactly like an authored blank line, and is
  // caught by the exact overflow check rather than by the budget.
  const r = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body: '' });
  const unit = 'सातारा जिल्ह्यातील शेतकऱ्यांसाठी राज्य सरकारने नवीन योजना जाहीर केली आहे. ';
  const filled = unit.repeat(Math.floor(r.capacity.bodyCharRange.min / unit.length));
  const set = adapter.composeSection({ ...BLOCK, images: [] }, { headline: '', subheading: '', body: filled });
  assert.equal(set.overset.body, '', 'copy written to the floor must fit even once the compositor breaks it');
});
