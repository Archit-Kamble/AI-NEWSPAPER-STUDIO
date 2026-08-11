const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');

// Wrapped so a rejected handler reaches the error middleware instead of
// crashing the process - see src/middleware/asyncRoute.js.
const featureController = asyncController(require('../controllers/feature.controller'));

const router = express.Router();

router.get('/', featureController.list);
// Must be declared before '/:key', or "build" is read as a feature key.
router.post('/build', featureController.buildAll);
router.post('/:key', featureController.buildOne);

module.exports = router;
