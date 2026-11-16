import { prisma } from "../../src/lib/db.js";

// Empties every table so each test starts from a clean, known state.
// Without this, a test could pass or fail depending on what an earlier test left behind.
export async function resetDb() {
  // Safety: only ever wipe a test database.
  if (!process.env.DATABASE_URL?.endsWith("_test")) {
    throw new Error("resetDb() may only run against a database whose name ends with _test");
  }

  // CASCADE also empties the tables that point at these (staff, services, bookings, ...).
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users", "businesses" RESTART IDENTITY CASCADE');
}
