import { describe, expect, it } from "vitest";
import { dayProblem, fromWeek, nextRange, summarizeWeek, timeLabel, timeOptions, toWeek } from "./hours";

describe("toWeek / fromWeek", () => {
  it("groups the API's list by day, sorted, and turns it back", () => {
    const api = [
      { weekday: 1, start: "14:00", end: "18:00" },
      { weekday: 1, start: "09:00", end: "13:00" },
      { weekday: 6, start: "10:00", end: "14:00" },
    ];
    const week = toWeek(api);
    expect(week[1]).toEqual([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }]);
    expect(week[7]).toEqual([]);
    expect(fromWeek(week)).toEqual([
      { weekday: 1, start: "09:00", end: "13:00" },
      { weekday: 1, start: "14:00", end: "18:00" },
      { weekday: 6, start: "10:00", end: "14:00" },
    ]);
  });
});

describe("dayProblem", () => {
  it("accepts a split shift with a lunch break", () => {
    expect(dayProblem([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }])).toBeNull();
  });

  it("accepts blocks that touch, and an end at midnight", () => {
    expect(dayProblem([{ start: "09:00", end: "13:00" }, { start: "13:00", end: "24:00" }])).toBeNull();
  });

  it("catches an end before the start", () => {
    expect(dayProblem([{ start: "18:00", end: "09:00" }])).toMatch(/after its opening/);
  });

  it("catches overlaps whatever order they were added in", () => {
    expect(dayProblem([{ start: "12:00", end: "18:00" }, { start: "09:00", end: "13:00" }])).toMatch(/overlap/);
  });
});

describe("nextRange", () => {
  it("starts a closed day at 9 to 6", () => {
    expect(nextRange([])).toEqual({ start: "09:00", end: "18:00" });
  });

  it("leaves an hour after the last block, for lunch", () => {
    expect(nextRange([{ start: "09:00", end: "13:00" }])).toEqual({ start: "14:00", end: "18:00" });
  });

  it("stops at midnight", () => {
    expect(nextRange([{ start: "09:00", end: "21:30" }])).toEqual({ start: "22:30", end: "24:00" });
    expect(nextRange([{ start: "09:00", end: "23:30" }])).toBeNull();
  });
});

describe("times", () => {
  it("offers 15-minute steps, with midnight only as an end", () => {
    expect(timeOptions("start").at(-1)).toBe("23:45");
    expect(timeOptions("end").at(-1)).toBe("24:00");
    expect(timeOptions("start")).toHaveLength(96);
  });

  it("labels times the way people say them", () => {
    expect(timeLabel("09:00")).toBe("9:00 am");
    expect(timeLabel("13:30")).toBe("1:30 pm");
    expect(timeLabel("24:00")).toBe("midnight");
  });
});

describe("summarizeWeek", () => {
  it("groups neighbouring days with the same hours", () => {
    const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" }));
    const week = toWeek([...weekdays, { weekday: 6, start: "10:00", end: "14:00" }]);
    expect(summarizeWeek(week)).toBe("Mon–Fri 9:00 am–6:00 pm · Sat 10:00 am–2:00 pm");
  });

  it("says when nothing is set", () => {
    expect(summarizeWeek(toWeek([]))).toBe("No hours set");
  });
});
