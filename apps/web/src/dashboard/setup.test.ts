import { describe, expect, it } from "vitest";
import { setupSteps } from "./setup";

const haircut = { id: "s1", active: true };
const meera = (over: object = {}) => ({ id: "p1", name: "Meera", active: true, services: [{ id: "s1" }], ...over });
const done = (result: ReturnType<typeof setupSteps>) => result.steps.map((s) => s.done);

describe("setupSteps", () => {
  it("starts with nothing done", () => {
    const result = setupSteps([], [], {});
    expect(done(result)).toEqual([false, false, false]);
    expect(result.ready).toBe(false);
  });

  it("is ready when someone offers a shown service and has hours", () => {
    const result = setupSteps([haircut], [meera()], { p1: 3 });
    expect(done(result)).toEqual([true, true, true]);
    expect(result.ready).toBe(true);
  });

  it("points at the person who still needs hours", () => {
    const result = setupSteps([haircut], [meera()], { p1: 0 });
    expect(done(result)).toEqual([true, true, false]);
    expect(result.steps[2]!.to).toBe("staff/p1");
  });

  it("doesn't count a person who offers nothing", () => {
    const result = setupSteps([haircut], [meera({ services: [] })], { p1: 3 });
    expect(done(result)).toEqual([true, false, false]);
  });

  it("doesn't count hidden services or hidden people", () => {
    expect(setupSteps([{ ...haircut, active: false }], [meera()], { p1: 3 }).ready).toBe(false);
    expect(setupSteps([haircut], [meera({ active: false })], { p1: 3 }).ready).toBe(false);
  });

  it("says it is still loading while someone's hours are unknown", () => {
    expect(setupSteps([haircut], [meera()], {}).loading).toBe(true);
  });
});
