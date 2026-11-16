-- Database-level rules that Prisma's schema language can't express.
-- These are the real safety net: even if application code has a bug, or two
-- requests race each other, Postgres refuses to store invalid data.

-- btree_gist lets a GiST index combine "=" on a UUID with "&&" (overlaps) on a range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A booking must end after it starts.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_time_order" CHECK ("ends_at" > "starts_at");

-- THE key rule: one staff member can never have two active bookings whose
-- time ranges overlap. '[)' means start is included, end is excluded, so a
-- 10:00–10:30 booking and a 10:30–11:00 booking do NOT conflict.
-- Cancelled / completed / no_show bookings are ignored by the WHERE clause.
-- Violations raise Postgres error 23P01 (exclusion_violation); the API turns it into 409.
ALTER TABLE "bookings"
  ADD CONSTRAINT "no_double_booking"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" IN ('pending', 'confirmed'));

-- Sanity checks on the other time-based tables.
ALTER TABLE "time_off"
  ADD CONSTRAINT "time_off_time_order" CHECK ("ends_at" > "starts_at");

ALTER TABLE "working_hours"
  ADD CONSTRAINT "working_hours_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "working_hours_minutes_range" CHECK (
    "start_minute" >= 0 AND "end_minute" <= 1440 AND "end_minute" > "start_minute"
  );

ALTER TABLE "services"
  ADD CONSTRAINT "services_positive_values" CHECK (
    "duration_min" > 0 AND "buffer_min" >= 0 AND "price_cents" >= 0
  );
