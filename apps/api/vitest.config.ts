import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],

    // Tests use their OWN database (slotbook_test), never your real one (slotbook).
    // These values replace the ones in .env while tests run.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://slotbook:slotbook@localhost:5432/slotbook_test",
      JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
    },

    // Runs once before all tests: creates the test database and its tables.
    globalSetup: ["./tests/setup/global-setup.ts"],

    // Test files share one database, so run them one after another, not in parallel.
    fileParallelism: false,
  },
});
