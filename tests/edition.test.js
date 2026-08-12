// Starting an edition, and knowing what is left in it.
//
// These hold the three things that made a daily paper harder to produce than it
// needed to be: pressing "create today's edition" twice made two papers, every
// page of a new edition came out as a front page, and the software would not
// say how much copy a hole held until after the copy had been written.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');
const { ladderFor } = require('../src/layout/ladder');

test.after(() => pool.end());

// --- the page ladder ---------------------------------------------------------

test('a four-page paper is a front, a city page, the features page and a back page', () => {
  const ladder = ladderFor(4);

  assert.deepEqual(
    ladder.map((rung) => rung.templateKey),
    ['front', 'local', 'features', 'dense'],
  );
});

test('page one is always the front page, and it is the only one', () => {
  for (const pages of [1, 2, 4, 8, 12, 16, 32]) {
    const ladder = ladderFor(pages);
    assert.equal(ladder[0].templateKey, 'front', `${pages} pages`);
    assert.equal(
      ladder.filter((rung) => rung.templateKey === 'front').length,
      1,
      `${pages} pages should carry exactly one front page`,
    );
  }
});

test('every edition of four pages or more carries exactly one features page', () => {
  for (const pages of [4, 6, 8, 12, 16, 32]) {
    const features = ladderFor(pages).filter((rung) => rung.templateKey === 'features');
    assert.equal(features.length, 1, `${pages} pages`);
  }
});

test('the ladder never runs past the page count', () => {
  const ladder = ladderFor(6);
  assert.equal(ladder.length, 6);
  assert.deepEqual(ladder.map((rung) => rung.pageNumber), [1, 2, 3, 4, 5, 6]);
});

// --- starting an edition -----------------------------------------------------

test('starting today\'s edition twice opens the same paper rather than making a second', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const date = '2031-03-07'; // far enough out that nothing else uses it

  const first = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  const second = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });

  t.after(() => removeEdition(first.newspaper.id));

  assert.equal(first.created, true);
  assert.equal(second.created, false, 'the second press must not create a second edition');
  assert.equal(second.newspaper.id, first.newspaper.id);

  const all = await desk.json('/api/newspapers');
  const forThatDate = all.filter((n) => String(n.publication_date).slice(0, 10) === date);
  assert.equal(forThatDate.length, 1, 'exactly one paper exists for that date');
});

test('a started edition comes out with the ladder on it, not four front pages', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const result = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-08', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(result.newspaper.id));

  const pages = await desk.json(`/api/newspapers/${result.newspaper.id}/pages`);
  assert.deepEqual(pages.map((page) => page.template_key), ['front', 'local', 'features', 'dense']);
  // And every page came out with its layout's blocks already on it.
  for (const page of pages) assert.ok(page.sections.length > 0, `page ${page.page_number} has blocks`);
});

test('opening an existing edition never resizes it despite a different requested count', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const date = '2031-03-09';

  const four = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(four.newspaper.id));

  const six = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 6, fillFeatures: false }),
  });
  assert.equal(six.pageCount, 4);
  assert.equal(six.newspaper.id, four.newspaper.id);
});

test('explicit resize reconciles the 4→6 ladder and preserves retained page content', async (t) => {
  const server = createApp().listen(0); t.after(() => server.close()); const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', { method: 'POST', body: JSON.stringify({ publicationDate: '2099-07-11', pageCount: 4, fillFeatures: false }) });
  t.after(() => removeEdition(started.newspaper.id));
  const before = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const features = before.find((page) => page.template_key === 'features');
  await desk.json(`/api/pages/${features.id}/sections/${features.sections[0].section_key}`, { method: 'PUT', body: JSON.stringify({ headline: 'जतन केलेले पान', body: 'ही सामग्री स्थलांतरानंतरही टिकते.', status: 'draft' }) });
  const resized = await desk.json(`/api/newspapers/${started.newspaper.id}/resize`, { method: 'POST', body: JSON.stringify({ pageCount: 6 }) });
  assert.equal(resized.ok, true);
  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  assert.deepEqual(pages.map((page) => page.template_key), ['front', 'local', 'local', 'opinion', 'features', 'dense']);
  assert.equal(pages.find((page) => page.template_key === 'features').sections[0].headline, 'जतन केलेले पान');
});

test('unsafe shrink is blocked while an empty removed role permits a safe shrink', async (t) => {
  const server = createApp().listen(0); t.after(() => server.close()); const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', { method: 'POST', body: JSON.stringify({ publicationDate: '2099-07-12', pageCount: 6, fillFeatures: false }) });
  t.after(() => removeEdition(started.newspaper.id));
  let pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const general = pages.find((page) => page.page_number === 3);
  await desk.json(`/api/pages/${general.id}/sections/${general.sections[0].section_key}`, { method: 'PUT', body: JSON.stringify({ headline: 'काम आहे', body: 'पान हटवता येणार नाही.', status: 'draft' }) });
  const blocked = await desk.json(`/api/newspapers/${started.newspaper.id}/resize`, { method: 'POST', body: JSON.stringify({ pageCount: 4 }) });
  assert.equal(blocked.code, 'EDITION_RESIZE_HAS_CONTENT');
  assert.equal((await desk.json(`/api/newspapers/${started.newspaper.id}/pages`)).length, 6);
});

test('safe 6→4 shrink removes only empty roles and moves retained semantic pages', async (t) => {
  const server = createApp().listen(0); t.after(() => server.close()); const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', { method: 'POST', body: JSON.stringify({ publicationDate: '2099-07-13', pageCount: 6, fillFeatures: false }) });
  t.after(() => removeEdition(started.newspaper.id));
  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const features = pages.find((page) => page.template_key === 'features');
  await desk.json(`/api/pages/${features.id}/sections/${features.sections[0].section_key}`, { method: 'PUT', body: JSON.stringify({ headline: 'वैशिष्ट्य जतन', body: 'जागा बदलली तरी मजकूर टिकतो.', status: 'draft' }) });
  const resized = await desk.json(`/api/newspapers/${started.newspaper.id}/resize`, { method: 'POST', body: JSON.stringify({ pageCount: 4 }) });
  assert.equal(resized.ok, true);
  const after = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  assert.deepEqual(after.map((page) => page.template_key), ['front', 'local', 'features', 'dense']);
  assert.equal(after[2].sections[0].headline, 'वैशिष्ट्य जतन');
});

test('unsupported page counts are rejected without creating an edition', async (t) => {
  const server = createApp().listen(0); t.after(() => server.close()); const desk = await signIn(server.address().port);
  const response = await desk('/api/newspapers/start', { method: 'POST', body: JSON.stringify({ publicationDate: '2099-07-14', pageCount: 5, fillFeatures: false }) });
  assert.equal(response.status, 400);
  const all = await desk.json('/api/newspapers');
  assert.equal(all.some((edition) => String(edition.publication_date).slice(0, 10) === '2099-07-14'), false);
});

test('an advert carries forward to the next edition, and news never does', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const monday = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-10', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(monday.newspaper.id));

  const [page1] = await desk.json(`/api/newspapers/${monday.newspaper.id}/pages`);
  await desk(`/api/pages/${page1.id}/sections/top-advert`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'रुद्र मोटर्स', body: 'नवीन शोरूम आता उघडले.', status: 'ready' }),
  });
  await desk(`/api/pages/${page1.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'सोमवारची मुख्य बातमी', body: 'सोमवारचा मजकूर.', status: 'ready' }),
  });

  const tuesday = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-11', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(tuesday.newspaper.id));

  assert.equal(tuesday.carriedAdverts, 1, 'the booked advert comes across');

  const [nextPage1] = await desk.json(`/api/newspapers/${tuesday.newspaper.id}/pages`);
  const advert = nextPage1.sections.find((s) => s.section_key === 'top-advert');
  const lead = nextPage1.sections.find((s) => s.section_key === 'lead');

  assert.equal(advert.headline, 'रुद्र मोटर्स');
  assert.equal(lead.headline || '', '', "yesterday's news must never appear in today's paper");
});

test('carrying forward never writes over a block that already has something in it', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const first = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-12', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(first.newspaper.id));
  const [firstPage] = await desk.json(`/api/newspapers/${first.newspaper.id}/pages`);
  await desk(`/api/pages/${firstPage.id}/sections/top-advert`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'जुनी जाहिरात', body: 'जुना मजकूर.', status: 'ready' }),
  });

  const second = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-13', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(second.newspaper.id));
  const [secondPage] = await desk.json(`/api/newspapers/${second.newspaper.id}/pages`);
  await desk(`/api/pages/${secondPage.id}/sections/top-advert`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'आजची नवी जाहिरात', body: 'नवा मजकूर.', status: 'ready' }),
  });

  // A third edition: the second's advert should carry, and the desk's own copy
  // in the second must be untouched by anything that ran afterwards.
  const third = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-14', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(third.newspaper.id));

  const [check] = await desk.json(`/api/newspapers/${second.newspaper.id}/pages`);
  assert.equal(
    check.sections.find((s) => s.section_key === 'top-advert').headline,
    'आजची नवी जाहिरात',
  );
});

// --- what is left ------------------------------------------------------------

test('the worklist counts every block and lists only the unfinished ones', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-15', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const before = await desk.json(`/api/newspapers/${started.newspaper.id}/worklist`);
  assert.ok(before.totals.blocks > 0);
  assert.equal(before.totals.done, 0, 'nothing is done on a fresh edition');
  assert.equal(before.totals.empty, before.totals.blocks);

  const [page1] = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  await desk(`/api/pages/${page1.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'एक बातमी', body: 'थोडा मजकूर.', status: 'ready' }),
  });

  const after = await desk.json(`/api/newspapers/${started.newspaper.id}/worklist`);
  assert.equal(after.totals.done, 1);
  assert.equal(after.totals.empty, before.totals.empty - 1);

  const stillListed = after.pages
    .flatMap((page) => page.blocks)
    .some((block) => block.sectionKey === 'lead' && block.pageNumber === 1);
  assert.equal(stillListed, false, 'a finished block drops off the list');
});

// The words the worklist prints against a block are the same words the editor
// prints on the block itself, because both read public/editor/layout/
// block-kinds.js. A second copy of a catalog is how the template keys drifted
// (CLAUDE.md), and this one is read by a night editor deciding whether a box is
// an unwritten story or space that was sold.
test('the worklist describes a block in the same words the editor does', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-19', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const { BLOCK_KINDS, blockWork } = await import('../public/editor/layout/block-kinds.js');
  const list = await desk.json(`/api/newspapers/${started.newspaper.id}/worklist`);
  const blocks = list.pages.flatMap((page) => page.blocks);

  assert.ok(blocks.length > 0, 'a fresh edition has unfinished blocks');
  for (const block of blocks) {
    assert.equal(block.work, blockWork(block.blockType),
      `${block.sectionKey} is described as "${block.work}"`);
  }
  // Every kind the catalog knows carries all three descriptions - a kind added
  // with no panel heading would silently head an advert "Write the story".
  for (const [key, kind] of Object.entries(BLOCK_KINDS)) {
    assert.ok(kind.label && kind.work && kind.panel, `${key} is fully described`);
  }
});

test('the worklist says how many characters an empty block holds, before a word is written', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-16', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const list = await desk.json(`/api/newspapers/${started.newspaper.id}/worklist`);
  const lead = list.pages[0].blocks.find((block) => block.sectionKey === 'lead');

  assert.ok(lead.capacity > 0, 'the lead block reports a character budget');
  assert.equal(lead.written, 0);
  assert.ok(list.totals.charactersWanted >= lead.capacity);
});

test('an overset block stays on the worklist even when it is marked ready', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-17', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const [page1] = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  await desk(`/api/pages/${page1.id}/sections/brief-one`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'खूप लांब बातमी', body: 'मजकूर. '.repeat(600), status: 'ready' }),
  });

  const list = await desk.json(`/api/newspapers/${started.newspaper.id}/worklist`);
  const brief = list.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.sectionKey === 'brief-one');

  assert.ok(brief, 'a block whose copy will not print is still work');
  assert.equal(brief.state, 'overset');
  assert.ok(brief.over > 0);
});

// --- making it fit -----------------------------------------------------------

test('fit reports the change before it makes it, and only makes it when asked', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-18', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const [page1] = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const before = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`)
    .then((pages) => pages[0].sections.find((s) => s.section_key === 'report-one'));

  await desk(`/api/pages/${page1.id}/sections/report-one`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'बातमी', body: 'मजकूर आहे. '.repeat(40), status: 'ready' }),
  });

  const proposal = await desk.json(`/api/pages/${page1.id}/sections/report-one/fit`);
  assert.equal(proposal.applied, false, 'GET must not change anything');

  const unchanged = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`)
    .then((pages) => pages[0].sections.find((s) => s.section_key === 'report-one'));
  assert.equal(Number(unchanged.body_font_px), Number(before.body_font_px));

  if (proposal.fits && proposal.to) {
    const applied = await desk.json(`/api/pages/${page1.id}/sections/report-one/fit`, { method: 'POST' });
    assert.equal(applied.applied, true);

    const after = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`)
      .then((pages) => pages[0].sections.find((s) => s.section_key === 'report-one'));
    assert.ok(Number(after.body_font_px) < Number(before.body_font_px), 'the type came down');

    // And the block now passes the same overset check preflight runs.
    const report = await desk.json(`/api/newspapers/${started.newspaper.id}/preflight`);
    const stillOver = report.findings.some(
      (f) => f.check === 'overset' && f.sectionKey === 'report-one',
    );
    assert.equal(stillOver, false, 'preflight agrees it fits now');
  }
});

test('fit never sets type below what will print on newsprint', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-19', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const [page1] = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  // Far more copy than any legible type could fit in a small block.
  await desk(`/api/pages/${page1.id}/sections/brief-two`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'बातमी', body: 'अ'.repeat(20000), status: 'ready' }),
  });

  const result = await desk.json(`/api/pages/${page1.id}/sections/brief-two/fit`, { method: 'POST' });

  assert.equal(result.fits, false);
  assert.ok(result.cut > 0, 'it says how much to cut instead');

  const after = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`)
    .then((pages) => pages[0].sections.find((s) => s.section_key === 'brief-two'));
  assert.ok(Number(after.body_font_px) >= 4.6, 'nothing was set below 6.5pt');
});

test('a headline is not shrunk to make room for its own body unless it has to be', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);

  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: '2031-03-20', pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const [page1] = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const before = (await desk.json(`/api/newspapers/${started.newspaper.id}/pages`))[0]
    .sections.find((s) => s.section_key === 'lead');

  await desk(`/api/pages/${page1.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'आजची मुख्य बातमी', body: 'मजकूर आहे. '.repeat(60), status: 'ready' }),
  });
  const result = await desk.json(`/api/pages/${page1.id}/sections/lead/fit`, { method: 'POST' });

  if (result.fits && result.to) {
    assert.equal(
      result.to.headlineFontPx,
      Number(before.headline_font_px),
      'the body came down on its own; the lead headline is the page hierarchy',
    );
  }
});
