const express = require('express');
const { asyncController } = require('../middleware/asyncRoute');
const { loginThrottle } = require('../middleware/loginThrottle');

// Wrapped so a rejected handler (a DB error inside authService.login, say)
// reaches the error middleware instead of taking the process down - see
// src/middleware/asyncRoute.js.
const authController = asyncController(require('../controllers/auth.controller'));

const router = express.Router();

router.post('/login', loginThrottle, authController.login);
router.get('/me', authController.me);

module.exports = router;
