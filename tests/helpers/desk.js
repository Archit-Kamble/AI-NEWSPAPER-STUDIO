// Signing in, for tests.
//
// Every test used to call the API as nobody, because the API let it. Now that
// making up the paper requires a desk sign-in, the tests go through the same
// door a real editor does - which is the right way round: a test that can do
// something a user cannot is testing a system nobody uses.
//
// Node's fetch does not keep cookies, so the session is carried by hand.

const pool = require('../../src/config/db');

/**
 * Signs in and returns a fetch bound to that session.
 *
 * `deskFetch(path, options)` behaves like fetch against the test server, with
 * the session cookie and a JSON content type already set.
 */
async function signIn(port, { email = 'admin@esahas.com', password = 'admin123', role = 'admin' } = {}) {
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  });
  if (!response.ok) {
    throw new Error(`Could not sign in as ${email} (${response.status}). Seed a ${role} user first.`);
  }
  const cookie = (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean)
    .map((value) => value.split(';')[0])
    .join('; ');

  const call = (path, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(options.headers || {}) },
    });

  call.base = base;
  call.cookie = cookie;
  call.json = async (path, options) => {
    const result = await call(path, options);
    return result.json();
  };
  return call;
}

/**
 * A signed-in desk and a fresh edition, which is what most tests want.
 */
async function newEdition(port, name, { pages = [[1, 'front']], date = '2026-08-04' } = {}) {
  const desk = await signIn(port);
  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name, publicationDate: date }),
  });
  const made = [];
  for (const [number, template] of pages) {
    made.push(
      await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
        method: 'POST',
        body: JSON.stringify({ pageNumber: number, templateKey: template }),
      }),
    );
  }
  return { desk, newspaper, pages: made };
}

async function removeEdition(id) {
  if (id) await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
}

module.exports = { signIn, newEdition, removeEdition };
