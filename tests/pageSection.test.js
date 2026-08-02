const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');

async function setup(port, newspaperName) {
  const newspaper = await fetch(`http://127.0.0.1:${port}/api/newspapers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newspaperName }),
  }).then((response) => response.json());

  const page = await fetch(`http://127.0.0.1:${port}/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  }).then((response) => response.json());

  return { newspaper, page };
}

async function putSection(port, pageId, sectionKey, body) {
  return fetch(`http://127.0.0.1:${port}/api/pages/${pageId}/sections/${sectionKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function cleanupNewspaper(id) {
  await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
}

test('saving a section with direct field names persists every field', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - direct fields');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'top-side', {
      headline: 'Direct Headline',
      subheading: 'Direct Sub',
      body: 'Direct Body',
      headlineFontPx: 40,
      subheadingFontPx: 22,
      bodyFontPx: 18,
      category: 'Politics',
      location: 'Pune',
      tags: 'a,b',
      reporterName: 'Ravi',
      aiNotes: 'note',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'top-side');
    assert.equal(section.headline, 'Direct Headline');
    assert.equal(section.subheading, 'Direct Sub');
    assert.equal(section.body, 'Direct Body');
    assert.equal(section.headline_font_px, 40);
    assert.equal(section.subheading_font_px, 22);
    assert.equal(section.body_font_px, 18);
    assert.equal(section.category, 'Politics');
    assert.equal(section.location, 'Pune');
    assert.equal(section.tags, 'a,b');
    assert.equal(section.reporter_name, 'Ravi');
    assert.equal(section.ai_notes, 'note');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section accepts the title/subtitle/description aliases', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - aliases');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'lead', {
      title: 'Alias Headline',
      subtitle: 'Alias Sub',
      description: 'Alias Body',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'lead');
    assert.equal(section.headline, 'Alias Headline');
    assert.equal(section.subheading, 'Alias Sub');
    assert.equal(section.body, 'Alias Body');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section links a reporter news item via newsItemId', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;
  let newsId;

  try {
    const setupResult = await setup(port, 'Page section test - linked news');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const newsFormData = new FormData();
    newsFormData.append('title', 'Linked reporter story');
    newsFormData.append('description', 'story body');
    const news = await fetch(`http://127.0.0.1:${port}/api/news`, {
      method: 'POST',
      body: newsFormData,
    }).then((response) => response.json());
    newsId = news.id;

    const response = await putSection(port, page.id, 'mid-side', {
      newsItemId: newsId,
      headline: 'Linked',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'mid-side');
    assert.equal(section.news_item_id, newsId);
  } finally {
    if (newsId) await pool.query('DELETE FROM news_items WHERE id = $1', [newsId]);
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section twice overwrites the previous content', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - overwrite');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    await putSection(port, page.id, 'lead', { headline: 'First' });
    const response = await putSection(port, page.id, 'lead', { headline: 'Second' });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'lead');
    assert.equal(section.headline, 'Second');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('saving a section on a nonexistent page returns 404', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const response = await putSection(port, 999999999, 'lead', { headline: 'x' });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  } finally {
    server.close();
  }
});

test('saving a section with an unknown section key is a silent no-op', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - bogus key');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    const response = await putSection(port, page.id, 'not-a-real-section', { headline: 'x' });
    assert.equal(response.status, 200);

    const updated = await response.json();
    assert.equal(updated.sections.length, page.sections.length);
    assert.ok(!updated.sections.some((s) => s.section_key === 'not-a-real-section'));
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});
