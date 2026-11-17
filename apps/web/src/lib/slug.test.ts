import { describe, expect, it } from "vitest";
import { slugify, slugProblem } from "./slug";

describe("slugify", () => {
  it("turns a salon name into a web address", () => {
    expect(slugify("Glow Salon")).toBe("glow-salon");
    expect(slugify("  Glow Salon & Spa!  ")).toBe("glow-salon-spa");
    expect(slugify("Priya's Hair Studio")).toBe("priya-s-hair-studio");
  });

  it("drops accents instead of the whole letter", () => {
    expect(slugify("Café Beauté")).toBe("cafe-beaute");
  });

  it("never ends with a dash, even when cut to 50 characters", () => {
    const slug = slugify(`${"a".repeat(49)} b`);
    expect(slug).toBe("a".repeat(49));
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("gives an empty string for a name with no letters or numbers", () => {
    expect(slugify("✨✨")).toBe("");
  });
});

describe("slugProblem", () => {
  it("accepts a good address", () => {
    expect(slugProblem("glow-salon")).toBeNull();
  });

  it("explains what is wrong", () => {
    expect(slugProblem("gs")).toMatch(/at least 3/);
    expect(slugProblem("glow--salon")).toMatch(/single dashes/);
    expect(slugProblem("Glow")).toMatch(/lowercase/);
  });
});
