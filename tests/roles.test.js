// WHAT EACH ROLE MAY DO, DRIVEN THROUGH THE REAL ROUTES.
//
// The permission table in src/auth/roles.js is one small object, and a unit
// test of it can only ever prove that the object says what it says. What
// matters is whether the ROUTES are wired to it - and the fault this test
// exists to catch is a route that was never given a guard, which no test of
// the table can see. So every check below signs in and makes the request.
//
// It creates its own logins and removes them afterwards, crash path included -
// the dev database reached 221 editions the other way.

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { can, capabilitiesOf, isRole, ROLE_KEYS } = require('../src/auth/roles');

test.after(() => pool.end());

const SUFFIX = `${process.pid}-${Date.now()}`;
const PASSWORD = 'role-test-pass-1';
const emailFor = (role) => `zz-role-${role}-${SUFFIX}@example.test`;

async function seed(role) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const { rows } = await pool.query(
    `INSERT INTO users (role, name, email, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
    [role, `ZZ ${role}`, emailFor(role), hash],
  );
  return rows[0].id;
}

// THE OWNER THESE TESTS USE IS THEIR OWN, NOT THE NEWSPAPER'S.
//
// This upserted `admin@esahas.com` and REPLACED its password hash with
// 'admin123' - a constant published in this repository, on the account that
// runs a real newspaper - and never put back what it overwrote. It is created
// the same way the three role fixtures beside it already are: `zz-`, a
// reserved `@example.test` address, and removed afterwards.
async function ensureOwner() {
  return seed('admin');
}

async function sessionFor(port, email, password = PASSWORD) {
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200, `${email} could not sign in`);
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean).map((value) => value.split(';')[0]).join('; ');
  const body = await response.json();
  const call = (path, options = {}) => fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
  });
  call.user = body.user;
  return call;
}

test('the table itself: a capability names its roles, and an unknown one is closed', () => {
  assert.equal(can({ role: 'admin' }, 'deleteEdition'), true);
  assert.equal(can({ role: 'chief_editor' }, 'deleteEdition'), false);
  assert.equal(can({ role: 'chief_editor' }, 'publish'), true);
  assert.equal(can({ role: 'editor' }, 'publish'), false);
  assert.equal(can({ role: 'editor' }, 'makeUp'), true);
  assert.equal(can({ role: 'reporter' }, 'makeUp'), false);

  // A TYPO IN A ROUTE GUARD MUST CLOSE THE DOOR, NOT OPEN IT. `can` reads its
  // roles out of the table, so an unknown key finds nothing - and returning
  // `undefined.includes` or a permissive default would make a misspelt guard
  // grant everybody the thing it was written to protect.
  assert.equal(can({ role: 'admin' }, 'no-such-capability'), false);
  assert.equal(can(null, 'makeUp'), false);
  assert.equal(can({}, 'makeUp'), false);

  // The owner holds everything. This is the user's own rule - "give owner/admin
  // full access" - and it is the one property of this table worth asserting as
  // a whole, because a capability added later without listing admin would take
  // the paper's own administration away from its owner silently.
  const owner = capabilitiesOf({ role: 'admin' });
  assert.equal(Object.values(owner).every(Boolean), true, `owner is missing: ${JSON.stringify(owner)}`);

  assert.equal(isRole('chief_editor'), true);
  // Sampadak is STORED as chief_editor - one key per rung. A second spelling
  // of the same rung is the duplicated-catalogue failure this project has
  // already been bitten by twice.
  assert.equal(isRole('sampadak'), false);
  assert.deepEqual(ROLE_KEYS, ['admin', 'chief_editor', 'editor', 'reporter']);
});

test('every boundary, driven through the real routes as each role', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  const made = [];
  let editionId = null;
  let storyId = null;
  try {
    // The owner is seeded like the other three, so `zz-…@example.test` and
    // removed in the finally below. It used to be the newspaper's own
    // administrator with its password overwritten.
    const ownerId = await ensureOwner();
    // Deliberately NOT pushed onto `made` before the three roles: the checks
    // below address that array positionally (made[0] is the Sampadak, made[1]
    // the editor), so putting the owner at the front would silently re-aim
    // every one of them at a different account. It is added at the END, where
    // only the cleanup reads it.
    for (const role of ['chief_editor', 'editor', 'reporter']) made.push(await seed(role));

    const owner = await sessionFor(port, emailFor('admin'));
    const sampadak = await sessionFor(port, emailFor('chief_editor'));
    const editor = await sessionFor(port, emailFor('editor'));
    const reporter = await sessionFor(port, emailFor('reporter'));

    // The wire tells the browser what it may do, so the browser needs no copy
    // of the rules. public/admin.js decides which dashboard to open on it.
    assert.equal(sampadak.user.can.publish, true);
    assert.equal(sampadak.user.can.manageStaff, false);
    assert.equal(editor.user.can.makeUp, true);
    assert.equal(editor.user.can.reviewCopy, false);
    assert.equal(reporter.user.can.makeUp, false);
    assert.equal(editor.user.roleLabel, 'Editor');
    assert.equal(sampadak.user.roleLabel, 'Sampadak');

    const edition = await (await owner('/api/newspapers', {
      method: 'POST', body: JSON.stringify({ name: 'ZZ roles probe', publicationDate: '2099-04-07' }),
    })).json();
    editionId = edition.id;
    const story = await (await owner('/api/news', {
      method: 'POST', body: JSON.stringify({ title: 'ZZ roles filing', description: 'probe', status: 'pending' }),
    })).json();
    storyId = story.id;

    // ---- make up: the desk, and not the reporter ----
    for (const [who, call] of [['owner', owner], ['sampadak', sampadak], ['editor', editor]]) {
      assert.equal((await call('/api/newspapers')).status, 200, `${who} should be able to see the editions`);
    }
    assert.equal((await reporter('/api/newspapers')).status, 403, 'a reporter does not make up the paper');

    // ---- review a filing: the Sampadak's, not the desk's ----
    const review = (call) => call(`/api/news/${storyId}/status`, {
      method: 'PATCH', body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal((await review(owner)).status, 200);
    assert.equal((await review(sampadak)).status, 200);
    assert.equal((await review(editor)).status, 403, "an editor may not pass a reporter's copy");
    assert.equal((await review(reporter)).status, 403);

    // ---- publish: the Sampadak's. The 4xx for the two who MAY is the route's
    // own business logic answering past the guard, which is the point: the
    // guard let them through and refused the other two before it. ----
    const publish = (call) => call(`/api/newspapers/${editionId}/publish-current`, { method: 'POST' });
    assert.equal((await publish(editor)).status, 403, 'an editor may not release the paper');
    assert.equal((await publish(reporter)).status, 403);
    assert.notEqual((await publish(owner)).status, 403, 'the owner reaches the publish route');
    assert.notEqual((await publish(sampadak)).status, 403, 'the Sampadak reaches the publish route');

    // ---- the logins themselves: the owner's alone ----
    for (const [who, call] of [['sampadak', sampadak], ['editor', editor], ['reporter', reporter]]) {
      assert.equal((await call('/api/staff')).status, 403, `${who} may not see the paper's logins`);
      assert.equal((await call('/api/settings/general')).status, 403, `${who} may not read the settings`);
    }
    assert.equal((await owner('/api/staff')).status, 200);
    assert.equal((await owner('/api/settings/general')).status, 200);

    // ---- deleting an edition: the owner's alone ----
    for (const [who, call] of [['sampadak', sampadak], ['editor', editor], ['reporter', reporter]]) {
      assert.equal((await call(`/api/newspapers/${editionId}`, { method: 'DELETE' })).status, 403,
        `${who} may not delete an edition`);
    }
    assert.equal((await owner(`/api/newspapers/${editionId}`, { method: 'DELETE' })).status, 200);
    editionId = null;

    // ---- a role is checked against the catalogue, not taken on trust ----
    const invented = await owner('/api/staff', {
      method: 'POST', body: JSON.stringify({ name: 'ZZ', email: `zz-bad-${SUFFIX}@example.test`, password: PASSWORD, role: 'sampadak' }),
    });
    assert.equal(invented.status, 400, "'sampadak' is a label, not a stored role");

    // ---- an owner cannot lock the paper's administration away ----
    //
    // Addressed by the seeded owner's OWN id. It used to be a literal
    // `/api/staff/1`, which meant "self" only because the test had signed in
    // as whichever account happened to be row one - so the check would have
    // gone on passing while testing something else entirely the moment that
    // stopped being true.
    const self = await owner(`/api/staff/${ownerId}/access`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    assert.equal(self.status, 400);
    assert.match((await self.json()).error, /your own login/);

    const demote = await owner(`/api/staff/${ownerId}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'ZZ admin', email: emailFor('admin'), role: 'editor' }),
    });
    assert.equal(demote.status, 400);
    assert.match((await demote.json()).error, /only owner|your own role/);

    // ---- blocking is live: an OPEN session loses its authority ----
    const blocked = await owner(`/api/staff/${made[1]}/access`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    assert.equal(blocked.status, 200);
    assert.equal((await editor('/api/newspapers')).status, 403, 'a blocked account loses the session it already had');

    // ---- and so is a role change: a promotion needs no new sign-in ----
    await owner(`/api/staff/${made[0]}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'ZZ chief_editor', email: emailFor('chief_editor'), role: 'editor' }),
    });
    assert.equal((await review(sampadak)).status, 403,
      'a demotion takes effect on the very next request, not at the next sign-in');
  } finally {
    // Removed even when a check above throws, or the next run inherits them.
    // The LIKE sweep below covers the seeded owner too, since it carries the
    // same zz-…SUFFIX@example.test shape as the other three.
    if (editionId) {
      const owner = await sessionFor(port, emailFor('admin'));
      await owner(`/api/newspapers/${editionId}`, { method: 'DELETE' });
    }
    if (storyId) await pool.query('DELETE FROM news_items WHERE id = $1', [storyId]);
    if (made.length) await pool.query('DELETE FROM users WHERE id = ANY($1)', [made]);
    await pool.query(`DELETE FROM users WHERE email LIKE 'zz-%${SUFFIX}@example.test'`);
    server.close();
  }
});
