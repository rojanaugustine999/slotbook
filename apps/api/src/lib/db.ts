import { PrismaClient } from "@prisma/client";

// One shared client for the whole app. Each PrismaClient holds a connection
// pool, so creating one per request would quickly exhaust Postgres connections.
export const prisma = new PrismaClient();
