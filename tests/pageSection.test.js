const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

// Making up the paper requires a desk sign-in, so the tests hold one too.
let desk = null;

async function setup(port, newspaperName) {
  desk = await signIn(port);
  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name: newspaperName }),
  });
  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { newspaper, page };
}

async function putSection(port, pageId, sectionKey, body) {
  return desk(`/api/pages/${pageId}/sections/${sectionKey}`, {
    method: 'PUT',
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

    const response = await putSection(port, page.id, 'anchor', {
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
    const section = updated.sections.find((s) => s.section_key === 'anchor');
    assert.equal(section.headline, 'Direct Headline');
    assert.equal(section.subheading, 'Direct Sub');
    assert.equal(section.body, 'Direct Body');
    // Type sizes are NUMERIC now, because a printer sets type in half points -
    // so these come back over the wire as strings, the same as the page's mm
    // dimensions always have. Every reader in the application coerces.
    assert.equal(Number(section.headline_font_px), 40);
    assert.equal(Number(section.subheading_font_px), 22);
    assert.equal(Number(section.body_font_px), 18);
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
    // Filing a story needs a signed-in reporter; multipart carries the session
    // cookie by hand because FormData sets its own content type.
    const news = await fetch(`http://127.0.0.1:${port}/api/news`, {
      method: 'POST',
      headers: { Cookie: desk.cookie },
      body: newsFormData,
    }).then((response) => response.json());
    newsId = news.id;

    const response = await putSection(port, page.id, 'report-one', {
      newsItemId: newsId,
      headline: 'Linked',
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    const section = updated.sections.find((s) => s.section_key === 'report-one');
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
  desk = await signIn(port);

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

// A picture that lands on the headline takes no room from the copy, so
// dropping one changes the character budget by nothing - the opposite of what
// the composition editor promises. It has to land in the text.
test('a new picture lands in the copy, not on the headline, and takes room from it', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  let newspaper;

  try {
    const setupResult = await setup(port, 'Page section test - picture lands in the copy');
    newspaper = setupResult.newspaper;
    const page = setupResult.page;

    // A headline long enough to take real rows off the top of the block.
    await putSection(port, page.id, 'lead', {
      headline: 'सातारा जिल्ह्यात पावसाने उघडीप दिल्याने शेतीकामांना वेग',
      subheading: 'शेतकऱ्यांनी पेरणीच्या कामांना सुरुवात केली',
    });

    // What the block holds, measured by the worklist - the one character grid.
    const capacityOfLead = async () => {
      const list = await desk.json(`/api/newspapers/${newspaper.id}/worklist`);
      return list.pages.flatMap((p) => p.blocks).find((b) => b.sectionKey === 'lead')?.capacity;
    };
    const before = await capacityOfLead();

    const placed = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/does-not-need-to-exist.png', filename: 'p.png' }),
    });

    const picture = placed[0];
    assert.ok(picture, 'the picture is placed');

    const { rows } = await pool.query(
      'SELECT margin_px, headline_font_px, body_font_px FROM page_sections WHERE page_id = $1 AND section_key = $2',
      [page.id, 'lead'],
    );
    const margin = Number(rows[0].margin_px) || 12;
    assert.ok(
      Number(picture.y_px) > margin,
      `a picture at y=${picture.y_px} sits on the headline, which starts at ${margin}`,
    );

    // The point of landing it there: the copy now has less room.
    const after = await capacityOfLead();
    assert.ok(after < before, `the budget should fall when a picture lands: ${before} -> ${after}`);

    // An explicit placement is still obeyed - this is a default, not a rule.
    const second = await desk.json(`/api/pages/${page.id}/sections/lead/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/does-not-need-to-exist-2.png', filename: 'q.png', x: 4, y: 2 }),
    });
    assert.equal(Number(second.find((i) => i.id !== picture.id).y_px), 2);
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});
