import { fleetOptions } from "sailing-sim";
import { describe, expect, it, vi } from "vitest";
import {
  type DecisionReply,
  type DecisionRequest,
  FleetRuntime,
  replayFleet,
} from "./fleet-runtime";

const response = (
  request: DecisionRequest,
  selected = "tack_now",
): DecisionReply => ({
  ...request,
  selected,
  source: "decider",
  confidence: 0.8,
  latencyMs: 10,
  probabilities: Object.fromEntries(
    fleetOptions(request.observation).map((id) => [
      id,
      Number(id === selected),
    ]),
  ),
});

describe("spectator runtime", () => {
  it("requires a prediction, locks it at start and never exposes steering", () => {
    const runtime = new FleetRuntime();
    runtime.start();
    expect(runtime.race.status).toBe("ready");
    runtime.predict("aurora");
    runtime.start();
    runtime.predict("jade");
    expect(runtime.prediction).toBe("aurora");
    runtime.focus("jade");
    expect(runtime.prediction).toBe("aurora");
    expect(runtime.focusIndex).toBe(3);
    expect("setControl" in runtime).toBe(false);
  });
  it("pauses all boats/weather, rejects terminal resume and clears a new prediction", () => {
    const runtime = new FleetRuntime();
    runtime.predict("zephyr");
    runtime.start();
    runtime.advance(200);
    runtime.pause();
    const before = runtime.race;
    runtime.advance(60000);
    expect(runtime.race).toBe(before);
    runtime.resume();
    runtime.advance(1000 / 30);
    expect(runtime.race.tick).toBe(before.tick + 1);
    runtime.finish();
    runtime.resume();
    expect(runtime.race.status).toBe("aborted");
    runtime.configure("dynamic", 42);
    expect(runtime.prediction).toBeNull();
    expect(runtime.logs).toEqual([]);
  });
  it("replays applied per-boat choices exactly without calling a transport", () => {
    const transport = vi.fn();
    const runtime = new FleetRuntime(transport);
    runtime.predict("coral");
    runtime.start();
    for (let i = 0; i < 1500; i++) runtime.advance(1000 / 30);
    expect(transport).not.toHaveBeenCalled();
    expect(new Set(runtime.logs.map((d) => d.boatId)).size).toBe(4);
    expect(runtime.logs.every((d) => d.source === "preview")).toBe(true);
    expect(replayFleet(runtime.recording(), runtime.race.tick)).toEqual(
      runtime.race,
    );
    expect(JSON.parse(runtime.exportRecording()).prediction).toBe("coral");
    const record = runtime.recording();
    record.decisions[0].selected = "fake";
    expect(runtime.logs[0].selected).not.toBe("fake");
  });
  it("keeps racing while a real request is in flight, applies once and rejects a cancelled response", async () => {
    let request: DecisionRequest | undefined;
    let resolve: ((reply: DecisionReply) => void) | undefined;
    const transport = vi.fn((packet: DecisionRequest) => {
      request = packet;
      return new Promise<DecisionReply>((done) => {
        resolve = done;
      });
    });
    const runtime = new FleetRuntime(transport);
    runtime.setMode("decider");
    runtime.predict("aurora");
    runtime.start();
    for (let i = 0; i < 60; i++) runtime.advance(1000 / 30);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(runtime.race.tick).toBe(60);
    resolve?.(response(request as DecisionRequest));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    runtime.advance(1000 / 30);
    expect(runtime.logs.filter((d) => d.status === "applied")).toHaveLength(1);
    runtime.pause();
    const before = runtime.race;
    runtime.resume();
    runtime.advance(200);
    const old = request as DecisionRequest;
    runtime.configure("dynamic", 99);
    resolve?.(response(old));
    await Promise.resolve();
    expect(runtime.race.status).toBe("ready");
    expect(runtime.logs).toEqual([]);
    expect(runtime.race).not.toBe(before);
    runtime.finish();
    runtime.pause();
  });
  it("discards responses that arrive after three real seconds", async () => {
    vi.useFakeTimers();
    let request: DecisionRequest | undefined;
    let resolve: ((reply: DecisionReply) => void) | undefined;
    const runtime = new FleetRuntime((packet) => {
      request = packet;
      return new Promise<DecisionReply>((done) => {
        resolve = done;
      });
    });
    runtime.setMode("decider");
    runtime.predict("aurora");
    runtime.start();
    runtime.advance(1000 / 30);
    vi.advanceTimersByTime(3100);
    resolve?.(response(request as DecisionRequest));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    runtime.advance(1000 / 30);
    expect(runtime.logs[0].status).toBe("expired");
    expect(runtime.logs[0].appliedTick).toBeNull();
    runtime.finish();
    vi.useRealTimers();
  });
  it.each([
    [5000, "applied"],
    [8100, "expired"],
  ])(
    "with an 8 s cloud deadline, a reply after %i ms is %s",
    async (wait, status) => {
      vi.useFakeTimers();
      let request: DecisionRequest | undefined;
      let resolve: ((reply: DecisionReply) => void) | undefined;
      const runtime = new FleetRuntime(
        (packet) => {
          request = packet;
          return new Promise<DecisionReply>((done) => {
            resolve = done;
          });
        },
        12,
        8000,
      );
      runtime.setMode("decider");
      runtime.predict("aurora");
      runtime.start();
      runtime.advance(1000 / 30);
      const sent = request as DecisionRequest;
      expect(sent.expiresAt - Date.now()).toBeLessThanOrEqual(8000);
      expect(sent.expiresAt - Date.now()).toBeGreaterThan(7000);
      vi.advanceTimersByTime(wait);
      resolve?.(response(sent, "hold_course"));
      for (let i = 0; i < 3; i++) await Promise.resolve();
      runtime.advance(1000 / 30);
      expect(runtime.logs[0].status).toBe(status);
      expect(runtime.logs[0].appliedTick === null).toBe(status === "expired");
      runtime.finish();
      vi.useRealTimers();
    },
  );
  it("switches transport and deadline only before the start", () => {
    const runtime = new FleetRuntime(vi.fn());
    const cloud = vi.fn();
    expect(runtime.setTransport(cloud, 50_000)).toBe(false);
    expect(runtime.setTransport(cloud, 8000)).toBe(true);
    expect(runtime.deadline).toBe(8000);
    runtime.predict("jade");
    runtime.start();
    expect(runtime.setTransport(vi.fn(), 3000)).toBe(false);
    expect(runtime.deadline).toBe(8000);
    runtime.finish();
  });
  it("aborts after two inference failures without applying a substitute tactic", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("inference_failed"));
    const runtime = new FleetRuntime(transport);
    runtime.setMode("decider");
    runtime.predict("aurora");
    runtime.start();
    runtime.advance(1000 / 30);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(runtime.race.status).toBe("running");
    for (let i = 0; i < 60; i++) runtime.advance(1000 / 30);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(runtime.race.status).toBe("aborted");
    expect(runtime.mode).toBe("decider");
    expect(runtime.logs).toHaveLength(2);
    expect(runtime.logs.every((entry) => entry.appliedTick === null)).toBe(
      true,
    );
    expect(runtime.logs.every((entry) => entry.status === "failed")).toBe(true);
  });
});
