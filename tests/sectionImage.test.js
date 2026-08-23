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
const sectionImageRepository = require('../src/repositories/sectionImage.repository');

async function withEdition(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk.json('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'sectionImage carry-forward test', publicationDate: '2099-01-01' }),
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

// Found live: a cut-out (shape: 'cutout') resized via a plain API call that
// only named a new width came back with its OLD height unchanged, stretching
// the frame around the trimmed silhouette and stranding its own resize
// handles a third of the frame's width from anything visible. A cut-out has
// exactly one shape to show - there is no more subject a wider frame reveals,
// only dead space - so its aspect ratio is preserved here regardless of
// which single dimension a caller names, the same guarantee block-frame.js's
// drag handles now enforce for a mouse-driven resize.
test('resizing a cut-out by only one dimension preserves its aspect ratio, never stretching the silhouette', async () => {
  await withEdition(async ({ desk, page }) => {
    // page.sections[0] ("anchor" on the "dense" template) is 307x296 - large
    // enough that neither resize below runs into clampToBlock()'s own
    // ceiling, which would otherwise be indistinguishable from this test's
    // own aspect-lock arithmetic being wrong.
    const sectionKey = page.sections[0].section_key;
    const [placed] = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/cutout-test.png', width: 40, height: 100, shape: 'cutout' }),
    });
    assert.equal(placed.shape, 'cutout');

    // Width-only: height must follow the SAME 40:100 ratio, not stay at 100.
    const afterWidth = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images/${placed.id}`, {
      method: 'PATCH', body: JSON.stringify({ width: 60 }),
    });
    const rowAfterWidth = afterWidth.find((row) => row.id === placed.id);
    assert.equal(rowAfterWidth.width_px, 60);
    assert.equal(rowAfterWidth.height_px, 150, '60/40 = 1.5x, so height must scale 100 -> 150 too');

    // Height-only, from the now-60x150 row: width must follow back down.
    const afterHeight = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images/${placed.id}`, {
      method: 'PATCH', body: JSON.stringify({ height: 100 }),
    });
    const rowAfterHeight = afterHeight.find((row) => row.id === placed.id);
    assert.equal(rowAfterHeight.height_px, 100);
    assert.equal(rowAfterHeight.width_px, 40, '100/150 = (2/3)x, so width must scale 60 -> 40 too');
  });
});

// A frame already stretched crooked by an earlier call - before this
// guarantee existed - must be able to self-correct, not lock in its own
// wrong ratio forever. The source photograph's real dimensions (recorded on
// media_assets at upload) are the authority here, not whatever the frame
// currently happens to be.
test('a cut-out whose frame is ALREADY the wrong ratio self-corrects from the source photo\'s real dimensions, not its own crooked frame', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[0].section_key;
    const [placed] = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({
        url: '/uploads/cutout-test.png', width: 40, height: 100, shape: 'cutout',
        sourceWidth: 40, sourceHeight: 100,
      }),
    });
    // Stretch it crooked directly at the repository, the way a stray call
    // made before this guarantee existed could have.
    const repo = require('../src/repositories/sectionImage.repository');
    await repo.update(placed.id, { width: 120, height: 105 });

    const after = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images/${placed.id}`, {
      method: 'PATCH', body: JSON.stringify({ width: 80 }),
    });
    const row = after.find((r) => r.id === placed.id);
    assert.equal(row.width_px, 80);
    assert.equal(row.height_px, 200, '80 at the source\'s real 40:100 ratio is 200, not 70 (which 120:105 would have given)');
  });
});

test('a plain "rect" picture is unaffected - it still resizes free-form, one dimension at a time', async () => {
  await withEdition(async ({ desk, page }) => {
    const sectionKey = page.sections[0].section_key;
    const [placed] = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({ url: '/uploads/rect-test.jpg', width: 40, height: 100, shape: 'rect' }),
    });
    const after = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images/${placed.id}`, {
      method: 'PATCH', body: JSON.stringify({ width: 60 }),
    });
    const row = after.find((r) => r.id === placed.id);
    assert.equal(row.width_px, 60);
    assert.equal(row.height_px, 100, 'a rect picture keeps its stated height - only a cutout locks aspect');
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

// D1: media_assets.width_px/height_px already existed in schema but were
// never populated consistently - findOrCreateAsset() is the one place every
// creation path (upload, composition, cutout) goes through, so it is the
// one place backfill has to be correct: a genuinely new asset records what
// it is told, an existing asset with real dimensions is never clobbered by
// a caller that does not happen to know them, and one missing only its
// dimensions gets them filled in without disturbing anything else about it.
test('findOrCreateAsset records source dimensions on a new asset, backfills a missing one, never overwrites a known one', async () => {
  const freshUrl = `/uploads/dims-test-${Date.now()}.jpg`;
  try {
    const created = await sectionImageRepository.findOrCreateAsset({ url: freshUrl, filename: 'x.jpg', mimeType: 'image/jpeg', width: 400, height: 300 });
    assert.equal(created.width_px, 400);
    assert.equal(created.height_px, 300);

    const sameNoDims = await sectionImageRepository.findOrCreateAsset({ url: freshUrl, filename: 'x.jpg', mimeType: 'image/jpeg' });
    assert.equal(sameNoDims.id, created.id);
    assert.equal(sameNoDims.width_px, 400, 'a caller with no dimensions of its own must never blank out a known size');
    assert.equal(sameNoDims.height_px, 300);

    const differentDims = await sectionImageRepository.findOrCreateAsset({ url: freshUrl, filename: 'x.jpg', mimeType: 'image/jpeg', width: 999, height: 999 });
    assert.equal(differentDims.width_px, 400, 'a known dimension is never overwritten by a different one either');
    assert.equal(differentDims.height_px, 300);
  } finally {
    await pool.query('DELETE FROM media_assets WHERE url = $1', [freshUrl]);
  }
});

test('findOrCreateAsset backfills a real asset whose dimensions were never recorded', async () => {
  const undimensionedUrl = `/uploads/no-dims-${Date.now()}.jpg`;
  try {
    await pool.query(
      'INSERT INTO media_assets (original_filename, storage_path, mime_type, url) VALUES ($1, $2, $3, $4)',
      ['x.jpg', undimensionedUrl, 'image/jpeg', undimensionedUrl],
    );
    const backfilled = await sectionImageRepository.findOrCreateAsset({ url: undimensionedUrl, filename: 'x.jpg', mimeType: 'image/jpeg', width: 640, height: 480 });
    assert.equal(backfilled.width_px, 640);
    assert.equal(backfilled.height_px, 480);
  } finally {
    await pool.query('DELETE FROM media_assets WHERE url = $1', [undimensionedUrl]);
  }
});
