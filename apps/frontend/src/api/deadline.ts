/** Bound the entire operation, including response bodies and fetch implementations that ignore abort. */
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  upstream?: AbortSignal | null,
  milliseconds = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(upstream?.reason);
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    milliseconds,
  );
  upstream?.addEventListener("abort", abort, { once: true });
  if (upstream?.aborted) abort();
  let rejectAbort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    });
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", abort);
    if (rejectAbort)
      controller.signal.removeEventListener("abort", rejectAbort);
  }
}
