import { render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigContext } from "../config";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";

vi.mock("./cognito", () => ({
  completeSignIn: vi.fn(async () => ({ accessToken: "access-token-1" })),
  startSignIn: vi.fn(),
}));

import * as customFetch from "../api/custom-fetch";

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

describe("AuthProvider", () => {
  beforeEach(() => {
    window.history.pushState(null, "", "/auth/callback?code=c&state=s");
    customFetch.setAccessTokenProvider(() => undefined);
  });

  it("makes the token available before children of a signed-in session send their first request", async () => {
    const seen = vi.fn();
    render(
      <ConfigContext.Provider
        value={{
          mode: "cognito",
          cognito: { domain: "d", clientId: "c", redirectUri: "r" },
          pollDelay: () => 0,
        }}
      >
        <AuthProvider>
          <FirstRequest seen={seen} />
        </AuthProvider>
      </ConfigContext.Provider>,
    );
    await waitFor(() => expect(seen).toHaveBeenCalled());
    expect(seen).toHaveBeenCalledWith("access-token-1");
  });
});
