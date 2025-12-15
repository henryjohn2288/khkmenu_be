const express = require("express");
const cors = require("cors");
require("dotenv").config();

const publicRouter = require("./routes/public");
const authRouter = require("./routes/auth");
const adminRouter = require("./routes/admin");
const uploadsRouter = require("./routes/uploads");
const inviteAcceptanceRouter = require("./routes/inviteAcceptance");
const themesRouter = require("./routes/themes");
const billingRouter = require("./routes/billing");
const { createRateLimiter } = require("./middlewares/rateLimit");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://khkmenu.com",
  "https://www.khkmenu.com",
  "https://khkmenu-fe.onrender.com", // optional
];

// ✅ CORS options
const corsOptions = {
  origin(origin, cb) {
    // Allow server-to-server / curl / postman
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
};

// ✅ Handle preflight (OPTIONS) for all routes
app.options("/(.*)", cors(corsOptions));

// ✅ Apply CORS
app.use(cors(corsOptions));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Protect login endpoint from brute force.
const loginLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: "Too many login attempts. Please try again in a minute.",
});

// Routes
app.use("/", publicRouter);
app.use("/api/auth/login", loginLimiter);
app.use("/api", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/admin/billing", billingRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api", inviteAcceptanceRouter);
app.use("/api/themes", themesRouter);

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({ message: err.message || "Internal server error" });
});

module.exports = app;
