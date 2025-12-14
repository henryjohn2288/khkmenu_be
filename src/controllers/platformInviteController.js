const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Set a strong secret in the environment.');
}

const sanitizeUser = (user) => {
  if (!user) return null;
  // keep consistent with other controllers; remove passwordHash only
  const { passwordHash, ...rest } = user;
  return rest;
};

const decodePlatformInvite = (token) => {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.kind !== 'PLATFORM_ADMIN_SETUP' || !payload.userId || !payload.email) {
      throw createHttpError(404, 'Invite not found or expired');
    }
    return payload;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw createHttpError(404, 'Invite not found or expired');
    }
    throw createHttpError(404, 'Invite not found or expired');
  }
};

async function getPlatformAdminInvite(req, res) {
  const { token } = req.params;
  const payload = decodePlatformInvite(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, platformAdmin: true }
  });

  if (!user || user.email !== payload.email) {
    throw createHttpError(404, 'Invite not found or expired');
  }

  res.json({
    invite: {
      type: 'PLATFORM_ADMIN_SETUP',
      email: user.email,
      name: user.name || payload.name || null
    }
  });
}

async function acceptPlatformAdminInvite(req, res) {
  const { token } = req.params;
  const { password, name } = req.body || {};

  if (!password) {
    return res.status(400).json({ message: 'Password is required to set up your admin account' });
  }

  const payload = decodePlatformInvite(token);

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || user.email !== payload.email) {
    throw createHttpError(404, 'Invite not found or expired');
  }

  if (user.role === 'SUPER_ADMIN') {
    throw createHttpError(409, 'This invite cannot be accepted with this email');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      platformAdmin: true,
      role: user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
      name: user.name || name || payload.name || user.email.split('@')[0]
    }
  });

  res.json({ success: true, user: sanitizeUser(updated) });
}

module.exports = {
  getPlatformAdminInvite,
  acceptPlatformAdminInvite
};
