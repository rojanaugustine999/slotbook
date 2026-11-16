import { DateTime } from "luxon";
import { prisma } from "../../lib/db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getAvailableSlots, toRange } from "./availability.js";
import type { AvailabilityQuery } from "./availability.schema.js";

// This file is the "glue": it loads the facts from the database and hands them
// to the pure getAvailableSlots function. All the hard thinking stays in that
// function, where it is easy to test.
// ignoreBookingId: when a customer reschedules, their existing booking must not
// block the new time (moving 09:30 to 09:45 overlaps the old 09:30 booking).
export async function getPublicAvailability(slug: string, query: AvailabilityQuery, options: { ignoreBookingId?: string } = {}) {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: { id: true, timezone: true, minNoticeMinutes: true, maxAdvanceDays: true },
  });
  if (!business) throw notFound("Business not found");

  // Only active services of THIS salon can be booked.
  const service = await prisma.service.findFirst({
    where: { id: query.serviceId, businessId: business.id, active: true },
    select: { durationMin: true, bufferMin: true },
  });
  if (!service) throw notFound("Service not found");

  // The regex in the schema accepts "2026-02-30"; Luxon knows that day doesn't exist.
  const day = DateTime.fromISO(query.date, { zone: business.timezone });
  if (!day.isValid) throw badRequest("date is not a real calendar date");

  // The whole local day as two real moments (00:00 to 24:00 in the salon's timezone).
  const wholeDay = toRange(query.date, business.timezone, 0, 1440);

  // Staff who can do this service, each with only the rows that matter for this day.
  const staff = await prisma.staff.findMany({
    where: {
      businessId: business.id,
      active: true,
      services: { some: { serviceId: query.serviceId } }, // offers this service
      ...(query.staffId ? { id: query.staffId } : {}), // a specific person, if asked
    },
    select: {
      id: true,
      // Luxon and our table agree: weekday 1 = Monday ... 7 = Sunday.
      workingHours: { where: { weekday: day.weekday }, select: { startMinute: true, endMinute: true } },
      // "Overlaps this day" is the same rule as the overlaps() helper, written as a query:
      // it starts before the day ends AND ends after the day starts.
      timeOff: {
        where: { startsAt: { lt: wholeDay.endsAt }, endsAt: { gt: wholeDay.startsAt } },
        select: { startsAt: true, endsAt: true },
      },
      // Cancelled, completed and no-show bookings don't block the slot.
      bookings: {
        where: {
          status: { in: ["pending", "confirmed"] },
          ...(options.ignoreBookingId ? { id: { not: options.ignoreBookingId } } : {}),
          startsAt: { lt: wholeDay.endsAt },
          endsAt: { gt: wholeDay.startsAt },
        },
        select: { startsAt: true, endsAt: true },
      },
    },
  });

  if (query.staffId && staff.length === 0) throw notFound("Staff member not found for this service");

  const now = new Date();
  const result = { date: query.date, timezone: business.timezone, slots: [] as { time: string; staffIds: string[] }[] };

  // Salons only take bookings a limited number of days ahead (maxAdvanceDays).
  const today = DateTime.fromJSDate(now, { zone: business.timezone }).startOf("day");
  if (day > today.plus({ days: business.maxAdvanceDays })) return result;

  // Work out each person's slots, then group by time:
  //   "09:30" → [Priya, Arjun]   means either of them can take a 09:30 booking.
  const staffByTime = new Map<string, string[]>();
  for (const member of staff) {
    const times = getAvailableSlots({
      date: query.date,
      timezone: business.timezone,
      now,
      service,
      workingHours: member.workingHours,
      timeOff: member.timeOff,
      bookings: member.bookings,
      minNoticeMinutes: business.minNoticeMinutes,
    });

    for (const time of times) {
      staffByTime.set(time, [...(staffByTime.get(time) ?? []), member.id]);
    }
  }

  // "HH:mm" text sorts correctly as plain text ("09:00" < "10:30").
  result.slots = [...staffByTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, staffIds]) => ({ time, staffIds }));

  return result;
}
