import { describe, expect, it } from "vitest";
import { challengeFromVerifier, randomUrlSafe } from "./pkce";

describe("PKCE (RFC 7636)", () => {
  it("derives the S256 challenge from the RFC 7636 appendix B example", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await challengeFromVerifier(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes URL-safe verifiers of the allowed length that never repeat", () => {
    const a = randomUrlSafe(64);
    const b = randomUrlSafe(64);
    expect(a).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(a).not.toBe(b);
  });
});
