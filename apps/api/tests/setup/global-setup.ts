import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";

// Runs ONCE before the whole test run.
// `prisma migrate deploy` creates the slotbook_test database if it doesn't exist
// and applies every migration, so the test database always has the same tables
// and rules (including no_double_booking) as the real one.
export default function setup(project: TestProject) {
  const url = String(project.config.env.DATABASE_URL ?? "");

  // Safety: never run test setup against a database that isn't a test database.
  if (!url.endsWith("_test")) {
    throw new Error(`Refusing to run tests: DATABASE_URL must end with "_test" (got "${url}")`);
  }

  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });
  } catch (err) {
    const output = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    throw new Error(`Could not prepare the test database. Is Docker running?\n${output}`);
  }
}
