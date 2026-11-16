import { describe, expect, it } from "vitest";
import { getAvailableSlots, type AvailabilityInput } from "./availability.js";

// WEEK 4: delete ".skip" below, then make these tests pass one at a time:
//   npm run test:watch
// Add your own cases too. Good tests are the best proof the algorithm works.

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

describe.skip("getAvailableSlots (Week 4: remove .skip to start)", () => {
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
