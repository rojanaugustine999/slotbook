import { Worker } from "bullmq";
import { env } from "../../lib/env.js";
import { logger } from "../../lib/logger.js";
import { createRedisConnection } from "../../lib/redis.js";
import { processRefund, REFUND_JOB } from "../payments/payments.refunds.js";
import { processHoldRelease, RELEASE_HOLD_JOB } from "../payments/payments.service.js";
import { processNotification } from "./notifications.service.js";
import { QUEUE_NAME } from "./notifications.queue.js";

// The worker is a loop that waits for due jobs and hands each one to
// processNotification. It is deliberately thin: all the real logic lives in
// notifications.service.ts, where it is easy to test.
//
// Right now it runs inside the same process as the web server (see server.ts).
// Later it can move to its own process or machine without changing this code,
// because the two sides only talk through Redis.
export function startReminderWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // The same queue also carries "release this unpaid hold" jobs (see payments.service.ts).
      if (job.name === RELEASE_HOLD_JOB) {
        await processHoldRelease(job.data.bookingId);
        return;
      }
      // ...and "send this refund to Razorpay" jobs (see payments.refunds.ts).
      if (job.name === REFUND_JOB) {
        await processRefund(job.data.refundId);
        return;
      }
      await processNotification(job.data.notificationId);
    },
    { connection: createRedisConnection("worker"), prefix: env.QUEUE_PREFIX, concurrency: 5 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id, attempt: job?.attemptsMade }, "notification job failed");
  });

  return worker;
}
