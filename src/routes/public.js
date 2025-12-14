const { Router } = require('express');
const prisma = require('../lib/prisma');
const asyncHandler = require('../middlewares/asyncHandler');

const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'Digital Menu API', docs: '/api' });
});

router.get('/api', (_req, res) => {
  res.json({
    status: 'ok',
    endpoints: {
      catalog: '/api/catalog/:slug',
      login: '/api/auth/login',
      me: '/api/me',
      admin: '/api/admin/*'
    }
  });
});

router.get(
  '/api/catalog/:slug',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const store = await prisma.store.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        tagline: true,
        description: true,
        phone: true,
        telegram: true,
        whatsapp: true,
        contactEmail: true,
        facebookUrl: true,
        instagramUrl: true,
        websiteUrl: true,
        location: true,
        qrCodeImageUrl: true,
        logoUrl: true,
        heroImageUrl: true,
        themeSettings: true,
        theme: { select: { id: true, slug: true, name: true, config: true } },
        categories: {
          where: { isVisible: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name_km: true, name_en: true, sortOrder: true, description: true, isVisible: true }
        },
        products: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name_km: true,
            name_en: true,
          price: true,
          sku: true,
          imageUrl: true,
          imageUrls: true,
          categoryId: true,
          description: true,
          unit: true,
          isFeatured: true,
            status: true,
            sortOrder: true
          }
        }
      }
    });

    if (!store) return res.status(404).json({ message: 'Store not found' });

    const productsByCategory = {};
    for (const product of store.products) {
      const key = product.categoryId || 'uncategorized';
      if (!productsByCategory[key]) {
        productsByCategory[key] = [];
      }
      productsByCategory[key].push(product);
    }

    res.json({
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        tagline: store.tagline,
        description: store.description,
        contact: {
          phone: store.phone,
          telegram: store.telegram,
          whatsapp: store.whatsapp,
          email: store.contactEmail,
          facebook: store.facebookUrl,
          instagram: store.instagramUrl,
          website: store.websiteUrl,
          location: store.location
        },
        media: {
          qrCodeImageUrl: store.qrCodeImageUrl,
          logoUrl: store.logoUrl,
          heroImageUrl: store.heroImageUrl
        },
        theme: store.theme,
        themeSettings: store.themeSettings
      },
      categories: store.categories,
      productsByCategory
    });
  })
);

router.get(
  '/api/public/plans',
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: 'asc' }
    });
    res.json({ plans });
  })
);

module.exports = router;
