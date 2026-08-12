const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const { publicationUpload } = require('../middleware/upload');
const { requireDesk } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js. This router used
// to call the controller unwrapped; every other resource router already did.
const newspaperController = asyncController(require('../controllers/newspaper.controller'));

const router = express.Router();

router.post('/', newspaperController.create);
// Both must be declared before '/:id', or "start" and "ladder" are read as ids.
router.post('/start', newspaperController.start);
router.get('/ladder', newspaperController.ladder);
router.get('/supported-page-counts', newspaperController.supportedPageCounts);
router.post('/:id/resize', newspaperController.resize);
router.get('/', newspaperController.list);
router.get('/latest', newspaperController.latest);
router.get('/:id', newspaperController.getOne);
router.patch('/:id', newspaperController.update);
router.post(
  '/:id/final-files',
  publicationUpload.fields([
    { name: 'scribusFile', maxCount: 1 },
    { name: 'printPdf', maxCount: 1 },
  ]),
  newspaperController.saveFinalFiles,
);

// District editions: one paper with some pages swapped, not many papers.
router.post('/:id/district-editions', newspaperController.createDistrictEdition);
router.get('/:id/district-editions', newspaperController.listDistrictEditions);
router.get('/:id/printed-pages', newspaperController.printedPages);

router.get('/:id/epaper', newspaperController.epaper);

// GET is left open by deskWrites above (it guards writes only), so these five
// - desk-internal production state, not the finished public edition - repeat
// the requireDesk check the inline routes had, or they would go public.
router.get('/:id/preflight', requireDesk, newspaperController.preflight);
router.get('/:id/worklist', requireDesk, newspaperController.worklist);
router.get('/:id/status', requireDesk, newspaperController.status);
router.get('/:id/history', requireDesk, newspaperController.history);
router.get('/:id/scribus', requireDesk, newspaperController.scribus);
router.get('/:id/press-package', requireDesk, newspaperController.pressPackage);

router.post('/:id/features', newspaperController.features);

module.exports = router;
