// The initial letter, and the copy that runs round it.
//
// The desk asked for "make one character big at the start", pressed the size
// button, and got a letter on a stilt: a size mark is a property of a RUN, so
// a 28px run inside an 8px line only makes THAT ROW three and a half times
// taller and leaves a band of white beneath it. A drop cap is a property of
// the FRAME. In this engine it is one more rectangle type may not enter -
// exactly what a photograph is - so the runaround comes from the machinery
// that was already there.
//
// Every check here is on the geometry, not on a screenshot: how deep the cap
// is, which lines it narrows, that the copy does not repeat it, and - the one
// that protects everything else - that a block which has not asked for a drop
// cap composes byte for byte as it did before.

const test = require('node:test');
const assert = require('node:assert');

let composeSection;
let composeBlock;

test.before(async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  ({ composeSection } = await import('../public/editor/compose/section-adapter.js'));
  ({ composeBlock } = await import('../public/editor/compose/compose.js'));
});

const COPY = 'सातारा जिल्ह्यातील तीन तालुक्यांसाठी प्रस्तावित असलेल्या पाणीपुरवठा योजनेला जिल्हा '
  + 'नियोजन समितीने बुधवारी मंजुरी दिली. या योजनेतून एकूण बेचाळीस गावांना थेट नळजोडणी मिळणार '
  + 'असून पुढील दोन वर्षांत काम पूर्ण करण्याचे उद्दिष्ट ठेवण्यात आले आहे. समितीच्या बैठकीत '
  + 'योजनेच्या आराखड्यावर सविस्तर चर्चा झाली. पाण्याचा उपसा कोयना नदीतून करण्यात येणार आहे.';

const block = (extra = {}) => ({
  width_px: 268, height_px: 248, block_type: 'article', margin_px: 1,
  headline: 'सातारा जिल्ह्यात पाणी योजना मंजूर',
  subheading: 'तीन तालुक्यांतील गावांना थेट लाभ मिळणार',
  body: COPY, images: [], ...extra,
});

test('a block that has not asked for a drop cap is composed exactly as before', () => {
  const shape = (c) => c.bodyLines.map((l) => `${l.at}|${l.x.toFixed(2)}|${l.y.toFixed(2)}|${l.measure.toFixed(2)}|${l.text}`).join('\n');
  const without = composeSection(block(), {});
  const zero = composeSection(block({ drop_cap_lines: 0 }), {});
  assert.equal(without.dropCap, null, 'no cap is composed');
  assert.equal(shape(zero), shape(without), 'an explicit 0 is the same as saying nothing');
});

test('the cap is set over the number of lines it was asked for, and narrows exactly those', () => {
  for (const deep of [2, 3, 4]) {
    const c = composeSection(block({ drop_cap_lines: deep }), {});
    assert.ok(c.dropCap, `${deep}: a cap is composed`);

    // Judged by where each line STARTS, not by its measure: a paragraph's
    // first line is legitimately shorter than its measure because of the
    // indent, and a test that could not tell an indent from a drop cap would
    // pass on a cap one line too deep.
    const capRight = c.dropCap.x + c.dropCap.width;
    const beside = c.bodyLines.filter((l) => l.x >= capRight);
    assert.equal(beside.length, deep,
      `${deep} lines deep pushes exactly ${deep} lines aside, not ${beside.length}`);
    for (let i = 0; i < deep; i += 1) {
      assert.ok(c.bodyLines[i].x >= capRight, `${deep}: line ${i} clears the cap`);
    }
    assert.ok(c.bodyLines[deep].x < capRight, `${deep}: line ${deep} runs the full measure again`);
  }
});

test('the cap is the first AKSHARA, and the copy does not set it a second time', () => {
  const c = composeSection(block({ drop_cap_lines: 3 }), {});
  assert.equal(c.dropCap.text, 'सा', 'one cluster - स plus its matra, not a bare consonant');
  assert.ok(!c.bodyLines[0].text.startsWith('सा'), 'the copy resumes after the cap');
  assert.ok(c.bodyLines[0].text.startsWith('तारा'), `resumed at "${c.bodyLines[0].text.slice(0, 12)}"`);
});

test('every mark a sub-editor set stays on the same words', () => {
  // `line.at` is how render.js puts bold and italic back on the right
  // characters. Skipping the cap's clusters in the pour must not shift it.
  const c = composeSection(block({ drop_cap_lines: 3 }), {});
  assert.equal(c.bodyLines[0].at, 'सा'.length,
    'the first line reports its real offset in the authored copy, past the cap');
  for (const line of c.bodyLines) {
    assert.equal(COPY.slice(line.at, line.at + line.text.length).replace(/\s+/g, ' '),
      line.text.replace(/\s+/g, ' '), `line at ${line.at} points at its own words`);
  }
});

test('the cap is aligned by its head stroke and its baseline, not by its design box', () => {
  const plain = composeSection(block(), {});
  const c = composeSection(block({ drop_cap_lines: 3 }), {});
  // The ORDINARY band, from the block's own type - never the distance between
  // two poured lines, which the leading may legitimately have opened to close
  // the foot of the column (compose.js's MAX_LEADING_STRETCH).
  const band = plain.typography.bodyPx * plain.typography.lineHeight;
  // Its body - head stroke to baseline - spans three line boxes to within a
  // pixel. Sized by the 1.555em design box instead it came out barely half
  // that, which is the "letter sitting in its own hole" this test exists for.
  const body = c.dropCap.fontPx * 0.625;
  assert.ok(Math.abs(body - ((3 - 1) * band + plain.typography.bodyPx * 0.625)) < 1,
    `cap body ${body.toFixed(1)}px against ${((3 - 1) * band + plain.typography.bodyPx * 0.625).toFixed(1)}px expected`);
  assert.ok(c.dropCap.y > plain.content.top, 'it starts at the first line\'s own head stroke, not at the frame edge');
});

test('a cap never pushes copy off the block', () => {
  // It takes room, so a block already full to the foot may overset - but a
  // block with room must not, and the cap must never lose text silently.
  for (const deep of [0, 2, 3, 4]) {
    const c = composeSection(block({ drop_cap_lines: deep }), {});
    assert.equal(c.overset.body || '', '', `${deep} lines: nothing overset`);
    const set = c.bodyLines.map((l) => l.text).join(' ').replace(/\s+/g, '');
    const capped = (c.dropCap?.text || '') + set;
    assert.equal(capped.length, COPY.replace(/\s+/g, '').length,
      `${deep} lines: every character is still set`);
  }
});

test('two columns: the cap stands in the first one only', () => {
  // Enough copy to reach the second column - a block that simply runs out
  // before it gets there proves nothing about where the cap stands.
  const c = composeBlock({
    width: 268, height: 248, padding: 1, columnCount: 2, bodyFontPx: 6.4,
    body: new Array(12).fill(COPY).join(' '), headline: '', subheading: '',
    dropCapLines: 3, expectsCopy: true,
  });
  assert.ok(c.dropCap, 'a cap is composed');
  const second = c.columns[1];
  const inSecond = c.bodyLines.filter((l) => l.x >= second.start - 0.5);
  assert.ok(inSecond.length > 0, 'the second column is used');
  const widest = Math.max(...inSecond.map((l) => l.measure));
  for (const line of inSecond) {
    assert.ok(line.measure > widest - 0.5, 'no line in the second column is narrowed by the cap');
  }
});
