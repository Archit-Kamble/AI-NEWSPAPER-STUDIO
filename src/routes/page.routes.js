const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const { requireDesk } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js.
const pageController = asyncController(require('../controllers/page.controller'));
const pageSectionController = asyncController(require('../controllers/pageSection.controller'));
const sectionImageController = asyncController(require('../controllers/sectionImage.controller'));

const router = express.Router();

router.post('/newspapers/:newspaperId/pages', pageController.create);
router.get('/newspapers/:newspaperId/pages', pageController.list);
router.patch('/pages/:pageId', pageController.update);
router.patch('/pages/:pageId/colour', pageController.colour);
router.patch('/pages/:pageId/state', pageController.state);

router.put('/pages/:pageId/sections/:sectionId', pageSectionController.update);
router.post('/pages/:pageId/sections', pageSectionController.create);
router.delete('/pages/:pageId/sections/:sectionId', pageSectionController.remove);
router.patch('/pages/:pageId/sections/:sectionId/geometry', pageSectionController.move);

// Pictures placed inside a block. Where each sits is layout data - it is what
// the character grid in public/editor/layout/text-flow.js is computed from.
router.get('/pages/:pageId/sections/:sectionId/images', sectionImageController.list);
router.post('/pages/:pageId/sections/:sectionId/images', sectionImageController.add);
router.patch('/pages/:pageId/sections/:sectionId/images/:imageId', sectionImageController.move);
router.delete('/pages/:pageId/sections/:sectionId/images/:imageId', sectionImageController.remove);
router.post('/pages/:pageId/sections/:sectionId/images/:imageId/cutout', sectionImageController.cutout);

// Section production workflow: writing, filling, jump lines and fitting. All
// addressed by the section's semantic key (e.g. "lead"), not its numeric id -
// the same addressing pageSection.service.js already uses internally.
router.post('/pages/:pageId/sections/:sectionKey/write', pageSectionController.write);
router.post('/pages/:pageId/sections/:sectionKey/fill', pageSectionController.fill);
router.post('/pages/:pageId/sections/:sectionKey/carry-over', pageSectionController.carryOver);
router.post('/pages/:pageId/sections/:sectionKey/reunite', pageSectionController.reunite);
router.post('/pages/:pageId/sections/:sectionKey/fit', pageSectionController.fitApply);

// GET is left open by deskWrites above (it guards writes only), so these two
// - desk-internal production tools, not the finished public edition - repeat
// the requireDesk check the inline routes had, or they would go public.
router.get('/pages/:pageId/sections/:sectionKey/fit', requireDesk, pageSectionController.fitPreview);
router.get('/pages/:pageId/sections/:sectionKey/rate', requireDesk, pageSectionController.rate);

module.exports = router;
