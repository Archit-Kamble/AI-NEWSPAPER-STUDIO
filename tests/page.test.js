const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');

async function createNewspaper(desk, name) {
  const response = await desk('/api/newspapers', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return response.json();
}

async function cleanupNewspaper(id) {
  await pool.query('DELETE FROM newspapers WHERE id = $1', [id]);
}

test('creating a page applies the requested template and its sections', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;

  try {
    newspaper = await createNewspaper(desk, 'Page test - create');

    const response = await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1, templateKey: 'opinion' }),
    });
    assert.equal(response.status, 201);

    const page = await response.json();
    assert.equal(page.newspaper_id, newspaper.id);
    assert.equal(page.page_number, 1);
    assert.equal(page.template_key, 'opinion');
    assert.ok(Array.isArray(page.sections) && page.sections.length > 0);
    assert.deepEqual(
      page.sections.map((section) => section.section_key).sort(),
      ['editorial', 'opinion-one', 'opinion-three', 'opinion-two'].sort(),
    );
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('creating a page without a template defaults to front', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;

  try {
    newspaper = await createNewspaper(desk, 'Page test - default template');

    const page = await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1 }),
    }).then((response) => response.json());

    assert.equal(page.template_key, 'front');
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('listing pages for a newspaper returns every page created for it', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;

  try {
    newspaper = await createNewspaper(desk, 'Page test - list');

    await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
    });
    await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 2, templateKey: 'local' }),
    });

    const response = await desk(`/api/newspapers/${newspaper.id}/pages`);
    assert.equal(response.status, 200);
    const pages = await response.json();

    assert.equal(pages.length, 2);
    assert.deepEqual(
      pages.map((page) => page.page_number).sort(),
      [1, 2],
    );
    assert.deepEqual(
      pages.map((page) => page.template_key).sort(),
      ['front', 'local'].sort(),
    );
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('updating a page template replaces its sections with the new template layout', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;

  try {
    newspaper = await createNewspaper(desk, 'Page test - update template');

    const page = await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
    }).then((response) => response.json());
    assert.equal(page.template_key, 'front');

    const response = await desk(`/api/pages/${page.id}`, {
      method: 'PATCH',
            body: JSON.stringify({ template: 'photo' }),
    });
    assert.equal(response.status, 200);

    const updated = await response.json();
    assert.equal(updated.template_key, 'photo');
    assert.deepEqual(
      updated.sections.map((section) => section.section_key).sort(),
      ['caption-story', 'photo-bottom', 'photo-lead', 'photo-top'].sort(),
    );
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('updating a page with no template field leaves it unchanged', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;

  try {
    newspaper = await createNewspaper(desk, 'Page test - noop update');

    const page = await desk(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
            body: JSON.stringify({ pageNumber: 1, templateKey: 'local' }),
    }).then((response) => response.json());

    const response = await desk(`/api/pages/${page.id}`, {
      method: 'PATCH',
            body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);

    const unchanged = await response.json();
    assert.equal(unchanged.template_key, 'local');
    assert.deepEqual(
      unchanged.sections.map((section) => section.id).sort(),
      page.sections.map((section) => section.id).sort(),
    );
  } finally {
    if (newspaper) await cleanupNewspaper(newspaper.id);
    server.close();
  }
});

test('updating a nonexistent page with no template field returns 404', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const desk = await signIn(port);

  try {
    const response = await desk(`/api/pages/999999999`, {
      method: 'PATCH',
            body: JSON.stringify({}),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  } finally {
    server.close();
  }
});
