const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const publication = require('../src/services/epaperPublication.service');
const epaper = require('../src/services/epaper.service');
const canvasCapture = require('../src/services/epaperCanvasRender.service');

test('hotspot percentages become an exact, bounded raster crop', () => {
  assert.deepEqual(
    publication.cropBox({ width: 2000, height: 3000 }, {
      leftPct: 10, topPct: 20, widthPct: 30, heightPct: 40,
    }),
    { x: 200, y: 600, w: 600, h: 1200 },
  );
  assert.deepEqual(
    publication.cropBox({ width: 100, height: 100 }, {
      leftPct: -5, topPct: 99.8, widthPct: 0, heightPct: 50,
    }),
    { x: 0, y: 99, w: 1, h: 1 },
    'a corrupt edge rectangle is bounded rather than reading outside the PNG',
  );
});

test('a story share image is a real 1080px PNG with the nameplate above the printed crop', async (t) => {
  const { Jimp } = await import('jimp');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sahas-epaper-card-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'story.png');
  const page = new Jimp({ width: 1200, height: 1800, color: 0xe9e5ddff });
  const nameplate = await Jimp.read(path.join(epaper.PUBLIC_DIR, epaper.LOGO_URL));

  await publication.storyCard(page, nameplate, {
    hotspot: { leftPct: 10, topPct: 10, widthPct: 45, heightPct: 55 },
  }, output);

  const card = await Jimp.read(output);
  assert.equal(card.bitmap.width, 1080, 'social cards have a stable, high-resolution width');
  assert.ok(card.bitmap.height > 1000, 'the printed story crop is retained below the masthead');
  assert.equal((await fs.readFile(output)).subarray(1, 4).toString(), 'PNG');
});

test('reader HTML carries mobile page navigation, PNG story affordances, PDF and accessible text', () => {
  const html = epaper.renderHtml({
    edition: { id: 42, title: 'दैनिक साहस वार्ता', district: 'सातारा', date: '2026-08-20', dateLine: null, volumeLine: 'वर्ष १', pdfUrl: '/epaper/42/pdf' },
    pages: [{ number: 1, imageUrl: '/uploads/epaper/42/page-1.png', imageWidth: 1200, imageHeight: 1800, articles: [{
      id: 7, sectionKey: 'lead', headline: 'स्पष्ट बातमी', body: 'वाचता येणारा मजकूर.', pictures: [],
      hotspot: { leftPct: 10, topPct: 20, widthPct: 60, heightPct: 30 },
      shareImageUrl: '/uploads/epaper/42/story-1-7.png',
    }] }],
  });
  assert.match(html, /data-page-button="1"/);
  assert.match(html, /data-page-stage/);
  assert.match(html, /story-1-7\.png/);
  assert.match(html, /Whole newspaper PDF/);
  assert.match(html, /वाचता येणारा मजकूर/);
  assert.match(html, /WhatsApp/);
  assert.match(html, /Instagram/);
  assert.match(html, /Facebook/);
  assert.match(html, /LinkedIn/);
  assert.doesNotMatch(html, />All editions</);
  // THE NAMEPLATE CARRIES THE LION, so the header does not carry it twice.
  // This asserted the presence of a second, cropped copy of the same mark - a
  // 42px circle taken out of the nameplate image at background-position 56%,
  // with a red sliver of the वा of वार्ता caught in its edge, sitting beside the
  // real one. The desk's report was "lion logo in top is not right", and the
  // answer is the one this project already reached for the RNI: the artwork
  // sets the mark, and setting it a second time is not a mark but a mistake.
  assert.doesNotMatch(html, /reader-lion-mark/);
  assert.match(html, /class="reader-brand"/, 'the real nameplate is still the header');
});

test('published asset paths reject traversal, manifests and non-PNG files before lookup', async () => {
  assert.equal(await epaper.publishedAsset(42, '../manifest.json'), null);
  assert.equal(await epaper.publishedAsset(42, 'manifest.json'), null);
  assert.equal(await epaper.publishedAsset(42, 'page-1.jpg'), null);
});

test('the exact-canvas capture handoff is one-use, opaque and never a public editor route', () => {
  const token = canvasCapture.createCanvasCapture(
    { id: 42, page_width_px: 660, page_height_px: 1060 },
    { page_number: 1, sections: [{ headline: '</script><script>bad()</script>' }] },
    1,
  );
  assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
  const payload = canvasCapture.takeCanvasCapture(token);
  assert.equal(payload.page.page_number, 1);
  assert.equal(canvasCapture.takeCanvasCapture(token), null, 'a capture URL cannot be replayed');
  const html = canvasCapture.canvasCaptureHtml(payload);
  assert.match(html, /epaper-canvas-capture\.js/);
  assert.match(html, /\.newspaper-canvas\{transform:none!important;/, 'the canvas capture must never re-enter editor Fit scale after its page map is frozen');
  assert.doesNotMatch(html, /<\/script><script>bad\(\)<\/script>/, 'edition copy cannot end the embedded JSON script');
  assert.match(html, /\\u003c\/script>/);
});

test('the editor Publish action is one confirmation, while optional PDF e-paper publishing lives in management', async () => {
  const publicationUi = await fs.readFile(path.join(epaper.PUBLIC_DIR, 'editor', 'publication.js'), 'utf8');
  const managementUi = await fs.readFile(path.join(epaper.PUBLIC_DIR, 'admin', 'epapers.js'), 'utf8');
  assert.match(publicationUi, /id="confirmPublish"/);
  assert.match(publicationUi, /\/publish-current/);
  assert.doesNotMatch(publicationUi, /scribusFile|final-files|publishEpaper|printPdf/);
  assert.match(managementUi, /Publish from a finished PDF/);
  assert.match(managementUi, /\/epaper\/pdf/);
  assert.match(managementUi, /data-epaper-pdf-date/);
  assert.match(managementUi, /data-map-epaper/);
  assert.doesNotMatch(managementUi, /data-epaper-pdf-edition/);
  const readerUi = await fs.readFile(path.join(epaper.PUBLIC_DIR, 'epaper-reader.js'), 'utf8');
  assert.match(readerUi, /dblclick/);
  assert.match(readerUi, /Story PNG downloaded/);
  assert.match(readerUi, /web\.whatsapp\.com/);
  assert.match(readerUi, /instagram\.com/);
});
