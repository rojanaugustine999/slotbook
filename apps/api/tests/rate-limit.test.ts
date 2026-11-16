import express from "express";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { closeLimiterRedis } from "../src/lib/redis.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { rateLimit, type RateLimitOptions } from "../src/middleware/rateLimit.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";

// Two apps: one with limits off (to set up users quickly), one with them on.
const plainApp = createApp();
const limitedApp = createApp({ rateLimiting: true });

// A tiny app with ONE limiter and one route, to test the limiter on its own.
function miniApp(options: Partial<RateLimitOptions> = {}) {
  const app = express();
  app.use(rateLimit({ name: "unit", limit: 3, windowSec: 60, ...options }));
  app.get("/", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

// Counters live in Redis database 15. Empty the limiter keys so each test starts at zero.
const cleaner = new Redis(process.env.REDIS_URL!);
beforeEach(async () => {
  const keys = await cleaner.keys(`${process.env.QUEUE_PREFIX}:rl:*`);
  if (keys.length > 0) await cleaner.del(...keys);
});
afterAll(async () => {
  cleaner.disconnect();
  await closeLimiterRedis();
});

describe("the limiter on its own", () => {
  it("allows requests up to the limit, then answers 429 with Retry-After", async () => {
    const app = miniApp({ limit: 3 });

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(app).get("/")).status);
    const blocked = await request(app).get("/");

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(60);
  });

  it("tells the client how many requests it has left", async () => {
    const app = miniApp({ limit: 3 });

    const remaining: string[] = [];
    for (let i = 0; i < 3; i++) remaining.push((await request(app).get("/")).headers["ratelimit-remaining"] as string);
    const first = await request(app).get("/");

    expect(remaining).toEqual(["2", "1", "0"]);
    expect(first.headers["ratelimit-limit"]).toBe("3");
  });

  it("counts each caller separately, and skips requests with no caller", async () => {
    const app = miniApp({ limit: 1, key: (req) => req.header("x-caller") });

    const a1 = await request(app).get("/").set("x-caller", "alice");
    const a2 = await request(app).get("/").set("x-caller", "alice");
    const b1 = await request(app).get("/").set("x-caller", "bob"); // a different counter
    const anonymous = await Promise.all([0, 1, 2].map(() => request(app).get("/"))); // no caller: never limited

    expect([a1.status, a2.status, b1.status]).toEqual([200, 429, 200]);
    expect(anonymous.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("lets a caller back in when the window ends", async () => {
    const app = miniApp({ limit: 1, windowSec: 1 });

    const first = await request(app).get("/");
    const blocked = await request(app).get("/");
    await new Promise((resolve) => setTimeout(resolve, 1200)); // wait out the 1-second window
    const again = await request(app).get("/");

    expect([first.status, blocked.status, again.status]).toEqual([200, 429, 200]);
  });

  it("lets requests through when Redis is unreachable (fails open)", async () => {
    // Nothing listens on port 1, so every command fails.
    const broken = new Redis("redis://127.0.0.1:1", { maxRetriesPerRequest: 1, commandTimeout: 250, retryStrategy: () => null });
    broken.on("error", () => {}); // we expect the failure; don't let it crash the test
    const app = miniApp({ limit: 1, redis: broken });

    const statuses = [(await request(app).get("/")).status, (await request(app).get("/")).status, (await request(app).get("/")).status];

    broken.disconnect();
    expect(statuses).toEqual([200, 200, 200]); // beyond the limit of 1, yet none blocked
  });
});

describe("limits on the real app", () => {
  it("blocks login after 10 attempts, but leaves other routes alone", async () => {
    const attempt = () => request(limitedApp).post("/auth/login").send({ email: "nobody@example.com", password: "wrong-password" });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt()).status);
    const health = await request(limitedApp).get("/health");
    const salon = await request(limitedApp).get("/b/no-such-salon");

    expect(statuses).toEqual([...Array(10).fill(401), 429]); // ten wrong guesses, then blocked
    expect(health.status).toBe(200);
    expect(salon.status).toBe(404); // a different endpoint, a different counter: still answers normally
  }, 30_000);

  it("limits the public availability endpoint to 60 per minute", async () => {
    const ask = () => request(limitedApp).get("/b/no-such-salon/availability"); // missing parameters: a quick 400

    const first = await ask();
    for (let i = 1; i < 60; i++) await ask();
    const sixtyFirst = await ask();

    expect(first.status).toBe(400);
    expect(first.headers["ratelimit-limit"]).toBe("60");
    expect(sixtyFirst.status).toBe(429);
  }, 30_000);

  it("limits bookings per signed-in user, not per IP address", async () => {
    await resetDb();
    const alice = await createOwner(plainApp);
    const bob = await createOwner(plainApp);
    const book = (who: { auth: { Authorization: string } }) => request(limitedApp).post("/b/some-salon/bookings").set(who.auth).send({}); // an empty body: a quick 400

    const aliceStatuses: number[] = [];
    for (let i = 0; i < 21; i++) aliceStatuses.push((await book(alice)).status);
    const bobFirst = await book(bob);

    expect(aliceStatuses).toEqual([...Array(20).fill(400), 429]); // her 21st attempt is blocked
    expect(bobFirst.status).toBe(400); // same IP, different user: not blocked
  }, 30_000);

  it("doesn't count requests with no valid login against anyone's booking limit", async () => {
    const res = await request(limitedApp).post("/b/some-salon/bookings").send({});

    expect(res.status).toBe(401);
  });
});
