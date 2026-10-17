import { type ReactNode, useEffect, useMemo, useState } from "react";
import { setAccessTokenProvider } from "../api/custom-fetch";
import { useConfig } from "../config";
import { completeSignIn, startSignIn } from "./cognito";
import { AuthContext, type AuthState } from "./context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const returningFromSignIn = window.location.pathname === "/auth/callback";
  const [status, setStatus] = useState<AuthState["status"]>(
    config.mode === "mock"
      ? "signed-in"
      : returningFromSignIn
        ? "loading"
        : "signed-out",
  );
  const [token, setToken] = useState<string | undefined>(
    config.mode === "mock" ? "mock-token" : undefined,
  );

  useEffect(() => {
    setAccessTokenProvider(() => token);
  }, [token]);

  useEffect(() => {
    if (config.mode === "mock" || !config.cognito) return;
    const cognito = config.cognito;
    if (!returningFromSignIn) return;
    completeSignIn(cognito, window.location.search)
      .then((tokens) => {
        setToken(tokens.accessToken);
        setStatus("signed-in");
        window.history.replaceState(null, "", "/");
      })
      .catch(() => setStatus("error"));
  }, [config, returningFromSignIn]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      userLabel: config.mode === "mock" ? "モックユーザー" : undefined,
      signIn: () => {
        if (config.cognito) void startSignIn(config.cognito);
      },
      signOut: () => {
        setToken(undefined);
        setStatus("signed-out");
      },
    }),
    [status, config],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
