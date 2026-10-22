// AWS connection: runtime config, Cognito sign-in (Authorization Code + PKCE, public
// client) and the authenticated Decider / debrief calls. Tokens stay in memory only.
import type {
  DecisionReply,
  DecisionRequest,
  FleetRecording,
  Transport,
} from "./fleet-runtime";

export type CloudConfig = {
  apiUrl: string;
  cognitoDomain: string;
  clientId: string;
  scope: string;
  /** Observation-to-apply deadline for cloud decisions (ms). */
  deadlineMs: number;
};

const PKCE_KEY = "regatta.pkce";
const URL_SAFE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** `/config.json` is written only by the AWS publish script; absent means local mode. */
export async function loadCloudConfig(): Promise<CloudConfig | null> {
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) return null;
    const value = (await response.json()) as Partial<CloudConfig>;
    if (
      typeof value.apiUrl !== "string" ||
      !value.apiUrl.startsWith("https://") ||
      typeof value.cognitoDomain !== "string" ||
      !value.cognitoDomain.startsWith("https://") ||
      typeof value.clientId !== "string" ||
      typeof value.scope !== "string" ||
      typeof value.deadlineMs !== "number" ||
      !(value.deadlineMs >= 1000 && value.deadlineMs <= 20000)
    )
      return null;
    return {
      ...(value as CloudConfig),
      apiUrl: value.apiUrl.replace(/\/$/, ""),
    };
  } catch {
    return null;
  }
}

export function randomUrlSafe(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => URL_SAFE[b % URL_SAFE.length]).join("");
}

export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const redirectUri = () => `${window.location.origin}/auth/callback`;

export async function startSignIn(config: CloudConfig): Promise<void> {
  const verifier = randomUrlSafe(64);
  const state = randomUrlSafe(32);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri(),
    scope: `openid email ${config.scope}`,
    state,
    code_challenge: await challengeFromVerifier(verifier),
    code_challenge_method: "S256",
  });
  window.location.assign(`${config.cognitoDomain}/oauth2/authorize?${params}`);
}

export type Session = { accessToken: string; expiresAt: number };

/** Finish sign-in on /auth/callback; the code is single-use and state must match. */
export async function completeSignIn(
  config: CloudConfig,
  search: string,
): Promise<Session> {
  const stored = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  const params = new URLSearchParams(search);
  const code = params.get("code");
  if (!stored || !code) throw new Error("sign_in_failed");
  const { verifier, state } = JSON.parse(stored) as {
    verifier: string;
    state: string;
  };
  if (params.get("state") !== state) throw new Error("sign_in_failed");
  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      redirect_uri: redirectUri(),
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

function authorized(session: Session): Record<string, string> {
  if (Date.now() >= session.expiresAt - 30_000) throw new Error("signed_out");
  return { Authorization: `Bearer ${session.accessToken}` };
}

export function errorFor(status: number): string {
  if (status === 401 || status === 403) return "signed_out";
  if (status === 410) return "expired";
  if (status === 429) return "busy";
  if (status === 503) return "not_ready";
  return "inference_failed";
}

export function cloudTransport(
  config: CloudConfig,
  session: () => Session | null,
): Transport {
  return async (
    request: DecisionRequest,
    signal: AbortSignal,
  ): Promise<DecisionReply> => {
    const current = session();
    if (!current) throw new Error("signed_out");
    const response = await fetch(`${config.apiUrl}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authorized(current) },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(errorFor(response.status));
    return response.json();
  };
}

export type CloudHealth = { ready: boolean; error: string | null };

export async function cloudHealth(
  config: CloudConfig,
  session: Session,
): Promise<CloudHealth> {
  const response = await fetch(`${config.apiUrl}/health`, {
    headers: authorized(session),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    return {
      ready: false,
      // 503 from API Gateway means the stopped worker has no registered task.
      error:
        response.status === 503 ? "worker_stopped" : errorFor(response.status),
    };
  const body = (await response.json()) as { ready?: unknown };
  return { ready: body.ready === true, error: null };
}

export type DebriefRequest = {
  raceId: string;
  language: "ja" | "en";
  prediction: string;
  outcome: "finished" | "timed_out" | "aborted";
  finishes: { boatId: string; seconds: number | null }[];
  decisions: {
    boatId: string;
    selected: string;
    source: string;
    status: string;
    observedTick: number;
    appliedTick: number | null;
  }[];
};

/** A bounded, free-text-free summary of one race; the Lambda validates it again. */
export function debriefRequest(
  raceId: string,
  language: "ja" | "en",
  recording: FleetRecording,
  finishes: { boatId: string; seconds: number | null }[],
): DebriefRequest | null {
  if (
    !recording.prediction ||
    !["finished", "timed_out", "aborted"].includes(recording.outcome)
  )
    return null;
  return {
    raceId,
    language,
    prediction: recording.prediction,
    outcome: recording.outcome as DebriefRequest["outcome"],
    finishes: finishes.map((f) => ({
      boatId: f.boatId,
      seconds: f.seconds === null ? null : Math.round(f.seconds * 10) / 10,
    })),
    decisions: recording.decisions.slice(0, 96).map((d) => ({
      boatId: d.boatId,
      selected: d.selected,
      source: d.source,
      status: d.status,
      observedTick: d.observedTick,
      appliedTick: d.appliedTick,
    })),
  };
}

export type Debrief = { text: string; references: number[]; model: string };

export async function requestDebrief(
  config: CloudConfig,
  session: Session,
  body: DebriefRequest,
): Promise<Debrief> {
  const response = await fetch(`${config.apiUrl}/debrief`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authorized(session) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429 ? "debrief_limit" : "debrief_failed",
    );
  return response.json();
}
