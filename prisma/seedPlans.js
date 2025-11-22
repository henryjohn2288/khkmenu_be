/**
 * Seed default billing plans.
 *
 * Run: npm run seed:plans
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const plans = [
  {
    code: 'STARTER',
    name: 'Starter',
    priceCents: 0,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 14,
    isActive: true,
    features: {
      products: 100,
      stores: 1,
      support: 'Standard'
    }
  },
  {
    code: 'PRO',
    name: 'Pro',
    priceCents: 4900,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 14,
    isActive: true,
    features: {
      products: 1000,
      stores: 3,
      support: 'Priority'
    }
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    priceCents: 14900,
    currency: 'USD',
    interval: 'MONTHLY',
    trialDays: 30,
    isActive: true,
    features: {
      products: 'unlimited',
      stores: 'unlimited',
      support: 'Dedicated'
    }
  }
];

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: { ...plan, updatedAt: new Date() },
      create: plan
    });
  }
  console.log('Seeded plans:', plans.map((p) => p.code).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
