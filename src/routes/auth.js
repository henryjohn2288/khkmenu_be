const { Router } = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');
const authController = require('../controllers/authController');

const router = Router();

router.post('/auth/login', asyncHandler(authController.login));
router.get('/me', requireAuth, asyncHandler(authController.me));

module.exports = router;
