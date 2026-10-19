import { createContext, useContext } from "react";
import type { MockApi } from "./mock/mock-api";

export interface CognitoConfig {
  /** Hosted UI domain, e.g. https://photoprep-123456789012.auth.ap-northeast-1.amazoncognito.com */
  domain: string;
  clientId: string;
  redirectUri: string;
}

export interface AppConfig {
  /** "mock" replays fixed results in this tab; "cognito" talks to the deployed API. */
  mode: "mock" | "cognito";
  mock?: MockApi;
  cognito?: CognitoConfig;
  /** Delay before poll number `attempt` (0-based). */
  pollDelay: (attempt: number) => number;
}

export const SCOPES = "openid email photoprep/session";
export const CONSENT_VERSION = "2026-10-v2";

export function loadConfig(): AppConfig {
  const env = import.meta.env;
  const useMock = env.VITE_USE_MOCK_API === "true" || !env.VITE_API_BASE_URL;
  if (useMock) {
    // Slower than the tests so the waiting state is visible in a demo.
    return { mode: "mock", pollDelay: () => 500 };
  }
  return {
    mode: "cognito",
    cognito: {
      domain: env.VITE_COGNITO_DOMAIN,
      clientId: env.VITE_COGNITO_CLIENT_ID,
      redirectUri: `${window.location.origin}/auth/callback`,
    },
    pollDelay: (attempt) => [2000, 3000, 5000][Math.min(attempt, 2)],
  };
}

export const ConfigContext = createContext<AppConfig | null>(null);

export function useConfig(): AppConfig {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("ConfigContext is missing");
  return config;
}
