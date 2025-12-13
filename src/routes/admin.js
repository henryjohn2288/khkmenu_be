const { Router } = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');
const storeController = require('../controllers/storeController');
const adminUserController = require('../controllers/adminUserController');

const router = Router();

router.use(requireAuth);

// Platform admins
router.get('/platform-admins', asyncHandler(adminUserController.listPlatformAdmins));
router.post('/platform-admins', asyncHandler(adminUserController.addPlatformAdmin));
router.patch('/platform-admins/:userId', asyncHandler(adminUserController.updatePlatformAdminRole));
router.delete('/platform-admins/:userId', asyncHandler(adminUserController.removePlatformAdmin));

// Stores & customers
router.get('/stores', asyncHandler(storeController.listStores));
router.post('/stores', asyncHandler(storeController.createStore));
router.patch('/stores/:storeId', asyncHandler(storeController.updateStore));
router.delete('/stores/:storeId', asyncHandler(storeController.deleteStore));
router.get('/customers', asyncHandler(storeController.listCustomers));

// Categories
router.post('/stores/:storeId/categories', asyncHandler(storeController.createCategory));
router.patch('/categories/:categoryId', asyncHandler(storeController.updateCategory));
router.delete('/categories/:categoryId', asyncHandler(storeController.deleteCategory));

// Products
router.post('/stores/:storeId/products', asyncHandler(storeController.createProduct));
router.patch('/products/:productId', asyncHandler(storeController.updateProduct));
router.delete('/products/:productId', asyncHandler(storeController.deleteProduct));

// Members
router.get('/stores/:storeId/members', asyncHandler(storeController.listMembers));
router.post('/stores/:storeId/members', asyncHandler(storeController.addMember));
router.patch('/store-members/:memberId', asyncHandler(storeController.updateMember));
router.delete('/store-members/:memberId', asyncHandler(storeController.removeMember));

// Invites
router.get('/stores/:storeId/invites', asyncHandler(storeController.listInvites));
router.post('/stores/:storeId/invites', asyncHandler(storeController.createInvite));
router.delete('/store-invites/:inviteId', asyncHandler(storeController.cancelInvite));
router.post('/store-invites/:inviteId/resend', asyncHandler(storeController.resendInvite));

module.exports = router;
