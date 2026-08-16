// PROJECT_STATUS.md, PROJECT A audit: page_sections.image_url ("Take from
// Reporter"'s auto-fill) and section_images (a desk's own placed pictures)
// are two independent fields. The renderer switches over to section_images
// the moment it gains a first row, and image_url is never drawn again -
// found live against a real block: the reporter's photo silently vanished,
// with no warning, the instant a desk added one picture of their own.
//
// carryForwardAutoFilledImage() (sectionImage.service.js) is the fix: the
// first manual picture converts image_url into an ordinary section_images
// row instead of orphaning it, so nothing a reporter filed is ever lost by
// a desk simply doing their job.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');

async function withEdition(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk.json('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'sectionImage carry-forward test' }),
    });
    const page = await desk.json(`/api/newspapers/${newspaper.id}/pages`, {
      method: 'POST',
      body: JSON.stringify({ pageNumber: 1, templateKey: 'dense' }),
    });
    await run({ desk, newspaper, page });
  } finally {
    await removeEdition(newspaper?.id);
    server.close();
  }
}

test('the first manually placed picture carries a reporter\'s auto-filled photo forward, rather than orphaning it', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[0].section_key;
    const autoFilledUrl = 'https://example.test/reporter-photo.jpg';

    // Simulate "Take from Reporter"'s own auto-fill: it writes image_url
    // directly onto the section (section-model.js's draftFromStory(), saved
    // through the ordinary PUT), never through this endpoint.
    await pool.query(
      'UPDATE page_sections SET image_url = $1 WHERE page_id = $2 AND section_key = $3',
      [autoFilledUrl, page.id, sectionKey],
    );

    const before = await desk.json(`/api/pages/${page.id}`, {}).catch(() => null);
    const beforeRow = (await pool.query(
      'SELECT image_url FROM page_sections WHERE page_id = $1 AND section_key = $2',
      [page.id, sectionKey],
    )).rows[0];
    assert.equal(beforeRow.image_url, autoFilledUrl, 'the auto-fill really is there before the desk adds anything');

    // The desk adds their own picture, exactly what "+ Picture" does.
    const images = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/desk-added-picture.jpg', filename: 'desk-added-picture.jpg' }),
    });

    assert.equal(images.length, 2, 'the reporter\'s photo AND the desk\'s new picture both exist as placed pictures');
    const carried = images.find((row) => row.url === autoFilledUrl);
    assert.ok(carried, 'the auto-filled photo is now an ordinary section_images row, not gone');
    const added = images.find((row) => row.url !== autoFilledUrl);
    assert.ok(added, 'and the desk\'s own picture is there too');
    assert.ok(Number(added.z_index) > Number(carried.z_index), 'the newly-added picture sits above the carried-forward one');

    const afterRow = (await pool.query(
      'SELECT image_url FROM page_sections WHERE page_id = $1 AND section_key = $2',
      [page.id, sectionKey],
    )).rows[0];
    assert.equal(afterRow.image_url, null, 'image_url is cleared - there is exactly one place this photo now lives');
    void before;
  });
});

test('a block with no auto-filled photo behaves exactly as before - nothing to carry forward', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[1].section_key;
    const images = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/only-picture.jpg', filename: 'only-picture.jpg' }),
    });
    assert.equal(images.length, 1, 'only the one picture the desk actually added');
  });
});

test('adding the SAME url as the auto-fill does not duplicate it - it becomes the one placed row', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[2].section_key;
    const url = 'https://example.test/same-photo.jpg';
    await pool.query(
      'UPDATE page_sections SET image_url = $1 WHERE page_id = $2 AND section_key = $3',
      [url, page.id, sectionKey],
    );
    const images = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url, filename: 'same-photo.jpg' }),
    });
    assert.equal(images.length, 1, 'the carried-forward row and the desk\'s own add resolve to the one picture, not two');
  });
});

// D0: a new picture's landing Y used to be measured on text-flow.js's
// approximate character grid - a second geometry truth from the one the
// page canvas, the Block Editor, fit and preflight all measure against
// (compose.js). copyStartsAt() now composes through that same exact engine,
// so a picture lands exactly where the real body actually starts, even for
// a multiline Marathi headline/deck the approximate grid could disagree
// with the real shaped line count on.
test('a new picture lands exactly at the exact compositor\'s own bodyTop, for a multiline Marathi headline/deck', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[3].section_key;
    const headline = 'ही एक बरीच लांब मथळ्याची ओळ आहे जी अनेक ओळींमध्ये सहज मोडते आणि चाचणीसाठी पुरेशी मोठी आहे';
    const subheading = 'ही उपमथळ्याची ओळ देखील पुरेशी लांब आहे जेणेकरून ती एका ओळीत बसणार नाही';
    await desk(`/api/pages/${page.id}/sections/${sectionKey}`, {
      method: 'PUT',
      body: JSON.stringify({ headline, subheading }),
    });
    // Tall enough that the picture's own default height (a third of the
    // block) cannot push clampToBlock() into pulling the placement back up
    // off bodyTop - this proves what D0 actually changed (WHERE the body
    // starts), not clampToBlock's separate, pre-existing "stay inside the
    // block" behaviour.
    await pool.query('UPDATE page_sections SET height_px = 900 WHERE page_id = $1 AND section_key = $2', [page.id, sectionKey]);

    const images = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/multiline-headline-photo.jpg', filename: 'photo.jpg' }),
    });
    assert.equal(images.length, 1);

    const [adapter, metrics, shaper] = await Promise.all([
      import('../public/editor/compose/section-adapter.js'),
      import('../public/editor/compose/font-metrics.js'),
      import('../public/editor/compose/shaper.js'),
    ]);
    await metrics.ensureFontsLoaded();
    await shaper.ensureShaperReady();

    const { rows } = await pool.query('SELECT * FROM page_sections WHERE id = $1', [images[0].page_section_id]);
    const section = rows[0];
    const expected = Math.round(adapter.composeSection({ ...section, images: [] }, { ...section, body: '' }).bodyTop);
    assert.equal(Number(images[0].y_px), expected);
  });
});
