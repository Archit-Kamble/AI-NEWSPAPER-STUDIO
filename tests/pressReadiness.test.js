require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const readiness = require('../src/services/pressReadiness.service');
const signoff = require('../src/services/signoff.service');
const { createApp } = require('../server');
const { signIn, newEdition, removeEdition } = require('./helpers/desk');
const bcrypt = require('bcryptjs');

// The desk login these tests use is created and removed by
// tests/helpers/desk-owner.js. It used to be `admin@esahas.com`, upserted here
// with its password REPLACED by a constant published in this repository - the
// real administrator of a real newspaper, overwritten on every run. Nothing
// under tests/ writes to an account somebody uses any more.
async function ensureAdmin() { /* helpers/desk.js signs in as its own disposable owner */ }

test('FULLY_COMPOSED editorial state is distinct from press approval, and edits revoke it', async () => {
  await ensureAdmin();
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    const { desk, newspaper, pages } = await newEdition(port, 'press readiness truth', { pages: [[1, 'front']] });
    editionId = newspaper.id; const page = pages[0]; const lead = page.sections.find((section) => section.section_key === 'lead');
    const { rows: news } = await pool.query(`INSERT INTO news_items (newspaper_id,title,description,status) VALUES ($1,'मूळ बातमी','विश्वसनीय मजकूर','approved') RETURNING id`, [editionId]);
    await pool.query(`UPDATE page_sections SET news_item_id=$1, headline='तपासलेला मथळा', body='विश्वसनीय मजकूर', status='needs_review', ai_generated=TRUE WHERE id=$2`, [news[0].id, lead.id]);
    // This focused lifecycle test is not an autonomous whole-edition fixture;
    // give every other required frame truthful test content so the canonical
    // publication-content gate is satisfied before exercising review/signoff.
    await pool.query(`UPDATE page_sections SET headline=CASE WHEN block_type='advert' THEN 'जाहिरात' ELSE 'तपासलेली बातमी' END,
      body=CASE WHEN block_type IN ('article','briefs') THEN 'विश्वसनीय मजकूर' ELSE body END, status='ready'
      WHERE page_id=$1 AND id<>$2`, [page.id, lead.id]);
    await pool.query(`UPDATE page_sections
      SET headline=feature_key, body='तपासलेली माहिती', smart_card_key=feature_key,
          smart_card_data='{}'::jsonb, status='ready', ai_generated=FALSE
      WHERE page_id=$1 AND feature_key IS NOT NULL`, [page.id]);
    await pool.query(`UPDATE page_sections SET image_url='/uploads/test-image.png' WHERE page_id=$1 AND block_type='photo'`, [page.id]);
    let report = await readiness.assessPage(page.id, { requirePassed: false });
    assert.equal(report.readyForPress, false);
    assert.ok(report.blockers.some((item) => item.code === 'EDITORIAL_REVIEW_REQUIRED'));
    const blocked = await signoff.setPageState(page.id, 'passed', { id: null });
    assert.equal(blocked.code, 'PRESS_NOT_READY');

    await pool.query(`UPDATE page_sections SET status='ready' WHERE id=$1`, [lead.id]);
    const passed = await signoff.setPageState(page.id, 'passed', { id: null });
    assert.equal(passed.ok, true, `pass result: ${JSON.stringify(passed)}`);
    assert.equal((await readiness.assessEdition(editionId)).readyForPress, true);

    await desk(`/api/pages/${page.id}/sections/lead`, { method: 'PUT', body: JSON.stringify({ newsItemId: news[0].id, headline: 'सुधारित मथळा', body: 'विश्वसनीय मजकूर', status: 'ready', aiGenerated: true }) });
    const { rows } = await pool.query('SELECT status FROM page_sections WHERE id=$1', [lead.id]);
    assert.equal(rows[0].status, 'needs_review', 'stale browser status cannot keep changed AI copy approved');
    report = await readiness.assessEdition(editionId);
    assert.equal(report.readyForPress, false);
    assert.ok(report.blockers.some((item) => ['PAGE_NOT_PASSED','PAGE_SIGNOFF_STALE','EDITORIAL_REVIEW_REQUIRED'].includes(item.code)));
  } finally { if (editionId) await pool.query('DELETE FROM news_items WHERE newspaper_id=$1', [editionId]); await removeEdition(editionId); server.close(); }
});

test('all production output endpoints consume the same PRESS_NOT_READY gate', async () => {
  await ensureAdmin();
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    const desk = await signIn(port); const edition = await desk.json('/api/newspapers', { method: 'POST', body: JSON.stringify({ name: 'blocked press paths', publicationDate: '2099-06-12' }) }); editionId = edition.id;
    await desk.json(`/api/newspapers/${edition.id}/pages`, { method: 'POST', body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }) });
    for (const route of [`/api/newspapers/${edition.id}/scribus`, `/api/newspapers/${edition.id}/press-package`]) {
      const response = await desk(route); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'PRESS_NOT_READY');
    }
  } finally { await removeEdition(editionId); server.close(); }
});

// Gap 3 (image truth #9): a signed-off page's fingerprint used to omit
// fit_mode/mask/source dimensions - a desk could switch Contain -> Stretch,
// or a cutout could be re-run against a different mask, on an ALREADY
// SIGNED-OFF page without the fingerprint (and therefore PAGE_SIGNOFF_STALE)
// ever noticing.
test('press signoff fingerprint changes when fit mode, mask, or source dimensions change - not only geometry', () => {
  const image = {
    media_asset_id: 7, url: '/uploads/a.jpg', x_px: 10, y_px: 20, width_px: 100, height_px: 80,
    rotation: 0, flip_h: false, flip_v: false, shape: 'cutout', stand_off_px: 6, caption: 'कॅप्शन',
    fit_mode: 'contain', mask: { rows: 2, cols: 2, cells: [[1, 1], [0, 0]] },
    source_width_px: 200, source_height_px: 100,
  };
  const page = { id: 1, page_number: 1, template_key: 'front', prints_colour: true, sections: [{ section_key: 'lead', images: [image] }] };
  const withImage = (overrides) => readiness.pageFingerprint({
    ...page,
    sections: [{ ...page.sections[0], images: [{ ...image, ...overrides }] }],
  });

  const base = withImage({});
  const stretch = withImage({ fit_mode: 'stretch' });
  const flipped = withImage({ flip_h: true });
  const rerunMask = withImage({ mask: { rows: 2, cols: 2, cells: [[1, 0], [1, 0]] } });
  const widerSource = withImage({ source_width_px: 400 });

  const fingerprints = new Set([base, stretch, flipped, rerunMask, widerSource]);
  assert.equal(fingerprints.size, 5, 'fit mode, flip, mask and source dimensions must each change the signoff fingerprint');
  assert.equal(withImage({}), base, 'the same image identity remains deterministic');
});
