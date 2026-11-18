import { describe, expect, it } from "vitest";
import { depositFor, parsePrice, priceInputValue } from "./money";

describe("parsePrice", () => {
  it("reads rupees and paise as whole paise", () => {
    expect(parsePrice("500")).toBe(50000);
    expect(parsePrice("199.5")).toBe(19950); // .5 is 50 paise
    expect(parsePrice("19.99")).toBe(1999); // parseFloat("19.99") * 100 would give 1998.9999999999998
    expect(parsePrice("0")).toBe(0);
  });

  it("accepts the way people write prices", () => {
    expect(parsePrice("₹1,200")).toBe(120000);
    expect(parsePrice(" 2,500.00 ")).toBe(250000);
  });

  it("rejects anything that isn't a price", () => {
    for (const text of ["", "abc", "-100", "12.345", "1e3", "."]) {
      expect(parsePrice(text), text).toBeNull();
    }
  });
});

describe("priceInputValue", () => {
  it("shows paise only when there are some, and round-trips", () => {
    expect(priceInputValue(50000)).toBe("500");
    expect(priceInputValue(120050)).toBe("1200.50");
    expect(priceInputValue(1905)).toBe("19.05");
    for (const paise of [0, 5, 1999, 120050]) expect(parsePrice(priceInputValue(paise))).toBe(paise);
  });
});

// Must give the same numbers as depositFor in the API (tests/payments-flow.test.ts).
describe("depositFor", () => {
  it("takes the percentage, rounded to whole paise", () => {
    expect(depositFor(50_000, 20)).toBe(10_000);
    expect(depositFor(33_333, 10)).toBe(3_333);
  });

  it("is never under ₹1 and never more than the price", () => {
    expect(depositFor(500, 1)).toBe(100);
    expect(depositFor(150, 100)).toBe(150);
  });

  it("is off without a percentage or for services under ₹1", () => {
    expect(depositFor(50_000, null)).toBeNull();
    expect(depositFor(99, 50)).toBeNull();
  });
});
