import { prisma } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { getOwnedStaff } from "../staff/staff.service.js";
import type { CreateTimeOffInput } from "./time-off.schema.js";

// The fields we send back. startsAt and endsAt come out as UTC ("...Z").
const timeOffFields = { id: true, startsAt: true, endsAt: true, reason: true } as const;

export async function createTimeOff(businessId: string, staffId: string, userId: string, input: CreateTimeOffInput) {
  await getOwnedStaff(businessId, staffId, userId);

  return prisma.timeOff.create({
    data: {
      staffId,
      // new Date("2026-12-05T09:00:00+05:30") understands the offset and holds the
      // exact moment. Prisma then saves it to the timestamptz column in UTC.
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      reason: input.reason,
    },
    select: timeOffFields,
  });
}

// Lists time off that hasn't finished yet, soonest first. Past leave is kept
// in the database as history but isn't useful on the schedule screen.
export async function listUpcomingTimeOff(businessId: string, staffId: string, userId: string) {
  await getOwnedStaff(businessId, staffId, userId);

  return prisma.timeOff.findMany({
    where: { staffId, endsAt: { gt: new Date() } }, // gt = "greater than", i.e. ends after now
    orderBy: { startsAt: "asc" },
    select: timeOffFields,
  });
}

export async function deleteTimeOff(businessId: string, staffId: string, timeOffId: string, userId: string) {
  await getOwnedStaff(businessId, staffId, userId);

  // deleteMany with both ids only removes the row if it belongs to THIS staff member.
  // It returns how many rows it removed, so 0 means "not found".
  const { count } = await prisma.timeOff.deleteMany({ where: { id: timeOffId, staffId } });
  if (count === 0) throw notFound("Time off not found");

  // A real delete this time (not a soft delete like services): nothing else in the
  // database points at a time-off row, so removing it can't break any history.
}
