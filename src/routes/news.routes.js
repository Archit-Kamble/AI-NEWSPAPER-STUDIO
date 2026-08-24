const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const { upload } = require('../middleware/upload');
const { requireDesk } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js. Most of these
// handlers had no try/catch of their own and were registered unwrapped.
const newsController = asyncController(require('../controllers/news.controller'));

const router = express.Router();

router.post('/', upload.array('images'), newsController.create);
router.get('/', newsController.list);
router.get('/status/:status', newsController.listByStatus);
router.get('/:id', newsController.getOne);
router.patch('/:id', upload.array('images'), newsController.update);
router.patch('/:id/status', requireDesk, newsController.updateStatus);

module.exports = router;
