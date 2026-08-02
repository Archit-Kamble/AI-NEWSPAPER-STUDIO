const express = require('express');
const newspaperController = require('../controllers/newspaper.controller');
const { publicationUpload } = require('../middleware/upload');

const router = express.Router();

router.post('/', newspaperController.create);
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

module.exports = router;
