require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');
const { createApp } = require('../server');
const { newEdition, removeEdition, satisfyPublicationContent } = require('./helpers/desk');
const signoff = require('../src/services/signoff.service');
const publicationRepository = require('../src/repositories/publication.repository');
const publication = require('../src/services/epaperPublication.service');
const epaper = require('../src/services/epaper.service');

test.after(() => pool.end());

async function ensureAdmin() {
  const password = await bcrypt.hash('admin123', 4);
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ('संपादक', 'admin@esahas.com', $1, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1, role = 'admin'`,
    [password],
  );
}

test('publish freezes a complete snapshot and unpublish removes only its derivatives', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  let pdfPath = null;
  let previousSelected = null;

  try {
    previousSelected = (await pool.query(
      'SELECT id FROM newspapers WHERE epaper_selected = TRUE LIMIT 1',
    )).rows[0]?.id || null;
    await ensureAdmin();
    const { newspaper, pages } = await newEdition(port, 'E-paper publication fixture', {
      pages: [[1, 'front']], date: '2099-12-27',
    });
    editionId = newspaper.id;
    await satisfyPublicationContent(pages);
    const passed = await signoff.setPageState(pages[0].id, 'passed', { id: null });
    assert.equal(passed.ok, true, JSON.stringify(passed));

    const pdfName = `epaper-publication-${process.pid}-${editionId}.pdf`;
    pdfPath = path.join(epaper.PUBLIC_DIR, 'uploads', pdfName);
    await fs.writeFile(pdfPath, Buffer.from('test final PDF'));
    await publicationRepository.save(editionId, 'print_pdf', `/uploads/${pdfName}`, null);

    const result = await publication.publishEdition(editionId, null, {
      rasterize: async (_pdf, prefix) => {
        const { Jimp } = await import('jimp');
        const page = new Jimp({ width: 1200, height: 1800, color: 0xf8f4edff });
        await page.write(`${prefix}-1.png`);
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pages, 1);
    assert.ok(result.stories > 0);

    const snapshot = await epaper.readRelease(editionId);
    assert.equal(snapshot.edition.pdfUrl, `/epaper/${editionId}/pdf`);
    assert.equal(snapshot.pages[0].imageWidth, 1200);
    assert.ok(snapshot.pages[0].articles.every((article) => article.shareImageUrl));
    await fs.access(path.join(epaper.editionDirectory(editionId), 'page-1.png'));

    const removed = await publication.unpublishEdition(editionId);
    assert.equal(removed.ok, true);
    assert.equal(await epaper.readRelease(editionId), null);
    await fs.access(pdfPath);
    const files = await publicationRepository.latestByNewspaper(editionId);
    assert.ok(files.some((file) => file.file_type === 'print_pdf'), 'the final-PDF record survives unpublish');
    await assert.rejects(fs.access(epaper.editionDirectory(editionId)));
  } finally {
    if (editionId) await fs.rm(epaper.editionDirectory(editionId), { recursive: true, force: true });
    if (pdfPath) await fs.rm(pdfPath, { force: true });
    await removeEdition(editionId);
    if (previousSelected) await pool.query(
      'UPDATE newspapers SET epaper_selected = TRUE WHERE id = $1', [previousSelected],
    );
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});

test('current-editor publishing freezes a draft without changing its press status or needing a PDF', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  let previousSelected = null;

  try {
    previousSelected = (await pool.query(
      'SELECT id FROM newspapers WHERE epaper_selected = TRUE LIMIT 1',
    )).rows[0]?.id || null;
    // The assertion below exercises the no-selection default. Clear only for
    // this fixture and restore the live choice in finally.
    await pool.query('UPDATE newspapers SET epaper_selected = FALSE WHERE epaper_selected = TRUE');
    await ensureAdmin();
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const { newspaper } = await newEdition(port, 'Current e-paper fixture', {
      pages: [[1, 'front']], date: today,
    });
    editionId = newspaper.id;

    const result = await publication.publishCurrentEdition(editionId, null, {
      renderCurrentPages: async (snapshot, directory) => {
        const { Jimp } = await import('jimp');
        for (const page of snapshot.pages) {
          await new Jimp({ width: 1320, height: 2120, color: 0xffffffff })
            .write(path.join(directory, `page-${page.number}.png`));
        }
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.selected, true, 'the first release becomes the selected public e-paper');

    const paper = (await pool.query(
      'SELECT status, epaper_released_at, epaper_selected, epaper_source FROM newspapers WHERE id = $1', [editionId],
    )).rows[0];
    assert.equal(paper.status, 'draft', 'web proof publishing never claims press-final status');
    assert.ok(paper.epaper_released_at);
    assert.equal(paper.epaper_selected, true);
    assert.equal(paper.epaper_source, 'editor_snapshot');

    const manifest = JSON.parse(await fs.readFile(epaper.manifestPath(editionId), 'utf8'));
    assert.equal(manifest.edition.source, 'editor_snapshot');
    assert.equal(manifest.edition.pdfUrl, '');
    assert.ok(await epaper.loadSelectedEdition(), 'the public reader resolves the selected proof');
  } finally {
    if (editionId) {
      await fs.rm(epaper.editionDirectory(editionId), { recursive: true, force: true });
      await removeEdition(editionId);
    }
    if (previousSelected) await pool.query(
      'UPDATE newspapers SET epaper_selected = TRUE WHERE id = $1', [previousSelected],
    );
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});

test('an uploaded e-paper PDF publishes a draft without press approval and keeps the same saved block map', async () => {
  const server = createApp().listen(0);
  const port = server.address().port;
  let editionId = null;
  let pdfPath = null;
  let previousSelected = null;
  try {
    previousSelected = (await pool.query(
      'SELECT id FROM newspapers WHERE epaper_selected = TRUE LIMIT 1',
    )).rows[0]?.id || null;
    await ensureAdmin();
    const { newspaper } = await newEdition(port, 'E-paper PDF fixture', {
      pages: [[1, 'front']], date: '2099-12-29',
    });
    editionId = newspaper.id;
    const filename = `epaper-upload-${process.pid}-${editionId}.pdf`;
    pdfPath = path.join(epaper.PUBLIC_DIR, 'uploads', filename);
    await fs.writeFile(pdfPath, Buffer.from('web publication PDF'));

    const result = await publication.publishUploadedPdfEdition(editionId, { filename }, null, {
      rasterize: async (_pdf, prefix) => {
        const { Jimp } = await import('jimp');
        await new Jimp({ width: 1320, height: 2120, color: 0xffffffff }).write(`${prefix}-1.png`);
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.pages, 1);

    const paper = (await pool.query(
      'SELECT status, epaper_source FROM newspapers WHERE id = $1', [editionId],
    )).rows[0];
    assert.equal(paper.status, 'draft', 'web PDF release never promotes an edition to press-final');
    assert.equal(paper.epaper_source, 'uploaded_pdf');

    const snapshot = await epaper.readRelease(editionId);
    assert.equal(snapshot.edition.source, 'uploaded_pdf');
    assert.equal(snapshot.edition.pdfUrl, `/epaper/${editionId}/pdf`);
    const live = await epaper.buildEdition(editionId);
    assert.deepEqual(
      snapshot.pages[0].articles.map((article) => article.hotspot),
      live.pages[0].articles.map((article) => article.hotspot),
      'PDF releases use the exact same saved block rectangles as the editor release',
    );
    const pdf = await epaper.releasedPdf(editionId, { includePrivate: true });
    assert.equal(pdf.file, pdfPath, 'the e-paper download resolves the uploaded web PDF, not a press artifact');
    const files = await publicationRepository.latestByNewspaper(editionId);
    assert.ok(files.some((file) => file.file_type === 'epaper_pdf'));
    assert.ok(!files.some((file) => file.file_type === 'print_pdf'));
  } finally {
    if (editionId) await fs.rm(epaper.editionDirectory(editionId), { recursive: true, force: true });
    if (pdfPath) await fs.rm(pdfPath, { force: true });
    await removeEdition(editionId);
    if (previousSelected) await pool.query(
      'UPDATE newspapers SET epaper_selected = TRUE WHERE id = $1', [previousSelected],
    );
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});
