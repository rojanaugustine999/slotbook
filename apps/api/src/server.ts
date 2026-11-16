import { createApp } from "./app.js";
import { prisma } from "./lib/db.js";
import { env } from "./lib/env.js";
import { closeQueue } from "./modules/notifications/notifications.queue.js";
import { startReminderWorker } from "./modules/notifications/notifications.worker.js";

const server = createApp().listen(env.PORT, () => {
  console.log(`SlotBook API running on http://localhost:${env.PORT}`);
});

// The background worker that sends confirmations and reminders when they are due.
const worker = startReminderWorker();

// Graceful shutdown: finish in-flight requests, then close DB connections.
// Hosting platforms send SIGTERM when they redeploy your app.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close(async () => {
    await worker.close(); // let a job that is mid-send finish
    await closeQueue();
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
