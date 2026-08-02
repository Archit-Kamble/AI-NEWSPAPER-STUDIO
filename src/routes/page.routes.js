const express = require('express');
const pageController = require('../controllers/page.controller');

const router = express.Router();

router.post('/newspapers/:newspaperId/pages', pageController.create);
router.get('/newspapers/:newspaperId/pages', pageController.list);
router.patch('/pages/:pageId', pageController.update);

module.exports = router;
