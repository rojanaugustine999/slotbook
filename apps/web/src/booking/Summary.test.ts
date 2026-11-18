import { describe, expect, it } from "vitest";
import { confirmLabel } from "./Summary";

// The desktop summary and the phone bar both use confirmLabel, so a deposit is
// always named on the button the customer actually taps.
describe("confirmLabel", () => {
  it("names the deposit when one is due", () => {
    expect(confirmLabel(10_000, "long")).toBe("Pay ₹100 and book");
    expect(confirmLabel(10_000, "short")).toBe("Pay ₹100");
    expect(confirmLabel(19_950, "short")).toBe("Pay ₹199.50");
  });

  it("just confirms when there's nothing to pay now", () => {
    expect(confirmLabel(null, "long")).toBe("Confirm booking");
    expect(confirmLabel(null, "short")).toBe("Confirm");
  });
});
