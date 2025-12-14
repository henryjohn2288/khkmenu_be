const { Router } = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const inviteAcceptanceController = require('../controllers/inviteAcceptanceController');
const platformInviteController = require('../controllers/platformInviteController');

const router = Router();

router.get('/invites/:token', asyncHandler(inviteAcceptanceController.getInvite));
router.post('/invites/:token/accept', asyncHandler(inviteAcceptanceController.acceptInvite));
router.get('/platform-admin-invites/:token', asyncHandler(platformInviteController.getPlatformAdminInvite));
router.post('/platform-admin-invites/:token/accept', asyncHandler(platformInviteController.acceptPlatformAdminInvite));

module.exports = router;
