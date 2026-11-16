import type { BookingStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { badRequest } from "../../lib/errors.js";
import { toRange } from "../availability/availability.js";
import { getOwnedBusiness } from "../businesses/businesses.service.js";
import type { StatsQuery } from "./stats.schema.js";

// ─── Aggregation: letting the database do the counting ───────────────────────
// To answer "how many bookings per day?" you could load every booking into the
// server and count them in JavaScript. That gets slower with every booking and
// wastes memory. A database is built for this: GROUP BY makes Postgres return
// only the answer (a few rows), no matter how many bookings there are.
// ──────────────────────────────────────────────────────────────────────────────

const ALL_STATUSES: BookingStatus[] = ["pending", "confirmed", "cancelled", "completed", "no_show"];

export async function getBusinessStats(businessId: string, userId: string, query: StatsQuery) {
  const business = await getOwnedBusiness(businessId, userId);
  const tz = business.timezone;

  const first = DateTime.fromISO(query.from, { zone: tz });
  const last = DateTime.fromISO(query.to, { zone: tz });
  if (!first.isValid || !last.isValid) throw badRequest("from and to must be real calendar dates");

  // "From 00:00 on the first day to 24:00 on the last day" as two real moments.
  const rangeStart = toRange(query.from, tz, 0, 1440).startsAt;
  const rangeEnd = toRange(query.to, tz, 0, 1440).endsAt;

  // ── 1. Bookings by status ──────────────────────────────────────────────────
  // Prisma's groupBy is SQL's GROUP BY: one row per status with its count.
  const grouped = await prisma.booking.groupBy({
    by: ["status"],
    where: { businessId, startsAt: { gte: rangeStart, lt: rangeEnd } },
    _count: { _all: true },
  });

  // Start every status at 0, so the answer always has all five keys.
  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<BookingStatus, number>;
  for (const row of grouped) byStatus[row.status] = row._count._all;

  const total = ALL_STATUSES.reduce((sum, s) => sum + byStatus[s], 0);

  // Of the appointments that were due to happen, how many were no-shows?
  // (Cancelled and still-upcoming bookings don't count either way.)
  const finished = byStatus.completed + byStatus.no_show;
  const noShowRate = finished === 0 ? null : Math.round((byStatus.no_show / finished) * 1000) / 1000;

  // ── 2. Bookings per day, in the salon's timezone ───────────────────────────
  // Raw SQL, because Prisma can't group by "the local date". The ${...} parts are
  // sent to Postgres as separate PARAMETERS, never pasted into the text, so a
  // value can't change the meaning of the query (that would be SQL injection).
  //
  // `starts_at AT TIME ZONE 'Asia/Kolkata'` converts the stored UTC moment to the
  // salon's wall clock. A booking at 00:30 in Kochi is 19:00 UTC the DAY BEFORE;
  // grouping by the UTC date would put it on the wrong day.
  const perDayRows = await prisma.$queryRaw<{ day: string; count: bigint }[]>`
    SELECT to_char(starts_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, COUNT(*) AS count
    FROM bookings
    WHERE business_id = ${businessId}::uuid
      AND starts_at >= ${rangeStart}
      AND starts_at < ${rangeEnd}
      AND status <> 'cancelled'
    GROUP BY day
    ORDER BY day`;

  const countByDay = new Map(perDayRows.map((r) => [r.day, Number(r.count)])); // bigint → number

  // Days with no bookings produce no row, but a chart needs them as zeros.
  const bookingsPerDay: { date: string; count: number }[] = [];
  for (let d = first; d <= last; d = d.plus({ days: 1 })) {
    const date = d.toFormat("yyyy-MM-dd");
    bookingsPerDay.push({ date, count: countByDay.get(date) ?? 0 });
  }

  // ── 3. Most-booked services, with the money actually earned ────────────────
  // JOIN pulls each booking's service so we can add up prices. Revenue counts only
  // COMPLETED bookings: a booking that is still upcoming hasn't earned anything yet.
  const topRows = await prisma.$queryRaw<{ id: string; name: string; bookings: bigint; revenue: bigint }[]>`
    SELECT s.id, s.name, COUNT(*) AS bookings,
           COALESCE(SUM(CASE WHEN b.status = 'completed' THEN s.price_cents ELSE 0 END), 0) AS revenue
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.business_id = ${businessId}::uuid
      AND b.starts_at >= ${rangeStart}
      AND b.starts_at < ${rangeEnd}
      AND b.status <> 'cancelled'
    GROUP BY s.id, s.name
    ORDER BY bookings DESC, s.name
    LIMIT 5`;

  return {
    from: query.from,
    to: query.to,
    timezone: tz,
    total,
    byStatus,
    noShowRate, // 0.25 means 25%; null when no appointment has finished yet
    bookingsPerDay,
    topServices: topRows.map((r) => ({
      serviceId: r.id,
      name: r.name,
      bookings: Number(r.bookings),
      revenueCents: Number(r.revenue),
    })),
  };
}
