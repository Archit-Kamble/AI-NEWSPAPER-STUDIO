// A SHAPED BLOCK'S BORDER AND GROUND PRINT THE SAME POLYGON EVERYWHERE.
//
// blockShapes.test.js holds that the compositor keeps type clear of a cut
// corner. This holds the OTHER half: the polygon that gets drawn - in the
// PDF/IDML's shared walk and in Scribus's own separately-tested block walk -
// is the same shape, on a real edition, saved through the real service.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');
const newspaperRepository = require('../src/repositories/newspaper.repository');
const pageRepository = require('../src/repositories/page.repository');
const pageSectionService = require('../src/services/pageSection.service');

test.after(() => pool.end());

test('a notched block prints the same 5-point polygon in the PDF/IDML walk and in Scribus', async (t) => {
  const date = '2099-08-23';
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const page1 = pages.find((p) => p.page_number === 1);
  const section = page1.sections.find((s) => s.block_type === 'article');
  assert.ok(section, 'the fixture front page has no article block to shape');

  const saved = await desk.json(`/api/pages/${page1.id}/sections/${section.section_key}`, {
    method: 'PUT',
    body: JSON.stringify({
      headline: section.headline || '', subheading: section.subheading || '', body: section.body || '',
      frameShape: 'notch-tr', borderStyle: 'box', borderWidthPx: 1.5, borderInk: '#0a7a3f', backgroundColor: '#eef7f0',
    }),
  });
  assert.ok(!saved.error, `shaping the block failed: ${saved.error}`);

  const printModel = require('../src/services/export/print-model');
  const scribusService = require('../src/services/scribus.service');
  const newspaper = await newspaperRepository.findById(started.newspaper.id);
  const rows = await pageRepository.findByNewspaper(started.newspaper.id);
  const hydrated = await Promise.all(rows.map((p) => pageRepository.findById(p.id)));

  const model = await printModel.buildPrintModel(newspaper, hydrated);
  const allItems = model.pages.flatMap((p) => p.items || []);
  const fivePointPolys = allItems.filter((i) => i.kind === 'poly' && i.points?.length === 5);
  assert.strictEqual(fivePointPolys.length, 2, 'expected exactly 2 five-point polygons: the shaped ground fill and the shaped border stroke');
  const fill = fivePointPolys.find((p) => !p.strokeWidth);
  const stroke = fivePointPolys.find((p) => p.strokeWidth > 0);
  assert.ok(fill, 'no filled (ground) pentagon found');
  assert.ok(stroke, 'no stroked (border) pentagon found');
  assert.strictEqual(fill.ink, '#eef7f0');
  assert.strictEqual(stroke.ink, '#0a7a3f');

  const sla = await scribusService.buildDocument(newspaper, hydrated);
  const pathCount = (sla.match(/path="/g) || []).length;
  assert.strictEqual(pathCount, 2, 'expected exactly 2 path= polygons in the .sla: the ground fill and the border stroke');
  assert.match(sla, /PCOLOR="SahasTintMint"/, 'the .sla ground fill is not the block\'s own tint');
  // A STROKED polygon puts its colour in PCOLOR2 (scribus.service.js's
  // polyFrame: PCOLOR="None", PCOLOR2=colour when strokeWidth > 0) - a fill
  // does the reverse. Checking only PCOLOR was this test's own mistake, not
  // a product one; the live probe that found this checked both.
  assert.match(sla, /PCOLOR2="SahasGreen"/, 'the .sla border stroke is not the block\'s own ink');
});

// A foreign shape name must never reach the plate - the same palette-style
// boundary borderStyle/backgroundColor already have.
test('a shape not in the catalogue is refused by the real service', async (t) => {
  const date = '2099-08-24';
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));
  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const page1 = pages.find((p) => p.page_number === 1);
  const section = page1.sections.find((s) => s.block_type === 'article');

  const result = await pageSectionService.saveSection(page1.id, section.section_key, {
    headline: '', subheading: '', body: '', frameShape: 'hexagon-of-doom',
  });
  assert.ok(result.error, 'a foreign shape name was accepted');
});
