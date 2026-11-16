import { Queue } from "bullmq";
import { env } from "../../lib/env.js";
import { createRedisConnection } from "../../lib/redis.js";

// ─── What a queue is ─────────────────────────────────────────────────────────
// A queue is a to-do list that lives in Redis, outside your web server.
// The web server ADDS jobs ("send this email at 09:30 tomorrow") and a separate
// worker loop TAKES jobs when they are due. Because the list is in Redis and not
// in the server's memory, scheduled reminders survive a server restart.
// ──────────────────────────────────────────────────────────────────────────────

export const QUEUE_NAME = "notifications";

let queue: Queue | undefined;

// Created on first use, so code that never schedules anything never opens a connection.
export function getQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: createRedisConnection("producer"), prefix: env.QUEUE_PREFIX });
  return queue;
}

// Adds one job that becomes due at `sendAt`.
// The job id is the notification's own id. That gives us two things for free:
//   - adding the same notification twice can't create two jobs
//   - we can find and remove the job later, when a booking is cancelled
export async function enqueueNotification(notificationId: string, sendAt: Date): Promise<void> {
  await getQueue().add(
    "send",
    { notificationId },
    {
      jobId: notificationId,
      delay: Math.max(0, sendAt.getTime() - Date.now()), // milliseconds until it is due
      attempts: 5, // if sending fails, try again...
      backoff: { type: "exponential", delay: 10_000 }, // ...after 10s, 20s, 40s, 80s
      removeOnComplete: true,
      removeOnFail: 200, // keep the last 200 failures so you can inspect them
    },
  );
}

export async function removeQueuedNotification(notificationId: string): Promise<void> {
  await getQueue().remove(notificationId);
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
