const express = require('express');
const newsController = require('../controllers/news.controller');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.post('/', upload.array('images'), newsController.create);
router.get('/', newsController.list);
router.get('/status/:status', newsController.listByStatus);
router.get('/:id', newsController.getOne);
router.patch('/:id', upload.array('images'), newsController.update);
router.patch('/:id/status', newsController.updateStatus);

module.exports = router;
