import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { buildAuthorizeUrl } from "./cognito";

const auth = vi.hoisted(() => ({
  startSignIn: vi.fn(),
  startSignUp: vi.fn(),
  completeSignIn: vi.fn(),
  refreshTokens: vi.fn(),
}));
vi.mock("./cognito", async (original) => ({
  ...(await original<typeof import("./cognito")>()),
  ...auth,
}));

const config = {
  mode: "cognito" as const,
  cognito: {
    domain: "https://example.auth.ap-northeast-1.amazoncognito.com",
    clientId: "client123",
    redirectUri: "https://app.example/auth/callback",
  },
  pollDelay: () => 0,
};

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.clearAllMocks();
});

describe("self-registration", () => {
  it("starts the hosted registration flow from the signed-out app", async () => {
    const user = userEvent.setup();
    render(<App config={config} />);
    expect(screen.getByText(/メールに届く確認コード/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新規登録" }));
    expect(auth.startSignUp).toHaveBeenCalledWith(config.cognito);
    expect(auth.startSignIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ログイン" }));
    expect(auth.startSignIn).toHaveBeenCalledWith(config.cognito);
  });

  it("also explains registration and verification in English", async () => {
    const user = userEvent.setup();
    render(<App config={config} />);
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/verification code sent to your email/),
    ).toBeInTheDocument();
  });

  it("lets a failed authentication return to registration or sign-in", async () => {
    window.history.replaceState(null, "", "/auth/callback?error=access_denied");
    auth.completeSignIn.mockRejectedValueOnce(new Error("sign_in_failed"));
    render(<App config={config} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新規登録" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ログイン" })).toBeEnabled();
  });

  it("retains the OAuth scope, callback and PKCE on the hosted signup URL", () => {
    const url = new URL(
      buildAuthorizeUrl(config.cognito, "state", "challenge", "sign-up"),
    );
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      config.cognito.redirectUri,
    );
    expect(url.searchParams.get("scope")).toBe(
      "openid email photoprep/session",
    );
    expect(url.searchParams.get("state")).toBe("state");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.search).not.toMatch(/secret|password|token=/i);
  });
});
