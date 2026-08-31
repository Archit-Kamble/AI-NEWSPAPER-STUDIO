const express = require('express');
const { guardIdParams } = require('../middleware/params');
const { asyncController } = require('../middleware/asyncRoute');
const { upload } = require('../middleware/upload');
const { requireReview } = require('../middleware/auth');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js. Most of these
// handlers had no try/catch of their own and were registered unwrapped.
const newsController = asyncController(require('../controllers/news.controller'));

const router = express.Router();

// Any :id / :somethingId this router carries is checked before a handler
// runs, so a bad address is a 400 and never a database type error
// surfacing as a 500. Registered with router.param(), not use(): Express
// populates a route's own params only when that route matches.
guardIdParams(router);

router.post('/', upload.array('images'), newsController.create);
router.get('/', newsController.list);
router.get('/status/:status', newsController.listByStatus);
router.get('/:id', newsController.getOne);
router.patch('/:id', upload.array('images'), newsController.update);
// Passing or refusing a reporter's filing is the SAMPADAK's, not the desk's.
// A reporter's copy carries their name into print, so accepting it is the act
// the paper answers for - and until this line said so, anybody who could move
// a block on page one could also approve the story that went in it.
router.patch('/:id/status', requireReview, newsController.updateStatus);

module.exports = router;
