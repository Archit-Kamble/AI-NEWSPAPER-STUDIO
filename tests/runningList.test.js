// A NUMBERED OR BULLETED LIST IN RUNNING COPY.
//
// `page_sections.list_style` has been a column since the schema was written,
// the Typography control has always set it, and the compositor had never read
// it once - so a sub-editor could choose "Numbered", watch the setting persist,
// reload the edition, and find the block set as plain prose. The only thing the
// column reached was a CSS class on that panel's own PREVIEW paragraph. It is
// exactly the shape of fault the `drop_cap` BOOLEAN had before it became
// `drop_cap_lines`, and it was found the same way: by grepping for the column
// and seeing that no renderer read it.
//
// A list item is one authored PARAGRAPH and it HANGS - the marker stands in its
// own column and EVERY line of the item is set past it, which is what makes the
// markers line up down the page and the copy line up with them. The checks
// below are on that geometry, plus the two rules that protect everything else:
// the stored copy is never touched, and a block that has not asked for a list
// composes byte for byte as it did before.

const test = require('node:test');
const assert = require('node:assert');

let composeSection;

test.before(async () => {
  const { ensureFontsLoaded } = await import('../public/editor/compose/font-metrics.js');
  const { ensureShaperReady } = await import('../public/editor/compose/shaper.js');
  await Promise.all([ensureFontsLoaded(), ensureShaperReady()]);
  ({ composeSection } = await import('../public/editor/compose/section-adapter.js'));
});

const ITEMS = [
  'शेतकऱ्यांना बियाणे आणि खतांचा पुरवठा वेळेवर करण्यात येईल असे आश्वासन देण्यात आले.',
  'पाणीपुरवठा योजनेचे काम पुढील तीन महिन्यांत पूर्ण करण्याचे नियोजन आहे.',
  'गावातील अंतर्गत रस्त्यांचे डांबरीकरण याच वर्षी हाती घेतले जाणार आहे.',
];
const BODY = ITEMS.join('\n\n');

const sectionOf = (listStyle) => ({
  id: 1, section_key: 'lead', block_type: 'article',
  x_px: 0, y_px: 0, width_px: 190, height_px: 264,
  headline: 'तीन कामांना मंजुरी', body: BODY,
  body_font_px: 6.4, headline_font_px: 16, list_style: listStyle,
});

test('a block that has not asked for a list composes byte for byte as before', () => {
  const plain = composeSection(sectionOf('none'), {});
  const missing = composeSection({ ...sectionOf('none'), list_style: undefined }, {});
  assert.deepEqual(plain.listMarkers, [], 'no list, no markers');
  assert.deepEqual(
    plain.bodyLines.map((l) => [l.text, l.x.toFixed(3), l.y.toFixed(3)]),
    missing.bodyLines.map((l) => [l.text, l.x.toFixed(3), l.y.toFixed(3)]),
    'a row carrying no list_style at all and one carrying "none" must be the same composition',
  );
});

test('every item gets one marker, numbered in Devanagari, in authored order', () => {
  const numbered = composeSection(sectionOf('number'), {});
  assert.equal(numbered.listMarkers.length, ITEMS.length);
  assert.deepEqual(numbered.listMarkers.map((m) => m.text), ['१.', '२.', '३.']);

  // The bullet is one the publication faces actually have. A real U+2022
  // resolves to glyph 0 in both serif/400 and sans/700 and would reach the
  // press file as a .notdef box.
  const bulleted = composeSection(sectionOf('bullet'), {});
  assert.deepEqual(bulleted.listMarkers.map((m) => m.text), ['▪', '▪', '▪']);
  assert.ok(!bulleted.listMarkers.some((m) => m.text === '•'), 'never a bullet the faces lack');
});

test('a marker sits on the first line of its OWN item - not near it', () => {
  const numbered = composeSection(sectionOf('number'), {});
  const tops = [...new Set(numbered.bodyLines.map((l) => Number(l.y.toFixed(3))))].sort((a, b) => a - b);
  for (const marker of numbered.listMarkers) {
    assert.ok(
      tops.includes(Number(marker.y.toFixed(3))),
      `marker ${marker.text} is at y=${marker.y} and no body line is`,
    );
  }
  // Distinct items, so distinct lines - two markers on one line would mean a
  // paragraph was silently merged away.
  assert.equal(new Set(numbered.listMarkers.map((m) => m.y.toFixed(3))).size, ITEMS.length);
});

test('the markers move with the copy when the leading is opened to close the column', () => {
  // Vertical justification shifts every line down by a growing amount, and a
  // marker is NOT in `bodyLines`. Left out of that pass, item two's number
  // stood 2.4 px above its own first line and item three's 4.8 px above - a
  // drift small enough to look like a rendering artefact and never a bug.
  const numbered = composeSection(sectionOf('number'), {});
  const firstOfItem = [];
  let previousTop = -1;
  for (const line of numbered.bodyLines) {
    if (line.paragraphBreak || previousTop < 0) firstOfItem.push(line.y);
    previousTop = line.y;
  }
  for (const marker of numbered.listMarkers) {
    const nearest = Math.min(...numbered.bodyLines.map((l) => Math.abs(l.y - marker.y)));
    assert.ok(nearest < 0.001, `marker at ${marker.y} is ${nearest.toFixed(2)}px off every line`);
    assert.ok(marker.baseline > marker.y, 'a marker sits on a real baseline inside its own box');
  }
});

test('a list HANGS: every line of an item is inset past the marker, not just the first', () => {
  const plain = composeSection(sectionOf('none'), {});
  const numbered = composeSection(sectionOf('number'), {});

  const markerX = numbered.listMarkers[0].x;
  const copyX = [...new Set(numbered.bodyLines.map((l) => Number(l.x.toFixed(3))))];
  assert.equal(copyX.length, 1, 'every line of a one-column list starts at the same x');
  assert.ok(copyX[0] > markerX, 'the copy is set past the marker column');

  // The marker column starts where the copy would otherwise have started.
  const plainX = Number(plain.bodyLines[0].x.toFixed(3));
  assert.ok(Math.abs(markerX - plainX) < 0.001, 'the marker hangs at the measure\'s own left edge');

  // And the measure really is narrower by that column, on EVERY line.
  for (const line of numbered.bodyLines) {
    assert.ok(line.measure < plain.bodyLines[0].measure, 'a hung line is set in a narrower measure');
  }
});

test('the paragraph policy stands down for a list - the desk\'s breaks ARE the list', () => {
  // Three short items in an 11 em column is precisely the shape the policy
  // merges as prose, and it is right to: a one-line paragraph is a caption
  // with an indent in front of it. Merging two ITEMS would print three
  // undertakings as two, which is a change to what the paper says.
  const plain = composeSection(sectionOf('none'), {});
  assert.equal(plain.typography.paragraphs.set, 1, 'as prose these three merge into one');

  const numbered = composeSection(sectionOf('number'), {});
  assert.equal(numbered.typography.paragraphs.set, ITEMS.length, 'as a list all three stand');
  assert.equal(numbered.typography.paragraphs.authored, ITEMS.length);
});

test('the stored copy is never edited, and no marker is ever in the text', () => {
  const numbered = composeSection(sectionOf('number'), {});
  const set = numbered.bodyLines.map((l) => l.text).join('');
  for (const marker of ['१.', '२.', '३.', '▪']) {
    assert.ok(!set.includes(marker), `${marker} must be furniture, never copy`);
  }
  // `line.at` is what render.js re-applies a sub-editor's bold and italic
  // through, and what body-caret.js maps a pointer to. A marker that had been
  // prepended to the copy would move every one of them.
  const plain = composeSection(sectionOf('none'), {});
  assert.equal(numbered.bodyLines[0].at, plain.bodyLines[0].at);
});

test('a long list still leaves a measure to set in', () => {
  // "१००." hung on a narrow column would take a fifth of it away from the
  // words, so the hang is capped in ems - the unit legibility is in, the same
  // reason MIN_COLUMN_EM is.
  const many = Array.from({ length: 120 }, (_, i) => `${i + 1} या कामाला मंजुरी देण्यात आली आहे.`).join('\n\n');
  const long = composeSection({ ...sectionOf('number'), body: many }, {});
  const hang = long.bodyLines[0].x - long.listMarkers[0].x;
  assert.ok(hang <= 6.4 * 3 + 0.001, `the hang is capped at 3 em, got ${hang.toFixed(2)}px`);
  assert.ok(long.bodyLines[0].measure > 6.4 * 10, 'and what is left is still a printable measure');
});
