# SlotBook: notes for Claude

I'm a UI/UX designer and front-end developer **learning backend development** with this project.

## How to help me
- Explain the concept *before* writing code. Keep changes small.
- For core logic (especially `availability.ts` and booking creation), guide me with hints and
  review my code. Don't write it for me unless I ask.
- When reviewing, point out security, race-condition and timezone problems explicitly.
- Prefer clear code over clever code. Add short comments explaining *why*.

## Project conventions
- API: Express 5 + TypeScript (ESM, imports end in `.js`), Prisma 6, PostgreSQL, Zod, Luxon.
- Each feature lives in `apps/api/src/modules/<name>/` as `*.schema.ts` (Zod) → `*.service.ts`
  (logic + DB) → `*.routes.ts` (HTTP only).
- Throw `HttpError` helpers from `src/lib/errors.ts`; never `res.status(...)` for errors in routes.
- Owner-only actions start with `getOwnedBusiness()` (404 if not the owner).
- Times in the DB are UTC `timestamptz`; working hours are local minutes in the business timezone.
- Money is integer minor units (`priceCents`).
- Double booking is prevented by the `no_double_booking` exclusion constraint
  (`prisma/migrations/*_booking_rules`). Don't replace it with app-only checks.

## Commands (run in apps/api)
- `npm run dev`: start the API with reload
- `npm test` / `npm run test:watch`
- `npm run typecheck`
- `npm run db:migrate`: create/apply migrations · `npm run db:seed` · `npm run db:studio`

## Docker, CI and tests
- Tests need Docker running (Postgres `slotbook_test` and Redis database 15). Never run two test runs at once: they share those databases.
- `docker compose up -d`: Postgres and Redis only. `JWT_ACCESS_SECRET=... docker compose --profile full up --build`: the API too, from the Dockerfile.
- `.github/workflows/ci.yml` runs type check, tests and an image build on every push. Deployment steps are in `docs/DEPLOY.md`.
- The reminder worker runs inside the API process (`server.ts`). Rate limiting and logging are set up in `app.ts`.
