const { Router } = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const inviteAcceptanceController = require('../controllers/inviteAcceptanceController');

const router = Router();

router.get('/invites/:token', asyncHandler(inviteAcceptanceController.getInvite));
router.post('/invites/:token/accept', asyncHandler(inviteAcceptanceController.acceptInvite));

module.exports = router;
