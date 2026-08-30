// The Newsdesk Run.
//
// Everything here is deterministic and costs no AI call. The one paid step -
// the planner's own request - is deliberately NOT exercised: what matters
// about it is not what a model answers but what survives `validate()`
// afterwards, and that is where the guarantees are.

const test = require('node:test');
const assert = require('node:assert/strict');

const dedupe = require('../src/services/newsdesk/dedupe');
const planner = require('../src/services/newsdesk/planner');
const writer = require('../src/services/newsdesk/writer');
const { mapLimit } = require('../src/services/newsdesk/parallel');
const blocksOf = require('../src/services/newsdesk/blocks');

const tagsModule = () => import('../public/editor/layout/news-tags.js');

// ------------------------------------------------------- the tag catalogue ---

test('a tag is searched in BOTH languages', async () => {
  const { queryFor } = await tagsModule();
  const query = queryFor('national-politics');
  assert.match(query, /संसद/, 'the Maharashtra feeds publish in Marathi');
  assert.match(query, /parliament/,
    'the national feeds (PIB, the Times, the Hindu, NDTV) publish in English — measured, '
    + 'a Marathi-only query returned 4 items against 107 for the same query in English');
});

test('the local tag searches the paper\'s own place, and falls back rather than searching nothing', async () => {
  const { queryFor } = await tagsModule();
  assert.match(queryFor('local', { place: 'सातारा' }), /सातारा/);
  assert.match(queryFor('local', { place: '' }), /महाराष्ट्र/);
});

test('every query names the day, so intent.js reads it as a current event', async () => {
  const { NEWS_TAGS, queryFor } = await tagsModule();
  for (const tag of NEWS_TAGS) {
    assert.match(queryFor(tag, { place: 'सातारा' }), /ताज्या/, `${tag.key} must read as current news`);
  }
});

test('one tag asked for on three pages is retrieved ONCE', async () => {
  const { retrievalPlanFor } = await tagsModule();
  const plan = retrievalPlanFor(['local', 'local', 'state-politics', 'local'], { place: 'सातारा' });
  assert.equal(plan.length, 2, 'the fan-out is per tag, never per page and never per block');
});

test('an unknown tag is dropped rather than searched for as text', async () => {
  const { retrievalPlanFor, tagFor } = await tagsModule();
  assert.equal(tagFor('not-a-real-tag'), null);
  assert.deepEqual(retrievalPlanFor(['not-a-real-tag']), []);
});

// -------------------------------------------------------------- duplicates ---

test('a duplicate needs three shared words, not just a high ratio', () => {
  // Real pair, and the reason the floor exists: 0.50 on ONE shared word.
  const a = dedupe.tokenSet('पाणीपुरवठा योजनेला गळती');
  const b = dedupe.tokenSet('पाणीपुरवठा बंद');
  const hit = dedupe.containment(a, b);
  assert.ok(hit.score >= dedupe.PLACED_THRESHOLD, 'the ratio alone would call this a duplicate');
  assert.ok(hit.shared < dedupe.MIN_SHARED_WORDS, 'and the floor is what refuses it');
});

test('a matra is not a word boundary', () => {
  // \p{L} excludes Devanagari combining marks; splitting on it turns सातारा
  // into three sub-3-character fragments and the query matches everything.
  const words = [...dedupe.tokenSet('सातारा जिल्ह्यात पाणीटंचाई')];
  assert.ok(words.includes('सातारा'), `सातारा must survive tokenising, got ${JSON.stringify(words)}`);
});

test('a story already on a page is MARKED, never dropped', () => {
  const candidates = [
    { id: 's1', title: 'साताऱ्यात रस्ते दुरुस्तीसाठी निधी मंजूर' },
    { id: 's2', title: 'कोकणात गणेशोत्सवासाठी विशेष एक्स्प्रेस' },
  ];
  const marked = dedupe.markDuplicates(candidates, {
    placed: [{ headline: 'रस्ते दुरुस्तीसाठी निधी मंजूर', page_number: 3, section_key: 'lead' }],
  });
  assert.equal(marked.length, 2, 'day two of a running story is the story, not a duplicate to delete');
  assert.equal(marked[0].duplicate.where, 'edition');
  assert.equal(marked[0].duplicate.page, 3);
  assert.equal(marked[1].duplicate, undefined);
});

test('identical wire copy collapses, and the checked publisher is the one kept', () => {
  const items = [
    { id: 's1', title: 'मंत्रिमंडळाने प्रकल्पाला मान्यता दिली', trust: 'UNKNOWN', openWeb: true },
    { id: 's2', title: 'मंत्रिमंडळाने प्रकल्पाला मान्यता दिली', trust: 'TRUSTED_NEWS', openWeb: false },
  ];
  const out = dedupe.collapseSyndicated(items, { trustRank: (i) => (i.openWeb ? 2 : 0) });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 's2', 'a checked publisher\'s copy of a wire story is the one to keep');
  assert.equal(out[0].alsoRan.length, 1, 'the others are kept as evidence, not thrown away');
});

// ------------------------------------------------------------ the ordinals ---

test('a block descriptor carries NO dimensions', async () => {
  const pages = [{
    id: 1,
    page_number: 1,
    sections: [
      { section_key: 'lead', width_px: 268, height_px: 304, block_type: 'article', headline: '', body: '' },
      { section_key: 'filler', width_px: 60, height_px: 60, block_type: 'article', headline: '', body: '' },
    ],
  }];
  const { blocks } = await blocksOf.emptyBlocks(pages, { place: 'सातारा' });
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    // The pre-write reservation over-promises on 49 of 96 real geometries, so
    // a model handed pixels computes a character count that is wrong on half
    // the page. It gets a rank it cannot measure with.
    for (const key of ['width_px', 'height_px', 'widthPx', 'heightPx', 'area', 'section', 'sectionId']) {
      assert.equal(block[key], undefined, `a planner must never be handed ${key}`);
    }
    // Nor nested one level down, which is how the room measurement nearly
    // reintroduced it.
    assert.ok(!JSON.stringify(block).includes('width_px'),
      'the frame\'s dimensions must not survive anywhere in the descriptor');
    assert.ok(block.sizeRank >= 1);
    assert.ok(typeof block.rung === 'string');
  }
  assert.ok(blocks[0].sizeRank < blocks[1].sizeRank, 'the bigger frame ranks first');
});

test('a block the desk gave a headline is COMMISSIONED, and is not planned', async () => {
  const pages = [{
    id: 1,
    page_number: 1,
    sections: [
      { section_key: 'a', width_px: 200, height_px: 200, block_type: 'article', headline: 'देसाईंची नियुक्ती', body: '' },
      { section_key: 'b', width_px: 200, height_px: 200, block_type: 'article', headline: '', body: '' },
    ],
  }];
  const out = await blocksOf.emptyBlocks(pages, { place: 'सातारा' });
  assert.equal(out.unbriefed.length, 1);
  assert.equal(out.unbriefed[0].sectionKey, 'b');
  assert.equal(out.commissioned.length, 1);
  assert.equal(out.commissioned[0].sectionKey, 'a',
    'handing a wire story to a block somebody wrote a headline into discards an editorial decision');
});

// ------------------------------------------------- what survives validation ---

const POOL = [
  { id: 's001', title: 'A', excerpt: 'The council approved the road.', openWeb: false, trust: 'TRUSTED_NEWS', publisher: 'Lokmat', publisherDomain: 'lokmat.com', tags: ['local'] },
  { id: 's002', title: 'B', excerpt: 'Work begins next week.', openWeb: true, trust: 'UNKNOWN', publisher: 'Pudhari', publisherDomain: 'pudhari.news', tags: ['local'] },
];
const BLOCKS = [
  { page: 1, pageId: 9, sectionKey: 'lead', rung: 'lead', sizeRank: 1 },
  { page: 1, pageId: 9, sectionKey: 'b2', rung: 'small', sizeRank: 9 },
];
const BRIEF = { pages: [{ page: 1, wants: [{ tagKey: 'local', count: 2, demand: 'preferred' }] }] };

test('a source the model invented cannot reach a page', () => {
  const out = planner.validate({
    stories: [{
      page: 1, sectionKey: 'lead', tagKey: 'local', importance: 5,
      sourceIds: ['https://made-up.example/story', 's999'],
      angle: 'x', headlineHint: 'fabricated',
    }],
  }, { blocks: BLOCKS, pool: POOL, brief: BRIEF });

  assert.equal(out.stories.length, 0, 'a story with no real source is discarded whole');
  assert.equal(out.rejected[0].why, 'NO_REAL_SOURCE');
});

test('an invented id is stripped from a story that also cites a real one, and reported', () => {
  const out = planner.validate({
    stories: [{
      page: 1, sectionKey: 'lead', tagKey: 'local', importance: 5,
      sourceIds: ['s001', 's999'], angle: 'x', headlineHint: 'real one',
    }],
  }, { blocks: BLOCKS, pool: POOL, brief: BRIEF });

  assert.deepEqual(out.stories[0].sourceIds, ['s001']);
  assert.deepEqual(out.stories[0].inventedSourceIds, ['s999'],
    'a desk owed six stories out of eight is owed the reason');
});

test('the facts are the SOURCES\' own words, never the model\'s', () => {
  const out = planner.validate({
    stories: [{
      page: 1, sectionKey: 'lead', tagKey: 'local', importance: 5,
      sourceIds: ['s001'], angle: 'x', headlineHint: 'h',
      // A model paraphrase, offered and ignored: the schema has no `facts`.
      facts: ['The council approved a bridge and four flyovers.'],
    }],
  }, { blocks: BLOCKS, pool: POOL, brief: BRIEF });

  assert.deepEqual(out.stories[0].facts, ['The council approved the road.']);
});

test('a block that is not open, and a block claimed twice, are both refused', () => {
  const out = planner.validate({
    stories: [
      { page: 1, sectionKey: 'lead', tagKey: 'local', importance: 5, sourceIds: ['s001'], angle: 'a', headlineHint: 'first' },
      { page: 1, sectionKey: 'lead', tagKey: 'local', importance: 2, sourceIds: ['s002'], angle: 'b', headlineHint: 'double booked' },
      { page: 7, sectionKey: 'ghost', tagKey: 'local', importance: 3, sourceIds: ['s001'], angle: 'c', headlineHint: 'no such block' },
    ],
  }, { blocks: BLOCKS, pool: POOL, brief: BRIEF });

  assert.equal(out.stories.length, 1);
  assert.equal(out.stories[0].headlineHint, 'first', 'the more important story keeps the block');
  const whys = out.rejected.map((r) => r.why).sort();
  assert.deepEqual(whys, ['BLOCK_ALREADY_ASSIGNED', 'BLOCK_NOT_OPEN']);
});

test('no subject may take more than its share of the paper, however big the day\'s news is', () => {
  const blocks = Array.from({ length: 10 }, (_, i) => ({ page: 1, pageId: 9, sectionKey: `b${i}`, rung: 'small', sizeRank: i + 1 }));
  const pool = Array.from({ length: 10 }, (_, i) => ({
    id: `s${i}`, title: `t${i}`, excerpt: `e${i}`, openWeb: false, trust: 'TRUSTED_NEWS',
    publisher: 'P', publisherDomain: 'p.example', tags: ['state-politics'],
  }));
  const out = planner.validate({
    stories: blocks.map((block, i) => ({
      page: 1, sectionKey: block.sectionKey, tagKey: 'state-politics', importance: 10 - i,
      sourceIds: [`s${i}`], angle: 'a', headlineHint: `story ${i}`,
    })),
  }, { blocks, pool, brief: { pages: [{ page: 1, wants: [] }] } });

  assert.ok(out.stories.length <= Math.ceil(10 * planner.MAX_TAG_SHARE),
    'a paper is not a search result — a day dominated by politics is not a page of it');
  assert.equal(out.stories[0].headlineHint, 'story 0',
    'the cap takes the WEAKEST stories, so a dominant subject loses its filler and keeps its lead');
});

test('the concentration cap never refuses what the DESK asked for', () => {
  const blocks = Array.from({ length: 6 }, (_, i) => ({ page: 1, pageId: 9, sectionKey: `b${i}`, rung: 'small', sizeRank: i + 1 }));
  const pool = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i}`, title: `t${i}`, excerpt: `e${i}`, openWeb: false, trust: 'TRUSTED_NEWS',
    publisher: 'P', publisherDomain: 'p.example', tags: ['local'],
  }));
  const out = planner.validate({
    stories: blocks.map((block, i) => ({
      page: 1, sectionKey: block.sectionKey, tagKey: 'local', importance: 5,
      sourceIds: [`s${i}`], angle: 'a', headlineHint: `story ${i}`,
    })),
  }, { blocks, pool, brief: { pages: [{ page: 1, wants: [{ tagKey: 'local', count: 5, demand: 'required' }] }] } });

  assert.equal(out.stories.length, 5,
    'a desk that asked for five local stories gets five — the cap stops the planner '
    + 'over-concentrating, it does not second-guess an editor');
});

test('a story\'s verified flag follows the sources it actually has', () => {
  const out = planner.validate({
    stories: [
      { page: 1, sectionKey: 'lead', tagKey: 'local', importance: 5, sourceIds: ['s001'], angle: 'a', headlineHint: 'checked' },
      { page: 1, sectionKey: 'b2', tagKey: 'local', importance: 4, sourceIds: ['s002'], angle: 'b', headlineHint: 'open web' },
    ],
  }, { blocks: BLOCKS, pool: POOL, brief: BRIEF });

  const byHeadline = Object.fromEntries(out.stories.map((s) => [s.headlineHint, s.verified]));
  assert.equal(byHeadline.checked, true);
  assert.equal(byHeadline['open web'], false);
});

// ---------------------------------------------------------- the fact packet ---

test('an unchecked story stays unchecked all the way into the writer\'s brief', () => {
  const packet = writer.packetFor({
    angle: 'a', verified: false, facts: ['f'], sources: [{ publisher: 'Pudhari' }],
  });
  assert.equal(packet.status, 'unverified',
    'a packet must never launder open-web material into the heading that means "this was checked"');
  assert.equal(packet.mustVerify, true);
});

test('a packet carries the disagreements and the do-not-claims', () => {
  const packet = writer.packetFor({
    angle: 'a', verified: true, facts: ['f'],
    disagreements: ['एक स्रोत ५ म्हणतो, दुसरा ७'],
    doNotClaim: ['मृतांची संख्या'],
    sources: [],
  });
  assert.deepEqual(packet.disagreements, ['एक स्रोत ५ म्हणतो, दुसरा ७']);
  assert.deepEqual(packet.doNotClaim, ['मृतांची संख्या']);
});

// ------------------------------------------------------------- concurrency ---

test('results come back in the order they were asked for, not the order they finished', async () => {
  const out = await mapLimit([40, 5, 20, 1], 2, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3], 'a desk reads a page from the top');
});

test('one block failing does not take the batch down', async () => {
  const out = await mapLimit([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error('provider had a bad minute');
    return n;
  });
  assert.equal(out[0], 1);
  assert.equal(out[1].error, 'provider had a bad minute');
  assert.equal(out[2], 3);
});
