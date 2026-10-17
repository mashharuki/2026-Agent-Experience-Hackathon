/** Job polling: 2 s, then 3 s, then every 5 s, for at most 60 s (then "waiting for confirmation"). */
export const MAX_WAIT_MS = 60_000;

const DELAYS_MS = [2000, 3000, 5000];

export function nextPollDelay(attempt: number): number {
  return DELAYS_MS[Math.min(attempt, DELAYS_MS.length - 1)];
}

const FINISHED = new Set(["SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"]);

export function shouldKeepPolling(status: string, elapsedMs: number): boolean {
  return !FINISHED.has(status) && elapsedMs < MAX_WAIT_MS;
}
