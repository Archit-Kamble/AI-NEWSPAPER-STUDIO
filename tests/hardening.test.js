// WHAT MUST STAY TRUE FOR THIS TO BE SAFE TO RUN A NEWSPAPER ON.
//
// Each case here is a hole that was open, verified against the running server
// before it was closed. They are collected in one file because they share a
// property: none of them is visible in a screenshot, and none of them would be
// noticed on an ordinary day - they are noticed on the day somebody looks for
// them, which for a newspaper is the worst possible day.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { resetLoginThrottle, MAX_FAILURES } = require('../src/middleware/loginThrottle');
const { looksLikeImage, IMAGE_TYPES } = require('../src/middleware/upload');

// A one-pixel PNG, as real bytes - the point of several cases below is that
// what a file CONTAINS is checked, so a fixture that only claims to be a PNG
// would be testing nothing.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function listen() {
  const app = createApp();
  const server = app.listen(0);
  return { server, port: server.address().port };
}

// --------------------------------------------------------------- uploads ---

test('a file is judged by its BYTES, not by what the request called it', () => {
  assert.equal(looksLikeImage(REAL_PNG, '.png'), true);
  assert.equal(looksLikeImage(Buffer.from('<script>alert(1)</script>'), '.png'), false);
  assert.equal(looksLikeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), '.png'), false);
  assert.equal(looksLikeImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), '.jpg'), true);
  // WebP's mark is split: RIFF, then WEBP four bytes on. "RIFF" alone is a
  // container, and could as easily be a .wav.
  assert.equal(looksLikeImage(Buffer.from('RIFF____WAVE'), '.webp'), false);
  assert.equal(looksLikeImage(Buffer.from('RIFF____WEBP'), '.webp'), true);
});

test('an SVG is not an uploadable picture - it is a document that can carry script', () => {
  assert.equal(IMAGE_TYPES.has('image/svg+xml'), false);
  assert.equal(IMAGE_TYPES.has('text/html'), false);
  assert.equal(IMAGE_TYPES.has('image/png'), true);
});

test('an HTML file declared image/png cannot be stored, and cannot be served back as a page', async () => {
  const { server, port } = listen();
  const { signIn } = require('./helpers/desk');
  try {
    const desk = await signIn(port);
    const body = new FormData();
    body.append('images', new Blob(['<script>alert(document.domain)</script>'], { type: 'image/png' }), 'evil.html');
    const response = await fetch(`http://127.0.0.1:${port}/api/uploads/images`, {
      method: 'POST', headers: { Cookie: desk.cookie }, body,
    });
    // Rejected outright. Before this it was written to public/uploads as
    // <uuid>.html and served back as text/html - stored XSS on the origin the
    // desk's own session lives on.
    assert.equal(response.status, 400);
    const answer = await response.json();
    assert.match(answer.error, /not a picture/i);
  } finally {
    server.close();
  }
});

test('a real picture still uploads, and the name on disk is never the caller\'s', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { server, port } = listen();
  const { signIn } = require('./helpers/desk');
  const written = [];
  try {
    const desk = await signIn(port);
    const body = new FormData();
    // A traversing name with a script extension. Both must be discarded.
    body.append('images', new Blob([REAL_PNG], { type: 'image/png' }), '../../evil.html');
    const response = await fetch(`http://127.0.0.1:${port}/api/uploads/images`, {
      method: 'POST', headers: { Cookie: desk.cookie }, body,
    });
    assert.equal(response.status, 201);
    const { imageUrls } = await response.json();
    assert.equal(imageUrls.length, 1);
    written.push(path.basename(imageUrls[0]));
    assert.match(imageUrls[0], /^\/uploads\/\d+-[0-9a-f-]{36}\.png$/,
      'the stored name is this paper\'s own, and the extension comes from the type whitelist');
    assert.ok(!imageUrls[0].includes('..'), 'a traversing filename cannot reach the path');
  } finally {
    await Promise.all(written.map((f) => fs.unlink(path.join(__dirname, '..', 'public', 'uploads', f)).catch(() => {})));
    server.close();
  }
});

// ------------------------------------------------------------- the routes ---

test('an API path that does not exist answers 404 in JSON, not the application shell', async () => {
  const { server, port } = listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/there-is-no-such-thing`);
    // It used to fall through to the SPA catch-all: 200, text/html. So
    // `response.ok` was TRUE and the caller's .json() threw a parse error from
    // inside an async handler, with nothing on screen to say why.
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    assert.match((await response.json()).error, /No such endpoint/);
  } finally {
    server.close();
  }
});

test('a page route still reaches the application shell', async () => {
  const { server, port } = listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/some/desk/route`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
  } finally {
    server.close();
  }
});

test('every response tells the browser not to guess what a file is', async () => {
  const { server, port } = listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    // The layer under the upload whitelist: even a file that somehow got onto
    // disk with an unexpected name may not be re-interpreted as a document.
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  } finally {
    server.close();
  }
});

test('the health check asks the database, so a monitor cannot read green while every request fails', async () => {
  const { server, port } = listen();
  try {
    const body = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    assert.equal(body.status, 'ok');
    assert.equal(body.database, 'ok', 'it must report on the database, not merely on itself');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- signing in ---

test('a password cannot be guessed at without limit', async () => {
  const { server, port } = listen();
  resetLoginThrottle();
  try {
    const attempt = (password) => fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@esahas.com', password }),
    });

    for (let i = 0; i < MAX_FAILURES; i += 1) {
      assert.equal((await attempt(`wrong-${i}`)).status, 401, `attempt ${i + 1} is an ordinary refusal`);
    }
    const blocked = await attempt('wrong-again');
    assert.equal(blocked.status, 429, 'the run of failures is stopped');
    assert.ok(blocked.headers.get('retry-after'), 'and it says when to come back');
    assert.match((await blocked.json()).error, /Too many failed sign-ins/);

    // Locking the ACCOUNT alone would let anyone lock the editor out of their
    // own paper on deadline. The key is the account and the address together,
    // so another account from the same place is unaffected.
    const other = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'someone-else@esahas.com', password: 'x' }),
    });
    assert.equal(other.status, 401);
  } finally {
    resetLoginThrottle();
    server.close();
  }
});

test('a correct password clears the run of failures rather than being counted with them', async () => {
  const { server, port } = listen();
  resetLoginThrottle();
  try {
    const login = (password) => fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@esahas.com', password }),
    });
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await login('wrong');
    assert.equal((await login('admin123')).status, 200, 'a desk that mistypes and then gets it right is let in');
    // The counter is reset, so the next mistake starts from one again.
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      assert.equal((await login('wrong')).status, 401);
    }
  } finally {
    resetLoginThrottle();
    server.close();
  }
});

// --------------------------------------------------------------- sessions ---

test('a desk login is kept in PostgreSQL, so a restart does not sign the newsroom out', async () => {
  const pool = require('../src/config/db');
  const { PostgresSessionStore, TABLE } = require('../src/middleware/sessionStore');
  const store = new PostgresSessionStore();
  const sid = `test-${Date.now()}`;
  try {
    await store.ready();
    await new Promise((resolve, reject) => {
      store.set(sid, { cookie: { maxAge: 60000 }, user: { id: 1 } }, (e) => (e ? reject(e) : resolve()));
    });
    // A SECOND store instance is what a restarted process has: a different
    // object, reading the same table. MemoryStore would have nothing here.
    const afterRestart = new PostgresSessionStore();
    const read = await new Promise((resolve, reject) => {
      afterRestart.get(sid, (e, s) => (e ? reject(e) : resolve(s)));
    });
    assert.equal(read?.user?.id, 1, 'the session survives the process that created it');
    afterRestart.close();

    await new Promise((resolve, reject) => store.destroy(sid, (e) => (e ? reject(e) : resolve())));
    const gone = await new Promise((resolve, reject) => store.get(sid, (e, s) => (e ? reject(e) : resolve(s))));
    assert.equal(gone, null, 'signing out really removes it');
  } finally {
    await pool.query(`DELETE FROM ${TABLE} WHERE sid = $1`, [sid]).catch(() => {});
    store.close();
  }
});

test('an expired session is not honoured, and is swept away', async () => {
  const pool = require('../src/config/db');
  const { PostgresSessionStore, TABLE } = require('../src/middleware/sessionStore');
  const store = new PostgresSessionStore();
  const sid = `stale-${Date.now()}`;
  try {
    await store.ready();
    await pool.query(
      `INSERT INTO ${TABLE} (sid, data, expires_at) VALUES ($1, $2, NOW() - INTERVAL '1 hour')`,
      [sid, JSON.stringify({ user: { id: 1 } })],
    );
    const read = await new Promise((resolve, reject) => store.get(sid, (e, s) => (e ? reject(e) : resolve(s))));
    assert.equal(read, null, 'an expired session is not a session');

    await store.sweep();
    const { rows } = await pool.query(`SELECT 1 FROM ${TABLE} WHERE sid = $1`, [sid]);
    assert.equal(rows.length, 0, 'and it does not accumulate for the life of the process');
  } finally {
    await pool.query(`DELETE FROM ${TABLE} WHERE sid = $1`, [sid]).catch(() => {});
    store.close();
  }
});

test('the first request after signing in is already signed in', async () => {
  const { server, port } = listen();
  resetLoginThrottle();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@esahas.com', password: 'admin123' }),
    });
    assert.equal(response.status, 200);
    const cookie = (response.headers.getSetCookie?.() || [])
      .map((value) => value.split(';')[0]).join('; ');

    // Held in memory, the session write happened in the same tick and this
    // could not fail. Held in PostgreSQL it is a round trip, and answering
    // before it finished meant the FIRST request a browser made after signing
    // in raced it - measured as `user: null`, with the identical next request
    // answering correctly.
    const me = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { Cookie: cookie } })
      .then((r) => r.json());
    assert.equal(me.user?.email, 'admin@esahas.com', 'the very first request must already carry the session');
  } finally {
    resetLoginThrottle();
    server.close();
  }
});

test('signing in issues a new session id, so a planted one cannot inherit a desk\'s authority', async () => {
  const { server, port } = listen();
  resetLoginThrottle();
  try {
    // A session id that exists before anyone has signed in - what an attacker
    // who can plant a cookie would fix on a browser.
    const anonymous = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    const before = (anonymous.headers.getSetCookie?.() || [])
      .map((value) => value.split(';')[0]).find((value) => value.startsWith('connect.sid='));

    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(before ? { Cookie: before } : {}) },
      body: JSON.stringify({ email: 'admin@esahas.com', password: 'admin123' }),
    });
    assert.equal(login.status, 200);
    const after = (login.headers.getSetCookie?.() || [])
      .map((value) => value.split(';')[0]).find((value) => value.startsWith('connect.sid='));

    assert.ok(after, 'signing in must set a session cookie');
    if (before) {
      assert.notEqual(after, before, 'the id carrying an editor\'s authority is minted AFTER the password was checked');
      // And the old id must not have become authoritative.
      const stale = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { Cookie: before } })
        .then((r) => r.json());
      assert.equal(stale.user, null, 'the pre-login id never becomes a signed-in session');
    }
  } finally {
    resetLoginThrottle();
    server.close();
  }
});

// -------------------------------------------------- what a URL may contain ---

test('an id that cannot name a row is a 400, not a database type error', async () => {
  const { isRowId } = require('../src/middleware/params');
  // parseInt('abc') is NaN, and NaN reaches PostgreSQL as the string "NaN":
  //   error: invalid input syntax for type integer: "NaN"
  // Swept across every route, that was 888 of 2380 malformed requests
  // answering 500 - a desk told "something went wrong on the server" for a
  // stale bookmark or a typed URL.
  for (const bad of ['abc', '-1', '0', '99999999999999999999', 'null', 'undefined', '1.5', 'NaN', '', '1e3', ' 1']) {
    assert.equal(isRowId(bad), false, `"${bad}" must not be accepted as a row id`);
  }
  for (const good of ['1', '42', '51615', '2147483647']) {
    assert.equal(isRowId(good), true, `"${good}" is a real row id`);
  }
  // parseInt would have taken "1.5" to 1 and served a different row entirely.
  assert.equal(isRowId('2147483648'), false, 'past int4 no row can exist');
});

test('every shape of bad id answers 400 over HTTP, and a real one still works', async () => {
  const { server, port } = listen();
  const { signIn } = require('./helpers/desk');
  try {
    const desk = await signIn(port);
    for (const bad of ['abc', '99999999999999999999', 'null', 'NaN', '1.5']) {
      for (const path of [`/api/newspapers/${bad}`, `/api/newspapers/${bad}/pages`, `/epaper/${bad}`]) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Cookie: desk.cookie } });
        assert.equal(response.status, 400, `${path} must be a bad request, not a 500`);
      }
    }
  } finally {
    server.close();
  }
});

test('a publication date that is not a real day is refused, not passed to the database', async () => {
  const { publicationDateFrom, isCalendarDate } = require('../src/services/publicationDate');
  // `isoDate` used to be String(value).slice(0, 10) - it TRUNCATED and never
  // checked, so each of these reached PostgreSQL and answered
  // `invalid input syntax for type date`, reported to the desk as a 500.
  for (const bad of ['not-a-date', '0000-00-00', '2099-13-45', '2026-02-30', '2026-2-3', 'yesterday', {}, 42, []]) {
    assert.equal(publicationDateFrom({ publicationDate: bad }).error, 'INVALID_PUBLICATION_DATE',
      `${JSON.stringify(bad)} is not a day this paper can be dated`);
  }
  // A leap day is real in 2028 and not in 2026 - the shape cannot tell them
  // apart, which is why the check round-trips through Date.
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  // Nothing supplied means today, which is what starting the day's paper means.
  assert.match(publicationDateFrom({}).date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(publicationDateFrom({ publicationDate: '2099-06-15' }).date, '2099-06-15');
  assert.equal(publicationDateFrom({ publicationDate: '2099-06-15T10:00:00Z' }).date, '2099-06-15');
});

test('overlapping "start edition" calls make ONE paper for the date', async () => {
  const repo = require('../src/repositories/newspaper.repository');
  const pool = require('../src/config/db');
  const date = '2099-11-29';
  try {
    await pool.query('DELETE FROM newspapers WHERE publication_date = $1', [date]);
    // Eight callers overlapping. The old shape - findByDate, then create - is
    // a check-then-act: measured this way it made EIGHT editions for one date,
    // which is the state this project has already lived through once, where
    // the desk could not find the edition holding its work.
    const claims = await Promise.all(Array.from({ length: 8 }, () =>
      repo.claimDate({ name: 'race', publicationDate: date, createdBy: null })));

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM newspapers WHERE publication_date = $1 AND parent_edition_id IS NULL',
      [date],
    );
    assert.equal(rows[0].n, 1, 'one paper per publication date, whatever the timing');
    assert.equal(claims.filter((c) => c.created).length, 1, 'exactly one caller created it');
    const ids = new Set(claims.map((c) => c.newspaper.id));
    assert.equal(ids.size, 1, 'and every caller is handed the same edition');
  } finally {
    await pool.query('DELETE FROM newspapers WHERE publication_date = $1', [date]).catch(() => {});
  }
});

test('starting an edition whose row exists but has no pages builds the ladder into it', async () => {
  const repo = require('../src/repositories/newspaper.repository');
  const pageRepo = require('../src/repositories/page.repository');
  const pool = require('../src/config/db');
  const { startEdition } = require('../src/services/editionStart.service');
  const date = '2099-11-28';
  try {
    await pool.query('DELETE FROM newspapers WHERE publication_date = $1', [date]);
    // A row with no pages: an interrupted start, a create through
    // POST /api/newspapers (which makes the row and no ladder), or a page
    // delete that took the last one. Verified live on a real date, the desk
    // was handed `created: false, pageCount: 0` - a paper with no front page
    // and nothing to write on.
    const bare = await repo.create({ name: 'bare', publicationDate: date, createdBy: null });
    assert.equal((await pageRepo.findByNewspaper(bare.id)).length, 0, 'the fixture must start page-less');

    const result = await startEdition({ publicationDate: date, pageCount: 4, fillFeatures: false, carryForward: false });

    assert.equal(result.newspaper.id, bare.id, 'the date keeps its one edition rather than gaining a second');
    assert.equal(result.created, false, 'no new paper was made');
    assert.equal(result.repaired, true, 'and the desk is told the existing one was given its pages');
    assert.equal(result.pageCount, 4);
    assert.equal((await pageRepo.findByNewspaper(bare.id)).length, 4, 'the ladder is really in the database');
    assert.deepEqual(result.ladder.map((r) => r.pageNumber), [1, 2, 3, 4]);

    // And an edition that already has pages is still opened untouched.
    const again = await startEdition({ publicationDate: date, pageCount: 4, fillFeatures: false, carryForward: false });
    assert.equal(again.created, false);
    assert.equal(again.existing, true, 'a real edition is opened, not rebuilt');
    assert.equal((await pageRepo.findByNewspaper(bare.id)).length, 4, 'and it does not gain more pages');
  } finally {
    await pool.query('DELETE FROM newspapers WHERE publication_date = $1', [date]).catch(() => {});
  }
});

test('a section KEY still addresses a block, despite the route calling it :sectionId', async () => {
  const { ID_PARAMS } = require('../src/middleware/params');
  // The routes spell it `:sectionId` and it carries a KEY - `update`, `remove`
  // and the picture routes hand it straight to
  // `saveSection(pageId, sectionKey, ...)`. Guarding it as a number rejected
  // every ordinary block save with a 400: `PUT /pages/94263/sections/
  // feature-lead` is exactly what the editor sends, and 47 tests went red.
  assert.ok(!ID_PARAMS.includes('sectionId'),
    'sectionId carries a section key, so it must never be guarded as a row id');
  for (const name of ['id', 'pageId', 'newspaperId', 'imageId', 'guideId']) {
    assert.ok(ID_PARAMS.includes(name), `${name} is parsed with parseInt and must be guarded`);
  }
});

test('writing a block by its key works end to end, and survives a resize', async () => {
  const pool = require('../src/config/db');
  const { server, port } = listen();
  const { signIn } = require('./helpers/desk');
  const date = '2099-11-27';
  let editionId = null;
  try {
    await pool.query('DELETE FROM newspapers WHERE publication_date = $1', [date]);
    const desk = await signIn(port);
    const started = await desk.json('/api/newspapers/start', {
      method: 'POST',
      body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false, carryForward: false }),
    });
    editionId = started.newspaper.id;

    const pages = await desk.json(`/api/newspapers/${editionId}/pages`);
    const features = pages.find((page) => page.template_key === 'features');
    const key = features.sections[0].section_key;
    assert.match(key, /[a-z]/, 'a block is addressed by a key, not a number');

    const saved = await desk(`/api/pages/${features.id}/sections/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ headline: 'जतन केलेले पान', body: 'ही सामग्री टिकते.', status: 'draft' }),
    });
    assert.equal(saved.status, 200, 'a key in the :sectionId position is an ordinary save');

    const after = await desk.json(`/api/newspapers/${editionId}/pages`);
    const block = after.flatMap((p) => p.sections).find((s) => s.section_key === key);
    assert.equal(block.headline, 'जतन केलेले पान');
  } finally {
    if (editionId) await pool.query('DELETE FROM newspapers WHERE id = $1', [editionId]).catch(() => {});
    server.close();
  }
});
