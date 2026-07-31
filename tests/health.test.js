const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createApp } = require('../server');

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

  const createNews = async (status) => {
    const formData = new FormData();
    formData.append('title', `${status} story`);
    formData.append('reporterId', '2');
    formData.append('reporterName', 'Reporter');
    formData.append('status', status);
    formData.append('images', new Blob(['first image'], { type: 'image/png' }), 'first.png');
    formData.append('images', new Blob(['second image'], { type: 'image/png' }), 'second.png');

    const response = await fetch(`http://127.0.0.1:${port}/api/news`, {
      method: 'POST',
      body: formData
    });
    assert.equal(response.status, 201);
    const news = await response.json();
    assert.equal(news.reporterId, 2);
    assert.equal(news.imageUrls.length, 2);
    createdFiles.push(...news.imageFiles);
  };

  try {
    await createNews('draft');
    await createNews('pending');

    const drafts = await fetch(`http://127.0.0.1:${port}/api/news?status=draft&reporterId=2`).then((response) => response.json());
    const submitted = await fetch(`http://127.0.0.1:${port}/api/news?status=pending&reporterId=2`).then((response) => response.json());
    assert.equal(drafts.length, 1);
    assert.equal(submitted.length, 1);
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
  const jsonRequest = (pathName, method, body) => fetch(`http://127.0.0.1:${port}${pathName}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  try {
    const newspaper = await jsonRequest('/api/newspapers', 'POST', { pageCount: 1 }).then((response) => response.json());
    assert.deepEqual(newspaper.pageSize, { width: 330, height: 530, unit: 'mm' });
    assert.equal(newspaper.colorMode, 'CMYK');

    const page = await jsonRequest(`/api/newspapers/${newspaper.id}/pages`, 'POST', { pageNumber: 1 }).then((response) => response.json());
    const savedPage = await jsonRequest(`/api/pages/${page.id}/sections/lead`, 'PUT', {
      title: 'Admin written story', description: 'Story text', category: 'Local'
    }).then((response) => response.json());
    assert.equal(savedPage.articles[0].sectionId, 'lead');

    const formData = new FormData();
    formData.append('scribusFile', new Blob(['scribus project']), 'edition.sla');
    formData.append('printPdf', new Blob(['pdf output'], { type: 'application/pdf' }), 'edition.pdf');
    const uploadResponse = await fetch(`http://127.0.0.1:${port}/api/newspapers/${newspaper.id}/final-files`, { method: 'POST', body: formData });
    assert.equal(uploadResponse.status, 200);
    const finalised = await uploadResponse.json();
    assert.equal(finalised.status, 'finalised');
    createdFiles.push(path.basename(finalised.scribusFile), path.basename(finalised.printPdf));
  } finally {
    await Promise.all(createdFiles.map((file) => fs.unlink(path.join(__dirname, '..', 'public', 'uploads', file)).catch(() => {})));
    server.close();
  }
});
