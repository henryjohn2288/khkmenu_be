const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');

const inviteSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  token: true,
  storeId: true,
  expiresAt: true,
  store: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
};

const isInviteExpired = (invite) => invite.expiresAt && invite.expiresAt < new Date();

async function getInvite(req, res) {
  const { token } = req.params;
  const invite = await prisma.storeInvite.findUnique({ where: { token }, select: inviteSelect });
  if (!invite || invite.status !== 'PENDING' || isInviteExpired(invite)) {
    throw createHttpError(404, 'Invite not found or expired');
  }
  res.json({ invite: { ...invite, token: undefined } });
}

async function acceptInvite(req, res) {
  const { token } = req.params;
  const invite = await prisma.storeInvite.findUnique({ where: { token }, select: inviteSelect });
  if (!invite || invite.status !== 'PENDING' || isInviteExpired(invite)) {
    throw createHttpError(404, 'Invite not found or expired');
  }

  const { name, password } = req.body || {};
  let user = await prisma.user.findUnique({ where: { email: invite.email } });

  // Allow overwriting password if user was pre-created with a temp hash.
  if (user) {
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          name: user.name || name || invite.name || invite.email.split('@')[0]
        }
      });
    }
  } else {
    if (!password) {
      return res.status(400).json({ message: 'Password is required to create your account' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    user = await prisma.user.create({
      data: {
        email: invite.email,
        name: name || invite.name || invite.email.split('@')[0],
        passwordHash
      }
    });
  }

  const existingMembership = await prisma.storeMember.findUnique({
    where: { storeId_userId: { storeId: invite.storeId, userId: user.id } }
  });

  if (!existingMembership) {
    await prisma.storeMember.create({
      data: {
        storeId: invite.storeId,
        userId: user.id,
        role: invite.role
      }
    });
  }

  await prisma.storeInvite.update({
    where: { id: invite.id },
    data: { status: 'ACCEPTED', acceptedAt: new Date() }
  });

  res.json({ success: true });
}

module.exports = {
  getInvite,
  acceptInvite
};
