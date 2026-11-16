import { describe, expect, it } from "vitest";
import { checkStatusChange } from "./bookings.rules.js";

const now = new Date("2026-12-05T10:00:00Z");
const past = new Date("2026-12-05T09:00:00Z");
const future = new Date("2026-12-05T11:00:00Z");

describe("checkStatusChange", () => {
  it("allows cancelling an active booking, before or after it starts", () => {
    expect(checkStatusChange("confirmed", "cancelled", future, now)).toBeNull();
    expect(checkStatusChange("confirmed", "cancelled", past, now)).toBeNull();
    expect(checkStatusChange("pending", "cancelled", future, now)).toBeNull();
  });

  it("allows completed and no_show only once the booking has started", () => {
    expect(checkStatusChange("confirmed", "completed", past, now)).toBeNull();
    expect(checkStatusChange("confirmed", "no_show", past, now)).toBeNull();
    expect(checkStatusChange("confirmed", "completed", future, now)).toBe("This booking hasn't started yet");
    expect(checkStatusChange("confirmed", "no_show", future, now)).toBe("This booking hasn't started yet");
  });

  it("treats cancelled, completed and no_show as final", () => {
    for (const from of ["cancelled", "completed", "no_show"] as const) {
      for (const to of ["pending", "confirmed", "cancelled", "completed", "no_show"] as const) {
        expect(checkStatusChange(from, to, past, now)).not.toBeNull();
      }
    }
  });

  it("does not allow a pending booking to skip straight to completed", () => {
    expect(checkStatusChange("pending", "completed", past, now)).toBe("A pending booking can't be changed to completed");
  });
});
