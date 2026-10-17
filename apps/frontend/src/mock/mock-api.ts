// MOCK API. Replays fixed results through the same contract as the real API (statuses,
// bodies, limits and the session state machine), so the UI can be built and demonstrated
// without AWS. It says nothing about real model quality, and the UI always says so.

import type {
  Advice,
  Job,
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

export interface MockCall {
  method: string;
  route: string;
}
export interface MockFeedback {
  adviceResponse?: string;
  comparisonChoice?: string;
}

interface SessionItem {
  state: string;
  changesUsed: number;
  analysesUsed: number;
  expiresAt: string;
  lastAdviceKind?: string;
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

const ADVICE: Record<string, Advice> = {
  tip: {
    kind: "grooming_tip",
    basis: "observation",
    text: "（モックの助言）眉ブラシで、毛の流れを整えてみましょう。形は変えず、流れだけをそろえます。",
  },
  backlight: {
    kind: "capture_setup_tip",
    basis: "observation",
    text: "（モックの助言）光が後ろにあるようです。窓や照明が顔の正面に来る向きにして、もう一度撮ってみましょう。",
  },
  vague: {
    kind: "clarify",
    basis: "user_request",
    text: "（モックの助言）眉のどの部分が気になりますか？気になる箇所を教えてください。",
  },
  // The "after" check also returns the next suggestion, so a second change needs no extra analysis.
  next: {
    kind: "grooming_tip",
    basis: "observation",
    comparable: true,
    text: "（モックの助言）次の一手：前髪を指でそっと整えて、分け目をそろえてみましょう。",
  },
  last: {
    kind: "offer_finish",
    basis: "observation",
    comparable: true,
    text: "（モックの結果）試せる回数はここまでです。前後を見比べて選べます。",
  },
};

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
  const feedback: MockFeedback[] = [];

  function resultFor(session: SessionItem, phase: string): JobItem["result"] {
    if (scenario === "error") return { error: "model_error" };
    if (phase === "after")
      return session.changesUsed >= 2 ? ADVICE.last : ADVICE.next;
    // "backlight" fails the first photo only; "vague" asks first, then proceeds.
    if (scenario === "backlight" && session.analysesUsed === 1)
      return ADVICE.backlight;
    if (scenario === "vague" && session.analysesUsed === 1) return ADVICE.vague;
    return ADVICE.tip;
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
    if (job.phase === "after")
      session.state = comparable ? "COMPARING" : "CAPTURE_ADJUST";
    else if (kind === "offer_finish") session.state = "DONE";
    else
      session.state =
        {
          grooming_tip: "ADVICE_SHOWN",
          capture_setup_tip: "CAPTURE_ADJUST",
          clarify: "CONSULTING",
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
    const route = (r: string) => calls.push({ method, route: r });
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
        changesUsed: 0,
        analysesUsed: 0,
        expiresAt: new Date(NOW().getTime() + 24 * 3600 * 1000).toISOString(),
      };
      const sessionId = id("sess");
      sessions.set(sessionId, session);
      return respond(201, { sessionId, ...session } as Session);
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
        jobs.set(jobId, {
          id: jobId,
          sessionId,
          phase: body.phase,
          startedAt: Date.now(),
          result: resultFor(session, body.phase),
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
