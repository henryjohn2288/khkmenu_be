const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

async function upsertThemes() {
  const themes = [
    {
      slug: 'default',
      name: 'Default',
      description: 'Clean layout with neutral colors',
      config: { primary: '#1e1e1e', accent: '#f4b400', font: 'Inter' }
    },
    {
      slug: 'cosmetic',
      name: 'Cosmetic',
      description: 'Soft gradients for beauty and lifestyle brands',
      config: { primary: '#b83280', accent: '#ffd1dc', font: 'Playfair Display' }
    },
    {
      slug: 'kampuchea',
      name: 'Kampuchea',
      description: 'Bold reds and golds inspired by local markets',
      config: { primary: '#b22222', accent: '#f9c74f', font: 'Battambang' }
    }
  ];

  const themeMap = {};

  for (const theme of themes) {
    const { slug, ...rest } = theme;
    themeMap[slug] = await prisma.theme.upsert({
      where: { slug },
      update: rest,
      create: theme
    });
  }

  return themeMap;
}

async function upsertUsers() {
  const adminPassword = 'admin123';
  const furniturePassword = 'vfurniture123';
  const [adminHash, furnitureHash] = await Promise.all([
    hashPassword(adminPassword),
    hashPassword(furniturePassword)
  ]);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { name: 'Demo Admin', passwordHash: adminHash },
    create: {
      email: 'admin@example.com',
      name: 'Demo Admin',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN'
    }
  });

  const furnitureOwner = await prisma.user.upsert({
    where: { email: 'hello@vfurniture.com' },
    update: { name: 'V Furniture', passwordHash: furnitureHash },
    create: {
      email: 'hello@vfurniture.com',
      name: 'V Furniture',
      passwordHash: furnitureHash,
      role: 'ADMIN'
    }
  });

  console.log('Seeded demo users:');
  console.log('  admin@example.com /', adminPassword);
  console.log('  hello@vfurniture.com /', furniturePassword);

  return { admin, furnitureOwner };
}

async function seedStore({ ownerId, themeId, slug, baseData, categories, products, members = [] }) {
  const store = await prisma.store.upsert({
    where: { slug },
    update: { ownerId, themeId, ...baseData },
    create: { ownerId, themeId, slug, ...baseData }
  });

  // Reset catalog entries for deterministic seeds
  await prisma.product.deleteMany({ where: { storeId: store.id } });
  await prisma.category.deleteMany({ where: { storeId: store.id } });

  const categoryMap = {};
  for (const category of categories) {
    const { handle, ...data } = category;
    const created = await prisma.category.create({
      data: { ...data, storeId: store.id }
    });
    categoryMap[handle || created.id] = created;
  }

  for (const product of products) {
    const { categoryHandle, ...productData } = product;
    await prisma.product.create({
      data: {
        ...productData,
        storeId: store.id,
        categoryId: categoryHandle ? categoryMap[categoryHandle]?.id ?? null : null
      }
    });
  }

  const memberEntries = [
    { userId: ownerId, role: 'OWNER' },
    ...members
  ];

  for (const member of memberEntries) {
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: member.userId } },
      update: { role: member.role },
      create: { storeId: store.id, userId: member.userId, role: member.role }
    });
  }

  return store;
}

async function main() {
  console.log('Seeding themes and users...');
  const themeMap = await upsertThemes();
  const { admin, furnitureOwner } = await upsertUsers();

  console.log('Clearing existing demo data...');
  await prisma.storeMember.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();

  console.log('Seeding stores, categories, and products...');

  await seedStore({
    slug: 'slskincare',
    ownerId: admin.id,
    themeId: themeMap.cosmetic.id,
    baseData: {
      name: 'SL Skincare',
      tagline: 'Premium cosmetics and skincare',
      description: 'Curated K-beauty and local cosmetic products.',
      telegram: '@slskincare_shop',
      phone: '+855 96 555 2222',
      contactEmail: 'hello@slskincare.com',
      instagramUrl: 'https://instagram.com/slskincare',
      heroImageUrl: 'https://placehold.co/1200x400?text=SL+Skincare',
      logoUrl: 'https://placehold.co/300x300?text=SL'
    },
    categories: [
      { handle: 'lipsticks', name_en: 'Lipsticks', name_km: 'Lipsticks', sortOrder: 1, description: 'Matte and glossy finishes' },
      { handle: 'skincare', name_en: 'Skincare', name_km: 'Skincare', sortOrder: 2 }
    ],
    products: [
      {
        categoryHandle: 'lipsticks',
        name_en: 'Velvet Lipstick #01',
        name_km: 'Velvet Lipstick #01',
        price: 4.5,
        sku: 'LIP-01',
        status: 'ACTIVE',
        imageUrl: 'https://placehold.co/600x600?text=Lipstick+01',
        description: 'Long-lasting matte lipstick.',
        unit: 'pcs',
        isFeatured: true
      },
      {
        categoryHandle: 'lipsticks',
        name_en: 'Velvet Lipstick #02',
        name_km: 'Velvet Lipstick #02',
        price: 4.5,
        sku: 'LIP-02',
        status: 'ACTIVE',
        imageUrl: 'https://placehold.co/600x600?text=Lipstick+02',
        description: 'Gloss finish with vitamin E.',
        unit: 'pcs'
      },
      {
        categoryHandle: 'skincare',
        name_en: 'Brightening Serum',
        name_km: 'Brightening Serum',
        price: 24.99,
        sku: 'SKIN-01',
        status: 'ACTIVE',
        imageUrl: 'https://placehold.co/600x600?text=Serum',
        description: 'Niacinamide + Vitamin C.',
        unit: '30ml'
      }
    ],
    members: [
      { userId: furnitureOwner.id, role: 'EDITOR' }
    ]
  });

  await seedStore({
    slug: 'v_furniture',
    ownerId: furnitureOwner.id,
    themeId: themeMap.kampuchea.id,
    baseData: {
      name: 'V Furniture',
      tagline: 'Custom wood furniture',
      description: 'Hand-made furniture for modern homes.',
      telegram: '@vfurniture',
      phone: '+855 93 777 333',
      facebookUrl: 'https://facebook.com/vfurniture',
      websiteUrl: 'https://vfurniture.co',
      location: 'Phnom Penh',
      heroImageUrl: 'https://placehold.co/1200x400?text=V+Furniture'
    },
    categories: [
      { handle: 'sofas', name_en: 'Sofas', name_km: 'Sofas', sortOrder: 1 },
      { handle: 'tables', name_en: 'Dining Tables', name_km: 'Dining Tables', sortOrder: 2 }
    ],
    products: [
      {
        categoryHandle: 'sofas',
        name_en: 'Lotus 3-Seater Sofa',
        name_km: 'Lotus 3-Seater Sofa',
        price: 499.0,
        sku: 'SOFA-01',
        status: 'ACTIVE',
        imageUrl: 'https://placehold.co/800x600?text=Sofa',
        description: 'Solid wood frame, linen fabric.',
        unit: 'set',
        isFeatured: true
      },
      {
        categoryHandle: 'tables',
        name_en: 'Heritage Dining Table',
        name_km: 'Heritage Dining Table',
        price: 650.0,
        sku: 'TABLE-01',
        status: 'ACTIVE',
        imageUrl: 'https://placehold.co/800x600?text=Table',
        description: '6-seater teak dining table.',
        unit: 'set'
      }
    ]
  });

  console.log('Seed complete');
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
