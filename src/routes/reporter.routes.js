const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');

const reporterController = asyncController(require('../controllers/reporter.controller'));
const router = express.Router();

router.get('/', reporterController.list);
router.post('/', reporterController.create);
router.get('/:id', reporterController.getOne);
router.patch('/:id', reporterController.update);
router.patch('/:id/access', reporterController.access);

module.exports = router;
