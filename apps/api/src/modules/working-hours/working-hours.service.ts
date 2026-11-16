import { prisma } from "../../lib/db.js";
import { getOwnedStaff } from "../staff/staff.service.js";
import { toClock, toMinutes, type SetWorkingHoursInput } from "./working-hours.schema.js";

// Reads a staff member's week from the database and converts minutes back to clock times.
async function readHours(staffId: string) {
  const rows = await prisma.workingHours.findMany({
    where: { staffId },
    orderBy: [{ weekday: "asc" }, { startMinute: "asc" }],
  });

  return rows.map((row) => ({
    weekday: row.weekday,
    start: toClock(row.startMinute),
    end: toClock(row.endMinute),
  }));
}

export async function getWorkingHours(businessId: string, staffId: string, userId: string) {
  await getOwnedStaff(businessId, staffId, userId);
  return readHours(staffId);
}

// Replaces the staff member's whole weekly schedule.
export async function setWorkingHours(businessId: string, staffId: string, userId: string, input: SetWorkingHoursInput) {
  await getOwnedStaff(businessId, staffId, userId);

  // Same pattern as staff services: delete the old rows and insert the new ones
  // in one transaction, so the schedule is never left half-replaced.
  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { staffId } }),
    prisma.workingHours.createMany({
      data: input.hours.map((block) => ({
        staffId,
        weekday: block.weekday,
        startMinute: toMinutes(block.start),
        endMinute: toMinutes(block.end),
      })),
    }),
  ]);

  return readHours(staffId);
}
