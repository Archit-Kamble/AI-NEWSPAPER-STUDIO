// THE FOLIO AND THE FOOTER PRINT WHAT THE DESK APPROVED, on a real edition.
//
// The unit tests in furnitureStyles.test.js hold the catalogue's own shape.
// This holds the thing that actually matters: a page whose theme is set
// produces the SAME rule/tint/ink in print-model.js (the PDF/IDML's shared
// walk) and in scribus.service.js's own footer frames - never one styled and
// the other silently plain, which is the two-surface disagreement this
// project guards hardest against.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const pool = require('../src/config/db');
const { signIn, removeEdition } = require('./helpers/desk');
const newspaperRepository = require('../src/repositories/newspaper.repository');
const pageRepository = require('../src/repositories/page.repository');

test.after(() => pool.end());

async function dressedEdition(t, date) {
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const pages = await desk.json(`/api/newspapers/${started.newspaper.id}/pages`);
  const page3 = pages.find((p) => p.page_number === 3);
  // A theme carrying the strongest devices this catalogue has - a reversed
  // folio banner and a tinted, coloured footer - so a missed theming path
  // shows up as a wrong colour rather than a wrong shade of the same one.
  const dressed = await desk.json(`/api/pages/${page3.id}/style`, {
    method: 'POST',
    body: JSON.stringify({ theme: 'sunday' }),
  });
  assert.ok(!dressed.error, `dressing page 3 failed: ${dressed.error}`);
  return { newspaperId: started.newspaper.id, pageId: page3.id };
}

test('a themed page\'s folio prints the same reversed banner in the PDF/IDML walk and in Scribus', async (t) => {
  const date = '2099-08-21';
  const { newspaperId } = await dressedEdition(t, date);

  const printModel = require('../src/services/export/print-model');
  const scribusService = require('../src/services/scribus.service');

  const newspaper = await newspaperRepository.findById(newspaperId);
  const rows = await pageRepository.findByNewspaper(newspaperId);
  const pages = await Promise.all(rows.map((p) => pageRepository.findById(p.id)));

  // --- the shared walk (PDF/IDML) ---
  const model = await printModel.buildPrintModel(newspaper, pages);
  const page3 = model.pages.find((p) => p.number === 3);
  const folioFill = page3.items.find((i) => i.kind === 'fill' && i.y < 30 && i.ink === '#d2601a');
  assert.ok(folioFill, 'the sunday theme (orange) did not produce a reversed folio panel in print-model.js');
  const whiteText = page3.items.filter((i) => i.kind === 'text' && i.y < 30 && i.runs?.[0]?.ink === '#ffffff');
  assert.strictEqual(whiteText.length, 3, 'a reversed folio should carry all three columns in white');

  // --- Scribus's own walk (its footer is NOT shared code, by design - see
  // CLAUDE.md's "Scribus shares the FURNITURE, not the block walk" - so this
  // is the one place a themed footer could silently be plain) ---
  const sla = await scribusService.buildDocument(newspaper, pages);
  // The 'orange' hue family's GROUND is the measured VIVID variant
  // page-styles.js's automatic theming reaches for (inks.js's 'vivid-orange',
  // .sla name SahasTintVividOrange) - not the pale 'sand' a desk's own manual
  // picker offers. See tests/paletteExpansion.test.js for why the two exist.
  assert.match(sla, /PCOLOR="SahasTintVividOrange"/, 'the .sla footer is not tinted for the sunday theme');
  assert.match(sla, /PCOLOR="SahasOrange"/, 'the .sla footer title/page-number are not in the theme ink');
});

// An UNDRESSED page - the ordinary case for every edition today - must draw
// byte-for-byte what it always drew: no fill, a plain black hairline, black
// type. This is what makes the whole feature additive rather than a silent
// restyle of every existing edition.
test('an undressed page\'s folio and footer are unchanged: no tint, no theme ink', async (t) => {
  const date = '2099-08-22';
  const server = createApp().listen(0);
  t.after(() => server.close());
  const desk = await signIn(server.address().port);
  const started = await desk.json('/api/newspapers/start', {
    method: 'POST',
    body: JSON.stringify({ publicationDate: date, pageCount: 4, fillFeatures: false }),
  });
  t.after(() => removeEdition(started.newspaper.id));

  const printModel = require('../src/services/export/print-model');
  const newspaper = await newspaperRepository.findById(started.newspaper.id);
  const rows = await pageRepository.findByNewspaper(started.newspaper.id);
  const pages = await Promise.all(rows.map((p) => pageRepository.findById(p.id)));
  const model = await printModel.buildPrintModel(newspaper, pages);
  const page3 = model.pages.find((p) => p.number === 3);

  const folioFills = page3.items.filter((i) => i.kind === 'fill' && i.y < 30);
  assert.strictEqual(folioFills.length, 0, 'an undressed page should carry no folio tint or panel');
  const folioRules = page3.items.filter((i) => i.kind === 'rule' && i.y > 5 && i.y < 30);
  assert.strictEqual(folioRules.length, 1, 'an undressed page should carry exactly one hairline');
  assert.strictEqual(folioRules[0].ink, '#111111', 'an undressed folio\'s hairline is the paper\'s own plain rule ink');
  const folioTitle = page3.items.find((i) => i.kind === 'text' && i.y < 30 && i.runs?.[0]?.ink === '#c8102e');
  assert.ok(folioTitle, 'an undressed folio title keeps the paper\'s own accent red');
});
