import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  setAccessTokenProvider,
  setUnauthorizedHandler,
} from "../api/custom-fetch";
import { useConfig } from "../config";
import {
  completeSignIn,
  refreshTokens,
  startSignIn,
  startSignUp,
  type Tokens,
} from "./cognito";
import { AuthContext, type AuthState } from "./context";

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60_000;

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
  const refreshToken = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cognitoConfig = config.cognito;

  const stopTimer = useCallback(() => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const signedOut = useCallback(() => {
    stopTimer();
    refreshToken.current = undefined;
    setAccessTokenProvider(() => undefined);
    setStatus("signed-out");
  }, [stopTimer]);

  // applyTokens and refresh call each other (a refresh schedules the next one), hence the ref.
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const applyTokens = useCallback(
    (tokens: Tokens) => {
      // Set the provider before the state change: children that mount as "signed-in" send their
      // first request in an effect that runs before this component's own effects.
      setAccessTokenProvider(() => tokens.accessToken);
      if (tokens.refreshToken) refreshToken.current = tokens.refreshToken;
      stopTimer();
      const delay = Math.max(
        0,
        tokens.expiresAt - Date.now() - REFRESH_MARGIN_MS,
      );
      timer.current = setTimeout(() => void refreshRef.current(), delay);
    },
    [stopTimer],
  );

  useEffect(() => {
    refreshRef.current = async () => {
      const token = refreshToken.current;
      if (!token || !cognitoConfig) return signedOut();
      try {
        applyTokens(await refreshTokens(cognitoConfig, token));
      } catch {
        signedOut(); // revoked or expired: the sign-in screen is the honest next step
      }
    };
  }, [cognitoConfig, applyTokens, signedOut]);

  useEffect(() => {
    if (config.mode === "mock" || !cognitoConfig) return;
    // The API rejected the token (it may have expired early): try for a new one at once.
    setUnauthorizedHandler(() => void refreshRef.current());
    return () => setUnauthorizedHandler(undefined);
  }, [config.mode, cognitoConfig]);

  useEffect(() => stopTimer, [stopTimer]);

  useEffect(() => {
    if (config.mode === "mock" || !cognitoConfig) return;
    if (!returningFromSignIn) return;
    completeSignIn(cognitoConfig, window.location.search)
      .then((tokens) => {
        applyTokens(tokens);
        setStatus("signed-in");
        window.history.replaceState(null, "", "/");
      })
      .catch(() => setStatus("error"));
  }, [config.mode, cognitoConfig, returningFromSignIn, applyTokens]);

  useEffect(() => {
    if (config.mode === "mock") setAccessTokenProvider(() => "mock-token");
  }, [config.mode]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      userLabel: config.mode === "mock" ? "モックユーザー" : undefined,
      signIn: () => {
        if (cognitoConfig) void startSignIn(cognitoConfig);
      },
      signUp: () => {
        if (cognitoConfig) void startSignUp(cognitoConfig);
      },
      signOut: signedOut,
    }),
    [status, config.mode, cognitoConfig, signedOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
