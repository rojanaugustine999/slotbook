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
      // Redis database number 15, so tests never touch jobs in your development queue.
      REDIS_URL: "redis://localhost:6379/15",
      QUEUE_PREFIX: "slotbook-test",
      LOG_LEVEL: "silent", // quiet test output; logging tests pass their own logger
      RATE_LIMIT_ENABLED: "false", // tests make dozens of logins; the limiter tests turn it on themselves
      RESEND_API_KEY: "", // empty: emails go to the in-memory outbox, never to a real inbox
      // Fake Razorpay keys: tests replace createOrder and sign payments with this secret
      // themselves, so no test ever reaches the real Razorpay.
      RAZORPAY_KEY_ID: "rzp_test_fake_for_tests",
      RAZORPAY_KEY_SECRET: "test-only-razorpay-secret",
      RAZORPAY_WEBHOOK_SECRET: "test-only-webhook-secret",
    },

    // Runs once before all tests: creates the test database and its tables.
    globalSetup: ["./tests/setup/global-setup.ts"],

    // Test files share one database, so run them one after another, not in parallel.
    fileParallelism: false,
  },
});
