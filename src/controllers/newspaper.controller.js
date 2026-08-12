const newspaperService = require('../services/newspaper.service');
const editionStartService = require('../services/editionStart.service');
const districtEditionService = require('../services/districtEdition.service');
const epaperService = require('../services/epaper.service');
const preflightService = require('../services/preflight.service');
const worklistService = require('../services/worklist.service');
const signoffService = require('../services/signoff.service');
const scribusService = require('../services/scribus.service');
const pressPackageService = require('../services/pressPackage.service');
const editionFeaturesService = require('../services/editionFeatures.service');
const plainTextModule = require('../layout/plain-text');
const { ladderFor, getSupportedEditionPageCounts } = require('../layout/ladder');
const editionResizeService = require('../services/editionResize.service');

async function create(req, res) {
  const newspaper = await newspaperService.createNewspaper(req.body, req.session.user);
  res.status(201).json(newspaper);
}

// Start an edition: open the one for the date if it exists, otherwise make it,
// build its page ladder, carry the booked adverts forward and fill the day's
// standing features. One call, because it is one decision.
async function start(req, res) {
  const result = await editionStartService.startEdition(req.body, req.session.user);
  if (result.error) return res.status(400).json(result);
  res.status(result.created ? 201 : 200).json(result);
}

async function resize(req, res) {
  const result = await editionResizeService.resizeEdition(Number(req.params.id), Number(req.body.pageCount));
  if (!result.ok) return res.status(result.code === 'EDITION_RESIZE_HAS_CONTENT' ? 409 : 400).json(result);
  res.json(result);
}

// What a given page count would produce, so the desk can see the ladder before
// committing to it rather than after.
async function ladder(req, res) {
  res.json(ladderFor(req.query.pages));
}
async function supportedPageCounts(req, res) { res.json(getSupportedEditionPageCounts()); }

async function list(req, res) {
  res.json(await newspaperService.listNewspapers());
}

async function latest(req, res) {
  const newspaper = await newspaperService.getLatestNewspaper();
  res.json(newspaper || null);
}

async function getOne(req, res) {
  const newspaper = await newspaperService.getNewspaper(req.params.id);
  if (!newspaper) return res.status(404).json({ error: 'Not found' });
  res.json(newspaper);
}

async function update(req, res) {
  const newspaper = await newspaperService.updateNewspaper(req.params.id, req.body);
  if (!newspaper) return res.status(404).json({ error: 'Not found' });
  res.json(newspaper);
}

async function saveFinalFiles(req, res) {
  const result = await newspaperService.saveFinalFiles(
    req.params.id,
    req.files || {},
    req.session.user,
  );
  if (result.error) return res.status(400).json({ error: result.error });
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  res.json(result.item);
}

// District editions: one paper with some pages swapped, not many papers.
async function createDistrictEdition(req, res) {
  const result = await districtEditionService.createDistrictEdition(parseInt(req.params.id, 10), req.body || {});
  if (!result) return res.status(404).json({ error: 'No such edition.' });
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
}

async function listDistrictEditions(req, res) {
  res.json(await districtEditionService.siblingsOf(parseInt(req.params.id, 10)));
}

// Every page as it will print - a district edition's own pages, with its
// parent's filling the numbers it did not take over.
async function printedPages(req, res) {
  const pages = await districtEditionService.pagesOf(parseInt(req.params.id, 10));
  if (!pages) return res.status(404).json({ error: 'No such edition.' });
  res.json(pages);
}

async function epaper(req, res) {
  const edition = await epaperService.buildEdition(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).json({ error: 'No such edition.' });
  res.json(edition);
}

async function epaperHtml(req, res) {
  const edition = await epaperService.buildEdition(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).type('html').send('<h1>No such edition.</h1>');
  res.type('html').send(epaperService.renderHtml(edition));
}

// Preflight: everything that must be true before a page reaches the plate.
async function preflight(req, res) {
  const report = await preflightService.checkEdition(parseInt(req.params.id, 10));
  if (!report) return res.status(404).json({ error: 'No such edition.' });
  res.json(report);
}

// What this edition still needs, in page order, with the exact character
// count each unfinished block holds.
async function worklist(req, res) {
  const list = await worklistService.forEdition(parseInt(req.params.id, 10));
  if (!list) return res.status(404).json({ error: 'No such edition.' });
  res.json(list);
}

async function status(req, res) {
  const result = await signoffService.editionStatus(parseInt(req.params.id, 10));
  if (!result) return res.status(404).json({ error: 'No such edition.' });
  res.json(result);
}

async function history(req, res) {
  res.json(await signoffService.history(parseInt(req.params.id, 10)));
}

// Fills every block the layout marked as a standing feature, for the
// edition's own date - one press, one pass, one model call for all of them.
async function features(req, res) {
  const result = await editionFeaturesService.fillEdition(parseInt(req.params.id, 10), { tier: req.body?.tier });
  if (!result) return res.status(404).json({ error: 'No such edition.' });
  res.json(result);
}

// The Scribus document and the press package both start from the same
// newspaper row and its printed pages, so they share how that is fetched.
async function loadForOutput(id) {
  const newspaper = await newspaperService.getNewspaper(id);
  if (!newspaper) return null;
  const pages = await districtEditionService.pagesOf(newspaper.id);
  await plainTextModule.load();
  return { newspaper, pages };
}

async function scribus(req, res) {
  const loaded = await loadForOutput(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'No such edition.' });
  const { newspaper, pages } = loaded;
  const sla = scribusService.buildDocument(newspaper, pages);

  await signoffService.record(newspaper.id, req.session.user?.id, 'Scribus document generated');
  const date = String(newspaper.publication_date).slice(0, 10);
  res.type('application/vnd.scribus')
    .set('Content-Disposition', `attachment; filename="sahas-${date}.sla"`)
    .send(sla);
}

// The press package: the .sla plus the photographs it points at, shipped
// together, because the .sla alone means nothing once it leaves this server.
async function pressPackage(req, res) {
  const loaded = await loadForOutput(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'No such edition.' });
  const { newspaper, pages } = loaded;
  const sla = scribusService.buildDocument(newspaper, pages);
  const { zip, pictures, missing } = await pressPackageService.build(newspaper, pages, sla);

  await signoffService.record(
    newspaper.id, req.session.user?.id,
    `Press package generated (${pages.length} pages, ${pictures} pictures${missing.length ? `, ${missing.length} missing` : ''})`,
  );
  const date = String(newspaper.publication_date).slice(0, 10);
  res.type('application/zip')
    .set('Content-Disposition', `attachment; filename="sahas-${date}-press.zip"`)
    .set('X-Pictures-Included', String(pictures))
    .set('X-Pictures-Missing', String(missing.length))
    .send(zip);
}

module.exports = {
  create, start, resize, ladder, supportedPageCounts, list, latest, getOne, update, saveFinalFiles,
  createDistrictEdition, listDistrictEditions, printedPages,
  epaper, epaperHtml, preflight, worklist, status, history, features,
  scribus, pressPackage,
};
