const prisma = require('../lib/prisma');
const { createHttpError } = require('../utils/errors');

const requireSuperAdmin = (userRole) => {
  if (userRole !== 'SUPER_ADMIN') {
    throw createHttpError(403, 'Only super administrators can manage billing and plans');
  }
};

// Helpers --------------------------------------------------------------------
const addMonths = (date, months) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
};

const addYears = (date, years) => {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
};

const nextPeriodEnd = (interval) => {
  const now = new Date();
  if (interval === 'YEARLY') return addYears(now, 1);
  return addMonths(now, 1);
};

// Plans ----------------------------------------------------------------------
async function listPlans(req, res) {
  requireSuperAdmin(req.userRole);
  const plans = await prisma.plan.findMany({ orderBy: { priceCents: 'asc' } });
  res.json({ plans });
}

async function createPlan(req, res) {
  requireSuperAdmin(req.userRole);
  const { code, name, priceCents, currency = 'USD', interval = 'MONTHLY', trialDays = 0, features, isActive = true } =
    req.body || {};
  const safeCode = typeof code === 'string' ? code.trim() : '';
  const safeName = typeof name === 'string' ? name.trim() : '';
  if (!safeCode || !safeName || priceCents === undefined) {
    return res.status(400).json({ message: 'code, name, and priceCents are required' });
  }
  const plan = await prisma.plan.create({
    data: {
      code: safeCode,
      name: safeName,
      priceCents: Number(priceCents) || 0,
      currency,
      interval,
      trialDays: Number(trialDays) || 0,
      features: features || null,
      isActive: Boolean(isActive)
    }
  });
  res.status(201).json({ plan });
}

async function updatePlan(req, res) {
  requireSuperAdmin(req.userRole);
  const { planCode } = req.params;
  const { name, priceCents, currency, interval, trialDays, features, isActive } = req.body || {};

  const existing = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!existing) {
    throw createHttpError(404, 'Plan not found');
  }

  const safeName = typeof name === 'string' ? name.trim() : name;

  const plan = await prisma.plan.update({
    where: { code: planCode },
    data: {
      ...(safeName !== undefined ? { name: safeName } : {}),
      ...(priceCents !== undefined ? { priceCents: Number(priceCents) } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(interval !== undefined ? { interval } : {}),
      ...(trialDays !== undefined ? { trialDays: Number(trialDays) } : {}),
      ...(features !== undefined ? { features } : {}),
      ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {})
    }
  });
  res.json({ plan });
}

async function deletePlan(req, res) {
  requireSuperAdmin(req.userRole);
  let { planCode } = req.params;

  // Gracefully handle bad data where code is missing/empty
  if (!planCode || planCode === '__empty__') {
    const emptyPlan = await prisma.plan.findFirst({ where: { code: '' } });
    if (!emptyPlan) {
      throw createHttpError(404, 'Plan not found');
    }
    planCode = emptyPlan.code;
  }

  const existing = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!existing) {
    throw createHttpError(404, 'Plan not found');
  }

  // Only block deletion if a plan is currently active/trialing/past due; allow deletion when only cancelled history exists.
  const activeUsage = await prisma.storeSubscription.count({
    where: { planCode, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } }
  });
  if (activeUsage > 0) {
    throw createHttpError(409, 'Plan is in use by an active subscription and cannot be deleted');
  }

  await prisma.plan.delete({ where: { code: planCode } });
  res.status(204).end();
}

// Subscriptions --------------------------------------------------------------
async function getStoreSubscription(req, res) {
  requireSuperAdmin(req.userRole);
  const { storeId } = req.params;
  const current = await prisma.storeSubscription.findFirst({
    where: { storeId, status: { in: ['ACTIVE', 'TRIALING'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  const history = await prisma.storeSubscription.findMany({
    where: { storeId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ current, history });
}

async function setStoreSubscription(req, res) {
  requireSuperAdmin(req.userRole);
  const { storeId } = req.params;
  const { planCode, trialDays: overrideTrial, notes } = req.body || {};
  if (!planCode) {
    return res.status(400).json({ message: 'planCode is required' });
  }

  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.isActive) {
    throw createHttpError(400, 'Plan not found or inactive');
  }

  const existing = await prisma.storeSubscription.findFirst({
    where: { storeId, status: { in: ['ACTIVE', 'TRIALING'] } }
  });

  // Cancel existing active/trialing subscription
  if (existing) {
    await prisma.storeSubscription.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date()
      }
    });
  }

  const trialDays = overrideTrial !== undefined ? Number(overrideTrial) : plan.trialDays;
  const hasTrial = trialDays && trialDays > 0;
  const now = new Date();

  const subscription = await prisma.storeSubscription.create({
    data: {
      storeId,
      planCode: plan.code,
      status: hasTrial ? 'TRIALING' : 'ACTIVE',
      trialEnd: hasTrial ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null,
      currentPeriodEnd: nextPeriodEnd(plan.interval),
      notes: notes || null
    }
  });

  await prisma.subscriptionChangeLog.create({
    data: {
      storeId,
      fromPlan: existing?.planCode || null,
      toPlan: plan.code,
      changedById: req.userId,
      reason: hasTrial ? 'Activated with trial' : 'Activated',
      metadata: notes ? { notes } : undefined
    }
  });

  const enriched = await prisma.storeSubscription.findUnique({
    where: { id: subscription.id },
    include: { plan: true }
  });

  res.status(201).json({ subscription: enriched });
}

async function cancelStoreSubscription(req, res) {
  requireSuperAdmin(req.userRole);
  const { storeId } = req.params;
  const { reason } = req.body || {};

  const current = await prisma.storeSubscription.findFirst({
    where: { storeId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' }
  });

  if (!current) {
    return res.status(404).json({ message: 'No active subscription to cancel' });
  }

  await prisma.storeSubscription.update({
    where: { id: current.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date()
    }
  });

  await prisma.subscriptionChangeLog.create({
    data: {
      storeId,
      fromPlan: current.planCode,
      toPlan: null,
      changedById: req.userId,
      reason: reason || 'Cancelled'
    }
  });

  res.json({ cancelled: true });
}

async function listSubscriptionLogs(req, res) {
  requireSuperAdmin(req.userRole);
  const { storeId } = req.params;
  const logs = await prisma.subscriptionChangeLog.findMany({
    where: { storeId },
    include: {
      changedBy: { select: { id: true, email: true, name: true } }
    },
    orderBy: { effectiveAt: 'desc' }
  });
  res.json({ logs });
}

module.exports = {
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getStoreSubscription,
  setStoreSubscription,
  cancelStoreSubscription,
  listSubscriptionLogs
};
