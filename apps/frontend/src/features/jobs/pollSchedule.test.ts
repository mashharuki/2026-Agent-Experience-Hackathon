import { describe, expect, it } from "vitest";
import { MAX_WAIT_MS, nextPollDelay, shouldKeepPolling } from "./pollSchedule";

describe("job polling schedule (2 -> 3 -> 5 s, at most 60 s)", () => {
  it("backs off 2 s, 3 s, then 5 s", () => {
    expect([0, 1, 2, 3, 10].map(nextPollDelay)).toEqual([
      2000, 3000, 5000, 5000, 5000,
    ]);
  });

  it("stops after 60 seconds and on any finished status", () => {
    expect(MAX_WAIT_MS).toBe(60_000);
    expect(shouldKeepPolling("QUEUED", 59_000)).toBe(true);
    expect(shouldKeepPolling("RUNNING", 60_000)).toBe(false);
    for (const done of ["SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"]) {
      expect(shouldKeepPolling(done, 1000)).toBe(false);
    }
  });
});
