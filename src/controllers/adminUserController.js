const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');
const { findOrCreateUserByEmail, ensureAtLeastOneOwner } = require('../services/storeAccess');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Set a strong secret in the environment.');
}

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173';
const PLATFORM_INVITE_TTL = '7d';

const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
};

function assertSuperAdmin(req) {
  if (req.userRole !== 'SUPER_ADMIN') {
    throw createHttpError(403, 'Only super administrators can manage platform administrators');
  }
}

async function listPlatformAdmins(req, res) {
  assertSuperAdmin(req);
  const admins = await prisma.user.findMany({
    where: {
      OR: [{ role: 'SUPER_ADMIN' }, { platformAdmin: true }]
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true
    },
    orderBy: [{ role: 'desc' }, { createdAt: 'asc' }]
  });
  res.json({ admins });
}

async function addPlatformAdmin(req, res) {
  assertSuperAdmin(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = req.body?.name ? String(req.body.name).trim() : null;

  if (!email) {
    throw createHttpError(400, 'Email is required');
  }

  const user = await findOrCreateUserByEmail(email, name);

  // Prevent duplicates: if already a platform admin, block; if the user is tied to a store, block
  if (user.role === 'SUPER_ADMIN' || user.platformAdmin) {
    throw createHttpError(409, 'Email is already in use');
  }

  const membershipCount = await prisma.storeMember.count({ where: { userId: user.id } });
  if (membershipCount > 0) {
    throw createHttpError(409, 'Email is already in use');
  }

  const ownedCount = await prisma.store.count({ where: { ownerId: user.id } });
  if (ownedCount > 0) {
    throw createHttpError(409, 'Email is already in use');
  }

  // If already a super admin, leave as-is; otherwise ensure ADMIN role
  const updated =
    user.role === 'SUPER_ADMIN'
      ? user
      : await prisma.user.update({
          where: { id: user.id },
          data: { role: 'ADMIN', platformAdmin: true, ...(name ? { name } : {}) }
        });

  const setupToken = jwt.sign(
    {
      kind: 'PLATFORM_ADMIN_SETUP',
      userId: updated.id,
      email: updated.email,
      invitedById: req.userId,
      name: updated.name || name || null
    },
    JWT_SECRET,
    { expiresIn: PLATFORM_INVITE_TTL }
  );
  const inviteUrl = `${APP_BASE_URL}/admin-setup/${setupToken}`;

  res.status(201).json({ admin: sanitizeUser(updated), inviteUrl });
}

async function updatePlatformAdminRole(req, res) {
  assertSuperAdmin(req);
  const { userId } = req.params;
  const role = String(req.body?.role || '').toUpperCase();

  if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    throw createHttpError(400, 'Role must be ADMIN or SUPER_ADMIN');
  }

  if (req.userId === userId && role !== 'SUPER_ADMIN') {
    throw createHttpError(400, 'You cannot remove your own super admin access');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  if (user.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
    const remainingSupers = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', id: { not: userId } }
    });
    if (remainingSupers === 0) {
      throw createHttpError(400, 'At least one super admin is required');
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role, platformAdmin: true }
  });

  res.json({ admin: sanitizeUser(updated) });
}

async function removePlatformAdmin(req, res) {
  assertSuperAdmin(req);
  const { userId } = req.params;

  if (req.userId === userId) {
    throw createHttpError(400, 'You cannot delete your own account');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  if (user.role === 'SUPER_ADMIN') {
    const remainingSupers = await prisma.user.count({
      where: { role: 'SUPER_ADMIN', id: { not: userId } }
    });
    if (remainingSupers === 0) {
      throw createHttpError(400, 'At least one super admin is required');
    }
  }

  const memberships = await prisma.storeMember.findMany({
    where: { userId },
    select: { storeId: true, role: true }
  });

  // Ensure we won't orphan a store without an owner
  for (const membership of memberships) {
    if (membership.role === 'OWNER') {
      await ensureAtLeastOneOwner(membership.storeId, userId);
    }
  }

  await prisma.$transaction([
    prisma.storeMember.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } })
  ]);

  res.status(204).end();
}

module.exports = {
  listPlatformAdmins,
  addPlatformAdmin,
  updatePlatformAdminRole,
  removePlatformAdmin
};
