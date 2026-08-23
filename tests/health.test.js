const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../server');
const { signIn, satisfyPublicationContent } = require('./helpers/desk');

test('health endpoint returns ok', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
  } finally {
    server.close();
  }
});

test('reporter can save multiple images to drafts and submitted news', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const createdFiles = [];
  const testPrefix = `test-${Date.now()}`;
  const reporter = await signIn(port, {
    email: 'reporter@esahas.com', password: 'reporter123', role: 'reporter',
  });

  const createNews = async (status) => {
    const formData = new FormData();
    formData.append('title', `${testPrefix} ${status} story`);
    formData.append('reporterId', '2');
    formData.append('reporterName', 'Reporter');
    formData.append('status', status);
    formData.append('images', new Blob(['first image'], { type: 'image/png' }), 'first.png');
    formData.append('images', new Blob(['second image'], { type: 'image/png' }), 'second.png');

    const response = await fetch(`http://127.0.0.1:${port}/api/news`, {
      method: 'POST',
      headers: { Cookie: reporter.cookie },
      body: formData
    });
    assert.equal(response.status, 201);
    const news = await response.json();
    assert.equal(news.created_by, 2);
    assert.equal(news.image_urls.length, 2);
    createdFiles.push(...news.image_urls.map((url) => path.basename(url)));
  };

  try {
    await createNews('draft');
    await createNews('pending');

    const drafts = await reporter('/api/news?status=draft&reporterId=2').then((response) => response.json());
    const submitted = await reporter('/api/news?status=pending&reporterId=2').then((response) => response.json());
    assert.ok(drafts.some((item) => item.title === `${testPrefix} draft story`));
    assert.ok(submitted.some((item) => item.title === `${testPrefix} pending story`));
  } finally {
    await Promise.all(createdFiles.map((file) => fs.unlink(path.join(__dirname, '..', 'public', 'uploads', file)).catch(() => {})));
    server.close();
  }
});

test('admin workflow saves a page section and final Scribus/PDF files', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const createdFiles = [];
  const desk = await signIn(port);
  const jsonRequest = (pathName, method, body) => desk(pathName, { method, body: JSON.stringify(body) });

  try {
    // Dated 2099 deliberately. A dateless create takes today (newspaper.service.js
    // defaults to todayWhereWePrint), and POST /api/newspapers/start is idempotent
    // PER DATE - so a test edition left on today's date becomes the edition the
    // desk is handed when it presses "Open Edition", stubs and all.
    const newspaper = await jsonRequest('/api/newspapers', 'POST', { pageCount: 1, publicationDate: '2099-01-01' }).then((response) => response.json());
    assert.equal(newspaper.page_width_px, 660);
    assert.equal(newspaper.page_height_px, 1060);
    assert.equal(newspaper.color_mode, 'CMYK');

    const page = await jsonRequest(`/api/newspapers/${newspaper.id}/pages`, 'POST', { pageNumber: 1 }).then((response) => response.json());
    const savedPage = await jsonRequest(`/api/pages/${page.id}/sections/lead`, 'PUT', {
      title: 'Admin written story', description: 'Story text', category: 'Local'
    }).then((response) => response.json());
    assert.equal(savedPage.sections.find((section) => section.section_key === 'lead').headline, 'Admin written story');

    await jsonRequest(`/api/pages/${page.id}/sections/lead`, 'PUT', {
      title: 'Admin written story', description: 'Story text', category: 'Local', status: 'ready'
    });
    await satisfyPublicationContent([page]);
    const passed = await jsonRequest(`/api/pages/${page.id}/state`, 'PATCH', { state: 'passed' });
    assert.equal(passed.status, 200);

    const formData = new FormData();
    formData.append('scribusFile', new Blob(['scribus project']), 'edition.sla');
    formData.append('printPdf', new Blob(['pdf output'], { type: 'application/pdf' }), 'edition.pdf');
    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/newspapers/${newspaper.id}/final-files`, {
      method: 'POST', headers: { Cookie: desk.cookie }, body: formData,
    });
    assert.equal(uploadResponse.status, 200);
    const finalised = await uploadResponse.json();
    assert.equal(finalised.status, 'finalised');
    createdFiles.push(path.basename(finalised.scribusFile), path.basename(finalised.printPdf));
  } finally {
    await Promise.all(createdFiles.map((file) => fs.unlink(path.join(__dirname, '..', 'public', 'uploads', file)).catch(() => {})));
    server.close();
  }
});
