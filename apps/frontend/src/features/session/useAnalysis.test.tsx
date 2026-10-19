import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigContext } from "../../config";
import { I18nProvider } from "../../i18n/I18nProvider";
import { useAnalysis } from "./useAnalysis";

vi.mock("../../api/generated/photoprep", () => ({
  useGetJob: () => ({ data: undefined, error: null, refetch: vi.fn() }),
  getGetJobQueryKey: (id: string) => ["job", id],
  createUpload: vi.fn(),
  requestAnalysis: vi.fn(),
}));

afterEach(() => vi.useRealTimers());

it("times out without receiving a first job response", async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <ConfigContext.Provider value={{ mode: "mock", pollDelay: () => 5 }}>
          <I18nProvider>{children}</I18nProvider>
        </ConfigContext.Provider>
      </QueryClientProvider>
    );
  }
  const { result } = renderHook(() => useAnalysis("session-1"), {
    wrapper: Wrapper,
  });
  act(() => result.current.follow("job-1"));
  expect(result.current.run.status).toBe("waiting");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(result.current.run.status).toBe("timeout");
  act(() => result.current.cancel());
  expect(result.current.run.status).toBe("cancelled");
  client.clear();
});
