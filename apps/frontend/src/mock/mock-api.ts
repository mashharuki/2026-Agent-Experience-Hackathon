// MOCK API. Replays fixed results through the same contract as the real API (statuses,
// bodies, limits and the session state machine), so the UI can be built and demonstrated
// without AWS. It says nothing about real model quality, and the UI always says so.

import type {
  Advice,
  Clarification,
  Job,
  Restriction,
  Scope,
  ServiceStatus,
  Session,
  Upload,
} from "../api/generated/model";
import { CONSENT_VERSION } from "../config";

export type MockScenario = "normal" | "backlight" | "vague" | "error";

export interface MockDoor {
  accepting: boolean;
  reason: ServiceStatus["reason"];
  expectedReopenAt?: string;
  /** Simulates the status check itself failing (the app must treat that as closed). */
  failing?: boolean;
}

interface MockCall {
  method: string;
  route: string;
  body?: unknown;
}
interface MockFeedback {
  adviceResponse?: string;
  comparisonChoice?: string;
}

interface SessionItem {
  state: string;
  changesUsed: number;
  analysesUsed: number;
  expiresAt: string;
  lastAdviceKind?: string;
  language: MockLanguage;
  scope: Scope;
  restrictions: Restriction[];
  pending?: Clarification;
}
interface JobItem {
  id: string;
  sessionId: string;
  phase: string;
  startedAt: number;
  result: Advice | { error: string };
  applied: boolean;
}

const NOW = () => new Date();

type MockLanguage = "ja" | "en";

const SHAPES: Record<string, Omit<Advice, "text">> = {
  tip: { kind: "grooming_tip", basis: "observation" },
  backlight: { kind: "capture_setup_tip", basis: "observation" },
  vague: { kind: "clarify", basis: "user_request" },
  // The "after" check also returns the next suggestion, so a second change needs no extra analysis.
  next: { kind: "grooming_tip", basis: "observation", comparable: true },
  last: { kind: "offer_finish", basis: "observation", comparable: true },
};

const TEXTS: Record<MockLanguage, Record<string, string>> = {
  ja: {
    tip: "（モックの助言）眉ブラシで、毛の流れを整えてみましょう。形は変えず、流れだけをそろえます。",
    backlight:
      "（モックの助言）光が後ろにあるようです。窓や照明が顔の正面に来る向きにして、もう一度撮ってみましょう。",
    vague:
      "（モックの助言）眉のどの部分が気になりますか？気になる箇所を教えてください。",
    next: "（モックの助言）次の一手：前髪を指でそっと整えて、分け目をそろえてみましょう。",
    last: "（モックの結果）試せる回数はここまでです。前後を見比べて選べます。",
  },
  en: {
    tip: "(Mock advice) Brush your brows to even out the direction of the hairs. Keep the shape and only align the flow.",
    backlight:
      "(Mock advice) The light seems to be behind you. Turn so a window or lamp is in front of your face and take the photo again.",
    vague:
      "(Mock advice) Which part of your brows bothers you? Please tell me which spot.",
    next: "(Mock advice) Next step: gently tidy your bangs with your fingers and even out the parting.",
    last: "(Mock result) That is all the changes you can try. Compare before and after and choose.",
  },
};

function advice(key: string, language: MockLanguage): Advice {
  return { ...SHAPES[key], text: TEXTS[language][key] } as Advice;
}

const PHASE_BY_STATE: Record<string, string> = {
  CONSULTING: "before",
  CAPTURE_ADJUST: "before",
  ADVICE_SHOWN: "before",
  TRYING: "after",
};

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const fail = (status: number, code: string) =>
  respond(status, { code, message: "リクエストを処理できませんでした" });

export function createMockApi(
  options: {
    latencyMs?: number;
    scenario?: MockScenario;
    door?: MockDoor;
  } = {},
) {
  let scenario: MockScenario = options.scenario ?? "normal";
  let door: MockDoor = options.door ?? { accepting: true, reason: "open" };
  const latencyMs = options.latencyMs ?? 900;
  let counter = 0;
  const id = (prefix: string) =>
    `${prefix}${String(++counter).padStart(8, "0")}`;

  const sessions = new Map<string, SessionItem>();
  const uploads = new Map<
    string,
    { sessionId: string; phase: string; used: boolean }
  >();
  const jobs = new Map<string, JobItem>();
  const idempotent = new Map<string, string>();
  const calls: MockCall[] = [];
  /** The language each created session asked for (what the real API stores). */
  const sessionLanguages: string[] = [];
  const feedback: MockFeedback[] = [];

  function resultFor(session: SessionItem, phase: string): JobItem["result"] {
    const prohibited = session.restrictions;
    if (
      prohibited.includes("no_touch_brow") &&
      prohibited.includes("no_touch_bangs")
    )
      return advice("last", session.language);
    if (
      phase === "before" &&
      prohibited.includes(`no_touch_${session.scope}` as Restriction)
    )
      return advice("vague", session.language);
    if (scenario === "error") return { error: "model_error" };
    if (phase === "after")
      return advice(
        session.changesUsed >= 2 ? "last" : "next",
        session.language,
      );
    // "backlight" fails the first photo only; "vague" asks first, then proceeds.
    if (scenario === "backlight" && session.analysesUsed === 1)
      return advice("backlight", session.language);
    if (scenario === "vague" && session.analysesUsed === 1)
      return advice("vague", session.language);
    return advice("tip", session.language);
  }

  function settle(job: JobItem): void {
    // Apply the finished job to the session exactly once (the real worker does this).
    const session = sessions.get(job.sessionId);
    if (job.applied || !session || Date.now() - job.startedAt < latencyMs)
      return;
    job.applied = true;
    if ("error" in job.result) {
      session.state = job.phase === "after" ? "TRYING" : "CONSULTING";
      return;
    }
    const { kind, comparable } = job.result;
    session.lastAdviceKind = kind;
    session.pending = job.result.clarification;
    if (job.phase === "after")
      session.state = comparable ? "COMPARING" : "CAPTURE_ADJUST";
    else if (kind === "offer_finish") session.state = "DONE";
    else
      session.state =
        {
          grooming_tip: "ADVICE_SHOWN",
          capture_setup_tip: "CAPTURE_ADJUST",
          clarify: "CLARIFYING",
        }[kind] ?? "CONSULTING";
  }

  async function handle(
    method: string,
    url: URL,
    init: RequestInit,
  ): Promise<Response> {
    const parts = url.pathname.split("/").filter(Boolean);
    const body =
      typeof init.body === "string" && init.body
        ? JSON.parse(init.body)
        : undefined;
    const headers = new Headers(init.headers);
    const route = (r: string) =>
      calls.push({ method, route: r, ...(body ? { body } : {}) });
    // The real worker finishes jobs on its own; here that happens on the next request.
    for (const job of jobs.values()) settle(job);

    if (method === "POST" && url.hostname === "mock-upload.invalid")
      return respond(204);

    if (method === "GET" && parts[0] === "service-status") {
      route("/service-status");
      if (door.failing) return fail(500, "internal_error");
      const { failing: _failing, ...status } = door;
      return respond(200, status satisfies ServiceStatus);
    }
    if (method === "POST" && url.pathname === "/sessions") {
      route("/sessions");
      if (!door.accepting) return fail(503, "not_accepting");
      if (body?.consentVersion !== CONSENT_VERSION)
        return fail(400, "consent_required");
      const session: SessionItem = {
        state: "CONSULTING",
        scope: body.scope,
        restrictions: body.restrictions ?? [],
        changesUsed: 0,
        analysesUsed: 0,
        expiresAt: new Date(NOW().getTime() + 24 * 3600 * 1000).toISOString(),
        language: body?.language === "en" ? "en" : "ja",
      };
      const sessionId = id("sess");
      sessions.set(sessionId, session);
      sessionLanguages.push(session.language);
      const {
        language: _language,
        scope: _scope,
        restrictions: _restrictions,
        pending: _pending,
        ...visible
      } = session;
      return respond(201, { sessionId, ...visible } as Session);
    }
    if (parts[0] === "sessions" && parts[1]) {
      const sessionId = parts[1];
      const session = sessions.get(sessionId);
      if (!session) return fail(404, "not_found");

      if (method === "POST" && parts[2] === "uploads") {
        route("/sessions/{sessionId}/uploads");
        if (session.state === "DONE") return fail(409, "session_ended");
        if (!door.accepting) return fail(503, "not_accepting");
        const uploadId = id("upl");
        uploads.set(uploadId, { sessionId, phase: body.phase, used: false });
        return respond(201, {
          uploadId,
          url: "https://mock-upload.invalid/",
          fields: {
            key: `uploads/${sessionId}/${uploadId}`,
            "Content-Type": body.contentType,
          },
          expiresAt: new Date(NOW().getTime() + 60_000).toISOString(),
        } satisfies Upload);
      }
      if (method === "POST" && parts[2] === "analyses") {
        route("/sessions/{sessionId}/analyses");
        const key = headers.get("Idempotency-Key");
        if (!key) return fail(400, "invalid_request");
        const replay = idempotent.get(`${sessionId}:${key}`);
        if (replay) return respond(202, { jobId: replay, status: "QUEUED" });
        if (!door.accepting) return fail(503, "not_accepting"); // new work only while accepting
        const upload = uploads.get(body.uploadId);
        if (!upload || upload.sessionId !== sessionId)
          return fail(404, "not_found");
        if (upload.phase !== body.phase) return fail(400, "invalid_request");
        if (upload.used) return fail(409, "conflict");
        if (session.state === "DONE") return fail(409, "session_ended");
        if (PHASE_BY_STATE[session.state] !== body.phase)
          return fail(409, "conflict");
        if (session.analysesUsed >= 3)
          return fail(429, "analysis_limit_reached");
        upload.used = true;
        session.analysesUsed += 1;
        session.state = "ANALYZING";
        const jobId = id("job");
        idempotent.set(`${sessionId}:${key}`, jobId);
        const result = resultFor(session, body.phase);
        if (!("error" in result) && result.kind === "clarify") {
          const allowedScopes = (["brow", "bangs"] as const).filter(
            (target) => !session.restrictions.includes(`no_touch_${target}`),
          );
          result.clarification = {
            clarificationId: jobId,
            reason:
              session.scope === "look_first"
                ? "choose_scope"
                : "specify_detail",
            allowedScopes,
            requiresDetail:
              session.scope !== "look_first" &&
              allowedScopes.includes(session.scope),
          };
        }
        jobs.set(jobId, {
          id: jobId,
          sessionId,
          phase: body.phase,
          startedAt: Date.now(),
          result,
          applied: false,
        });
        return respond(202, { jobId, status: "QUEUED" });
      }
      if (method === "POST" && parts[2] === "clarifications") {
        route("/sessions/{sessionId}/clarifications");
        const key = headers.get("Idempotency-Key");
        const replay = idempotent.get(`${sessionId}:clarify:${key}`);
        if (replay) return respond(202, { jobId: replay, status: "QUEUED" });
        if (!door.accepting) return fail(503, "not_accepting");
        if (
          !key ||
          session.state !== "CLARIFYING" ||
          !session.pending ||
          session.pending.clarificationId !== body.clarificationId
        )
          return fail(409, "conflict");
        if (
          !session.pending.allowedScopes.includes(body.scope) ||
          (session.pending.requiresDetail && !body.detail?.trim())
        )
          return fail(400, "invalid_request");
        if (session.analysesUsed >= 3)
          return fail(429, "analysis_limit_reached");
        session.scope = body.scope;
        session.analysesUsed++;
        session.state = "ANALYZING";
        session.pending = undefined;
        const jobId = id("job");
        idempotent.set(`${sessionId}:clarify:${key}`, jobId);
        jobs.set(jobId, {
          id: jobId,
          sessionId,
          phase: "before",
          startedAt: Date.now(),
          result: advice("tip", session.language),
          applied: false,
        });
        return respond(202, { jobId, status: "QUEUED" });
      }
      if (method === "POST" && parts[2] === "feedback") {
        route("/sessions/{sessionId}/feedback");
        feedback.push({
          adviceResponse: body.adviceResponse,
          comparisonChoice: body.comparisonChoice,
        });
        if (body.type === "advice_response" && !body.adviceResponse)
          return fail(400, "invalid_request");
        if (body.type === "comparison" && !body.comparisonChoice)
          return fail(400, "invalid_request");
        if (body.adviceResponse === "finish") {
          session.state = "DONE";
        } else if (body.adviceResponse === "try") {
          const fromComparison =
            session.state === "COMPARING" &&
            session.lastAdviceKind === "grooming_tip";
          if (session.state !== "ADVICE_SHOWN" && !fromComparison)
            return fail(409, "conflict");
          if (session.changesUsed >= 2)
            return fail(409, "change_limit_reached");
          session.changesUsed += 1;
          session.state = "TRYING";
        } else if (body.adviceResponse === "another") {
          if (session.state !== "ADVICE_SHOWN") return fail(409, "conflict");
        } else if (session.state !== "COMPARING") {
          return fail(409, "conflict");
        }
        return respond(204);
      }
      if (method === "DELETE" && parts.length === 2) {
        route("/sessions/{sessionId}");
        session.state = "DONE";
        return respond(202);
      }
    }
    if (method === "GET" && parts[0] === "jobs" && parts[1]) {
      route("/jobs/{jobId}");
      const job = jobs.get(parts[1]);
      if (!job) return fail(404, "not_found");
      settle(job);
      const elapsed = Date.now() - job.startedAt;
      if (!job.applied) {
        return respond(200, {
          jobId: job.id,
          status: elapsed < latencyMs / 2 ? "QUEUED" : "RUNNING",
        } satisfies Job);
      }
      if ("error" in job.result) {
        return respond(200, {
          jobId: job.id,
          status: "FAILED",
          errorClass: "model_error",
        } satisfies Job);
      }
      return respond(200, {
        jobId: job.id,
        status: "SUCCEEDED",
        advice: job.result,
      } satisfies Job);
    }
    return fail(404, "not_found");
  }

  const mockFetch: typeof fetch = async (input, init = {}) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw, "http://mock.local");
    return handle((init.method ?? "GET").toUpperCase(), url, init);
  };

  return {
    fetch: mockFetch,
    calls,
    sessionLanguages,
    feedback,
    setScenario: (next: MockScenario) => {
      scenario = next;
    },
    setDoor: (next: MockDoor) => {
      door = next;
    },
    get door() {
      return door;
    },
    get scenario() {
      return scenario;
    },
  };
}

export type MockApi = ReturnType<typeof createMockApi>;
