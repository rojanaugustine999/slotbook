import { describe, expect, it } from "vitest";
import { buildEmail, type BookingEmailData } from "./notifications.emails.js";

// 09:30 in India is 04:00 UTC. The email must say 09:30, the salon's time.
const data: BookingEmailData = {
  customerName: "Maya",
  serviceName: "Haircut",
  staffName: "Priya",
  businessName: "Glow Salon",
  businessAddress: "MG Road, Kochi",
  startsAt: new Date("2026-12-05T04:00:00Z"),
  timezone: "Asia/Kolkata",
};

describe("buildEmail", () => {
  it("shows the time in the salon's timezone, not UTC", () => {
    const { text } = buildEmail("confirmation", data);

    expect(text).toContain("Saturday 5 December 2026 at 09:30");
    expect(text).not.toContain("04:00");
  });

  it("includes the service, staff member and address", () => {
    const { text } = buildEmail("confirmation", data);

    expect(text).toContain("Service: Haircut");
    expect(text).toContain("With: Priya");
    expect(text).toContain("Where: Glow Salon, MG Road, Kochi");
  });

  it("leaves out the address line text when the salon has none", () => {
    const { text } = buildEmail("confirmation", { ...data, businessAddress: null });

    expect(text).toContain("Where: Glow Salon");
    expect(text).not.toContain("null");
  });

  it("has a distinct subject for each kind", () => {
    const subjects = (["confirmation", "reminder_24h", "reminder_1h", "cancellation"] as const).map((t) => buildEmail(t, data).subject);

    expect(new Set(subjects).size).toBe(4);
    expect(subjects[0]).toContain("confirmed");
    expect(subjects[1]).toContain("Reminder");
    expect(subjects[2]).toContain("09:30");
    expect(subjects[3]).toContain("cancelled");
  });
});
