import { Redis } from "ioredis";
import { env } from "./env.js";

// Three kinds of Redis connection, because each job wants different behaviour
// when Redis is slow or down:
//
//  "producer"  the web server adding queue jobs. If Redis is down we want an
//              IMMEDIATE error (so a booking request isn't left hanging), so we
//              turn off the offline queue, which would otherwise hold commands
//              until Redis comes back.
//
//  "worker"    the background loop that waits for jobs. It must wait forever and
//              reconnect by itself, so retries are unlimited (null).
//
//  "limiter"   the rate limiter, which runs on EVERY request. It may wait a moment
//              for the first connection, but never more than 250 ms per command:
//              a slow Redis must not make the whole API slow.
export function createRedisConnection(role: "producer" | "worker" | "limiter") {
  if (role === "worker") return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  if (role === "limiter") return new Redis(env.REDIS_URL, { commandTimeout: 250, maxRetriesPerRequest: 1 });
  return new Redis(env.REDIS_URL, { enableOfflineQueue: false });
}

// One shared connection for the rate limiter, created on first use.
let limiterConnection: Redis | undefined;

export function getLimiterRedis(): Redis {
  limiterConnection ??= createRedisConnection("limiter");
  return limiterConnection;
}

export async function closeLimiterRedis(): Promise<void> {
  limiterConnection?.disconnect();
  limiterConnection = undefined;
}
