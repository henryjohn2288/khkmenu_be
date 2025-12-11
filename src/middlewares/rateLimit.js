// Lightweight in-memory rate limiter to protect sensitive endpoints (e.g., login).
// Keeps a sliding window per key (default: IP) and returns 429 when exceeded.
function createRateLimiter(options = {}) {
  const windowMs = Number(options.windowMs) || 15 * 60 * 1000;
  const max = Number(options.max) || 100;
  const message = options.message || 'Too many requests, please try again later.';
  const keyGenerator = options.keyGenerator || ((req) => req.ip || req.headers['x-forwarded-for'] || 'anonymous');

  const hits = new Map();

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.ceil((windowMs - (now - entry.start)) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({ message });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
