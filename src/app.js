const express = require('express');
const cors = require('cors');
require('dotenv').config();

const publicRouter = require('./routes/public');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const uploadsRouter = require('./routes/uploads');
const inviteAcceptanceRouter = require('./routes/inviteAcceptance');
const themesRouter = require('./routes/themes');

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'https://digitalmenu-fe.vercel.app',
];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use('/', publicRouter);
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api', inviteAcceptanceRouter);
app.use('/api/themes', themesRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.statusCode || 500;
  res.status(status).json({ message: err.message || 'Internal server error' });
});

module.exports = app;
