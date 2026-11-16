import { describe, expect, it } from "vitest";
import { formatPercent, labelStride, niceMax } from "./chart";
import { formatRange, matchPreset, presetRange, rangeDays, validateRange } from "./ranges";

describe("presetRange", () => {
  const today = "2026-11-16"; // a Monday

  it("covers the last 7 days, today included", () => {
    expect(presetRange("7d", today)).toEqual({ from: "2026-11-10", to: "2026-11-16" });
    expect(rangeDays("2026-11-10", "2026-11-16")).toBe(7);
  });

  it("covers the last 30 days, today included", () => {
    expect(presetRange("30d", today)).toEqual({ from: "2026-10-18", to: "2026-11-16" });
    expect(rangeDays("2026-10-18", "2026-11-16")).toBe(30);
  });

  it("covers this month so far", () => {
    expect(presetRange("this-month", today)).toEqual({ from: "2026-11-01", to: "2026-11-16" });
  });

  it("covers all of last month, whatever its length", () => {
    expect(presetRange("last-month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("last-month", "2027-03-10")).toEqual({ from: "2027-02-01", to: "2027-02-28" }); // a short month
    expect(presetRange("last-month", "2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" }); // across New Year
  });
});

describe("validateRange", () => {
  it("accepts a normal range, including a single day", () => {
    expect(validateRange("2026-11-01", "2026-11-16")).toBeNull();
    expect(validateRange("2026-11-16", "2026-11-16")).toBeNull();
  });

  it("accepts exactly 92 days and refuses 93", () => {
    expect(validateRange("2026-01-01", "2026-04-02")).toBeNull(); // 92 days
    expect(validateRange("2026-01-01", "2026-04-03")).toMatch(/at most 92 days/); // 93 days
  });

  it("refuses an end before the start, and missing or impossible dates", () => {
    expect(validateRange("2026-11-16", "2026-11-01")).toMatch(/can't be before/);
    expect(validateRange("", "2026-11-01")).toMatch(/Choose a start/);
    expect(validateRange("2026-02-30", "2026-03-05")).toMatch(/Choose a start/);
  });
});

describe("matchPreset", () => {
  it("recognises a preset's exact range, and nothing else", () => {
    const today = "2026-11-16";
    expect(matchPreset("2026-10-18", "2026-11-16", today)).toBe("30d");
    expect(matchPreset("2026-10-01", "2026-10-31", today)).toBe("last-month");
    expect(matchPreset("2026-10-19", "2026-11-16", today)).toBeNull(); // one day off
  });
});

describe("formatRange", () => {
  it("writes the range the way people say it", () => {
    expect(formatRange("2026-10-18", "2026-11-16")).toBe("18 Oct to 16 Nov 2026");
    expect(formatRange("2026-12-20", "2027-01-10")).toBe("20 Dec 2026 to 10 Jan 2027");
  });
});

describe("niceMax", () => {
  it("never shrinks the axis below 4", () => {
    expect([0, 1, 4].map(niceMax)).toEqual([4, 4, 4]);
  });

  it("rounds up to a number that reads well", () => {
    expect([5, 8, 9, 12, 20, 21, 100, 101].map(niceMax)).toEqual([8, 8, 10, 20, 20, 30, 100, 200]);
  });

  it("is always at least as tall as the biggest bar", () => {
    for (let n = 0; n <= 300; n++) expect(niceMax(n)).toBeGreaterThanOrEqual(n);
  });
});

describe("labelStride", () => {
  it("shows about seven labels however long the range", () => {
    expect([7, 14, 30, 92].map(labelStride)).toEqual([1, 2, 5, 14]);
    expect(Math.ceil(30 / labelStride(30))).toBeLessThanOrEqual(7);
  });
});

describe("formatPercent", () => {
  it("shows a rate as a percentage, with a decimal only when needed", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.094)).toBe("9.4%");
  });
});
