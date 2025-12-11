const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');
const { pick } = require('../utils/object');
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
const { sendInviteEmail } = require('../services/mailer');

const STORE_STATUSES = new Set(['ACTIVE', 'SUSPENDED']);
const STORE_PLANS = new Set(['STARTER', 'PRO', 'ENTERPRISE']);
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
  plan: true,
  status: true,
  ownerId: true,
  owner: {
    select: {
      id: true,
      name: true,
      email: true
    }
  },
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

// Stores --------------------------------------------------------------------
async function listStores(req, res) {
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
}

async function createStore(req, res) {
  if (req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Only platform administrators can create stores' });
  }

  const payload = pick(req.body, [
    'name',
    'slug',
    'tagline',
    'description',
    'status',
    'plan',
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

  if (payload.status) {
    payload.status = String(payload.status).toUpperCase();
    if (!STORE_STATUSES.has(payload.status)) {
      return res.status(400).json({ message: 'Invalid store status' });
    }
  }

  if (payload.plan) {
    payload.plan = String(payload.plan).toUpperCase();
    if (!STORE_PLANS.has(payload.plan)) {
      return res.status(400).json({ message: 'Invalid store plan' });
    }
  } else {
    payload.plan = 'STARTER';
  }

  let ownerUserId = req.userId;
  if (req.userRole === 'SUPER_ADMIN') {
    const incomingOwnerId = req.body?.ownerId ? String(req.body.ownerId).trim() : null;
    const incomingOwnerEmail = req.body?.ownerEmail ? String(req.body.ownerEmail).trim().toLowerCase() : null;
    if (incomingOwnerId) {
      const owner = await prisma.user.findUnique({ where: { id: incomingOwnerId } });
      if (!owner) {
        return res.status(404).json({ message: 'Owner user not found' });
      }
      ownerUserId = owner.id;
    } else if (incomingOwnerEmail) {
      const owner = await findOrCreateUserByEmail(incomingOwnerEmail, req.body?.ownerName);
      ownerUserId = owner.id;
    }
  }

  const store = await prisma.store.create({
    data: {
      ...payload,
      ownerId: ownerUserId
    },
    select: storeSummarySelect
  });

  if (ownerUserId) {
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: ownerUserId } },
      update: { role: 'OWNER' },
      create: { storeId: store.id, userId: ownerUserId, role: 'OWNER' }
    });
  }

  res.status(201).json({ store });
}

async function updateStore(req, res) {
  const { storeId } = req.params;
  await assertStorePermission(req.user, storeId, 'ADMIN');

  const payload = pick(req.body, [
    'name',
    'slug',
    'tagline',
    'description',
    'status',
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

  if (payload.status) {
    if (req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only platform administrators can change store status' });
    }
    const normalizedStatus = String(payload.status).toUpperCase();
    if (!STORE_STATUSES.has(normalizedStatus)) {
      return res.status(400).json({ message: 'Invalid store status' });
    }
    payload.status = normalizedStatus;
  }

  if (payload.plan) {
    if (req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only platform administrators can change store plans' });
    }
    const normalizedPlan = String(payload.plan).toUpperCase();
    if (!STORE_PLANS.has(normalizedPlan)) {
      return res.status(400).json({ message: 'Invalid store plan' });
    }
    payload.plan = normalizedPlan;
  }

  let resolvedOwnerId;
  const ownerEmail = req.body?.ownerEmail ? String(req.body.ownerEmail).trim().toLowerCase() : null;
  const ownerIdInput = req.body?.ownerId ? String(req.body.ownerId).trim() : null;

  if (ownerEmail || ownerIdInput) {
    if (req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only platform administrators can reassign owners' });
    }
    if (ownerIdInput) {
      const owner = await prisma.user.findUnique({ where: { id: ownerIdInput } });
      if (!owner) {
        return res.status(404).json({ message: 'Owner user not found' });
      }
      resolvedOwnerId = owner.id;
    } else if (ownerEmail) {
      const owner = await findOrCreateUserByEmail(ownerEmail, req.body?.ownerName);
      resolvedOwnerId = owner.id;
    }
  }

  if (!resolvedOwnerId && Object.keys(payload).length === 0) {
    return res.status(400).json({ message: 'No editable fields were provided' });
  }

  const store = await prisma.store.update({
    where: { id: storeId },
    data: {
      ...payload,
      ...(resolvedOwnerId ? { ownerId: resolvedOwnerId } : {})
    },
    select: storeSummarySelect
  });

  if (resolvedOwnerId) {
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId, userId: resolvedOwnerId } },
      update: { role: 'OWNER' },
      create: { storeId, userId: resolvedOwnerId, role: 'OWNER' }
    });
  }

  res.json({ store });
}

async function deleteStore(req, res) {
  const { storeId } = req.params;

  if (req.userRole !== 'SUPER_ADMIN') {
    const { membership } = await assertStorePermission(req.user, storeId, 'OWNER');
    const actorRole = getActorStoreRole(req.user, membership);
    if (actorRole !== 'OWNER') {
      throw createHttpError(403, 'Only store owners can delete a store');
    }
  }

  await prisma.$transaction([
    prisma.product.deleteMany({ where: { storeId } }),
    prisma.category.deleteMany({ where: { storeId } }),
    prisma.storeInvite.deleteMany({ where: { storeId } }),
    prisma.storeMember.deleteMany({ where: { storeId } }),
    prisma.subscriptionChangeLog.deleteMany({ where: { storeId } }),
    prisma.storeSubscription.deleteMany({ where: { storeId } }),
    prisma.store.delete({ where: { id: storeId } })
  ]);

  res.status(204).end();
}

// Customers ---------------------------------------------------------------
async function listCustomers(req, res) {
  if (req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Only platform administrators can view customers' });
  }

  const owners = await prisma.user.findMany({
    where: {
      ownedStores: {
        some: {}
      }
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      ownedStores: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          plan: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const customers = owners.map((owner) => {
    const stores = owner.ownedStores;
    const status = stores.length && stores.every((store) => store.status === 'SUSPENDED') ? 'SUSPENDED' : 'ACTIVE';
    return {
      id: owner.id,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      status,
      primaryPlan: stores[0]?.plan || 'STARTER',
      stores
    };
  });

  res.json({ customers });
}

// Categories --------------------------------------------------------------
async function createCategory(req, res) {
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
}

async function updateCategory(req, res) {
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
}

async function deleteCategory(req, res) {
  const { categoryId } = req.params;
  await ensureCategoryOwnership(categoryId, req.user, 'ADMIN');
  await prisma.category.delete({ where: { id: categoryId } });
  res.status(204).end();
}

// Products ---------------------------------------------------------------
async function createProduct(req, res) {
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
}

async function updateProduct(req, res) {
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
}

async function deleteProduct(req, res) {
  const { productId } = req.params;
  await ensureProductOwnership(productId, req.user, 'ADMIN');
  await prisma.product.delete({ where: { id: productId } });
  res.status(204).end();
}

// Members ---------------------------------------------------------------
async function listMembers(req, res) {
  const { storeId } = req.params;
  await assertStorePermission(req.user, storeId, 'ADMIN');
  const members = await prisma.storeMember.findMany({
    where: { storeId },
    select: memberSelect,
    orderBy: { createdAt: 'asc' }
  });
  res.json({ members });
}

async function addMember(req, res) {
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
}

async function updateMember(req, res) {
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
}

async function removeMember(req, res) {
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
}

// Invites ---------------------------------------------------------------
async function listInvites(req, res) {
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
}

async function createInvite(req, res) {
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
}

async function cancelInvite(req, res) {
  const { inviteId } = req.params;
  const invite = await prisma.storeInvite.findUnique({ where: { id: inviteId }, select: inviteSelect });
  if (!invite) {
    throw createHttpError(404, 'Invite not found');
  }
  await assertStorePermission(req.user, invite.storeId, 'ADMIN');
  await prisma.storeInvite.update({ where: { id: inviteId }, data: { status: 'CANCELLED' } });
  res.status(204).end();
}

async function resendInvite(req, res) {
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
}

module.exports = {
  listStores,
  createStore,
  updateStore,
  deleteStore,
  listCustomers,
  createCategory,
  updateCategory,
  deleteCategory,
  createProduct,
  updateProduct,
  deleteProduct,
  listMembers,
  addMember,
  updateMember,
  removeMember,
  listInvites,
  createInvite,
  cancelInvite,
  resendInvite
};
