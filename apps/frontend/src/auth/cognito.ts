import { type CognitoConfig, SCOPES } from "../config";
import { challengeFromVerifier, randomUrlSafe } from "./pkce";

const STORAGE_KEY = "photoprep.pkce";

export function buildAuthorizeUrl(
  config: CognitoConfig,
  state: string,
  challenge: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${config.domain}/oauth2/authorize?${params}`;
}

/** Start sign-in: remember the verifier and state for this tab only, then go to Cognito. */
export async function startSignIn(config: CognitoConfig): Promise<void> {
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ verifier, state }));
  window.location.assign(
    buildAuthorizeUrl(config, state, await challengeFromVerifier(verifier)),
  );
}

export interface Tokens {
  accessToken: string;
  expiresAt: number;
}

/** Finish sign-in on /auth/callback. Tokens are kept in memory only, never stored. */
export async function completeSignIn(
  config: CognitoConfig,
  search: string,
): Promise<Tokens> {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  const params = new URLSearchParams(search);
  const code = params.get("code");
  if (!stored || !code) throw new Error("sign_in_failed");
  const { verifier, state } = JSON.parse(stored) as {
    verifier: string;
    state: string;
  };
  if (params.get("state") !== state) throw new Error("sign_in_failed");
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error("sign_in_failed");
  const body = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}
