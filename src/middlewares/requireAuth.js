const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const asyncHandler = require('./asyncHandler');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

module.exports = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Missing authorization header' });
  }

  const token = header.replace('Bearer ', '').trim();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    req.userRole = user.role;
    req.userId = user.id;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});
