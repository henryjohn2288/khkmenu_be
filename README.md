# Backend Setup

## Prerequisites
- Node.js 18+
- npm (ships with Node)

## 1. Install dependencies
```bash
npm install
```

## 2. Apply schema + seed demo data
```bash
npm run setup   # prisma db push + npm run seed
```

### Individual commands
- `npm run db:push` - sync Prisma schema to the local DB
- `npm run seed` - populate demo themes, users, stores, categories, products
- `npm run migrate:dev -- --name <description>` - create a migration
- `npm run db:reset` - wipe + reseed (uses `prisma migrate reset --force`)

## 3. Run the API
```bash
npm run dev
```
Server listens on `http://localhost:4000`. Key endpoints:
- `GET /api` - health + route hints
- `GET /api/catalog/:slug` - public storefront data (e.g. `/api/catalog/slskincare`)
- `POST /api/auth/login` - JWT login (JSON body `{ email, password }`)
- `GET /api/me` - return the authenticated user + memberships
- `/api/admin/*` - protected CRUD routes for stores, categories, products

Seeded demo credentials (after `npm run seed`):
- `admin@example.com` / `admin123` (SUPER_ADMIN)
- `hello@vfurniture.com` / `vfurniture123` (Store admin/editor)

## Notes
- `.env` now includes:
  - `DATABASE_URL` (defaults to `file:./dev.db` for SQLite)
  - `JWT_SECRET` (change this in production)
  - `CLOUDINARY_*` variables for signed uploads
  - `APP_BASE_URL` so invite links use the correct frontend origin
  - `RESEND_API_KEY` and `MAIL_FROM` so member invites email users automatically
- After editing `prisma/schema.prisma`, rerun `npm run db:push` and restart `npm run dev` so the Prisma Client regenerates.

### Email invites
Member invites are sent via [Resend](https://resend.com/). Provide:

```
RESEND_API_KEY=your_resend_key
MAIL_FROM="Digital Menu <no-reply@yourdomain.com>"
```

If `RESEND_API_KEY` is missing, the server logs invite links to the console instead so you can still copy/paste them manually.




