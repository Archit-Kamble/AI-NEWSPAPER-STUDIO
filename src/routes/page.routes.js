const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const { requireDesk } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js.
const pageController = asyncController(require('../controllers/page.controller'));
const pageSectionController = asyncController(require('../controllers/pageSection.controller'));
const sectionImageController = asyncController(require('../controllers/sectionImage.controller'));
const pageGuideController = asyncController(require('../controllers/pageGuide.controller'));

const router = express.Router();

router.post('/newspapers/:newspaperId/pages', pageController.create);
// Every block on every page, with the copy in it - the single richest thing
// this API returns, and it was answering anonymous callers. See the note in
// newspaper.routes.js: deskWrites guards writes only.
router.get('/newspapers/:newspaperId/pages', requireDesk, pageController.list);
router.patch('/pages/:pageId', pageController.update);
router.patch('/pages/:pageId/colour', pageController.colour);
// Pictures laid on the PAGE, across block boundaries. A write, so it is
// covered by the router's deskWrites - but the read is the page itself.
router.patch('/pages/:pageId/overlays', pageController.overlays);
router.patch('/pages/:pageId/state', pageController.state);
router.post('/test-fixtures/pages/:pageId/reapply-template-geometry', pageController.reapplyFixtureGeometry);
router.post('/pages/:pageId/repair-structural-frames', pageController.repairStructuralFrames);

router.put('/pages/:pageId/sections/:sectionId', pageSectionController.update);
router.post('/pages/:pageId/sections', pageSectionController.create);
router.delete('/pages/:pageId/sections/:sectionId', pageSectionController.remove);
router.patch('/pages/:pageId/sections/:sectionId/geometry', pageSectionController.move);

// Pictures placed inside a block. Where each sits is layout data - it is what
// the character grid in public/editor/layout/text-flow.js is computed from.
router.get('/pages/:pageId/sections/:sectionId/images', requireDesk, sectionImageController.list);
router.post('/pages/:pageId/sections/:sectionId/images', sectionImageController.add);
router.patch('/pages/:pageId/sections/:sectionId/images/:imageId', sectionImageController.move);
router.delete('/pages/:pageId/sections/:sectionId/images/:imageId', sectionImageController.remove);
router.post('/pages/:pageId/sections/:sectionId/images/:imageId/cutout', sectionImageController.cutout);
// Candidate pictures from the AI. Desk-only, and it PROPOSES: nothing is
// placed, sized or accepted here - a person does all three.
router.post('/pages/:pageId/sections/:sectionId/images/propose', requireDesk, sectionImageController.propose);

// Ruler guides (Stage 4) - page-level reference lines, never printed and (so
// far) not a snap target. Same list-of-placements shape as pictures, so the
// same four verbs.
router.get('/pages/:pageId/guides', requireDesk, pageGuideController.list);
router.post('/pages/:pageId/guides', pageGuideController.create);
router.patch('/pages/:pageId/guides/:guideId', pageGuideController.move);
router.delete('/pages/:pageId/guides/:guideId', pageGuideController.remove);

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
