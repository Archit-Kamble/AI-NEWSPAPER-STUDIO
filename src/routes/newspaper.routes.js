const express = require('express');
const { guardIdParams } = require('../middleware/params');
const { asyncController, asyncRoute } = require('../middleware/asyncRoute');
const { publicationUpload } = require('../middleware/upload');
const { requireDesk } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js. This router used
// to call the controller unwrapped; every other resource router already did.
const newspaperController = asyncController(require('../controllers/newspaper.controller'));
const pressReadiness = require('../services/pressReadiness.service');

const router = express.Router();

// Any :id / :somethingId this router carries is checked before a handler
// runs, so a bad address is a 400 and never a database type error
// surfacing as a 500. Registered with router.param(), not use(): Express
// populates a route's own params only when that route matches.
guardIdParams(router);

router.post('/', newspaperController.create);
// Both must be declared before '/:id', or "start" and "ladder" are read as ids.
router.post('/start', newspaperController.start);
router.get('/ladder', newspaperController.ladder);
router.get('/supported-page-counts', newspaperController.supportedPageCounts);
router.post('/:id/resize', newspaperController.resize);
// deskWrites leaves every GET open, so a GET that returns PRODUCTION data has
// to say requireDesk itself. The rule this middleware states (src/middleware/
// auth.js) is that the finished edition and the e-paper are public - not the
// list of every edition in the building, not an edition's own record, and not
// the pages with every unpublished story on them. Measured before this was
// added: an anonymous GET of /api/newspapers returned 372 KB of edition state
// and /api/newspapers/:id/pages returned 126 KB of copy nobody had passed for
// press. The e-paper routes below are deliberately NOT guarded - that is what
// an e-paper is for, and it is built from its own service, not from these.
router.get('/', requireDesk, newspaperController.list);
router.get('/latest', requireDesk, newspaperController.latest);
router.get('/:id', requireDesk, newspaperController.getOne);
router.patch('/:id', newspaperController.update);
// The paper's own type and its column rules - one decision for the edition,
// not one per block. A write, so deskWrites already guards it.
router.patch('/:id/house-style', newspaperController.houseStyle);
router.post(
  '/:id/final-files',
  asyncRoute(async (req, res, next) => {
    const readiness = await pressReadiness.assessEdition(Number(req.params.id));
    if (!readiness) return res.status(404).json({ error: 'Not found' });
    if (!readiness.readyForPress) return res.status(409).json({ code: 'PRESS_NOT_READY', readiness });
    next();
  }),
  publicationUpload.fields([
    { name: 'scribusFile', maxCount: 1 },
    { name: 'printPdf', maxCount: 1 },
  ]),
  newspaperController.saveFinalFiles,
);

// District editions: one paper with some pages swapped, not many papers.
router.post('/:id/district-editions', newspaperController.createDistrictEdition);
router.get('/:id/district-editions', requireDesk, newspaperController.listDistrictEditions);
router.get('/:id/printed-pages', requireDesk, newspaperController.printedPages);

// The owner list/preview is desk-only. The public site has one canonical
// selected issue at /epaper, not an enumerable id route.
router.get('/:id/epaper', requireDesk, newspaperController.epaper);
router.post('/:id/publish', newspaperController.publishEpaper);
router.post('/:id/publish-current', newspaperController.publishCurrentEpaper);
router.post('/:id/epaper/pdf', publicationUpload.single('printPdf'), newspaperController.publishUploadedEpaperPdf);
router.patch('/:id/epaper/map', newspaperController.updateEpaperMap);
router.post('/:id/epaper/select', newspaperController.selectEpaper);
router.delete('/:id/epaper', newspaperController.unpublishEpaper);

// GET is left open by deskWrites above (it guards writes only), so these five
// - desk-internal production state, not the finished public edition - repeat
// the requireDesk check the inline routes had, or they would go public.
router.get('/:id/preflight', requireDesk, newspaperController.preflight);
router.get('/:id/worklist', requireDesk, newspaperController.worklist);
router.get('/:id/status', requireDesk, newspaperController.status);
router.get('/:id/history', requireDesk, newspaperController.history);
router.get('/:id/scribus', requireDesk, newspaperController.scribus);
router.get('/:id/press-package', requireDesk, newspaperController.pressPackage);
// The working exports: Scribus, InDesign, the CMYK press PDF and the copy in
// Word. Desk-only like every other production route - an edition being made up
// is not public - but NOT gated on press readiness, because a designer needs
// the InDesign document while the page is still being made.
router.get('/:id/export/:format', requireDesk, newspaperController.exportEdition);

router.post('/:id/features', newspaperController.features);
router.post('/:id/composition/plan', newspaperController.compositionPlan);
router.post('/:id/composition/apply', newspaperController.compositionApply);

module.exports = router;
