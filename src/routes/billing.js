const { Router } = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');
const billingController = require('../controllers/billingController');

const router = Router();

router.use(requireAuth);

// Plans
router.get('/plans', asyncHandler(billingController.listPlans));
router.post('/plans', asyncHandler(billingController.createPlan));
router.patch('/plans/:planCode', asyncHandler(billingController.updatePlan));

// Store subscriptions
router.get('/stores/:storeId/subscription', asyncHandler(billingController.getStoreSubscription));
router.post('/stores/:storeId/subscription', asyncHandler(billingController.setStoreSubscription));
router.patch('/stores/:storeId/subscription/cancel', asyncHandler(billingController.cancelStoreSubscription));
router.get('/stores/:storeId/subscription/logs', asyncHandler(billingController.listSubscriptionLogs));

module.exports = router;
