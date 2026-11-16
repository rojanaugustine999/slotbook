import { describe, expect, it } from "vitest";
import { calendarHours, layoutDay } from "./layout";

// A booking is just a name and a time range, written in hours for readability.
type B = { name: string; from: number; to: number };
const b = (name: string, from: number, to: number): B => ({ name, from, to });
const place = (items: B[]) => layoutDay(items, (x) => ({ startMin: x.from * 60, endMin: x.to * 60 }));
const summary = (items: B[]) => place(items).map((p) => `${p.item.name}:${p.lane}/${p.lanes}`);

describe("layoutDay", () => {
  it("gives a lone booking the whole width", () => {
    expect(summary([b("A", 9, 10)])).toEqual(["A:0/1"]);
  });

  it("puts two overlapping bookings side by side", () => {
    expect(summary([b("A", 10, 11), b("B", 10, 12)])).toEqual(["A:0/2", "B:1/2"]);
  });

  it("does not treat back-to-back bookings as overlapping", () => {
    // 10 to 11, then 11 to 12: they touch but don't share any time.
    expect(summary([b("A", 10, 11), b("B", 11, 12)])).toEqual(["A:0/1", "B:0/1"]);
  });

  it("keeps separate clusters at their own width", () => {
    expect(summary([b("A", 9, 10), b("B", 9, 10), b("C", 14, 15)])).toEqual(["A:0/2", "B:1/2", "C:0/1"]);
  });

  it("reuses a lane once it is free again inside one cluster", () => {
    // A 9-11 and B 10-12 overlap, and C 11-13 overlaps B but not A: C takes A's lane back.
    expect(summary([b("A", 9, 11), b("B", 10, 12), b("C", 11, 13)])).toEqual(["A:0/2", "B:1/2", "C:0/2"]);
  });

  it("opens a third lane when three bookings overlap at once", () => {
    expect(summary([b("A", 10, 12), b("B", 10, 12), b("C", 10, 12)])).toEqual(["A:0/3", "B:1/3", "C:2/3"]);
  });

  it("doesn't depend on the order it is given the bookings in", () => {
    expect(summary([b("C", 11, 13), b("A", 9, 11), b("B", 10, 12)])).toEqual(["A:0/2", "B:1/2", "C:0/2"]);
  });

  it("returns nothing for an empty day", () => {
    expect(place([])).toEqual([]);
  });
});

describe("calendarHours", () => {
  it("shows 9 to 18 when everything fits inside", () => {
    expect(calendarHours([{ startMin: 10 * 60, endMin: 11 * 60 }])).toEqual({ startHour: 9, endHour: 18 });
  });

  it("shows 9 to 18 for an empty week", () => {
    expect(calendarHours([])).toEqual({ startHour: 9, endHour: 18 });
  });

  it("stretches to include an early or late booking", () => {
    expect(calendarHours([{ startMin: 7 * 60 + 30, endMin: 8 * 60 }, { startMin: 18 * 60, endMin: 19 * 60 + 10 }])).toEqual({ startHour: 7, endHour: 20 });
  });
});
