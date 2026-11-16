import { describe, expect, it } from "vitest";
import { planNotifications } from "./notifications.plan.js";

const now = new Date("2026-12-01T10:00:00Z");
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000);

describe("planNotifications", () => {
  it("plans a confirmation now and both reminders for a booking days away", () => {
    const startsAt = hours(72);

    expect(planNotifications(startsAt, now)).toEqual([
      { type: "confirmation", sendAt: now },
      { type: "reminder_24h", sendAt: hours(48) },
      { type: "reminder_1h", sendAt: hours(71) },
    ]);
  });

  it("skips the 24-hour reminder when the booking is less than a day away", () => {
    const types = planNotifications(hours(3), now).map((p) => p.type);
    expect(types).toEqual(["confirmation", "reminder_1h"]);
  });

  it("sends only the confirmation when the booking is less than an hour away", () => {
    const types = planNotifications(hours(0.5), now).map((p) => p.type);
    expect(types).toEqual(["confirmation"]);
  });

  it("skips a reminder whose moment is exactly now", () => {
    // 24 hours ahead: the 24h reminder would be due right now, which is not in the future.
    const types = planNotifications(hours(24), now).map((p) => p.type);
    expect(types).toEqual(["confirmation", "reminder_1h"]);
  });
});
