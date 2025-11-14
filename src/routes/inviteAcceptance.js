const { Router } = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const asyncHandler = require('../middlewares/asyncHandler');
const { createHttpError } = require('../utils/errors');

const router = Router();

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

router.get(
  '/invites/:token',
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const invite = await prisma.storeInvite.findUnique({ where: { token }, select: inviteSelect });
    if (!invite || invite.status !== 'PENDING' || isInviteExpired(invite)) {
      throw createHttpError(404, 'Invite not found or expired');
    }
    res.json({ invite: { ...invite, token: undefined } });
  })
);

router.post(
  '/invites/:token/accept',
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const invite = await prisma.storeInvite.findUnique({ where: { token }, select: inviteSelect });
    if (!invite || invite.status !== 'PENDING' || isInviteExpired(invite)) {
      throw createHttpError(404, 'Invite not found or expired');
    }

    const { name, password } = req.body || {};
    let user = await prisma.user.findUnique({ where: { email: invite.email } });

    if (!user && !password) {
      return res.status(400).json({ message: 'Password is required to create your account' });
    }

    if (!user) {
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
  })
);

module.exports = router;
