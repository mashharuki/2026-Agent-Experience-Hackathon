import { act, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigContext } from "../config";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";

const cognito = vi.hoisted(() => ({
  completeSignIn: vi.fn(),
  refreshTokens: vi.fn(),
  startSignIn: vi.fn(),
  startSignUp: vi.fn(),
}));
vi.mock("./cognito", () => cognito);

import * as customFetch from "../api/custom-fetch";

const CONFIG = {
  mode: "cognito" as const,
  cognito: { domain: "d", clientId: "c", redirectUri: "r" },
  pollDelay: () => 0,
};

function signInResult(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "access-token-1",
    refreshToken: "refresh-1",
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  };
}

/** Stands in for DoorGate: asks for the token the moment it first mounts. */
function FirstRequest({ seen }: { seen: (token?: string) => void }) {
  const auth = useAuth();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (auth.status === "signed-in" && !done) {
      seen(customFetch.currentAccessToken());
      setDone(true);
    }
  }, [auth.status, done, seen]);
  return null;
}

function Status({ onStatus }: { onStatus: (status: string) => void }) {
  const auth = useAuth();
  useEffect(() => {
    onStatus(auth.status);
  }, [auth.status, onStatus]);
  return null;
}

function mount(child: React.ReactNode) {
  return render(
    <ConfigContext.Provider value={CONFIG}>
      <AuthProvider>{child}</AuthProvider>
    </ConfigContext.Provider>,
  );
}

beforeEach(() => {
  window.history.pushState(null, "", "/auth/callback?code=c&state=s");
  customFetch.setAccessTokenProvider(() => undefined);
  customFetch.setUnauthorizedHandler(undefined);
  cognito.completeSignIn.mockReset().mockResolvedValue(signInResult());
  cognito.refreshTokens.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AuthProvider", () => {
  it("makes the token available before children of a signed-in session send their first request", async () => {
    const seen = vi.fn();
    mount(<FirstRequest seen={seen} />);
    await waitFor(() => expect(seen).toHaveBeenCalled());
    expect(seen).toHaveBeenCalledWith("access-token-1");
  });
});

describe("keeping the sign-in alive (the access token lasts one hour)", () => {
  async function signedIn(expiresInMs = 3_600_000) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cognito.completeSignIn.mockResolvedValue(
      signInResult({ expiresAt: Date.now() + expiresInMs }),
    );
    const statuses: string[] = [];
    mount(<Status onStatus={(s) => statuses.push(s)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(statuses.at(-1)).toBe("signed-in");
    return statuses;
  }

  it("refreshes a minute before the token expires and uses the new token", async () => {
    cognito.refreshTokens.mockResolvedValue({
      accessToken: "access-token-2",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 7_200_000,
    });
    await signedIn(3_600_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000 - 61_000);
    });
    expect(cognito.refreshTokens).not.toHaveBeenCalled(); // not yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(cognito.refreshTokens.mock.calls[0][1]).toBe("refresh-1");
    expect(customFetch.currentAccessToken()).toBe("access-token-2");
  });

  it("keeps refreshing: the next one is scheduled from the new expiry", async () => {
    cognito.refreshTokens.mockImplementation(async () => ({
      accessToken: `access-${cognito.refreshTokens.mock.calls.length + 1}`,
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
    }));
    await signedIn(3_600_000);
    for (let n = 0; n < 3; n++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_600_000 - 59_000);
      });
    }
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(3);
  });

  it("signs the person out, so the sign-in screen shows, when the refresh is refused", async () => {
    cognito.refreshTokens.mockRejectedValue(new Error("sign_in_failed"));
    const statuses = await signedIn(120_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(statuses.at(-1)).toBe("signed-out");
    expect(customFetch.currentAccessToken()).toBeUndefined();
  });

  it("tries to refresh right away when the API rejects the token", async () => {
    cognito.refreshTokens.mockResolvedValue({
      accessToken: "access-token-9",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 3_600_000,
    });
    await signedIn(3_600_000);
    customFetch.setFetchImplementation(
      async () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
        }),
    );
    await act(async () => {
      await customFetch.customFetch("/x", {}).catch(() => undefined);
    });
    expect(cognito.refreshTokens).toHaveBeenCalledTimes(1);
    expect(customFetch.currentAccessToken()).toBe("access-token-9");
    customFetch.setFetchImplementation((...args) => fetch(...args));
  });

  it("stops the timer when the person signs out or the page closes", async () => {
    cognito.refreshTokens.mockResolvedValue(signInResult());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    cognito.completeSignIn.mockResolvedValue(
      signInResult({ expiresAt: Date.now() + 3_600_000 }),
    );
    const view = mount(<Status onStatus={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    view.unmount();
    await vi.advanceTimersByTimeAsync(4_000_000);
    expect(cognito.refreshTokens).not.toHaveBeenCalled();
  });
});
