import type { Request, RequestHandler } from "express";
import type { Redis } from "ioredis";
import { env } from "../lib/env.js";
import { tooManyRequests } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { getLimiterRedis } from "../lib/redis.js";

// ─── What rate limiting is for ───────────────────────────────────────────────
// Without it, one script can try 10,000 passwords a minute against /auth/login,
// or hammer an expensive endpoint until the database struggles. A rate limiter
// says: "each caller gets N requests per time window; after that, wait."
//
// How it works here (a "fixed window counter" kept in Redis):
//   1. Build a key from WHO is calling and WHICH limit:  "slotbook:rl:auth:203.0.113.5"
//   2. Add 1 to the counter at that key. The first request also starts a timer
//      (the window), after which Redis deletes the counter by itself.
//   3. If the counter is over the limit, answer 429 "Too Many Requests".
//
// Why Redis and not a variable in the server's memory? If you run 3 copies of the
// API, a memory counter would let each copy allow N requests, so callers get 3N.
// Redis is shared, so all copies count together. It also survives a restart.
//
// Known weakness: with fixed windows, someone can send N requests at the very end
// of one window and N more at the start of the next, so a burst of 2N is possible.
// For protecting logins that is acceptable. Stricter schemes exist ("sliding window").
// ──────────────────────────────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Short name, used in the Redis key and in logs: "auth", "booking", ... */
  name: string;
  /** How many requests one caller may make per window */
  limit: number;
  /** Window length in seconds */
  windowSec: number;
  /** Who is calling. Default: the client's IP. Return undefined to skip limiting. */
  key?: (req: Request) => string | undefined;
  /** Redis connection to use. Tests pass their own. */
  redis?: Redis;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const whoIs = options.key ?? ((req: Request) => req.ip);

  return async (req, res, next) => {
    const caller = whoIs(req);
    if (!caller) return next(); // nobody to count against (e.g. not signed in)

    const key = `${env.QUEUE_PREFIX}:rl:${options.name}:${caller}`;

    let count: number;
    let resetSec: number;
    try {
      // MULTI runs the three commands as one unit. "EXPIRE ... NX" sets the timer only
      // if the key has none yet, so the window starts at the FIRST request and a crash
      // between commands can't leave a counter that never expires.
      const results = await (options.redis ?? getLimiterRedis())
        .multi()
        .incr(key)
        .expire(key, options.windowSec, "NX")
        .pttl(key) // milliseconds left in this window
        .exec();

      if (!results || results.some(([err]) => err)) throw new Error("Redis rejected the rate-limit commands");
      count = Number(results[0]![1]);
      const ttlMs = Number(results[2]![1]);
      resetSec = Math.max(1, Math.ceil(ttlMs / 1000));
    } catch (err) {
      // FAIL OPEN: if Redis is down we let the request through. The alternative,
      // "fail closed", would turn a Redis outage into a total API outage.
      // (For a login limiter some teams choose the opposite. It is a judgement call.)
      logger.warn({ err, limiter: options.name }, "rate limiter unavailable; letting the request through");
      return next();
    }

    // Tell well-behaved clients where they stand, even when they are under the limit.
    res.set({
      "RateLimit-Limit": String(options.limit),
      "RateLimit-Remaining": String(Math.max(0, options.limit - count)),
      "RateLimit-Reset": String(resetSec),
    });

    if (count > options.limit) {
      res.set("Retry-After", String(resetSec)); // standard header: "try again in N seconds"
      (req.log ?? logger).warn({ limiter: options.name, caller }, "rate limit exceeded");
      throw tooManyRequests();
    }

    next();
  };
}

// ── The limits SlotBook uses ────────────────────────────────────────────────
// Each is a separate counter, so using one endpoint doesn't use up another's allowance.
export const limiters = {
  // A safety net for everything: far above normal use, but stops a runaway script.
  global: rateLimit({ name: "global", limit: 300, windowSec: 60 }),

  // Login and sign-up are what attackers target (password guessing, fake accounts),
  // so they are strict: 10 attempts per 15 minutes per IP address.
  auth: rateLimit({ name: "auth", limit: 10, windowSec: 15 * 60 }),

  // Public and runs several database queries, so cap how fast one visitor can ask.
  availability: rateLimit({ name: "availability", limit: 60, windowSec: 60 }),

  // Counted per SIGNED-IN USER, not per IP, so people sharing an office or phone
  // network aren't blocked by each other. Runs after requireAuth, which sets req.user.
  booking: rateLimit({ name: "booking", limit: 20, windowSec: 10 * 60, key: (req) => req.user?.id }),
};
