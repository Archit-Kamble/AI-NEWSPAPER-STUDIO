const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const settingsController = asyncController(require('../controllers/settings.controller'));
const router = express.Router();

router.get('/general', settingsController.general);
router.put('/general', settingsController.saveGeneral);

module.exports = router;
