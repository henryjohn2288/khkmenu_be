const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');
const {
  hasStorePermission,
  getActorStoreRole,
  assertRoleAssignable,
  assertRoleManagement,
  STORE_ROLES
} = require('../utils/roles');

async function assertStorePermission(user, storeId, requiredRole = 'EDITOR') {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) {
    throw createHttpError(404, 'Store not found');
  }

  if (user.role === 'SUPER_ADMIN') {
    return { store };
  }

  const membership = await prisma.storeMember.findUnique({
    where: { storeId_userId: { storeId, userId: user.id } }
  });

  if (!membership || !hasStorePermission(membership.role, requiredRole)) {
    throw createHttpError(403, 'You do not have permission to manage this store');
  }

  return { store, membership };
}

async function ensureCategoryOwnership(categoryId, user, requiredRole = 'EDITOR') {
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw createHttpError(404, 'Category not found');
  }
  await assertStorePermission(user, category.storeId, requiredRole);
  return category;
}

async function ensureProductOwnership(productId, user, requiredRole = 'EDITOR') {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw createHttpError(404, 'Product not found');
  }
  await assertStorePermission(user, product.storeId, requiredRole);
  return product;
}

async function ensureCategoryBelongsToStore(categoryId, storeId) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, storeId } });
  if (!category) {
    throw createHttpError(400, 'Category does not belong to this store');
  }
}

async function findOrCreateUserByEmail(email, name) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const tempPassword = crypto.randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    user = await prisma.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        passwordHash
      }
    });
  }
  return user;
}

async function ensureAtLeastOneOwner(storeId, excludingUserId) {
  const ownerCount = await prisma.storeMember.count({
    where: {
      storeId,
      role: 'OWNER',
      ...(excludingUserId ? { userId: { not: excludingUserId } } : {})
    }
  });
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true } });
  const hasPrimaryOwner = Boolean(store?.ownerId && store.ownerId !== excludingUserId);
  if (!hasPrimaryOwner && ownerCount === 0) {
    throw createHttpError(400, 'Store must have at least one owner');
  }
}

module.exports = {
  assertStorePermission,
  ensureCategoryOwnership,
  ensureProductOwnership,
  ensureCategoryBelongsToStore,
  findOrCreateUserByEmail,
  getActorStoreRole,
  assertRoleAssignable,
  assertRoleManagement,
  STORE_ROLES,
  ensureAtLeastOneOwner
};
