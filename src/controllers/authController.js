const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '7d';

const sanitizeUser = (user) => {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
};

const issueToken = (user) => jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        select: {
          id: true,
          role: true,
          storeId: true,
          store: {
            select: {
              id: true,
              name: true,
              slug: true,
              tagline: true,
              themeId: true,
              logoUrl: true,
              heroImageUrl: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  if (!user) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = issueToken(user);
  res.json({ token, user: sanitizeUser(user) });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      avatarUrl: true,
      role: true,
      memberships: {
        select: {
          id: true,
          role: true,
          storeId: true,
          store: {
            select: {
              id: true,
              name: true,
              slug: true,
              tagline: true,
              themeId: true,
              logoUrl: true,
              heroImageUrl: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  res.json({ user });
}

module.exports = {
  login,
  me
};
