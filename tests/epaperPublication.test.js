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

  try {
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

    const snapshot = await epaper.loadPublishedEdition(editionId);
    assert.equal(snapshot.edition.pdfUrl, `/epaper/${editionId}/pdf`);
    assert.equal(snapshot.pages[0].imageWidth, 1200);
    assert.ok(snapshot.pages[0].articles.every((article) => article.shareImageUrl));
    await fs.access(path.join(epaper.editionDirectory(editionId), 'page-1.png'));

    const removed = await publication.unpublishEdition(editionId);
    assert.equal(removed.ok, true);
    assert.equal(await epaper.loadPublishedEdition(editionId), null);
    await fs.access(pdfPath);
    const files = await publicationRepository.latestByNewspaper(editionId);
    assert.ok(files.some((file) => file.file_type === 'print_pdf'), 'the final-PDF record survives unpublish');
    await assert.rejects(fs.access(epaper.editionDirectory(editionId)));
  } finally {
    if (editionId) await fs.rm(epaper.editionDirectory(editionId), { recursive: true, force: true });
    if (pdfPath) await fs.rm(pdfPath, { force: true });
    await removeEdition(editionId);
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});
