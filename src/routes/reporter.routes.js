const express = require('express');
const { guardIdParams } = require('../middleware/params');
const { asyncController } = require('../middleware/asyncRoute');

const reporterController = asyncController(require('../controllers/reporter.controller'));
const router = express.Router();

// Any :id / :somethingId this router carries is checked before a handler
// runs, so a bad address is a 400 and never a database type error
// surfacing as a 500. Registered with router.param(), not use(): Express
// populates a route's own params only when that route matches.
guardIdParams(router);

router.get('/', reporterController.list);
router.post('/', reporterController.create);
router.get('/:id', reporterController.getOne);
router.patch('/:id', reporterController.update);
router.patch('/:id/access', reporterController.access);

module.exports = router;
