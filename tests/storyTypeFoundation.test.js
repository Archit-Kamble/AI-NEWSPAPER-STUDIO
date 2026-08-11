const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn } = require('./helpers/desk');
const { templates } = require('../src/layout/templates');
const { normalizeStoryMetadata } = require('../src/services/storyType.service');

async function withPage(t, name) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const newspaper = await desk.json('/api/newspapers', {
    method: 'POST', body: JSON.stringify({ name }),
  });
  t.after(() => pool.query('DELETE FROM newspapers WHERE id = $1', [newspaper.id]));
  const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
    method: 'POST', body: JSON.stringify({ pageNumber: 1, templateKey: 'front' }),
  });
  return { desk, newspaper, page };
}

async function postNews(base, cookie, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return fetch(`${base}/api/news`, { method: 'POST', headers: { Cookie: cookie }, body: form });
}

async function patchNews(base, cookie, id, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  return fetch(`${base}/api/news/${id}`, { method: 'PATCH', headers: { Cookie: cookie }, body: form });
}

test('the one semantic catalog defines all supported story types and keeps ads/cards distinct', async () => {
  const types = await import('../public/editor/layout/story-types.js');
  assert.deepEqual(types.STORY_TYPE_KEYS, [
    'LEAD', 'SECONDARY', 'STANDARD', 'BRIEF', 'PHOTO_FEATURE', 'OPINION',
    'ANALYSIS', 'QUOTE', 'DATA', 'SIDEBAR', 'SMART_CARD', 'ADVERTISEMENT',
  ]);

  for (const key of types.STORY_TYPE_KEYS) {
    const policy = types.storyPolicy(key);
    assert.equal(policy.type, key);
    assert.ok(policy.priority >= 1 && policy.priority <= 5, `${key} has a bounded priority`);
  }

  assert.equal(types.storyPolicy('ADVERTISEMENT').compatibleBlockTypes.includes('article'), false);
  assert.equal(types.storyPolicy('SMART_CARD').compatibleBlockTypes.includes('article'), false);
  assert.notEqual(types.resolveStoryType({ block_type: 'advert' }), types.STORY_TYPE.STANDARD);
  assert.notEqual(types.resolveStoryType({ smart_card_key: 'rashi' }), types.STORY_TYPE.STANDARD);

  // Server request code imports this exact browser-safe module; it does not
  // carry a second enum or independently normalise a type.
  const bridge = fs.readFileSync(path.join(__dirname, '..', 'src/services/storyType.service.js'), 'utf8');
  assert.match(bridge, /import\('\.\.\/\.\.\/public\/editor\/layout\/story-types\.js'\)/);
});

test('the shared catalog accepts known aliases, safely defaults legacy rows, and bounds priority', async () => {
  const types = await import('../public/editor/layout/story-types.js');
  const { draftFromSection } = await import('../public/editor/section-model.js');

  assert.equal(types.normalizeStoryType('photo feature'), 'PHOTO_FEATURE');
  assert.equal(types.isKnownStoryType('not-a-story-type'), false);
  assert.equal(types.resolveStoryType({ block_type: 'briefs' }), 'BRIEF');
  assert.equal(types.resolveStoryType({ block_type: 'article' }), 'STANDARD');

  const legacy = draftFromSection({ section_key: 'legacy', block_type: 'article' });
  assert.equal(legacy.storyType, 'STANDARD');
  assert.equal(legacy.editorialPriority, 3);

  assert.deepEqual(await normalizeStoryMetadata({ storyType: 'lead', editorialPriority: 9 }), {
    storyType: 'LEAD', editorialPriority: 5,
  });
  assert.deepEqual(await normalizeStoryMetadata({ storyType: 'brief', editorialPriority: 0 }), {
    storyType: 'BRIEF', editorialPriority: 1,
  });
  assert.match((await normalizeStoryMetadata({ storyType: 'invented_type' })).error, /Unknown story type/);
  assert.match((await normalizeStoryMetadata({ editorialPriority: 'high' })).error, /priority/i);
});

test('news create/read/update persists semantic metadata and rejects an invalid explicit type', async (t) => {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  let newsId;
  t.after(async () => { if (newsId) await pool.query('DELETE FROM news_items WHERE id = $1', [newsId]); });

  const createdResponse = await postNews(desk.base, desk.cookie, {
    title: 'Semantic news item', description: 'Copy', storyType: 'lead', editorialPriority: 9,
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  newsId = created.id;
  assert.equal(created.story_type, 'LEAD');
  assert.equal(Number(created.editorial_priority), 5);

  const reloaded = await desk(`/api/news/${newsId}`).then((response) => response.json());
  assert.equal(reloaded.story_type, 'LEAD');
  assert.equal(Number(reloaded.editorial_priority), 5);

  const updatedResponse = await patchNews(desk.base, desk.cookie, newsId, {
    title: 'Semantic news item updated', description: 'Copy updated', storyType: 'brief', editorialPriority: 0,
  });
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.story_type, 'BRIEF');
  assert.equal(Number(updated.editorial_priority), 1);

  const invalid = await patchNews(desk.base, desk.cookie, newsId, {
    title: 'Semantic news item updated', description: 'Copy updated', storyType: 'not-a-type', editorialPriority: 3,
  });
  assert.equal(invalid.status, 400);
  const afterInvalid = await desk(`/api/news/${newsId}`).then((response) => response.json());
  assert.equal(afterInvalid.story_type, 'BRIEF');
});

test('page-section save/reload persists semantic metadata while template defaults stay valid', async (t) => {
  const { desk, newspaper, page } = await withPage(t, 'Story type foundation');
  const types = await import('../public/editor/layout/story-types.js');

  for (const template of Object.values(templates)) {
    for (const section of template.sections) {
      assert.ok(types.STORY_TYPE_KEYS.includes(section.storyType), `${template.key}/${section.key} has a catalog type`);
      assert.ok(Number.isInteger(section.editorialPriority));
      assert.ok(section.editorialPriority >= 1 && section.editorialPriority <= 5);
    }
  }

  const fromTemplate = page.sections.find((section) => section.section_key === 'lead');
  assert.equal(fromTemplate.story_type, 'LEAD');
  assert.equal(Number(fromTemplate.editorial_priority), 5);

  const savedResponse = await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: 'संपादकीय पाहणी', body: 'हा मजकूर विभागाच्या प्रकारासह जतन होतो.',
      storyType: 'opinion', editorialPriority: 7,
    }),
  });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  const savedLead = saved.sections.find((section) => section.section_key === 'lead');
  assert.equal(savedLead.story_type, 'OPINION');
  assert.equal(Number(savedLead.editorial_priority), 5);

  const pages = await desk(`/api/newspapers/${newspaper.id}/pages`).then((response) => response.json());
  const reloadedLead = pages[0].sections.find((section) => section.section_key === 'lead');
  assert.equal(reloadedLead.story_type, 'OPINION');
  assert.equal(Number(reloadedLead.editorial_priority), 5);

  const invalid = await desk(`/api/pages/${page.id}/sections/lead`, {
    method: 'PUT', body: JSON.stringify({ storyType: 'corrupt_type' }),
  });
  assert.equal(invalid.status, 400);
  const afterInvalid = await desk(`/api/newspapers/${newspaper.id}/pages`).then((response) => response.json());
  assert.equal(afterInvalid[0].sections.find((section) => section.section_key === 'lead').story_type, 'OPINION');

  // The template recommends a role only for an empty frame. A desk decision
  // about an already-filled matching frame must survive a layout switch.
  await desk(`/api/pages/${page.id}/sections/anchor`, {
    method: 'PUT',
    body: JSON.stringify({ headline: 'स्वतंत्र मत', body: 'जतन केलेला मजकूर.', storyType: 'opinion', editorialPriority: 2 }),
  });
  const switched = await desk(`/api/pages/${page.id}`, {
    method: 'PATCH', body: JSON.stringify({ templateKey: 'dense' }),
  });
  assert.equal(switched.status, 200);
  const switchedPage = await switched.json();
  const anchor = switchedPage.sections.find((section) => section.section_key === 'anchor');
  assert.equal(anchor.story_type, 'OPINION');
  assert.equal(Number(anchor.editorial_priority), 2);
});
