import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CloudConfig,
  cloudHealth,
  cloudTransport,
  debriefRequest,
  errorFor,
  loadCloudConfig,
} from "./cloud";
import type { DecisionRequest, FleetRecording } from "./fleet-runtime";

const config: CloudConfig = {
  apiUrl: "https://api.example.test",
  cognitoDomain: "https://auth.example.test",
  clientId: "client",
  scope: "regatta/race",
  deadlineMs: 8000,
};
const session = { accessToken: "token-abc", expiresAt: Date.now() + 3_600_000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cloud connection", () => {
  it("sends the decision with the bearer token and maps refusals", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ selected: "tack_now" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);
    const transport = cloudTransport(config, () => session);
    const request = { raceId: "r", boatId: "aurora" } as DecisionRequest;
    await transport(request, new AbortController().signal);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.test/decide");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(JSON.parse(init.body)).toEqual(request);
    fetch.mockResolvedValue(new Response("{}", { status: 429 }));
    await expect(
      transport(request, new AbortController().signal),
    ).rejects.toThrow("busy");
  });

  it("refuses to call without a valid session", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(
      cloudTransport(config, () => null)({} as DecisionRequest, signal),
    ).rejects.toThrow("signed_out");
    const expired = { accessToken: "old", expiresAt: Date.now() + 1000 };
    await expect(
      cloudTransport(config, () => expired)({} as DecisionRequest, signal),
    ).rejects.toThrow("signed_out");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps HTTP statuses to runtime errors", () => {
    expect(errorFor(401)).toBe("signed_out");
    expect(errorFor(410)).toBe("expired");
    expect(errorFor(503)).toBe("not_ready");
    expect(errorFor(500)).toBe("inference_failed");
  });

  it("reports a stopped worker separately from a loading model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    expect(await cloudHealth(config, session)).toEqual({
      ready: false,
      error: "worker_stopped",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ready: false }))),
    );
    expect(await cloudHealth(config, session)).toEqual({
      ready: false,
      error: null,
    });
  });

  it("accepts only a complete HTTPS config with a bounded deadline", async () => {
    const serve = (value: unknown) =>
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
      );
    serve({ ...config, apiUrl: "https://api.example.test/" });
    expect((await loadCloudConfig())?.apiUrl).toBe("https://api.example.test");
    serve({ ...config, apiUrl: "http://api.example.test" });
    expect(await loadCloudConfig()).toBeNull();
    serve({ ...config, deadlineMs: 60_000 });
    expect(await loadCloudConfig()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    );
    expect(await loadCloudConfig()).toBeNull();
  });

  it("builds a bounded debrief summary without free text", () => {
    const recording: FleetRecording = {
      version: "fleet-replay-v1",
      physicsVersion: "sailing-v2",
      windVersion: "wind-v2",
      seed: 12,
      scenario: "dynamic",
      prediction: "aurora",
      endTick: 3000,
      outcome: "finished",
      decisions: Array.from({ length: 120 }, (_, i) => ({
        boatId: "zephyr",
        selected: "tack_now",
        source: "decider" as const,
        observedTick: i,
        appliedTick: i + 1,
        status: "applied" as const,
        latencyMs: 3000,
      })),
    };
    const finishes = [
      { boatId: "zephyr", seconds: 81.234 },
      { boatId: "aurora", seconds: null },
    ];
    const body = debriefRequest("race-1", "en", recording, finishes);
    expect(body?.decisions).toHaveLength(96);
    expect(Object.keys(body?.decisions[0] ?? {})).not.toContain("latencyMs");
    expect(body?.finishes[0].seconds).toBe(81.2);
    expect(
      debriefRequest("r", "ja", { ...recording, prediction: null }, finishes),
    ).toBeNull();
    expect(
      debriefRequest("r", "ja", { ...recording, outcome: "running" }, finishes),
    ).toBeNull();
  });
});
