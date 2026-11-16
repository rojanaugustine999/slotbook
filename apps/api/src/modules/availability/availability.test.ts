import { describe, expect, it } from "vitest";
import { getAvailableSlots, overlaps, subtract, toRange, type AvailabilityInput, type TimeRange } from "./availability.js";

// ─── HELPER 1: overlaps ──────────────────────────────────────────────────────
// A short way to write a time range on 5 Dec 2026 (UTC), e.g. range("10:00", "11:00").
const range = (start: string, end: string): TimeRange => ({
  startsAt: new Date(`2026-12-05T${start}:00Z`),
  endsAt: new Date(`2026-12-05T${end}:00Z`),
});

describe("overlaps", () => {
  it("is true when one range starts inside the other", () => {
    expect(overlaps(range("10:00", "11:00"), range("10:30", "11:30"))).toBe(true);
  });

  it("is true when one range is completely inside the other", () => {
    expect(overlaps(range("09:00", "17:00"), range("12:00", "13:00"))).toBe(true);
  });

  it("is true for two identical ranges", () => {
    expect(overlaps(range("10:00", "11:00"), range("10:00", "11:00"))).toBe(true);
  });

  it("is false when the ranges are apart", () => {
    expect(overlaps(range("09:00", "10:00"), range("14:00", "15:00"))).toBe(false);
  });

  it("is false when they only touch (one ends exactly when the other starts)", () => {
    expect(overlaps(range("10:00", "11:00"), range("11:00", "12:00"))).toBe(false);
  });

  it("gives the same answer whichever range comes first", () => {
    expect(overlaps(range("10:30", "11:30"), range("10:00", "11:00"))).toBe(true);
    expect(overlaps(range("11:00", "12:00"), range("10:00", "11:00"))).toBe(false);
  });
});

// ─── HELPER 2: subtract ──────────────────────────────────────────────────────
describe("subtract", () => {
  const day = [range("09:00", "17:00")];

  it("splits a range in two when the block is in the middle", () => {
    expect(subtract(day, range("12:00", "13:00"))).toEqual([range("09:00", "12:00"), range("13:00", "17:00")]);
  });

  it("trims the start when the block covers the beginning", () => {
    expect(subtract(day, range("08:00", "10:00"))).toEqual([range("10:00", "17:00")]);
  });

  it("trims the end when the block covers the end", () => {
    expect(subtract(day, range("16:00", "18:00"))).toEqual([range("09:00", "16:00")]);
  });

  it("removes the range when the block covers all of it", () => {
    expect(subtract(day, range("08:00", "18:00"))).toEqual([]);
  });

  it("changes nothing when the block is outside the range", () => {
    expect(subtract(day, range("18:00", "19:00"))).toEqual(day);
  });

  it("only touches the range the block overlaps", () => {
    const splitShift = [range("09:00", "13:00"), range("14:00", "18:00")];
    expect(subtract(splitShift, range("15:00", "16:00"))).toEqual([
      range("09:00", "13:00"),
      range("14:00", "15:00"),
      range("16:00", "18:00"),
    ]);
  });
});

// ─── HELPER 3: toRange ───────────────────────────────────────────────────────
describe("toRange", () => {
  it("turns local clock times into real moments (India is UTC+05:30)", () => {
    const r = toRange("2026-12-05", "Asia/Kolkata", 9 * 60, 13 * 60);
    expect(r.startsAt.toISOString()).toBe("2026-12-05T03:30:00.000Z");
    expect(r.endsAt.toISOString()).toBe("2026-12-05T07:30:00.000Z");
  });

  it("treats 24:00 as midnight at the start of the next day", () => {
    const r = toRange("2026-12-05", "Asia/Kolkata", 22 * 60, 24 * 60);
    expect(r.endsAt.toISOString()).toBe("2026-12-05T18:30:00.000Z"); // 00:00 on 6 Dec in India
  });

  it("uses the right offset on each side of a clock change", () => {
    // London: GMT (UTC+0) on 27 March 2027, BST (UTC+1) from 28 March 2027.
    const before = toRange("2027-03-27", "Europe/London", 9 * 60, 10 * 60);
    const after = toRange("2027-03-28", "Europe/London", 9 * 60, 10 * 60);
    expect(before.startsAt.toISOString()).toBe("2027-03-27T09:00:00.000Z");
    expect(after.startsAt.toISOString()).toBe("2027-03-28T08:00:00.000Z");
  });

  it("refuses a date or timezone that doesn't exist", () => {
    expect(() => toRange("2026-02-30", "Asia/Kolkata", 540, 600)).toThrow();
    expect(() => toRange("2026-12-05", "Mars/Olympus", 540, 600)).toThrow();
  });
});

// ─── The full function ───────────────────────────────────────────────────────

const utc = (iso: string) => new Date(iso);

// Saturday 5 Dec 2026 in India (UTC+05:30, no daylight saving).
// 09:00 IST = 03:30Z, 11:00 IST = 05:30Z.
const base: AvailabilityInput = {
  date: "2026-12-05",
  timezone: "Asia/Kolkata",
  now: utc("2026-12-01T00:00:00Z"),
  service: { durationMin: 30, bufferMin: 0 },
  workingHours: [{ startMinute: 9 * 60, endMinute: 11 * 60 }], // 09:00–11:00
  timeOff: [],
  bookings: [],
  minNoticeMinutes: 0,
  stepMinutes: 15,
};

describe("getAvailableSlots", () => {
  it("offers every 15-minute start that fits in an empty day", () => {
    expect(getAvailableSlots(base)).toEqual(["09:00", "09:15", "09:30", "09:45", "10:00", "10:15", "10:30"]);
  });

  it("removes slots that overlap an existing booking", () => {
    const slots = getAvailableSlots({
      ...base,
      bookings: [{ startsAt: utc("2026-12-05T04:00:00Z"), endsAt: utc("2026-12-05T04:30:00Z") }], // 09:30–10:00 IST
    });
    expect(slots).toEqual(["09:00", "10:00", "10:15", "10:30"]);
  });

  it("returns nothing when the gaps are shorter than the service", () => {
    const slots = getAvailableSlots({
      ...base,
      bookings: [{ startsAt: utc("2026-12-05T03:50:00Z"), endsAt: utc("2026-12-05T05:20:00Z") }], // 09:20–10:50 IST
    });
    expect(slots).toEqual([]);
  });

  it("counts the buffer as part of the slot length", () => {
    const slots = getAvailableSlots({
      ...base,
      service: { durationMin: 30, bufferMin: 15 },
      workingHours: [{ startMinute: 9 * 60, endMinute: 10 * 60 }], // 09:00–10:00
    });
    expect(slots).toEqual(["09:00", "09:15"]);
  });

  it("hides slots in the past and inside the minimum notice window", () => {
    const slots = getAvailableSlots({
      ...base,
      now: utc("2026-12-05T04:10:00Z"), // 09:40 IST
      minNoticeMinutes: 30, // so earliest start is 10:10
    });
    expect(slots).toEqual(["10:15", "10:30"]);
  });

  it("returns nothing when time off covers the whole day", () => {
    const slots = getAvailableSlots({
      ...base,
      timeOff: [{ startsAt: utc("2026-12-04T18:30:00Z"), endsAt: utc("2026-12-05T18:30:00Z") }],
    });
    expect(slots).toEqual([]);
  });

  it("supports split shifts (lunch break)", () => {
    const slots = getAvailableSlots({
      ...base,
      service: { durationMin: 60, bufferMin: 0 },
      workingHours: [
        { startMinute: 9 * 60, endMinute: 12 * 60 }, // 09:00–12:00
        { startMinute: 13 * 60, endMinute: 14 * 60 }, // 13:00–14:00
      ],
      stepMinutes: 30,
    });
    expect(slots).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "13:00"]);
  });

  it("uses the correct UTC offset on a daylight-saving day", () => {
    // UK clocks jump from 01:00 GMT to 02:00 BST on Sunday 28 March 2027.
    // From then on, 09:00 London time is 08:00Z, not 09:00Z.
    const slots = getAvailableSlots({
      ...base,
      date: "2027-03-28",
      timezone: "Europe/London",
      now: utc("2027-03-01T00:00:00Z"),
      workingHours: [{ startMinute: 9 * 60, endMinute: 10 * 60 }],
      bookings: [{ startsAt: utc("2027-03-28T08:00:00Z"), endsAt: utc("2027-03-28T08:30:00Z") }], // 09:00–09:30 BST
    });
    expect(slots).toEqual(["09:30"]);
  });
});
