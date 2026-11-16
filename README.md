# SlotBook

Appointment booking for salons and clinics. Businesses set working hours and services;
customers book open slots and get reminders. A full-stack learning project focused on
real backend problems: auth, authorization, timezones, availability, and race conditions.

## Stack
| Layer | Tech |
|---|---|
| API | Node.js · Express 5 · TypeScript |
| Database | PostgreSQL · Prisma 6 |
| Validation | Zod |
| Dates | Luxon |
| Tests | Vitest · Supertest |
| Later | Redis + BullMQ (reminders), Resend (email), React frontend |

## Getting started

### 1. Get a PostgreSQL database (pick one)
- **Docker Desktop** (recommended for learning): install it, then from this folder run
  `docker compose up -d`. The default `DATABASE_URL` in `.env.example` already matches.
- **Free hosted Postgres**: create a project on Neon or Supabase, copy the *direct*
  connection string, and paste it into `apps/api/.env` as `DATABASE_URL`.
- **Native install**: PostgreSQL for Windows from postgresql.org.

The database needs the `btree_gist` extension (built into Docker Postgres, Neon and Supabase).

### 2. Configure and run
```bash
cd apps/api
cp .env.example .env          # then set JWT_ACCESS_SECRET (and DATABASE_URL if not Docker)
npm install                   # from the repo root is fine too
npm run db:migrate            # creates all tables + the double-booking constraint
npm run db:seed               # demo salon: owner@slotbook.test / password123
npm run dev                   # http://localhost:4000/health
```

### 3. Try the API
Use Thunder Client, Postman, or curl:
```
POST /auth/register   { "email": "you@example.com", "password": "password123", "name": "You" }
POST /auth/login      { "email": "owner@slotbook.test", "password": "password123" }
GET  /auth/me         Authorization: Bearer <accessToken>
POST /businesses      Authorization: Bearer <accessToken>
                      { "name": "My Clinic", "slug": "my-clinic", "timezone": "Asia/Kolkata" }
GET  /businesses/mine
GET  /b/glow-salon    (public, no token)
```

## Project structure
```
apps/api/
  prisma/
    schema.prisma                 all tables
    migrations/                   SQL history (incl. booking_rules: no double booking)
    seed.ts                       demo data
  src/
    app.ts · server.ts
    lib/                          env, db, errors
    middleware/                   auth, validate, errorHandler
    modules/
      auth/                       register, login, refresh (rotating), logout, me
      businesses/                 owner CRUD + public page (pattern to copy)
      availability/               YOUR Week 4 task + ready-made tests
  tests/                          API tests (supertest)
```

## Roadmap
- [x] **Week 0:** scaffold, schema, double-booking constraint, auth, businesses module
- [x] **Week 1:** get the DB running, explore with Prisma Studio, build **services CRUD** (copy the businesses pattern)
- [x] **Week 2:** auth tests against a test DB; understand access vs refresh tokens
- [x] **Week 3:** staff CRUD, assign services, working hours (`PUT /staff/:id/working-hours`), time off
- [ ] **Week 4:** implement `getAvailableSlots()`, remove `.skip` in its tests, add `GET /b/:slug/availability`
- [ ] **Week 5:** create / cancel / reschedule bookings; race test (10 parallel requests → 1 success, 9 × 409)
- [ ] **Week 6:** Redis + BullMQ reminders (24h / 1h), cancel jobs on booking cancel
- [ ] **Week 7:** owner calendar + stats endpoint, rate limiting, logging
- [ ] **Week 8:** Docker deploy (Render/Railway), GitHub Actions CI, README architecture diagram

Stretch: Google Calendar sync · Stripe deposits · waitlist · Claude-powered "book by chat".
