// WHAT THE PRESS PANEL READS, AND WHAT THE FORME DECIDES.
//
// `PATCH /pages/:id/state` and `PATCH /pages/:id/colour` are both fully built
// and fully tested, and until press-panel.js neither appeared anywhere under
// public/ - so every page in this database sat at its `making_up` default and
// on its `prints_colour = TRUE` default. Since pressReadiness blocks on
// PAGE_NOT_PASSED, that meant the press package, the press-final e-paper and
// the CMYK export were all gated on a readiness no control could produce.
//
// tests/press.test.js already holds the sign-off rules themselves. What is new
// here is the CONTRACT the panel renders from: `GET /newspapers/:id/status`
// has no other caller, so nothing would notice if a field it draws stopped
// arriving.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, newEdition, removeEdition, satisfyPublicationContent } = require('./helpers/desk');

test.after(() => pool.end());

test('the status report carries every field the press panel draws', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { desk, newspaper, pages } = await newEdition(server.address().port, 'ZZ press panel', {
    pages: [[1, 'front']], date: '2099-05-05',
  });
  t.after(() => removeEdition(newspaper.id));
  await satisfyPublicationContent(pages);

  const before = await desk.json(`/api/newspapers/${newspaper.id}/status`);
  // The panel's heading is built from these two.
  assert.equal(before.readyForPress, false);
  assert.deepEqual(before.waitingOn, [1], 'the edition is waiting on its unpassed page');
  // Each row: the stage, its label, and the blockers keyed to their own page.
  const [page] = before.pages;
  assert.equal(page.production_state, 'making_up');
  assert.equal(page.label, 'Being made up');
  assert.ok('state_changed_at' in page && 'passed_by' in page, 'the row says who passed it and when');
  assert.ok(Array.isArray(before.readiness?.blockers), 'the panel lists the real blockers, not preflight errors alone');
  for (const blocker of before.readiness.blockers) {
    assert.ok(typeof blocker.message === 'string' && blocker.message, 'every blocker is a sentence a desk can read');
  }

  const passed = await desk(`/api/pages/${page.id}/state`, {
    method: 'PATCH', body: JSON.stringify({ state: 'passed' }),
  });
  assert.equal(passed.status, 200);

  const after = await desk.json(`/api/newspapers/${newspaper.id}/status`);
  assert.equal(after.pages[0].production_state, 'passed');
  assert.equal(after.pages[0].label, 'Passed for press');
  assert.ok(after.pages[0].state_changed_at, 'a passed page carries the time it was passed');
  assert.ok(after.pages[0].passed_by, 'and the NAME of who passed it - the audit trail is the point');
  assert.deepEqual(after.waitingOn, [], 'and the edition stops waiting on it');
});

test('a page can be pulled back off the stone, and the panel sees it', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { desk, newspaper, pages } = await newEdition(server.address().port, 'ZZ press pullback', {
    pages: [[1, 'front']], date: '2099-05-06',
  });
  t.after(() => removeEdition(newspaper.id));
  await satisfyPublicationContent(pages);

  await desk(`/api/pages/${pages[0].id}/state`, { method: 'PATCH', body: JSON.stringify({ state: 'passed' }) });
  const back = await desk(`/api/pages/${pages[0].id}/state`, { method: 'PATCH', body: JSON.stringify({ state: 'making_up' }) });
  assert.equal(back.status, 200, 'moving backwards is allowed - a page can come off the stone');

  const status = await desk.json(`/api/newspapers/${newspaper.id}/status`);
  assert.equal(status.pages[0].production_state, 'making_up');
  assert.deepEqual(status.waitingOn, [1], 'and the edition is waiting on it again');

  // `passed_by` IS NOT "who passed it" - it is `u.name` joined on
  // `state_changed_by`, so it survives a pull-back and names whoever moved the
  // page LAST. Measured here, because the field's name invites exactly the bug
  // it would cause: a panel reading it directly would print "Passed by Admin"
  // on a page sitting at "Being made up". press-panel.js's whenPassed() gates
  // on the STATE for that reason, and this is what says so.
  assert.ok(status.pages[0].passed_by, 'the field still names the last person to move the page');
  assert.equal(
    status.pages[0].production_state === 'passed', false,
    'so nothing may render it as a sign-off without checking the state first',
  );
  const { rows } = await pool.query('SELECT signoff_fingerprint FROM pages WHERE id = $1', [pages[0].id]);
  assert.equal(rows[0].signoff_fingerprint, null, 'the sign-off fingerprint IS cleared, which is what press readiness reads');
});

test('the forme is a page decision, and it survives a read', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const { desk, newspaper, pages } = await newEdition(server.address().port, 'ZZ press forme', {
    pages: [[1, 'front'], [2, 'local']], date: '2099-05-07',
  });
  t.after(() => removeEdition(newspaper.id));

  // Every page is born on a colour forme (`prints_colour NOT NULL DEFAULT
  // TRUE`), which for a district daily is usually wrong on most of the paper -
  // and until the press panel nothing could say otherwise, so every export
  // asked the press for four plates on every page.
  const fresh = await desk.json(`/api/newspapers/${newspaper.id}/pages`);
  assert.ok(fresh.every((p) => p.prints_colour === true), 'a new page is born in colour');

  const mono = await desk(`/api/pages/${pages[1].id}/colour`, {
    method: 'PATCH', body: JSON.stringify({ printsColour: false }),
  });
  assert.equal(mono.status, 200);

  const after = await desk.json(`/api/newspapers/${newspaper.id}/pages`);
  assert.equal(after.find((p) => p.page_number === 2).prints_colour, false, 'page two prints black only');
  assert.equal(after.find((p) => p.page_number === 1).prints_colour, true, 'and page one is untouched');
});
