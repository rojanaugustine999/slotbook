import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { formatClock, formatWhen, isInFuture, partOfDay, toStartsAt, upcomingDays } from "./dates";
import { formatDuration, formatPrice } from "./money";

describe("money", () => {
  it("turns paise into rupees without decimals when there are none", () => {
    expect(formatPrice(50000)).toBe("₹500");
    expect(formatPrice(120000)).toBe("₹1,200");
    expect(formatPrice(0)).toBe("₹0");
  });

  it("keeps real paise", () => {
    expect(formatPrice(19950)).toBe("₹199.50");
  });

  it("writes durations the way people say them", () => {
    expect(formatDuration(20)).toBe("20 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(90)).toBe("1 h 30 min");
  });
});

describe("toStartsAt", () => {
  it("builds the moment in the salon's timezone, with its offset", () => {
    expect(toStartsAt("2026-11-23", "11:00", "Asia/Kolkata")).toBe("2026-11-23T11:00:00.000+05:30");
  });

  it("uses the right offset on each side of a clock change", () => {
    // London switches from winter to summer time on 28 March 2027.
    expect(toStartsAt("2027-03-27", "09:00", "Europe/London")).toBe("2027-03-27T09:00:00.000+00:00");
    expect(toStartsAt("2027-03-28", "09:00", "Europe/London")).toBe("2027-03-28T09:00:00.000+01:00");
  });

  it("refuses a date that doesn't exist", () => {
    expect(() => toStartsAt("2026-02-30", "09:00", "Asia/Kolkata")).toThrow();
  });
});

describe("upcomingDays", () => {
  it("starts with today IN THE SALON, not in the viewer's timezone", () => {
    // 22:00 UTC on 22 November is already 03:30 on 23 November in India.
    const now = DateTime.fromISO("2026-11-22T22:00:00Z");

    const days = upcomingDays("Asia/Kolkata", 3, now);

    expect(days.map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(days[0]).toMatchObject({ weekday: "Mon", day: "23", month: "Nov", isToday: true });
    expect(days[1]!.isToday).toBe(false);
  });
});

describe("clock and day formatting", () => {
  it("shows 12-hour times", () => {
    expect(formatClock("09:00")).toBe("9:00 am");
    expect(formatClock("12:15")).toBe("12:15 pm");
    expect(formatClock("17:45")).toBe("5:45 pm");
  });

  it("shows a stored moment on the salon's wall clock", () => {
    expect(formatWhen("2026-11-23T04:30:00.000Z", "Asia/Kolkata")).toBe("Mon 23 Nov, 10:00 am");
  });

  it("groups times into morning, afternoon and evening", () => {
    expect(partOfDay("09:30")).toBe("Morning");
    expect(partOfDay("12:00")).toBe("Afternoon");
    expect(partOfDay("16:45")).toBe("Afternoon");
    expect(partOfDay("17:00")).toBe("Evening");
  });

  it("tells future from past", () => {
    const now = DateTime.fromISO("2026-11-23T10:00:00Z");
    expect(isInFuture("2026-11-23T11:00:00Z", now)).toBe(true);
    expect(isInFuture("2026-11-23T09:00:00Z", now)).toBe(false);
  });
});

describe("week helpers", () => {
  it("finds the Monday of any week", async () => {
    const { startOfWeek } = await import("./dates");
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23"); // already a Monday
    expect(startOfWeek("2026-11-26")).toBe("2026-11-23"); // a Thursday
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // Sunday belongs to the week before
  });

  it("moves by days across month and year ends", async () => {
    const { shiftDays } = await import("./dates");
    expect(shiftDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDays("2026-11-23", -7)).toBe("2026-11-16");
  });

  it("works out today in the salon, not in the viewer's timezone", async () => {
    const { todayIn } = await import("./dates");
    // 22:00 UTC on 22 November is already the 23rd in India.
    expect(todayIn("Asia/Kolkata", DateTime.fromISO("2026-11-22T22:00:00Z"))).toBe("2026-11-23");
    expect(todayIn("America/Los_Angeles", DateTime.fromISO("2026-11-22T22:00:00Z"))).toBe("2026-11-22");
  });

  it("measures minutes after midnight on the salon's clock", async () => {
    const { minutesOfDay, formatTimeRange } = await import("./dates");
    expect(minutesOfDay("2026-11-23T04:30:00.000Z", "Asia/Kolkata")).toBe(10 * 60); // 10:00 in India
    expect(formatTimeRange("2026-11-23T04:30:00.000Z", "2026-11-23T05:30:00.000Z", "Asia/Kolkata")).toBe("10:00 am to 11:00 am");
  });

  it("writes the week range the way people say it", async () => {
    const { formatWeekRange } = await import("./dates");
    expect(formatWeekRange("2026-11-23")).toBe("23 to 29 Nov 2026");
    expect(formatWeekRange("2026-11-30")).toBe("30 Nov to 6 Dec 2026");
    expect(formatWeekRange("2026-12-28")).toBe("28 Dec 2026 to 3 Jan 2027");
  });

  it("finds the salon's calendar day, not the UTC day", async () => {
    const { localDate } = await import("./dates");
    // 19:00 UTC on 16 November is 00:30 on the 17th in India.
    expect(localDate("2026-11-16T19:00:00.000Z", "Asia/Kolkata")).toBe("2026-11-17");
    expect(localDate("2026-11-16T19:00:00.000Z", "UTC")).toBe("2026-11-16");
  });

  it("labels the hours down the side", async () => {
    const { formatHourLabel } = await import("./dates");
    expect([9, 12, 13, 0].map(formatHourLabel)).toEqual(["9 am", "12 pm", "1 pm", "12 am"]);
  });
});
