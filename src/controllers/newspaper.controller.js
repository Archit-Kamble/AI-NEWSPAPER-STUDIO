const newspaperService = require('../services/newspaper.service');
const editionStartService = require('../services/editionStart.service');
const districtEditionService = require('../services/districtEdition.service');
const epaperService = require('../services/epaper.service');
const epaperPublicationService = require('../services/epaperPublication.service');
const epaperCanvasCapture = require('../services/epaperCanvasRender.service');
const preflightService = require('../services/preflight.service');
const worklistService = require('../services/worklist.service');
const signoffService = require('../services/signoff.service');
const scribusService = require('../services/scribus.service');
const exportService = require('../services/export');
const pressPackageService = require('../services/pressPackage.service');
const editionFeaturesService = require('../services/editionFeatures.service');
const plainTextModule = require('../layout/plain-text');
const { ladderFor, getSupportedEditionPageCounts } = require('../layout/ladder');
const editionResizeService = require('../services/editionResize.service');
const compositionWorkflow = require('../services/editionCompositionWorkflow.service');
const newsdesk = require('../services/newsdesk');
const newsdeskWriter = require('../services/newsdesk/writer');
const pageRepository = require('../repositories/page.repository');
const pressReadiness = require('../services/pressReadiness.service');
const { currentUser } = require('../middleware/auth');
const { can } = require('../auth/roles');

// Whether a PRIVATE e-paper asset may be served to this caller - a desk
// previewing a release nobody has selected yet. `can(..., 'makeUp')` rather
// than a role list, because src/auth/roles.js is the only place that says who
// the desk is.
const isDesk = (req) => can(currentUser(req), 'makeUp');

async function create(req, res) {
  const newspaper = await newspaperService.createNewspaper(req.body, req.session.user);
  // A refused date comes back as an error rather than a row; sending it as a
  // 201 would tell the caller an edition had been made when none had.
  if (newspaper?.error) return res.status(400).json(newspaper);
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

/**
 * Removing an edition. The one refusal it can carry - a live public e-paper -
 * comes back as a 409 with its own code, so the desk is told which thing to do
 * first rather than being told "no".
 */
async function remove(req, res) {
  const result = await newspaperService.deleteNewspaper(parseInt(req.params.id, 10));
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(result.status || 400).json({ error: result.error, code: result.code });
  res.json(result);
}

async function houseStyle(req, res) {
  const result = await newspaperService.setHouseStyle(req.params.id, req.body || {});
  if (result.notFound) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
}

async function saveFinalFiles(req, res) {
  const result = await newspaperService.saveFinalFiles(
    req.params.id,
    req.files || {},
    req.session.user,
  );
  if (result.code === 'PRESS_NOT_READY') return res.status(409).json({ code: result.code, readiness: result.readiness });
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
  const edition = await epaperService.readRelease(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).json({ error: 'No released e-paper.' });
  res.json(edition);
}

async function epaperHtml(req, res) {
  const edition = await epaperService.loadPublishedEdition(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).type('html').send('<h1>This edition has not been published.</h1>');
  res.type('html').send(epaperService.renderHtml(edition));
}

async function selectedEpaperHtml(req, res) {
  const edition = await epaperService.loadSelectedEdition();
  if (!edition) return res.status(404).type('html').send('<h1>No e-paper has been selected for public viewing.</h1>');
  res.type('html').send(epaperService.renderHtml(edition));
}

async function epaperPreviewHtml(req, res) {
  const edition = await epaperService.readRelease(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).type('html').send('<h1>This e-paper is unavailable.</h1>');
  res.type('html').send(epaperService.renderHtml(edition));
}

// Chrome receives this only while producing a current-editor PNG. The random
// payload token is one-use and expires in two minutes; it grants no session or
// write action and cannot be used as a public e-paper URL.
async function epaperCanvasCaptureHtml(req, res) {
  const payload = epaperCanvasCapture.takeCanvasCapture(req.params.token);
  if (!payload) return res.status(404).type('html').send('<h1>Capture expired.</h1>');
  res.type('html').send(epaperCanvasCapture.canvasCaptureHtml(payload));
}

async function epaperList(req, res) {
  res.json(await epaperService.listReleasedEditions());
}

async function selectEpaper(req, res) {
  const edition = await epaperService.selectReleasedEdition(parseInt(req.params.id, 10));
  if (!edition) return res.status(404).json({ error: 'No released e-paper exists for that edition.' });
  res.json({ ok: true, id: Number(req.params.id), publicUrl: '/epaper' });
}

async function epaperAsset(req, res) {
  const asset = await epaperService.releasedAsset(parseInt(req.params.id, 10), req.params.filename, { includePrivate: isDesk(req) });
  if (!asset) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=86400, immutable');
  res.sendFile(asset);
}

async function epaperPdf(req, res) {
  const pdf = await epaperService.releasedPdf(parseInt(req.params.id, 10), { includePrivate: isDesk(req) });
  if (!pdf) return res.status(404).end();
  res.download(pdf.file, pdf.name);
}

async function publishEpaper(req, res) {
  const result = await epaperPublicationService.publishEdition(
    parseInt(req.params.id, 10),
    req.session.user,
  );
  if (result.ok) return res.json(result);
  const status = result.code === 'EPAPER_NOT_FOUND' ? 404
    : result.code === 'PRESS_NOT_READY' || result.code === 'EPAPER_PAGE_COUNT_MISMATCH' ? 409
      : 400;
  res.status(status).json(result);
}

async function publishCurrentEpaper(req, res) {
  const result = await epaperPublicationService.publishCurrentEdition(
    parseInt(req.params.id, 10),
    req.session.user,
  );
  if (result.ok) return res.json(result);
  const status = result.code === 'EPAPER_NOT_FOUND' ? 404 : 400;
  res.status(status).json(result);
}

async function publishUploadedEpaperPdf(req, res) {
  const result = await epaperPublicationService.publishUploadedPdfEdition(
    parseInt(req.params.id, 10),
    req.file,
    req.session.user,
  );
  if (result.ok) return res.json(result);
  const status = result.code === 'EPAPER_NOT_FOUND' ? 404
    : result.code === 'EPAPER_PAGE_COUNT_MISMATCH' ? 409
      : 400;
  res.status(status).json(result);
}

// A released PDF is an image authority, while its story rectangles are a
// desk-owned overlay. This deliberately changes only the frozen release
// manifest and regenerated share crops, never the live newsroom page.
async function updateEpaperMap(req, res) {
  const result = await epaperPublicationService.updateEpaperMap(
    parseInt(req.params.id, 10),
    req.body || {},
  );
  if (result.ok) return res.json(result);
  const status = result.code === 'EPAPER_NOT_FOUND' || result.code === 'EPAPER_PAGE_NOT_FOUND' ? 404
    : result.code === 'EPAPER_MAP_STALE' ? 409
      : 400;
  res.status(status).json(result);
}

async function unpublishEpaper(req, res) {
  const result = await epaperPublicationService.unpublishEdition(parseInt(req.params.id, 10));
  if (!result.ok) return res.status(result.code === 'EPAPER_NOT_FOUND' ? 404 : 400).json(result);
  res.json(result);
}

// Preflight: everything that must be true before a page reaches the plate.
async function preflight(req, res) {
  try {
    const report = await preflightService.checkEdition(parseInt(req.params.id, 10));
    if (!report) return res.status(404).json({ error: 'No such edition.' });
    res.json(report);
  } catch (error) {
    if (error.message === 'EXACT_SHAPER_NOT_READY') {
      return res.status(503).json({ error: 'Real Marathi text shaping is not available right now. Try again in a moment.' });
    }
    throw error;
  }
}

// What this edition still needs, in page order, with the exact character
// count each unfinished block holds.
async function worklist(req, res) {
  try {
    const list = await worklistService.forEdition(parseInt(req.params.id, 10));
    if (!list) return res.status(404).json({ error: 'No such edition.' });
    res.json(list);
  } catch (error) {
    if (error.message === 'EXACT_SHAPER_NOT_READY') {
      return res.status(503).json({ error: 'Real Marathi text shaping is not available right now. Try again in a moment.' });
    }
    throw error;
  }
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

// maxServiceCalls is passed through exactly as supplied - undefined when the
// caller omits it, never defaulted here. The provider-call budget policy
// (compositionCallBudget.service.js) owns the default and the too-low
// rejection; a `|| 32` here would turn both "no preference" and an explicit
// 0 into the same wrong number, and would let this route silently outrun
// whatever the workflow actually derives from the real planned demand.
async function compositionPlan(req, res) {
  const result = await compositionWorkflow.planEditionComposition({ editionId: Number(req.params.id), aiMode: req.body?.aiMode || 'production', maxServiceCalls: req.body?.maxServiceCalls });
  res.status(result.ok ? 200 : result.code === 'EDITION_NOT_FOUND' ? 404 : 409).json(result);
}
async function compositionApply(req, res) {
  const result = await compositionWorkflow.applyEditionComposition({ editionId: Number(req.params.id), planToken: req.body?.planToken, aiMode: req.body?.aiMode || 'production', maxServiceCalls: req.body?.maxServiceCalls });
  res.status(result.ok ? 200 : result.code === 'RUN_ALREADY_ACTIVE' ? 409 : 400).json(result);
}

// ---------------------------------------------------------- the Newsdesk Run ---
//
// Three routes, and the separation between them is the safety argument for the
// whole feature: plan costs ONE call and returns something a person reads;
// write costs one per approved story and still saves nothing; accept is the
// only one that touches the paper. A desk sees what it is about to spend
// before it spends it, and what it is about to print before it prints it.

async function newsdeskPlan(req, res) {
  const result = await newsdesk.planEdition(Number(req.params.id), req.body?.brief || {}, {
    callBudget: req.body?.callBudget,
  });
  if (result.error) return res.status(result.status || 400).json(result);
  res.json(result);
}

async function newsdeskWrite(req, res) {
  const stories = Array.isArray(req.body?.stories) ? req.body.stories : [];
  if (!stories.length) return res.status(400).json({ error: 'No stories were approved to write.' });
  // Every story names the block it is for, and the plan proved that block was
  // open. Re-proving it here would need the plan back; what this must not do
  // is trust a page id from the browser, so the block is looked up by page and
  // key on the way in.
  const result = await newsdeskWriter.writePlan(stories);
  res.json(result);
}

async function newsdeskAccept(req, res) {
  const rows = Array.isArray(req.body?.stories) ? req.body.stories : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing was accepted.' });

  const saved = [];
  const refused = [];
  for (const row of rows) {
    const page = await pageRepository.findById(Number(row.pageId));
    // The edition in the URL is the authority. A page id from a browser that
    // belongs to a different paper must not be writable through this route.
    if (!page || Number(page.newspaper_id) !== Number(req.params.id)) {
      refused.push({ sectionKey: row.sectionKey, why: 'That block is not on this edition.' });
      continue;
    }
    // The narrow seam: editorial content only. It may never reset the frame's
    // geometry, its treatment or its images - a run that filled a block must
    // not undo the design work already done on it.
    const written = await pageRepository.saveComposedStoryContent(page.id, String(row.sectionKey), {
      headline: row.proposal?.headline,
      subheading: row.proposal?.subheading,
      body: row.proposal?.body,
      reporterName: row.proposal?.author,
      category: row.tagKey || null,
      editorialPriority: row.importance || 3,
      language: 'Marathi',
      // Never `passed`. Everything here was drafted by a model from sources a
      // person has not yet read line by line.
      status: 'needs_review',
      aiGenerated: true,
      aiNotes: row.retrieval
        ? `Newsdesk Run · ${row.retrieval.status} · ${(row.retrieval.sources || []).map((s) => s.publisher).join(', ')}`
        : 'Newsdesk Run',
    });
    if (written) saved.push({ page: page.page_number, sectionKey: row.sectionKey });
    else refused.push({ sectionKey: row.sectionKey, why: 'That block no longer exists.' });
  }
  res.json({ saved: saved.length, refused, blocks: saved });
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
  const readiness = await pressReadiness.assessEdition(newspaper.id);
  if (!readiness.readyForPress) return res.status(409).json({ code: 'PRESS_NOT_READY', readiness });
  const sla = await scribusService.buildDocument(newspaper, pages);

  await signoffService.record(newspaper.id, req.session.user?.id, 'Scribus document generated');
  const date = String(newspaper.publication_date).slice(0, 10);
  res.type('application/vnd.scribus')
    .set('Content-Disposition', `attachment; filename="sahas-${date}.sla"`)
    .send(sla);
}

/**
 * One edition, in one of the four formats a production desk actually needs.
 *
 * NOT gated on press readiness, deliberately, and Scribus/press-package still
 * are. Those two are the PRESS path - the file that goes to the plate, which
 * must not leave until the edition has been passed. These are the working
 * exports: a designer wants the InDesign document while the page is still
 * being made up, and a reporter wants the copy in Word before anybody has
 * signed anything. Refusing them until sign-off would make them useless on the
 * only day they are wanted.
 */
async function exportEdition(req, res) {
  const format = String(req.params.format || '').toLowerCase();
  if (!exportService.FORMATS[format]) {
    return res.status(400).json({ error: 'No such export format.', formats: Object.keys(exportService.FORMATS) });
  }
  const loaded = await loadForOutput(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'No such edition.' });
  const { newspaper, pages } = loaded;

  let built;
  try {
    built = await exportService.exportEdition(format, newspaper, pages);
  } catch (error) {
    // The compositor refuses to work without the exact shaper, and an export
    // measured against raw hmtx advances is not a conservative file, it is a
    // wrong one. Say so rather than shipping it.
    if (error.code === 'EXACT_SHAPER_NOT_READY') {
      return res.status(503).json({ code: error.code, error: 'The publication fonts are not ready on the server yet. Try again in a moment.' });
    }
    throw error;
  }

  await signoffService.record(newspaper.id, req.session.user?.id,
    `${exportService.FORMATS[format].label} exported`);

  res.type(built.type)
    .set('Content-Disposition', `attachment; filename="${built.filename}"`)
    .set('X-Export-Warnings', String(built.warnings.length))
    .set('X-Pictures-Missing', String(built.missingImages.length))
    .send(built.body);
}

// The press package: the .sla plus the photographs it points at, shipped
// together, because the .sla alone means nothing once it leaves this server.
async function pressPackage(req, res) {
  const loaded = await loadForOutput(req.params.id);
  if (!loaded) return res.status(404).json({ error: 'No such edition.' });
  const { newspaper, pages } = loaded;
  const readiness = await pressReadiness.assessEdition(newspaper.id);
  if (!readiness.readyForPress) return res.status(409).json({ code: 'PRESS_NOT_READY', readiness });
  const sla = await scribusService.buildDocument(newspaper, pages);
  let packaged;
  try { packaged = await pressPackageService.build(newspaper, pages, sla, readiness); }
  catch (error) { if (error.code === 'PRESS_ASSET_MISSING') return res.status(409).json({ code: error.code, missing: error.missing }); throw error; }
  const { zip, pictures, missing } = packaged;

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
  houseStyle,
  create, start, resize, ladder, supportedPageCounts, list, latest, getOne, update, remove, saveFinalFiles,
  createDistrictEdition, listDistrictEditions, printedPages,
  epaper, epaperHtml, selectedEpaperHtml, epaperPreviewHtml, epaperCanvasCaptureHtml, epaperList, selectEpaper,
  epaperAsset, epaperPdf, publishEpaper, publishCurrentEpaper, publishUploadedEpaperPdf, updateEpaperMap, unpublishEpaper,
  preflight, worklist, status, history, features, compositionPlan, compositionApply,
  newsdeskPlan, newsdeskWrite, newsdeskAccept,
  scribus, pressPackage, exportEdition,
};
