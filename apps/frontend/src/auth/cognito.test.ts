import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, completeSignIn, refreshTokens } from "./cognito";

const config = {
  domain: "https://example.auth.ap-northeast-1.amazoncognito.com",
  clientId: "client123",
  redirectUri: "https://app.example/auth/callback",
};

describe("Cognito authorize URL", () => {
  const url = new URL(buildAuthorizeUrl(config, "state-1", "challenge-1"));

  it("uses the authorization code flow with PKCE S256", () => {
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("asks for the API scope and sends no secret (public client)", () => {
    expect(url.searchParams.get("scope")).toContain("photoprep/session");
    expect(url.search).not.toMatch(/secret/i);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("token exchange and refresh", () => {
  const tokenResponse = (body: unknown, ok = true) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { status: ok ? 200 : 400 }),
    );

  afterEach(() => vi.unstubAllGlobals());

  it("keeps the refresh token from the sign-in (in memory, never stored)", async () => {
    sessionStorage.setItem(
      "photoprep.pkce",
      JSON.stringify({ verifier: "v", state: "s" }),
    );
    vi.stubGlobal(
      "fetch",
      tokenResponse({
        access_token: "a1",
        refresh_token: "r1",
        expires_in: 3600,
      }),
    );
    const tokens = await completeSignIn(config, "?code=c&state=s");
    expect(tokens.accessToken).toBe("a1");
    expect(tokens.refreshToken).toBe("r1");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("r1");
    expect(JSON.stringify({ ...localStorage })).not.toContain("r1");
  });

  it("asks Cognito for a new access token with the refresh token and no secret", async () => {
    const fetchMock = tokenResponse({ access_token: "a2", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);
    const before = Date.now();
    const tokens = await refreshTokens(config, "r1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`${config.domain}/oauth2/token`);
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
    expect(body.get("client_id")).toBe(config.clientId);
    expect(String(init.body)).not.toMatch(/secret/i);
    expect(tokens.accessToken).toBe("a2");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
  });

  it("fails when Cognito refuses (revoked or expired refresh token)", async () => {
    vi.stubGlobal("fetch", tokenResponse({ error: "invalid_grant" }, false));
    await expect(refreshTokens(config, "r1")).rejects.toThrow("sign_in_failed");
  });
});
