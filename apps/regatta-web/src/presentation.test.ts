import { describe, expect, it } from "vitest";
import { raceOutcome } from "./presentation";

describe("raceOutcome", () => {
  it("is no_result when nobody finished", () =>
    expect(raceOutcome([], "aurora")).toBe("no_result"));
  it("is hit or miss against the winner", () => {
    expect(raceOutcome(["zephyr"], "zephyr")).toBe("hit");
    expect(raceOutcome(["zephyr"], "aurora")).toBe("miss");
  });
  it("treats a tie containing the prediction as a hit", () =>
    expect(raceOutcome(["coral", "jade"], "jade")).toBe("hit"));
  it("never reports hit or miss without a prediction", () =>
    expect(raceOutcome(["coral"], null)).toBe("unscored"));
});
