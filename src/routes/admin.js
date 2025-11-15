const { Router } = require('express');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');
const {
  assertStorePermission,
  ensureCategoryOwnership,
  ensureProductOwnership,
  ensureCategoryBelongsToStore,
  findOrCreateUserByEmail,
  getActorStoreRole,
  assertRoleAssignable,
  assertRoleManagement,
  ensureAtLeastOneOwner
} = require('../services/storeAccess');
const { createHttpError } = require('../utils/errors');
const { pick } = require('../utils/object');
const { sendInviteEmail } = require('../services/mailer');

const router = Router();
const PRODUCT_STATUSES = new Set(['ACTIVE', 'HIDDEN', 'OUT_OF_STOCK']);
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';

const storeSummarySelect = {
  id: true,
  name: true,
  slug: true,
  tagline: true,
  themeId: true,
  logoUrl: true,
  heroImageUrl: true,
  createdAt: true,
  updatedAt: true
};

const memberSelect = {
  id: true,
  role: true,
  storeId: true,
  userId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true
    }
  }
};

const inviteSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  storeId: true,
  token: true,
  createdAt: true,
  expiresAt: true,
  store: {
    select: {
      name: true
    }
  }
};

router.use(requireAuth);

router.get(
  '/stores',
  asyncHandler(async (req, res) => {
    let stores;
    if (req.userRole === 'SUPER_ADMIN') {
      const allStores = await prisma.store.findMany({ select: storeSummarySelect, orderBy: { createdAt: 'desc' } });
      stores = allStores.map((store) => ({ ...store, memberRole: 'OWNER' }));
    } else {
      const memberships = await prisma.storeMember.findMany({
        where: { userId: req.userId },
        select: {
          role: true,
          store: { select: storeSummarySelect }
        }
      });
      stores = memberships.map(({ store, role }) => ({ ...store, memberRole: role }));
    }
    res.json({ stores });
  })
);

router.post(
  '/stores',
  asyncHandler(async (req, res) => {
    const payload = pick(req.body, [
      'name',
      'slug',
      'tagline',
      'description',
      'themeId',
      'themeSettings',
      'phone',
      'telegram',
      'whatsapp',
      'contactEmail',
      'facebookUrl',
      'instagramUrl',
      'websiteUrl',
      'location',
      'qrCodeImageUrl',
      'logoUrl',
      'heroImageUrl'
    ]);

    if (!payload.name || !payload.slug) {
      return res.status(400).json({ message: 'Store name and slug are required' });
    }

    const store = await prisma.store.create({
      data: {
        ...payload,
        ownerId: req.userId
      },
      select: storeSummarySelect
    });

    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: req.userId } },
      update: { role: 'OWNER' },
      create: { storeId: store.id, userId: req.userId, role: 'OWNER' }
    });

    res.status(201).json({ store });
  })
);

router.patch(
  '/stores/:storeId',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    await assertStorePermission(req.user, storeId, 'ADMIN');

    const payload = pick(req.body, [
      'name',
      'slug',
      'tagline',
      'description',
      'themeId',
      'themeSettings',
      'phone',
      'telegram',
      'whatsapp',
      'contactEmail',
      'facebookUrl',
      'instagramUrl',
      'websiteUrl',
      'location',
      'qrCodeImageUrl',
      'logoUrl',
      'heroImageUrl'
    ]);

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: 'No editable fields were provided' });
    }

    const store = await prisma.store.update({
      where: { id: storeId },
      data: payload,
      select: storeSummarySelect
    });

    res.json({ store });
  })
);

// Categories
router.post(
  '/stores/:storeId/categories',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    await assertStorePermission(req.user, storeId, 'EDITOR');

    const payload = pick(req.body, ['name_en', 'name_km', 'description', 'sortOrder', 'isVisible']);
    if (!payload.name_en || !payload.name_km) {
      return res.status(400).json({ message: 'Both English and Khmer names are required' });
    }

    if (payload.sortOrder !== undefined) {
      const value = Number(payload.sortOrder);
      if (Number.isNaN(value)) {
        return res.status(400).json({ message: 'sortOrder must be a number' });
      }
      payload.sortOrder = value;
    }

    const category = await prisma.category.create({ data: { ...payload, storeId } });
    res.status(201).json({ category });
  })
);

router.patch(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    await ensureCategoryOwnership(categoryId, req.user, 'EDITOR');

    const payload = pick(req.body, ['name_en', 'name_km', 'description', 'sortOrder', 'isVisible']);
    if (payload.sortOrder !== undefined) {
      const value = Number(payload.sortOrder);
      if (Number.isNaN(value)) {
        return res.status(400).json({ message: 'sortOrder must be a number' });
      }
      payload.sortOrder = value;
    }

    const category = await prisma.category.update({ where: { id: categoryId }, data: payload });
    res.json({ category });
  })
);

router.delete(
  '/categories/:categoryId',
  asyncHandler(async (req, res) => {
    const { categoryId } = req.params;
    await ensureCategoryOwnership(categoryId, req.user, 'ADMIN');
    await prisma.category.delete({ where: { id: categoryId } });
    res.status(204).end();
  })
);

// Products
router.post(
  '/stores/:storeId/products',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    await assertStorePermission(req.user, storeId, 'EDITOR');

    const payload = pick(req.body, [
      'name_en',
      'name_km',
      'price',
      'description',
      'unit',
      'sku',
      'status',
      'imageUrl',
      'categoryId',
      'sortOrder',
      'isFeatured'
    ]);

    if (!payload.name_en || !payload.name_km) {
      return res.status(400).json({ message: 'Both English and Khmer names are required' });
    }

    if (payload.price === undefined) {
      return res.status(400).json({ message: 'Price is required' });
    }

    const price = Number(payload.price);
    if (Number.isNaN(price)) {
      return res.status(400).json({ message: 'Price must be a number' });
    }
    payload.price = price;

    if (payload.sortOrder !== undefined) {
      const value = Number(payload.sortOrder);
      if (Number.isNaN(value)) {
        return res.status(400).json({ message: 'sortOrder must be a number' });
      }
      payload.sortOrder = value;
    }

    if (payload.status) {
      payload.status = String(payload.status).toUpperCase();
      if (!PRODUCT_STATUSES.has(payload.status)) {
        return res.status(400).json({ message: 'Invalid product status' });
      }
    }

    await ensureCategoryBelongsToStore(payload.categoryId, storeId);

    const product = await prisma.product.create({ data: { ...payload, storeId } });
    res.status(201).json({ product });
  })
);

router.patch(
  '/products/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const product = await ensureProductOwnership(productId, req.user, 'EDITOR');

    const payload = pick(req.body, [
      'name_en',
      'name_km',
      'price',
      'description',
      'unit',
      'sku',
      'status',
      'imageUrl',
      'categoryId',
      'sortOrder',
      'isFeatured'
    ]);

    if (payload.price !== undefined) {
      const price = Number(payload.price);
      if (Number.isNaN(price)) {
        return res.status(400).json({ message: 'Price must be a number' });
      }
      payload.price = price;
    }

    if (payload.sortOrder !== undefined) {
      const value = Number(payload.sortOrder);
      if (Number.isNaN(value)) {
        return res.status(400).json({ message: 'sortOrder must be a number' });
      }
      payload.sortOrder = value;
    }

    if (payload.status) {
      payload.status = String(payload.status).toUpperCase();
      if (!PRODUCT_STATUSES.has(payload.status)) {
        return res.status(400).json({ message: 'Invalid product status' });
      }
    }

    await ensureCategoryBelongsToStore(payload.categoryId, product.storeId);

    const updated = await prisma.product.update({ where: { id: productId }, data: payload });
    res.json({ product: updated });
  })
);

router.delete(
  '/products/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    await ensureProductOwnership(productId, req.user, 'ADMIN');
    await prisma.product.delete({ where: { id: productId } });
    res.status(204).end();
  })
);

// Members
router.get(
  '/stores/:storeId/members',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    await assertStorePermission(req.user, storeId, 'ADMIN');
    const members = await prisma.storeMember.findMany({
      where: { storeId },
      select: memberSelect,
      orderBy: { createdAt: 'asc' }
    });
    res.json({ members });
  })
);

router.post(
  '/stores/:storeId/members',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    const { membership } = await assertStorePermission(req.user, storeId, 'ADMIN');
    const actorRole = getActorStoreRole(req.user, membership);

    const { email, name, role } = req.body || {};
    if (!email || !role) {
      return res.status(400).json({ message: 'Email and role are required' });
    }

    const normalizedRole = role.toUpperCase();
    assertRoleAssignable(actorRole, normalizedRole);

    const user = await findOrCreateUserByEmail(String(email).trim().toLowerCase(), name);

    const existing = await prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId: user.id } }
    });

    if (existing) {
      throw createHttpError(409, 'User is already a member of this store');
    }

    const member = await prisma.storeMember.create({
      data: { storeId, userId: user.id, role: normalizedRole },
      select: memberSelect
    });

    res.status(201).json({ member });
  })
);

router.patch(
  '/store-members/:memberId',
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const member = await prisma.storeMember.findUnique({ where: { id: memberId }, select: memberSelect });
    if (!member) {
      throw createHttpError(404, 'Member not found');
    }

    const { membership } = await assertStorePermission(req.user, member.storeId, 'ADMIN');
    const actorRole = getActorStoreRole(req.user, membership);
    const { role } = req.body || {};
    if (!role) {
      return res.status(400).json({ message: 'Role is required' });
    }
    const normalizedRole = role.toUpperCase();
    assertRoleAssignable(actorRole, normalizedRole);
    assertRoleManagement(actorRole, member.role, req.userId, member.userId);
    if (member.role === 'OWNER' && normalizedRole !== 'OWNER') {
      await ensureAtLeastOneOwner(member.storeId, member.userId);
    }

    const updated = await prisma.storeMember.update({
      where: { id: memberId },
      data: { role: normalizedRole },
      select: memberSelect
    });

    res.json({ member: updated });
  })
);

router.delete(
  '/store-members/:memberId',
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    const member = await prisma.storeMember.findUnique({ where: { id: memberId }, select: memberSelect });
    if (!member) {
      throw createHttpError(404, 'Member not found');
    }

    const { membership } = await assertStorePermission(req.user, member.storeId, 'ADMIN');
    const actorRole = getActorStoreRole(req.user, membership);
    assertRoleManagement(actorRole, member.role, req.userId, member.userId);
    if (member.role === 'OWNER') {
      await ensureAtLeastOneOwner(member.storeId, member.userId);
    }

    await prisma.storeMember.delete({ where: { id: memberId } });
    res.status(204).end();
  })
);

// Invites
router.get(
  '/stores/:storeId/invites',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    await assertStorePermission(req.user, storeId, 'ADMIN');
    const invites = await prisma.storeInvite.findMany({
      where: { storeId, status: 'PENDING' },
      select: inviteSelect,
      orderBy: { createdAt: 'asc' }
    });
    const invitesWithLink = invites.map((invite) => ({
      ...invite,
      inviteUrl: `${APP_BASE_URL}/invite/${invite.token}`
    }));
    res.json({ invites: invitesWithLink });
  })
);

router.post(
  '/stores/:storeId/invites',
  asyncHandler(async (req, res) => {
    const { storeId } = req.params;
    const { membership } = await assertStorePermission(req.user, storeId, 'ADMIN');
    const actorRole = getActorStoreRole(req.user, membership);
    const { email, name, role } = req.body || {};
    if (!email || !role) {
      return res.status(400).json({ message: 'Email and role are required' });
    }
    const normalizedRole = role.toUpperCase();
    assertRoleAssignable(actorRole, normalizedRole);

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingInvite = await prisma.storeInvite.findFirst({
      where: { storeId, email: normalizedEmail, status: 'PENDING' }
    });
    if (existingInvite) {
      throw createHttpError(409, 'An invite for this email is already pending');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    const invite = await prisma.storeInvite.create({
      data: {
        storeId,
        email: normalizedEmail,
        name,
        role: normalizedRole,
        token,
        invitedById: req.userId,
        expiresAt
      },
      select: inviteSelect
    });

    const inviteUrl = `${APP_BASE_URL}/invite/${token}`;
    await sendInviteEmail({
      to: invite.email,
      inviteUrl,
      storeName: invite.store?.name || 'your store',
      role: invite.role
    }).catch((error) => console.error('Failed to send invite email', error));

    res.status(201).json({ invite: { ...invite, inviteUrl } });
  })
);

router.delete(
  '/store-invites/:inviteId',
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params;
    const invite = await prisma.storeInvite.findUnique({ where: { id: inviteId }, select: inviteSelect });
    if (!invite) {
      throw createHttpError(404, 'Invite not found');
    }
    await assertStorePermission(req.user, invite.storeId, 'ADMIN');
    await prisma.storeInvite.update({ where: { id: inviteId }, data: { status: 'CANCELLED' } });
    res.status(204).end();
  })
);

router.post(
  '/store-invites/:inviteId/resend',
  asyncHandler(async (req, res) => {
    const { inviteId } = req.params;
    const invite = await prisma.storeInvite.findUnique({ where: { id: inviteId }, select: inviteSelect });
    if (!invite) {
      throw createHttpError(404, 'Invite not found');
    }
    await assertStorePermission(req.user, invite.storeId, 'ADMIN');
    if (invite.status !== 'PENDING') {
      throw createHttpError(400, 'Only pending invites can be resent');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const updated = await prisma.storeInvite.update({
      where: { id: inviteId },
      data: { token, expiresAt },
      select: inviteSelect
    });
    const inviteUrl = `${APP_BASE_URL}/invite/${token}`;
    await sendInviteEmail({
      to: updated.email,
      inviteUrl,
      storeName: updated.store?.name || 'your store',
      role: updated.role
    }).catch((error) => console.error('Failed to resend invite email', error));
    res.json({ invite: { ...updated, inviteUrl } });
  })
);

module.exports = router;
