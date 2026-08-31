// REMOVING AN EDITION.
//
// There was no way to. This newsroom's own database reached 221 editions
// across 13 dates - mis-typed dates, interrupted starts, test fixtures named
// "ZZ …" - and the only way to be rid of one was to open psql. A desk cannot
// be asked to write SQL to tidy up after a typo, and an archive nobody can
// prune is one nobody can find anything in.
//
// What these hold is the shape of the refusal, not the deleting: a delete
// that works is easy and a delete that refuses correctly is the whole safety
// argument.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');

test.after(() => pool.end());

const startServer = (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  return server;
};

async function throwaway(desk, name, { date } = {}) {
  const day = date || `2099-0${1 + Math.floor(Math.random() * 9)}-${10 + Math.floor(Math.random() * 18)}`;
  return desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name, publicationDate: day }),
  });
}

test('an edition and everything on its pages goes, and the row is really gone', async (t) => {
  const server = startServer(t);
  const desk = await signIn(server.address().port);
  const edition = await throwaway(desk, 'ZZ delete me');
  t.after(() => removeEdition(edition.id));

  const page = await desk.json(`/api/newspapers/${edition.id}/pages`, {
    method: 'POST', body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  const { rows: before } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM page_sections WHERE page_id = $1', [page.id],
  );
  assert.ok(before[0].n > 0, 'the fixture page should carry blocks');

  const response = await desk(`/api/newspapers/${edition.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  // The answer names what went, so the desk can be told rather than guessing.
  assert.equal(Number(result.removed.page_count), 1);
  assert.equal(Number(result.removed.block_count), before[0].n);

  const { rows: after } = await pool.query('SELECT id FROM newspapers WHERE id = $1', [edition.id]);
  assert.equal(after.length, 0, 'the edition row is gone');
  // pages -> page_sections cascade from the edition, which is why the service
  // is one statement rather than a walk. If that stops being true this fails.
  const { rows: orphanPages } = await pool.query('SELECT id FROM pages WHERE id = $1', [page.id]);
  assert.equal(orphanPages.length, 0, 'its pages went with it');
  const { rows: orphanBlocks } = await pool.query(
    'SELECT id FROM page_sections WHERE page_id = $1', [page.id],
  );
  assert.equal(orphanBlocks.length, 0, 'its blocks went with it');
});

test('an edition published as an e-paper refuses, and says which thing to do first', async (t) => {
  const server = startServer(t);
  const desk = await signIn(server.address().port);
  const edition = await throwaway(desk, 'ZZ released');
  t.after(() => removeEdition(edition.id));

  // The one refusal this route carries. It is about the READER, not the desk:
  // a released issue is a promise already made to whoever holds the link.
  await pool.query(
    `UPDATE newspapers SET epaper_released_at = CURRENT_TIMESTAMP, epaper_source = 'current_canvas' WHERE id = $1`,
    [edition.id],
  );

  const response = await desk(`/api/newspapers/${edition.id}`, { method: 'DELETE' });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'EPAPER_RELEASED');
  assert.match(body.error, /public copy/i);

  const { rows } = await pool.query('SELECT id FROM newspapers WHERE id = $1', [edition.id]);
  assert.equal(rows.length, 1, 'the edition is still there');

  // And once the public copy is gone, it deletes - so the refusal is a step in
  // a sequence rather than a wall.
  await pool.query(
    `UPDATE newspapers SET epaper_released_at = NULL, epaper_selected = FALSE WHERE id = $1`,
    [edition.id],
  );
  const second = await desk(`/api/newspapers/${edition.id}`, { method: 'DELETE' });
  assert.equal(second.status, 200);
});

test("a reporter's filing outlives the edition it was placed in", async (t) => {
  const server = startServer(t);
  const desk = await signIn(server.address().port);
  const edition = await throwaway(desk, 'ZZ filing survives');
  t.after(() => removeEdition(edition.id));

  // news_items.newspaper_id is ON DELETE SET NULL rather than CASCADE, and
  // that is deliberate: a filing belongs to the reporter who wrote it, not to
  // the edition somebody placed it in, and it stays in their queue to be used
  // again. Deleting an edition must never destroy a reporter's work.
  const { rows: filing } = await pool.query(
    `INSERT INTO news_items (title, description, status, newspaper_id)
     VALUES ('ZZ test filing', 'body', 'approved', $1) RETURNING id`,
    [edition.id],
  );
  t.after(() => pool.query('DELETE FROM news_items WHERE id = $1', [filing[0].id]));

  const response = await desk(`/api/newspapers/${edition.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);

  const { rows } = await pool.query(
    'SELECT id, newspaper_id FROM news_items WHERE id = $1', [filing[0].id],
  );
  assert.equal(rows.length, 1, 'the filing is still there');
  assert.equal(rows[0].newspaper_id, null, 'and no longer points at an edition that has gone');
});

test('deleting is a desk action, and a bad address is the caller\'s mistake', async (t) => {
  const server = startServer(t);
  const port = server.address().port;
  const desk = await signIn(port);

  const anon = await fetch(`http://127.0.0.1:${port}/api/newspapers/999999`, { method: 'DELETE' });
  assert.equal(anon.status, 401, 'nobody may delete an edition');

  assert.equal((await desk('/api/newspapers/abc', { method: 'DELETE' })).status, 400);
  assert.equal((await desk('/api/newspapers/99999999', { method: 'DELETE' })).status, 404);
});
