require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const readiness = require('../src/services/pressReadiness.service');
const signoff = require('../src/services/signoff.service');
const { createApp } = require('../server');
const { signIn, newEdition, removeEdition } = require('./helpers/desk');
const bcrypt = require('bcryptjs');

async function ensureAdmin() { const password = await bcrypt.hash('admin123', 4); await pool.query(`INSERT INTO users (name,email,password_hash,role) VALUES ('संपादक','admin@esahas.com',$1,'admin') ON CONFLICT (email) DO UPDATE SET password_hash=$1, role='admin'`, [password]); }

test('FULLY_COMPOSED editorial state is distinct from press approval, and edits revoke it', async () => {
  await ensureAdmin();
  const server = createApp().listen(0); const port = server.address().port; let editionId;
  try {
    const { desk, newspaper, pages } = await newEdition(port, 'press readiness truth', { pages: [[1, 'front']] });
    editionId = newspaper.id; const page = pages[0]; const lead = page.sections.find((section) => section.section_key === 'lead');
    const { rows: news } = await pool.query(`INSERT INTO news_items (newspaper_id,title,description,status) VALUES ($1,'मूळ बातमी','विश्वसनीय मजकूर','approved') RETURNING id`, [editionId]);
    await pool.query(`UPDATE page_sections SET news_item_id=$1, headline='तपासलेला मथळा', body='विश्वसनीय मजकूर', status='needs_review', ai_generated=TRUE WHERE id=$2`, [news[0].id, lead.id]);
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
