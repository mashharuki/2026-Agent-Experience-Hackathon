import { afterEach, expect, it, vi } from "vitest";
import { withDeadline } from "./deadline";

afterEach(() => vi.useRealTimers());

it("bounds a request even when its fetch implementation ignores abort", async () => {
  vi.useFakeTimers();
  const result = withDeadline(() => new Promise(() => {}), undefined, 500);
  const rejected = expect(result).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(500);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("propagates caller cancellation and clears its deadline", async () => {
  vi.useFakeTimers();
  const caller = new AbortController();
  const result = withDeadline(() => new Promise(() => {}), caller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  caller.abort();
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
