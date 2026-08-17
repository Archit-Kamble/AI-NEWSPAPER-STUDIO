// Gap 2 (image truth #9): three server-side consumers of a placed picture -
// the section-image API, a hydrated page (page.repository.js#hydrate, what
// preflight/press readiness/district editions all read), and
// placementsByEdition (what the worklist measures against) - used to reach
// into the database with three different SELECT lists. A cutout's exclusion
// depends on source width/height (image-geometry.js's resolvePlacedImage()),
// which only `media_assets` carries; two of the three consumers never
// joined it, so the SAME picture could compose one shape for the browser
// and a different, wrong shape for the worklist's character budget or a
// preflight check - silently, because nothing failed, it just disagreed.
//
// This asserts the strongest thing that matters: the ACTUAL COMPOSED
// EXCLUSION (not merely "the field is present on the row") is identical
// across all three, for a picture whose source aspect (400x200) does NOT
// match its placement (200x200) - the exact case a missing source width
// silently gets wrong by falling back to "assume 1:1".

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp } = require('../server');
const { signIn, removeEdition } = require('./helpers/desk');
const pageRepository = require('../src/repositories/page.repository');
const sectionImageRepository = require('../src/repositories/sectionImage.repository');

const load = (file) => import(path.join(__dirname, '..', 'public', 'editor', 'compose', file));

let exclusion;
let obstacleFromImage;
test.before(async () => {
  exclusion = await load('exclusion.js');
  ({ obstacleFromImage } = await load('section-adapter.js'));
});

async function withEdition(run) {
  const server = createApp().listen(0);
  const port = server.address().port;
  const desk = await signIn(port);
  let newspaper;
  try {
    newspaper = await desk.json('/api/newspapers', {
      method: 'POST',
      body: JSON.stringify({ name: 'image hydration parity test' }),
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

test('a cutout with a non-matching source aspect composes the SAME exclusion via the section-image API, hydrated page, and placementsByEdition', async () => {
  await withEdition(async ({ desk, newspaper, page }) => {
    const sectionKey = page.sections[0].section_key;
    const rows = 8;
    const cols = 8;
    // Subject in the upper-left quadrant only - a naive "assume 1:1" source
    // fallback would map this identically regardless of the real 400x200
    // source, so any of the three consumers disagreeing shows up as a
    // different obstacle, not merely a missing field.
    const cells = Array.from({ length: rows }, (u, r) => Array.from({ length: cols }, (u2, c) => (r < 4 && c < 4 ? 1 : 0)));

    const placed = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {
      method: 'POST',
      body: JSON.stringify({
        url: '/uploads/parity-test.jpg', filename: 'parity-test.jpg', mimeType: 'image/jpeg',
        sourceWidth: 400, sourceHeight: 200, x: 10, y: 10, width: 200, height: 200, fitMode: 'contain',
      }),
    });
    const imageId = placed[placed.length - 1].id;
    const asCutout = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images/${imageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ shape: 'cutout', mask: { rows, cols, cells } }),
    });
    assert.equal(asCutout.find((r) => r.id === imageId)?.shape, 'cutout', 'the picture is really a cutout before comparing consumers');

    // Consumer 1: the section-image API - what the browser (both Layout
    // and the Block Editor) actually reads.
    const apiImages = await desk.json(`/api/pages/${page.id}/sections/${sectionKey}/images`, {});
    const apiRow = apiImages.find((r) => r.id === imageId);
    assert.ok(apiRow, 'API consumer found the image');
    assert.equal(Number(apiRow.source_width_px), 400, 'API consumer carries source width');

    // Consumer 2: a hydrated page - page.repository.js#hydrate(), what
    // preflight/press readiness/district editions read.
    const hydratedPage = await pageRepository.findById(page.id);
    const hydratedSection = hydratedPage.sections.find((s) => s.section_key === sectionKey);
    const hydratedRow = hydratedSection.images.find((r) => r.id === imageId);
    assert.ok(hydratedRow, 'hydrated-page consumer found the image');
    assert.equal(Number(hydratedRow.source_width_px), 400, 'hydrated-page consumer carries source width');

    // Consumer 3: placementsByEdition - what the worklist measures against.
    const placements = await sectionImageRepository.placementsByEdition(newspaper.id);
    const placementRows = placements.get(hydratedSection.id) || [];
    const placementRow = placementRows.find((r) => r.id === imageId);
    assert.ok(placementRow, 'placementsByEdition consumer found the image');
    assert.equal(Number(placementRow.source_width_px), 400, 'placementsByEdition consumer carries source width');

    // Now the actual proof: the SAME query band, on each row, through the
    // SAME exact exclusion engine, must produce IDENTICAL obstacle runs.
    // Spans the picture's whole placed height (y:10..210) rather than a
    // narrow guessed band - 'contain' letterboxes this 400x200 source into
    // a 200x200 frame (scale 0.5, centred with 50px margins top/bottom), so
    // a band picked without accounting for that would miss the subject
    // entirely; the full height is guaranteed to overlap it regardless.
    // Each row goes through obstacleFromImage() first - the SAME snake_case
    // to camelCase, x_px-to-x normalisation composeSection() itself applies
    // via obstaclesOf() - obstacleIntervals() is never called with a raw DB
    // row in production, only with its output.
    const band = (row) => exclusion.obstacleIntervals(obstacleFromImage(row), 10, 210, 12);
    const apiResult = band(apiRow);
    const hydratedResult = band(hydratedRow);
    const placementResult = band(placementRow);

    assert.ok(apiResult.length > 0, 'the exclusion is real (not empty) via the API row');
    assert.deepEqual(hydratedResult, apiResult, 'hydrated-page composition must match the section-image API exactly');
    assert.deepEqual(placementResult, apiResult, 'placementsByEdition (worklist) composition must match the section-image API exactly');
  });
});
