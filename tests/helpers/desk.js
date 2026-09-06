// Signing in, for tests.
//
// Every test used to call the API as nobody, because the API let it. Now that
// making up the paper requires a desk sign-in, the tests go through the same
// door a real editor does - which is the right way round: a test that can do
// something a user cannot is testing a system nobody uses.
//
// Node's fetch does not keep cookies, so the session is carried by hand.

const pool = require('../../src/config/db');
const { testOwner, removeTestOwner, sweepAbandonedTestOwners } = require('./desk-owner');
const { assertWritableDatabase } = require('./test-database');

// Checked at require time, so a suite pointed at a production database stops
// before it writes anything rather than after.
assertWritableDatabase();

// THE TESTS SIGN IN AS THEIR OWN OWNER, NOT AS THE NEWSROOM'S.
//
// This defaulted to `admin@esahas.com` / `admin123` - the real administrator of
// a real newspaper - and seven test files kept that password working by
// OVERWRITING it on every run. See helpers/desk-owner.js for what that cost.
//
// The account is made on first use and removed when the file's tests finish.
// A caller that names an email explicitly (the roles tests, which are about
// particular roles) still gets exactly what it asked for.
require('node:test').after(async () => {
  await removeTestOwner();
  await sweepAbandonedTestOwners();
});

/**
 * Signs in and returns a fetch bound to that session.
 *
 * `deskFetch(path, options)` behaves like fetch against the test server, with
 * the session cookie and a JSON content type already set.
 */
async function signIn(port, { email, password, role = 'admin' } = {}) {
  if (!email) {
    const owner = await testOwner(role);
    email = owner.email;
    password = owner.password;
  }
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

// Press/output tests are interested in a particular artifact or lifecycle,
// not in hand-authoring forty-five unrelated blocks. Seed every canonical
// publication obligation without bypassing production readiness logic.
async function satisfyPublicationContent(pages = [], { companionImageUrl = '/uploads/test-image.png' } = {}) {
  const pageRepository = require('../../src/repositories/page.repository');
  const { getTemplate } = require('../../src/layout/templates');
  const { PURPOSE, resolveFramePurpose } = require('../../src/layout/frame-purpose');
  for (const item of pages) {
    const page = await pageRepository.findById(item.id ?? item);
    const byKey = new Map(getTemplate(page.template_key).sections.map((section) => [section.key, section]));
    for (const section of page.sections) {
      const owner = resolveFramePurpose(section, byKey.get(section.section_key));
      if (owner.purpose === PURPOSE.EDITORIAL_STORY) await pool.query(
        `UPDATE page_sections SET headline=COALESCE(headline,'तपासलेली बातमी'), body=COALESCE(body,'तपासलेला मजकूर'), status='ready' WHERE id=$1`, [section.id],
      );
      if (owner.purpose === PURPOSE.ADVERT) await pool.query(
        `UPDATE page_sections SET headline=COALESCE(headline,'जाहिरात'), status='ready' WHERE id=$1`, [section.id],
      );
      if (owner.purpose === PURPOSE.IMAGE_COMPANION) await pool.query(
        `UPDATE page_sections SET image_url=COALESCE(image_url,$2), status='ready' WHERE id=$1`, [section.id, companionImageUrl],
      );
      if (owner.purpose === PURPOSE.STANDING_FEATURE) await pool.query(
        `UPDATE page_sections SET headline=COALESCE(headline,$2), body=COALESCE(body,'तपासलेली माहिती'), smart_card_key=$2, smart_card_data=$3::jsonb, status='ready', ai_generated=FALSE WHERE id=$1`,
        [section.id, owner.standingFeatureKind, JSON.stringify({ items: [], entries: ['तपासलेली माहिती'] })],
      );
      if (owner.purpose === PURPOSE.UTILITY) await pool.query(
        `UPDATE page_sections SET headline=COALESCE(headline,'आजचा सुडोकू'), smart_card_key=$2, smart_card_data=$3::jsonb, status='ready', ai_generated=FALSE WHERE id=$1`,
        [section.id, owner.utilityKind, JSON.stringify({ grid: Array.from({ length: 9 }, () => Array(9).fill(0)) })],
      );
    }
  }
}

module.exports = { signIn, newEdition, removeEdition, satisfyPublicationContent };
