const { Router } = require('express');
const prisma = require('../lib/prisma');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuth = require('../middlewares/requireAuth');

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const themes = await prisma.theme.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        previewImageUrl: true,
        config: true
      }
    });
    res.json({ themes });
  })
);

module.exports = router;
