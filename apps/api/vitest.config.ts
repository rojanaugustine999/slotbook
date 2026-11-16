import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Fake env so the app can boot in tests without a real .env file.
    // Tests that need a real database should use a separate test DB (Week 2+).
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://slotbook:slotbook@localhost:5432/slotbook_test",
      JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
    },
  },
});
