// Writing the empty blocks of a page.
//
// The shape that must NOT be built is one enormous request carrying the whole
// newspaper: the output budget is per request, so twelve stories in one answer
// is exactly the call that spends its budget reasoning and returns nothing; one
// failure loses all twelve; and every block has its own measured hole, so a
// single answer cannot be written to fit any of them.

const test = require('node:test');
const assert = require('node:assert/strict');

let bulk;
test.before(async () => {
  bulk = await import('../public/editor/external-editor/bulk-generate.js');
});

const page = (sections) => ({ id: 1, sections });

// ------------------------------------------------- what may be written at all ---

test('an empty block is written - from its headline, or from today\'s news when it has none', () => {
  const { ready, skipped } = bulk.candidatesOn(page([
    { section_key: 'lead', headline: 'शेतकऱ्यांसाठी योजना', body: '' },
    { section_key: 'second', headline: 'पावसाची हजेरी', body: 'आधीच लिहिलेला मजकूर' },
    { section_key: 'third', headline: '', body: '' },
    { section_key: 'reporter-copy', headline: 'बातमी', body: '', news_item_id: 4 },
    { section_key: 'masthead-advert', headline: 'जाहिरात', body: '', block_type: 'advert' },
    { section_key: 'lead-pictures', headline: 'छायाचित्र', body: '', block_type: 'photo' },
    { section_key: 'calendar-space', headline: '', body: '', block_type: 'feature' },
    { section_key: 'rashi', headline: 'राशिभविष्य', body: '', feature_key: 'rashi' },
    { section_key: 'puzzle', headline: 'सुडोकू', body: '', smart_card_key: 'sudoku' },
  ]));

  assert.deepEqual(ready.map((b) => b.sectionKey), ['lead', 'third'], 'the two writable blocks qualify');
  assert.equal(ready[0].seed, 'शेतकऱ्यांसाठी योजना', 'the headline is the brief when there is one');
  assert.equal(ready[0].fromToday, false);

  // A block with NO headline used to be skipped, on the reasoning that a model
  // asked to fill 800 characters from nothing invents all of them. That was
  // true when it was written; it is not any more. The seed names a place and
  // names today, which is what information/intent.js classifies as
  // `current_news` - so write() fetches and verifies real sources BEFORE
  // spending a call and refuses in Marathi if it cannot. The model is never
  // the source of a current event.
  assert.equal(ready[1].seed, 'महाराष्ट्र आजच्या ताज्या बातम्या');
  assert.equal(ready[1].fromToday, true);

  const why = Object.fromEntries(skipped.map((s) => [s.sectionKey, s.why]));
  assert.match(why.second, /already written/, 'copy is never overwritten');
  assert.match(why['reporter-copy'], /reporter/, "a reporter's story belongs to the reporter");
  assert.match(why['masthead-advert'], /advert/);
  assert.match(why['lead-pictures'], /photograph/);
  assert.match(why['calendar-space'], /feature/);
  assert.match(why.rashi, /standing feature/);
  assert.match(why.puzzle, /standing feature/);
  assert.equal(why.third, undefined, 'a block with no headline is no longer skipped');
});

test("a headline-less block is briefed with the paper's own ground, not a guess", () => {
  const { ready } = bulk.candidatesOn(page([
    { section_key: 'a', headline: '', body: '', location: 'सातारा' },
    { section_key: 'b', headline: '', body: '', category: 'क्रीडा' },
    { section_key: 'c', headline: '', body: '' },
  ]), { place: 'सातारा' });

  // The block's own location first, then what the layout said it is for, then
  // the paper's place of publication - and every one of them names today, so
  // intent.js reads it as a current event and retrieval runs.
  assert.equal(ready[0].seed, 'सातारा आजच्या ताज्या बातम्या');
  assert.equal(ready[1].seed, 'क्रीडा आजच्या ताज्या बातम्या');
  assert.equal(ready[2].seed, 'सातारा आजच्या ताज्या बातम्या');
});

test("the desk's own notes ride along with the headline", () => {
  const { ready } = bulk.candidatesOn(page([
    { section_key: 'lead', headline: 'योजना', body: '', ai_notes: 'आकडेवारी टाळा', language: 'Marathi' },
  ]));
  assert.equal(ready[0].notes, 'आकडेवारी टाळा');
  assert.equal(ready[0].language, 'Marathi');
});

// --------------------------------------------------------- L. the batch itself ---

test('one request per block, never one request for the page', async () => {
  const blocks = Array.from({ length: 7 }, (_, i) => ({ sectionKey: `b${i}`, seed: `story ${i}` }));
  const seen = [];

  const batch = await bulk.runBulk({
    blocks,
    concurrency: 2,
    request: async (block) => {
      seen.push(block.sectionKey);
      return { proposal: { headline: `H ${block.sectionKey}`, body: 'copy' }, fit: { charsUsed: 10, bodyCharBudget: 20 } };
    },
  });

  assert.equal(seen.length, 7, 'seven blocks, seven requests');
  assert.equal(new Set(seen).size, 7, 'and each block asked for exactly once');
  assert.equal(batch.written, 7);
  assert.equal(batch.failed, 0);
});

test('a bulk proposal keeps the same verified-source evidence as a single proposal', async () => {
  const retrieval = {
    status: 'verified',
    query: 'सातारा आजच्या ताज्या बातम्या',
    sources: [{ publisher: 'विश्वसनीय वृत्त', url: 'https://example.test/story' }],
  };
  const batch = await bulk.runBulk({
    blocks: [{ sectionKey: 'empty', fromToday: true }],
    request: async () => ({
      proposal: { headline: 'आजची बातमी', body: 'तपासलेला मजकूर' },
      fit: { charsUsed: 20, bodyCharBudget: 30 },
      retrieval,
    }),
  });

  assert.deepEqual(batch.results[0].retrieval, retrieval,
    'the desk must be able to inspect the publishers and links before accepting');
});

test('no more than the concurrency limit are ever in the air at once', async () => {
  const blocks = Array.from({ length: 9 }, (_, i) => ({ sectionKey: `b${i}` }));
  let inFlight = 0;
  let peak = 0;

  await bulk.runBulk({
    blocks,
    concurrency: 3,
    request: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { proposal: { headline: 'h', body: 'b' }, fit: {} };
    },
  });

  assert.equal(peak, 3, 'three at a time, because a provider has a per-minute ceiling');
  assert.ok(peak <= bulk.CONCURRENCY + 1, 'and the default limit is small on purpose');
});

test('the desk can be told "3 of 12", and which block', async () => {
  const blocks = Array.from({ length: 4 }, (_, i) => ({ sectionKey: `b${i}` }));
  const progress = [];

  await bulk.runBulk({
    blocks,
    concurrency: 1,
    onProgress: (event) => progress.push(event),
    request: async () => ({ proposal: { headline: 'h', body: 'b' }, fit: {} }),
  });

  assert.equal(progress.length, 8, 'a start and a done for every block');
  assert.ok(progress.every((p) => p.total === 4), 'the total is known before the first request');
  assert.ok(progress.every((p) => p.sectionKey), 'and which block it is on');
  assert.equal(progress[progress.length - 1].finished, 4);
});

test('one block failing does not take the batch down', async () => {
  const blocks = [{ sectionKey: 'a' }, { sectionKey: 'b' }, { sectionKey: 'c' }];

  const batch = await bulk.runBulk({
    blocks,
    concurrency: 2,
    request: async (block) => {
      if (block.sectionKey === 'b') throw new Error('provider had a bad minute');
      return { proposal: { headline: 'h', body: 'copy' }, fit: {} };
    },
  });

  assert.equal(batch.written, 2);
  assert.equal(batch.failed, 1);
  const failed = batch.results.find((r) => r.sectionKey === 'b');
  assert.match(failed.error, /bad minute/);
  assert.ok(batch.results.find((r) => r.sectionKey === 'c').proposal, 'the block after it still ran');
});

test('an error the provider reports is carried, not thrown away', async () => {
  const batch = await bulk.runBulk({
    blocks: [{ sectionKey: 'a' }],
    request: async () => ({ error: 'AI could not complete this request within the current output limit.' }),
  });
  assert.equal(batch.failed, 1);
  assert.match(batch.results[0].error, /output limit/);
});

test('results come back in page order however the workers finish', async () => {
  const blocks = [{ sectionKey: 'first' }, { sectionKey: 'second' }, { sectionKey: 'third' }];

  const batch = await bulk.runBulk({
    blocks,
    concurrency: 3,
    request: async (block) => {
      // Deliberately finishes in reverse.
      const wait = { first: 30, second: 15, third: 1 }[block.sectionKey];
      await new Promise((resolve) => setTimeout(resolve, wait));
      return { proposal: { headline: block.sectionKey, body: 'b' }, fit: {} };
    },
  });

  assert.deepEqual(batch.results.map((r) => r.sectionKey), ['first', 'second', 'third'],
    'a desk reads a page from the top');
});

test('an empty page asks the model for nothing', async () => {
  let called = 0;
  const batch = await bulk.runBulk({ blocks: [], request: async () => { called += 1; return {}; } });
  assert.equal(called, 0);
  assert.equal(batch.written, 0);
});
