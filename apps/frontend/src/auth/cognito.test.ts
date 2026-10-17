import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl } from "./cognito";

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
