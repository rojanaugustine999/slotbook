import { prisma } from "../../src/lib/db.js";

// For tests that need bookings with exact times and statuses (including past
// ones and "completed"/"no_show", which the API won't create directly).

export async function createCustomerRow() {
  return prisma.user.create({ data: { email: `customer-${Math.random().toString(36).slice(2)}@example.com`, name: "Customer", passwordHash: "x" } });
}

export type BookingStatusName = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

/** Inserts a 30-minute booking starting at the given ISO moment, e.g. "2026-03-02T10:00:00+05:30". */
export async function insertBookingAt(args: {
  businessId: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  startsAt: string;
  status: BookingStatusName;
}) {
  const startsAt = new Date(args.startsAt);
  return prisma.booking.create({
    data: {
      businessId: args.businessId,
      staffId: args.staffId,
      serviceId: args.serviceId,
      customerId: args.customerId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
      status: args.status,
    },
  });
}
