import { Redis } from "ioredis";
import { env } from "./env.js";

// BullMQ needs two kinds of Redis connection, and they want opposite settings:
//
//  "producer"  the web server adding jobs. If Redis is down we want an
//              IMMEDIATE error (so a booking request isn't left hanging), so we
//              turn off the offline queue, which would otherwise hold commands
//              until Redis comes back.
//
//  "worker"    the background loop that waits for jobs. It must wait forever and
//              reconnect by itself, so retries are unlimited (null).
export function createRedisConnection(role: "producer" | "worker") {
  return new Redis(env.REDIS_URL, role === "worker" ? { maxRetriesPerRequest: null } : { enableOfflineQueue: false });
}
