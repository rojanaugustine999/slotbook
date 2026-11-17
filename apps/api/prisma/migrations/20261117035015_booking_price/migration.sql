-- ─── Bookings keep their own price ──────────────────────────────────────────
-- Until now a booking's price was read from its service, so changing a service's
-- price rewrote every past booking and the revenue in stats. From now on each
-- booking stores the price it was made at.
--
-- Prisma wrote a single "ADD COLUMN ... NOT NULL". That fails on a table that
-- already has rows: Postgres can't fill a required column out of nothing.
-- So we add it in three steps.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column as optional. Existing bookings get NULL for now.
ALTER TABLE "bookings" ADD COLUMN "price_cents" INTEGER;

-- 2. Backfill: give every existing booking its service's current price.
--    For old bookings that is the best information we have (the real price at the
--    time was never saved, which is the bug being fixed). A DEFAULT of 0 instead
--    would quietly turn all past revenue into ₹0.
UPDATE "bookings" AS b
SET "price_cents" = s."price_cents"
FROM "services" AS s
WHERE s."id" = b."service_id";

-- 3. Now that no row is empty, make it required, so a booking can never be saved
--    without a price again.
ALTER TABLE "bookings" ALTER COLUMN "price_cents" SET NOT NULL;
