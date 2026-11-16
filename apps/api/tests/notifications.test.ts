import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { outbox } from "../src/lib/mailer.js";
import { closeQueue, getQueue } from "../src/modules/notifications/notifications.queue.js";
import { processNotification } from "../src/modules/notifications/notifications.service.js";
import { startReminderWorker } from "../src/modules/notifications/notifications.worker.js";
import { resetDb } from "./helpers/db.js";
import { createOwner } from "./helpers/factory.js";
import { addStaff, at, atISO, setupSalon, type Salon } from "./helpers/salon.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
  await getQueue().obliterate({ force: true }); // an empty queue for every test
  outbox.length = 0; // and an empty "inbox"
});

afterAll(async () => {
  await closeQueue();
});

async function createCustomer() {
  const { auth } = await createOwner(app);
  const me = await request(app).get("/auth/me").set(auth);
  return { auth, email: me.body.user.email as string };
}

async function book(salon: Salon, auth: { Authorization: string }, clock: string) {
  const res = await request(app).post(`/b/${salon.slug}/bookings`).set(auth).send({ serviceId: salon.serviceId, startsAt: atISO(clock) });
  return res.body.booking as { id: string };
}

// All notifications of a booking, as { type: status }.
async function notificationsOf(bookingId: string) {
  const rows = await prisma.notification.findMany({ where: { bookingId }, orderBy: { sendAt: "asc" } });
  return rows;
}

describe("scheduling", () => {
  it("queues a confirmation and both reminders when a booking is made", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();

    const booking = await book(salon, customer.auth, "09:30");
    const rows = await notificationsOf(booking.id);

    expect(rows.map((r) => r.type)).toEqual(["confirmation", "reminder_24h", "reminder_1h"]);
    expect(rows.every((r) => r.status === "scheduled" && r.channel === "email")).toBe(true);
    // The reminders are due exactly 24 hours and 1 hour before the appointment.
    expect(rows[1]!.sendAt.toISOString()).toBe(new Date(at("09:30").getTime() - 24 * 3600_000).toISOString());
    expect(rows[2]!.sendAt.toISOString()).toBe(new Date(at("09:30").getTime() - 3600_000).toISOString());
  });

  it("puts a job in the queue for each notification, waiting until it is due", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();

    const booking = await book(salon, customer.auth, "09:30");
    const rows = await notificationsOf(booking.id);

    // The job id is the notification id, so we can look each one up directly.
    const states = await Promise.all(rows.map(async (r) => (await getQueue().getJob(r.id))?.getState()));
    expect(states[0]).toMatch(/waiting|active|completed/); // the confirmation is due now
    expect(states[1]).toBe("delayed"); // the 24h reminder is days away
    expect(states[2]).toBe("delayed");
  });
});

describe("cancelling", () => {
  it("stops the reminders, removes their jobs, and queues a cancellation email", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:30");
    const before = await notificationsOf(booking.id);

    await request(app).post(`/me/bookings/${booking.id}/cancel`).set(customer.auth);

    const after = await notificationsOf(booking.id);
    const byType = Object.fromEntries(after.map((r) => [r.type, r.status]));
    expect(byType).toMatchObject({ reminder_24h: "cancelled", reminder_1h: "cancelled", cancellation: "scheduled" });
    // The two reminder jobs are gone from Redis.
    expect(await getQueue().getJob(before[1]!.id)).toBeUndefined();
    expect(await getQueue().getJob(before[2]!.id)).toBeUndefined();
  });

  it("does the same when the owner cancels", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:30");

    await request(app).patch(`/businesses/${salon.businessId}/bookings/${booking.id}/status`).set(salon.auth).send({ status: "cancelled" });

    const types = (await notificationsOf(booking.id)).filter((r) => r.status === "scheduled").map((r) => r.type);
    expect(types).toEqual(["cancellation"]);
  });
});

describe("rescheduling", () => {
  it("replaces the old reminders with ones for the new time", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:00");

    await request(app).post(`/me/bookings/${booking.id}/reschedule`).set(customer.auth).send({ startsAt: atISO("10:30") });

    const live = (await notificationsOf(booking.id)).filter((r) => r.status === "scheduled");
    expect(live.map((r) => r.type).sort()).toEqual(["confirmation", "reminder_1h", "reminder_24h"]);
    const oneHour = live.find((r) => r.type === "reminder_1h")!;
    expect(oneHour.sendAt.toISOString()).toBe(new Date(at("10:30").getTime() - 3600_000).toISOString()); // the NEW time, not 09:00
  });
});

describe("processNotification (what the worker does)", () => {
  it("sends the email once, in the salon's timezone, and marks it sent", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:30");
    const confirmation = (await notificationsOf(booking.id)).find((r) => r.type === "confirmation")!;

    const first = await processNotification(confirmation.id);
    const second = await processNotification(confirmation.id); // e.g. the queue retried

    expect([first, second]).toEqual(["sent", "skipped"]);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: customer.email });
    expect(outbox[0]!.subject).toContain("Booking confirmed");
    expect(outbox[0]!.text).toContain("at 09:30"); // 09:30 in the salon, not 04:00 UTC
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: confirmation.id } });
    expect(row.status).toBe("sent");
    expect(row.sentAt).not.toBeNull();
  });

  it("sends nothing for a booking that is no longer active", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:30");
    const reminder = (await notificationsOf(booking.id)).find((r) => r.type === "reminder_1h")!;
    // Simulate "the job was not removed in time": cancel the booking behind the queue's back.
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "cancelled" } });

    const result = await processNotification(reminder.id);

    expect(result).toBe("skipped");
    expect(outbox).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: reminder.id } })).status).toBe("cancelled");
  });

  it("still sends the cancellation email for a cancelled booking", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const booking = await book(salon, customer.auth, "09:30");
    await request(app).post(`/me/bookings/${booking.id}/cancel`).set(customer.auth);
    const cancellation = (await notificationsOf(booking.id)).find((r) => r.type === "cancellation")!;

    expect(await processNotification(cancellation.id)).toBe("sent");
    expect(outbox[0]!.subject).toContain("cancelled");
  });

  it("does nothing for a notification that no longer exists", async () => {
    expect(await processNotification("00000000-0000-4000-8000-000000000000")).toBe("missing");
  });
});

describe("the real worker", () => {
  it("sends the confirmation email by itself, shortly after booking", async () => {
    const salon = await setupSalon(app);
    await addStaff(app, salon, "Priya", "09:00", "11:00");
    const customer = await createCustomer();
    const worker = startReminderWorker(); // a running worker, like in the real server

    try {
      await book(salon, customer.auth, "09:30");

      // Poll for up to 10 seconds: the worker runs in the background, so the email arrives a moment later.
      const deadline = Date.now() + 10_000;
      while (outbox.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

      expect(outbox).toHaveLength(1);
      expect(outbox[0]!.subject).toContain("Booking confirmed");
      // The reminders are days away, so they must NOT have gone out yet.
      await new Promise((r) => setTimeout(r, 500));
      expect(outbox).toHaveLength(1);
    } finally {
      await worker.close();
    }
  }, 30_000);
});
