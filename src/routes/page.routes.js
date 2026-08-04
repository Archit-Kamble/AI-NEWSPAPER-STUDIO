const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js.
const pageController = asyncController(require('../controllers/page.controller'));
const pageSectionController = asyncController(require('../controllers/pageSection.controller'));
const sectionImageController = asyncController(require('../controllers/sectionImage.controller'));

const router = express.Router();

router.post('/newspapers/:newspaperId/pages', pageController.create);
router.get('/newspapers/:newspaperId/pages', pageController.list);
router.patch('/pages/:pageId', pageController.update);
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

module.exports = router;
