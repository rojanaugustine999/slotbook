import { execSync } from "node:child_process";
import { Redis } from "ioredis";
import type { TestProject } from "vitest/node";

// Runs ONCE before the whole test run.
//  1. Postgres: `prisma migrate deploy` creates the slotbook_test database if it
//     doesn't exist and applies every migration, so the test database always has
//     the same tables and rules (including no_double_booking) as the real one.
//  2. Redis: empties database 15, so jobs from a previous run can't leak in.
export default async function setup(project: TestProject) {
  const dbUrl = String(project.config.env.DATABASE_URL ?? "");
  const redisUrl = String(project.config.env.REDIS_URL ?? "");

  // Safety: never run test setup against a database that isn't a test database.
  if (!dbUrl.endsWith("_test")) {
    throw new Error(`Refusing to run tests: DATABASE_URL must end with "_test" (got "${dbUrl}")`);
  }
  if (!redisUrl.endsWith("/15")) {
    throw new Error(`Refusing to run tests: REDIS_URL must use database /15 (got "${redisUrl}")`);
  }

  try {
    execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(`Could not prepare the test database. Is Docker running?\n${output}`);
  }

  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try {
    await redis.connect();
    await redis.flushdb(); // only database 15
  } catch (err) {
    throw new Error(`Could not reach Redis for the tests. Is Docker running?\n${String(err)}`);
  } finally {
    redis.disconnect();
  }
}
