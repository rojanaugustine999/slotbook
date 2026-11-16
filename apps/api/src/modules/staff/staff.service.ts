import { prisma } from "../../lib/db.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { getOwnedBusiness } from "../businesses/businesses.service.js";
import type { CreateStaffInput, SetStaffServicesInput } from "./staff.schema.js";

// What we send back for a staff member: their own fields plus the services they offer.
// The join table (staff_services) only holds ids, so we "include" the real service rows.
const staffWithServices = {
  id: true,
  name: true,
  active: true,
  services: { select: { service: { select: { id: true, name: true } } } },
} as const;

type StaffRow = { id: string; name: string; active: boolean; services: { service: { id: string; name: string } }[] };

// Flattens the database shape into a simpler one for the frontend:
//   services: [{ service: { id, name } }]   becomes   services: [{ id, name }]
function present(row: StaffRow) {
  return { ...row, services: row.services.map((link) => link.service) };
}

// Checks the user owns the salon AND the staff member belongs to that salon.
export async function getOwnedStaff(businessId: string, staffId: string, userId: string) {
  await getOwnedBusiness(businessId, userId);

  const staff = await prisma.staff.findFirst({ where: { id: staffId, businessId } });
  if (!staff) throw notFound("Staff member not found");
  return staff;
}

export async function createStaff(businessId: string, userId: string, input: CreateStaffInput) {
  await getOwnedBusiness(businessId, userId);
  const row = await prisma.staff.create({ data: { ...input, businessId }, select: staffWithServices });
  return present(row);
}

export async function listStaff(businessId: string, userId: string) {
  await getOwnedBusiness(businessId, userId);
  const rows = await prisma.staff.findMany({ where: { businessId }, select: staffWithServices, orderBy: { name: "asc" } });
  return rows.map(present);
}

// Replaces the whole list of services a staff member offers.
export async function setStaffServices(businessId: string, staffId: string, userId: string, input: SetStaffServicesInput) {
  await getOwnedStaff(businessId, staffId, userId);

  // Remove duplicates, so sending the same id twice doesn't cause an error.
  const serviceIds = [...new Set(input.serviceIds)];

  // Every service must belong to THIS salon. Otherwise an owner could attach
  // another salon's service to their staff by guessing its id.
  const found = await prisma.service.count({ where: { id: { in: serviceIds }, businessId } });
  if (found !== serviceIds.length) throw badRequest("One or more services don't belong to this business");

  // A transaction: both steps succeed together or neither happens. Without it,
  // a crash between the two steps would leave the staff member with no services.
  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { staffId } }),
    prisma.staffService.createMany({ data: serviceIds.map((serviceId) => ({ staffId, serviceId })) }),
  ]);

  const row = await prisma.staff.findUniqueOrThrow({ where: { id: staffId }, select: staffWithServices });
  return present(row);
}
