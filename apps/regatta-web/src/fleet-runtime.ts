import {
  applyFleetTactic,
  createFleetRace,
  FLEET,
  type FleetObservation,
  type FleetRace,
  fleetObservation,
  fleetOptions,
  PHYSICS_VERSION,
  previewTactic,
  type Scenario,
  STEP,
  stepFleetRace,
  windAt,
} from "sailing-sim";
import { CameraDirector } from "./camera-director";
import { FleetReplay } from "./fleet-replay";
import { RaceEvents } from "./race-events";
import type { TrailPoint } from "./runtime";
import { PRESENTATION_VERSION } from "./wave-field";

export type DecisionRequest = {
  raceId: string;
  epoch: number;
  seq: number;
  boatId: string;
  expiresAt: number;
  observation: FleetObservation;
};
export type DecisionReply = {
  raceId: string;
  epoch: number;
  seq: number;
  boatId: string;
  selected: string;
  source: "decider";
  confidence: number;
  probabilities: Record<string, number>;
  latencyMs: number;
};
export type DecisionLog = {
  boatId: string;
  selected: string;
  source: "preview" | "decider" | "fallback";
  observedTick: number;
  appliedTick: number | null;
  status: "applied" | "expired" | "rejected" | "failed";
  latencyMs: number;
};
export type FleetRecording = {
  version: "fleet-replay-v1";
  presentationVersion?: string;
  physicsVersion: typeof PHYSICS_VERSION;
  windVersion: "wind-v2";
  seed: number;
  scenario: Scenario;
  prediction: string | null;
  endTick: number;
  outcome: FleetRace["status"];
  decisions: DecisionLog[];
};
export type Transport = (
  request: DecisionRequest,
  signal: AbortSignal,
) => Promise<DecisionReply>;

export async function localDecider(
  request: DecisionRequest,
  signal: AbortSignal,
): Promise<DecisionReply> {
  const response = await fetch("/local-decider/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 410
        ? "expired"
        : response.status === 429
          ? "busy"
          : "inference_failed",
    );
  return response.json();
}

export function replayFleet(record: FleetRecording, target: number): FleetRace {
  if (
    record.version !== "fleet-replay-v1" ||
    record.physicsVersion !== PHYSICS_VERSION ||
    record.windVersion !== "wind-v2"
  )
    throw new Error("unsupported_replay_version");
  let race: FleetRace = {
    ...createFleetRace(record.seed, record.scenario),
    status: "running",
  };
  const actions = record.decisions.filter(
    (d) => d.status === "applied" && d.appliedTick !== null,
  );
  let index = 0;
  while (
    race.tick < Math.min(record.endTick, Math.max(0, target)) &&
    race.status === "running"
  ) {
    while (actions[index]?.appliedTick === race.tick) {
      const action = actions[index++];
      race = applyFleetTactic(race, action.boatId, action.selected);
    }
    race = stepFleetRace(race);
  }
  return race;
}

export class FleetRuntime {
  race: FleetRace;
  trails: TrailPoint[][] = FLEET.map(() => []);
  view: "follow" | "helm" | "overview" = "follow";
  quality: "high" | "standard" | "economy" = "high";
  tactics = false;
  autoCamera = false;
  cameraMotion = true;
  events = new RaceEvents();
  private director = new CameraDirector();
  private replayCache: FleetReplay | null = null;
  replayTick: number | null = null;
  replayPlaying = false;
  replaySpeed = 1;
  get displayRace() {
    return this.replayTick === null
      ? this.race
      : (this.replayCache?.at(this.replayTick) ?? this.race);
  }
  get displayTrails() {
    const tick = this.replayTick;
    return tick === null || !this.replayCache
      ? this.trails
      : this.replayCache.trails.map((trail) =>
          trail.filter((p) => p.tick <= tick),
        );
  }
  setReplay(tick: number | null) {
    if (["running", "paused", "ready"].includes(this.race.status)) return;
    if (tick !== null && !Number.isFinite(tick)) return;
    if (tick !== null && !this.replayCache)
      this.replayCache = new FleetReplay(this.recording());
    this.replayTick =
      tick === null ? null : Math.max(0, Math.min(this.race.tick, tick));
    this.replayPlaying = false;
    this.publish();
  }
  playReplay(speed = this.replaySpeed) {
    if (this.replayTick === null || ![0.5, 1, 2].includes(speed)) return;
    if (this.replayTick >= this.race.tick) this.replayTick = 0;
    this.replaySpeed = speed;
    this.replayPlaying = true;
    this.publish();
  }
  setPresentation(
    key: "tactics" | "autoCamera" | "cameraMotion",
    value: boolean,
  ) {
    this[key] = value;
    this.publish();
  }
  focusIndex = 0;
  prediction: string | null = null;
  mode: "preview" | "decider" = "preview";
  logs: DecisionLog[] = [];
  error: string | null = null;
  private listeners = new Set<() => void>();
  private accumulator = 0;
  private epoch = 0;
  private seq = 0;
  private raceId = crypto.randomUUID();
  private due = [0, 60, 120, 180];
  private failures = 0;
  private fps = 60;
  private pending: {
    request: DecisionRequest;
    controller: AbortController;
    started: number;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private inbox: {
    request: DecisionRequest;
    reply: DecisionReply;
    elapsed: number;
  } | null = null;
  private snapshot: ReturnType<FleetRuntime["makeSnapshot"]>;

  constructor(
    private transport: Transport = localDecider,
    seed = 12,
    /** Observation-to-apply deadline; 3 s locally, longer for the CPU cloud worker. */
    private deadlineMs = 3000,
  ) {
    this.race = createFleetRace(seed);
    this.snapshot = this.makeSnapshot();
  }
  get currentRaceId() {
    return this.raceId;
  }
  get deadline() {
    return this.deadlineMs;
  }
  /** Switch between the local bridge and AWS; only before a race starts. */
  setTransport(transport: Transport, deadlineMs: number) {
    if (this.race.status !== "ready" || this.pending) return false;
    if (!(deadlineMs >= 1000 && deadlineMs <= 20000)) return false;
    this.transport = transport;
    this.deadlineMs = deadlineMs;
    this.publish();
    return true;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private makeSnapshot() {
    const boat = this.race.boats[this.focusIndex];
    return {
      race: this.race,
      sceneRace: this.displayRace,
      replayTick: this.replayTick,
      replayPlaying: this.replayPlaying,
      replaySpeed: this.replaySpeed,
      tactics: this.tactics,
      autoCamera: this.autoCamera,
      cameraMotion: this.cameraMotion,
      events: [...this.events.events],
      view: this.view,
      quality: this.quality,
      focusIndex: this.focusIndex,
      prediction: this.prediction,
      mode: this.mode,
      logs: [...this.logs],
      error: this.error,
      pending: this.pending?.request.boatId ?? null,
      fps: this.fps,
      wind: windAt(
        this.race.scenario,
        this.race.seed,
        this.race.tick * STEP,
        boat.x,
        boat.y,
      ),
    };
  }
  private publish() {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
  private invalidate() {
    this.epoch++;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.controller.abort();
    }
    this.pending = null;
    this.inbox = null;
  }
  configure(scenario: Scenario, seed = this.race.seed) {
    this.invalidate();
    this.raceId = crypto.randomUUID();
    this.events = new RaceEvents();
    this.director = new CameraDirector();
    this.replayCache = null;
    this.replayTick = null;
    this.replayPlaying = false;
    this.race = createFleetRace(seed, scenario);
    this.trails = FLEET.map(() => []);
    this.logs = [];
    this.prediction = null;
    this.due = [0, 60, 120, 180];
    this.seq = 0;
    this.failures = 0;
    this.error = null;
    this.accumulator = 0;
    this.publish();
  }
  predict(id: string) {
    if (this.race.status !== "ready" || !FLEET.some((b) => b.id === id)) return;
    this.prediction = id;
    this.focusIndex = this.race.boats.findIndex((b) => b.id === id);
    this.publish();
  }
  setMode(mode: typeof this.mode) {
    if (this.race.status === "ready") {
      this.mode = mode;
      this.publish();
    }
  }
  setView(view: typeof this.view) {
    this.director.manual(this.race.tick);
    this.view = view;
    this.publish();
  }
  setQuality(quality: typeof this.quality) {
    this.quality = quality;
    this.publish();
  }
  focus(id: string) {
    this.director.manual(this.race.tick);
    const index = this.race.boats.findIndex((b) => b.id === id);
    if (index >= 0) {
      this.focusIndex = index;
      this.publish();
    }
  }
  start() {
    if (this.race.status === "ready" && this.prediction) {
      this.race = { ...this.race, status: "running" };
      this.publish();
    }
  }
  pause() {
    this.replayPlaying = false;
    if (this.race.status === "running") {
      this.invalidate();
      this.race = { ...this.race, status: "paused" };
    }
    this.accumulator = 0;
    this.publish();
  }
  resume() {
    if (this.race.status === "paused") {
      this.race = { ...this.race, status: "running" };
      this.accumulator = 0;
      this.publish();
    }
  }
  finish() {
    if (["running", "paused"].includes(this.race.status)) {
      this.invalidate();
      this.race = { ...this.race, status: "aborted" };
      this.publish();
    }
  }

  private applyInbox() {
    const item = this.inbox;
    this.inbox = null;
    if (!item) return;
    const { request, reply, elapsed } = item;
    if (request.epoch !== this.epoch || this.race.status !== "running") return;
    if (
      !reply ||
      typeof reply !== "object" ||
      !reply.probabilities ||
      typeof reply.probabilities !== "object"
    ) {
      this.logs.push({
        boatId: request.boatId,
        selected: "hold_course",
        source: "fallback",
        observedTick: request.observation.simulationTick,
        appliedTick: null,
        status: "rejected",
        latencyMs: elapsed,
      });
      this.failed("invalid_output");
      return;
    }
    const now = fleetObservation(this.race, request.boatId);
    const probabilities = Object.values(reply.probabilities ?? {});
    const options = fleetOptions(request.observation);
    const valid =
      reply.raceId === request.raceId &&
      reply.epoch === request.epoch &&
      reply.seq === request.seq &&
      reply.boatId === request.boatId &&
      reply.source === "decider" &&
      options.length === Object.keys(reply.probabilities ?? {}).length &&
      options.every(
        (id) =>
          typeof reply.probabilities[id] === "number" &&
          Number.isFinite(reply.probabilities[id]) &&
          reply.probabilities[id] >= 0 &&
          reply.probabilities[id] <= 1,
      ) &&
      Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) <= 0.01 &&
      Number.isFinite(reply.confidence) &&
      reply.confidence >= 0 &&
      reply.confidence <= 1 &&
      reply.probabilities[reply.selected] >= Math.max(...probabilities) - 1e-9;
    const applicable =
      fleetOptions(now).includes(reply.selected) &&
      now.boat.leg === request.observation.boat.leg;
    const expired =
      elapsed >= this.deadlineMs || Date.now() >= request.expiresAt;
    const applied = valid && applicable && !expired;
    this.logs.push({
      boatId: request.boatId,
      selected: reply.selected,
      source: "decider",
      observedTick: request.observation.simulationTick,
      appliedTick: applied ? this.race.tick : null,
      status: expired ? "expired" : applied ? "applied" : "rejected",
      latencyMs: elapsed,
    });
    if (applied) {
      this.race = applyFleetTactic(this.race, request.boatId, reply.selected);
      this.failures = 0;
    } else if (expired || !valid)
      this.failed(expired ? "expired" : "invalid_output");
  }
  private failed(reason: string) {
    this.failures++;
    this.error = reason;
    if (this.failures >= 2) this.finish();
  }
  private decide() {
    if (this.pending || this.seq >= 96 || this.race.status !== "running")
      return;
    const index = this.due
      .map((tick, i) => ({ tick, i }))
      .filter(
        ({ tick, i }) =>
          tick <= this.race.tick && this.race.boats[i].leg !== "finished",
      )
      .sort((a, b) => a.tick - b.tick)[0]?.i;
    if (index === undefined) return;
    const boat = this.race.boats[index];
    const observation = fleetObservation(this.race, boat.id);
    this.due[index] = this.race.tick + 240;
    if (this.mode === "preview") {
      const selected = previewTactic(observation);
      this.race = applyFleetTactic(this.race, boat.id, selected);
      this.logs.push({
        boatId: boat.id,
        selected,
        source: "preview",
        observedTick: this.race.tick,
        appliedTick: this.race.tick,
        status: "applied",
        latencyMs: 0,
      });
      this.seq++;
      return;
    }
    const request: DecisionRequest = {
      raceId: this.raceId,
      epoch: this.epoch,
      seq: this.seq++,
      boatId: boat.id,
      expiresAt: Date.now() + this.deadlineMs,
      observation,
    };
    const controller = new AbortController();
    const pending = {
      request,
      controller,
      started: performance.now(),
      timer: setTimeout(() => controller.abort(), this.deadlineMs),
    };
    this.pending = pending;
    this.transport(request, controller.signal)
      .then((reply) => {
        if (
          this.pending !== pending ||
          request.epoch !== this.epoch ||
          this.race.status !== "running"
        )
          return;
        this.inbox = {
          request,
          reply,
          elapsed: performance.now() - pending.started,
        };
      })
      .catch((error: Error) => {
        if (
          this.pending !== pending ||
          request.epoch !== this.epoch ||
          this.race.status !== "running"
        )
          return;
        const reason = error.name === "AbortError" ? "expired" : error.message;
        this.logs.push({
          boatId: boat.id,
          selected: "hold_course",
          source: "fallback",
          observedTick: observation.simulationTick,
          appliedTick: null,
          status: reason === "expired" ? "expired" : "failed",
          latencyMs: performance.now() - pending.started,
        });
        this.failed(reason);
      })
      .finally(() => {
        clearTimeout(pending.timer);
        if (this.pending === pending) this.pending = null;
        this.publish();
      });
  }
  advance(milliseconds: number) {
    if (this.replayTick !== null) {
      if (
        this.replayPlaying &&
        Number.isFinite(milliseconds) &&
        milliseconds > 0
      ) {
        this.replayTick = Math.min(
          this.race.tick,
          this.replayTick +
            (Math.min(milliseconds, 250) / 1000 / STEP) * this.replaySpeed,
        );
        if (this.replayTick >= this.race.tick) this.replayPlaying = false;
        this.publish();
      }
      return;
    }
    if (this.race.status !== "running") {
      this.accumulator = 0;
      return;
    }
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.fps = this.fps * 0.9 + Math.min(144, 1000 / milliseconds) * 0.1;
    this.accumulator += Math.min(milliseconds, 250) / 1000;
    while (this.accumulator + 1e-9 >= STEP && this.race.status === "running") {
      const before = this.race;
      this.applyInbox();
      if (this.race.status !== "running") break;
      this.decide();
      this.race = stepFleetRace(this.race);
      this.events.update(before, this.race);
      if (
        this.autoCamera &&
        this.cameraMotion &&
        !(
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches
        )
      ) {
        const focus = this.director.choose(this.events.events, this.race.tick);
        if (focus)
          this.focusIndex = this.race.boats.findIndex((b) => b.id === focus);
      }
      this.accumulator -= STEP;
      if (this.race.tick % 3 === 0) {
        this.race.boats.forEach((boat, i) => {
          this.trails[i].push({
            tick: this.race.tick,
            x: boat.x,
            y: boat.y,
            heading: boat.heading,
            speed: boat.speed,
          });
        });
        this.publish();
      }
    }
    if (this.race.status !== "running") {
      this.invalidate();
      this.publish();
    }
  }
  recording(): FleetRecording {
    return {
      version: "fleet-replay-v1",
      presentationVersion: PRESENTATION_VERSION,
      physicsVersion: PHYSICS_VERSION,
      windVersion: "wind-v2",
      seed: this.race.seed,
      scenario: this.race.scenario,
      prediction: this.prediction,
      endTick: this.race.tick,
      outcome: this.race.status,
      decisions: this.logs.map((d) => ({ ...d })),
    };
  }
  exportRecording(): string {
    const text = JSON.stringify(this.recording());
    if (new TextEncoder().encode(text).length > 512 * 1024)
      throw new Error("recording_too_large");
    return text;
  }
}
