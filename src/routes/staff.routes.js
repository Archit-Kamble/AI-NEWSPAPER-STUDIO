const express = require('express');
const { guardIdParams } = require('../middleware/params');
const { asyncController } = require('../middleware/asyncRoute');

const staffController = asyncController(require('../controllers/staff.controller'));
const router = express.Router();

// Any :id / :somethingId this router carries is checked before a handler
// runs, so a bad address is a 400 and never a database type error
// surfacing as a 500. Registered with router.param(), not use(): Express
// populates a route's own params only when that route matches.
guardIdParams(router);

router.get('/', staffController.list);
// Before '/:id', or "roles" is read as an id.
router.get('/roles', staffController.roles);
router.post('/', staffController.create);
router.get('/:id', staffController.getOne);
router.patch('/:id', staffController.update);
router.patch('/:id/access', staffController.access);

module.exports = router;
