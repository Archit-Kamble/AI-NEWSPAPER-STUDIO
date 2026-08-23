// Structural furniture repair (Phase C): a page-one row for a template's
// STRUCTURAL_FRAME_KEYS (today just masthead-advert, the sold corner beside
// the nameplate) can be missing on an edition whose row was deleted before
// deletion was guarded (see pageFurniture.test.js) - the corner then shows a
// blank reserved area instead of an actual frame. POST
// /api/pages/:id/repair-structural-frames recreates ONLY that, idempotently,
// and must never touch an editorial frame or an existing row's content.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');
const { getTemplateForPage, isStructuralTemplateFrame } = require('../src/layout/templates');

async function setup(port) {
  const desk = await signIn(port);
  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Structural frame repair test', publicationDate: '2099-01-01' }),
  });
  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, newspaper, page };
}

async function cleanupNewspaper(id) {
  await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
}

test('the front template ships exactly one structural frame today, and only that one', () => {
  const template = getTemplateForPage('front', 1);
  const structural = template.sections.filter(isStructuralTemplateFrame);
  assert.deepEqual(structural.map((s) => s.key), ['masthead-advert']);
});

test('repair recreates a missing masthead-advert, second call creates nothing, geometry matches the template', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  try {
    const setupResult = await setup(port);
    newspaper = setupResult.newspaper;
    const { desk, page } = setupResult;

    // Simulate the historical case directly: the row is gone, bypassing the
    // service-level deletion guard entirely, exactly as an edition created
    // before that guard existed could have ended up.
    await pool.query('DELETE FROM page_sections WHERE page_id = $1 AND section_key = $2', [page.id, 'masthead-advert']);

    const before = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(before.created, ['masthead-advert']);
    const restored = before.page.sections.find((s) => s.section_key === 'masthead-advert');
    assert.ok(restored, 'the frame must actually be back on the page');
    assert.equal(restored.is_custom, false, 'structural furniture is template-owned, never a hand-drawn block');

    const template = getTemplateForPage('front', 1);
    const wanted = template.sections.find((s) => s.key === 'masthead-advert');
    assert.equal(Number(restored.x_px), wanted.x);
    assert.equal(Number(restored.y_px), wanted.y);
    assert.equal(Number(restored.width_px), wanted.width);
    assert.equal(Number(restored.height_px), wanted.height);
    assert.equal(restored.block_type, wanted.blockType);

    const again = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(again.created, [], 'a second repair on an already-complete page must create nothing');
  } finally {
    server.close();
    if (newspaper) await cleanupNewspaper(newspaper.id);
  }
});

test('repair on a page that already has its structural frame leaves it untouched', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  try {
    const setupResult = await setup(port);
    newspaper = setupResult.newspaper;
    const { desk, page } = setupResult;

    const before = page.sections.find((s) => s.section_key === 'masthead-advert');
    assert.ok(before, 'a freshly created page already carries the frame');

    const result = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(result.created, []);
    const after = result.page.sections.find((s) => s.section_key === 'masthead-advert');
    assert.equal(after.id, before.id, 'the same row, not a new one');
    assert.equal(after.updated_at, before.updated_at, 'repair must not even touch its updated_at when nothing was missing');
  } finally {
    server.close();
    if (newspaper) await cleanupNewspaper(newspaper.id);
  }
});

test('a missing EDITORIAL frame is never recreated by repair - only structural furniture', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  try {
    const setupResult = await setup(port);
    newspaper = setupResult.newspaper;
    const { desk, page } = setupResult;

    // 'lead' is an ordinary editorial frame, deletable through the real
    // service (unlike masthead-advert) - delete it the same way a desk
    // could, and confirm repair does not silently bring it back. Recreating
    // it would be a layout decision, not a structural-invariant repair.
    const deleteResponse = await desk(`/api/pages/${page.id}/sections/lead`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);

    const result = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(result.created, [], 'repair must not touch a missing editorial frame');
    assert.ok(!result.page.sections.some((s) => s.section_key === 'lead'), '\'lead\' must stay gone');
  } finally {
    server.close();
    if (newspaper) await cleanupNewspaper(newspaper.id);
  }
});

test('a custom (desk-drawn) frame is untouched by repair, and the corner can be removed and put back', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  try {
    const setupResult = await setup(port);
    newspaper = setupResult.newspaper;
    const { desk, page } = setupResult;

    const created = await desk.json(`/api/pages/${page.id}/sections`, {
      method: 'POST',
      body: JSON.stringify({ x: 20, y: 500, width: 100, height: 100 }),
    });
    const custom = created.sections.find((s) => s.is_custom);
    assert.ok(custom, 'a hand-drawn block must exist to test against');

    const result = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(result.created, []);
    const after = result.page.sections.find((s) => s.id === custom.id);
    assert.equal(after.updated_at, custom.updated_at, 'repair must not touch a custom block at all');

    // A paper that does not sell the corner says so by removing the frame,
    // and the nameplate takes the whole measure (masthead.js). That used to
    // be refused with a 409; the fault it was guarding against was in the
    // nameplate and was fixed there.
    const deleteResponse = await desk(`/api/pages/${page.id}/sections/masthead-advert`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    const afterDelete = await deleteResponse.json();
    assert.ok(
      !afterDelete.sections.some((s) => s.section_key === 'masthead-advert'),
      'the corner frame must actually be gone',
    );

    // ...and this repair is how a desk gets it back, which is what makes the
    // removal safe to allow.
    const restored = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    assert.deepEqual(restored.created, ['masthead-advert']);
  } finally {
    server.close();
    if (newspaper) await cleanupNewspaper(newspaper.id);
  }
});

test('repair on a page missing its structural frame changes ONLY that one row - every other section is untouched', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  try {
    const setupResult = await setup(port);
    newspaper = setupResult.newspaper;
    const { desk, page } = setupResult;

    await pool.query('DELETE FROM page_sections WHERE page_id = $1 AND section_key = $2', [page.id, 'masthead-advert']);
    const before = page.sections.filter((s) => s.section_key !== 'masthead-advert');

    const result = await desk.json(`/api/pages/${page.id}/repair-structural-frames`, { method: 'POST' });
    for (const section of before) {
      const after = result.page.sections.find((s) => s.id === section.id);
      assert.ok(after, `${section.section_key} must still exist`);
      assert.equal(after.updated_at, section.updated_at, `${section.section_key} must not have been touched by the repair`);
    }
  } finally {
    server.close();
    if (newspaper) await cleanupNewspaper(newspaper.id);
  }
});
