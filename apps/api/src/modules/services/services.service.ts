import { prisma } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { getOwnedBusiness } from "../businesses/businesses.service.js";
import type { CreateServiceInput, UpdateServiceInput } from "./services.schema.js";

// Shared by update and deactivate: checks the user owns the salon AND that the
// service belongs to that salon. Without the second check, an owner could edit
// another salon's service by putting its id in their own salon's URL.
async function getOwnedService(businessId: string, serviceId: string, userId: string) {
  await getOwnedBusiness(businessId, userId);

  const service = await prisma.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service) throw notFound("Service not found");
  return service;
}

export async function createService(businessId: string, userId: string, input: CreateServiceInput) {
  // Step 1: permission. Stops here with a 404 if this user doesn't own the salon.
  await getOwnedBusiness(businessId, userId);

  // Step 2: save. businessId comes from the URL, never from the request body.
  return prisma.service.create({ data: { ...input, businessId } });
}

export async function listServices(businessId: string, userId: string) {
  // Step 1: permission. Same check as in createService.
  await getOwnedBusiness(businessId, userId);

  // Step 2: get all services of this salon, sorted A to Z by name.
  return prisma.service.findMany({ where: { businessId }, orderBy: { name: "asc" } });
}

export async function updateService(businessId: string, serviceId: string, userId: string, input: UpdateServiceInput) {
  // Step 1: permission, and the service must belong to this salon.
  await getOwnedService(businessId, serviceId, userId);

  // Step 2: change only the fields that were sent (input may hold just a price).
  return prisma.service.update({ where: { id: serviceId }, data: input });
}

export async function deactivateService(businessId: string, serviceId: string, userId: string) {
  await getOwnedService(businessId, serviceId, userId);

  // "Soft delete": we hide the service instead of erasing the row, because old
  // bookings still point to it. Erasing it would break the booking history.
  await prisma.service.update({ where: { id: serviceId }, data: { active: false } });
}