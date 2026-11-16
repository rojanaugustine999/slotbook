import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins classes and skips falsy values", () => {
    expect(cn("rounded", false && "hidden", null, undefined, "p-2")).toBe("rounded p-2");
  });

  it("lets a later class override an earlier one that sets the same thing", () => {
    expect(cn("h-11 px-4", "h-10 px-0")).toBe("h-10 px-0");
  });

  it("keeps classes that don't conflict", () => {
    expect(cn("border border-line-strong", "text-ink-2 px-3")).toBe("border border-line-strong text-ink-2 px-3");
  });

  it("does not confuse a font size with a text colour", () => {
    expect(cn("text-[15px] text-ink", "text-ink-2")).toBe("text-[15px] text-ink-2");
  });
});
