import { describe, expect, it } from "vitest";
import { formatTimeOff, timeOffMoments } from "./timeOff";

const TZ = "Asia/Kolkata";
const form = { fromDate: "2026-12-05", untilDate: "2026-12-07", wholeDays: true, fromTime: "09:00", untilTime: "18:00" };

describe("timeOffMoments", () => {
  it("covers whole days on the salon's clock, through midnight after the last day", () => {
    expect(timeOffMoments(form, TZ)).toEqual({ startsAt: "2026-12-05T00:00:00.000+05:30", endsAt: "2026-12-08T00:00:00.000+05:30" });
  });

  it("uses the salon's timezone, not the laptop's", () => {
    // The same form for a London salon gives different exact moments.
    expect(timeOffMoments(form, "Europe/London")).toEqual({ startsAt: "2026-12-05T00:00:00.000+00:00", endsAt: "2026-12-08T00:00:00.000+00:00" });
  });

  it("uses the times when it isn't whole days", () => {
    const result = timeOffMoments({ ...form, untilDate: "2026-12-05", wholeDays: false, fromTime: "14:00", untilTime: "18:00" }, TZ);
    expect(result).toEqual({ startsAt: "2026-12-05T14:00:00.000+05:30", endsAt: "2026-12-05T18:00:00.000+05:30" });
  });

  it("explains a backwards range", () => {
    expect(timeOffMoments({ ...form, untilDate: "2026-12-04" }, TZ)).toEqual({ problem: "The last day can't be before the first." });
    expect(timeOffMoments({ ...form, untilDate: "2026-12-05", wholeDays: false, fromTime: "18:00", untilTime: "14:00" }, TZ)).toHaveProperty("problem");
  });
});

describe("formatTimeOff", () => {
  it("shows whole days as a day range, ending on the last day itself", () => {
    expect(formatTimeOff("2026-12-04T18:30:00Z", "2026-12-07T18:30:00Z", TZ)).toBe("Sat 5 Dec – Mon 7 Dec");
    expect(formatTimeOff("2026-12-04T18:30:00Z", "2026-12-05T18:30:00Z", TZ)).toBe("Sat 5 Dec");
  });

  it("shows part of a day with times", () => {
    expect(formatTimeOff("2026-12-05T08:30:00Z", "2026-12-05T12:30:00Z", TZ)).toBe("Sat 5 Dec, 2:00 pm – 6:00 pm");
  });
});
