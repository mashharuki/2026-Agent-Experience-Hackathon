import {
  type Control,
  createRace,
  PHYSICS_VERSION,
  type Race,
  type Scenario,
  STEP,
  stepRace,
  windAt,
} from "sailing-sim";

export type TrailPoint = {
  tick: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
};
export type SceneRuntime = {
  race: Race;
  trails: TrailPoint[][];
  view: "follow" | "helm" | "overview";
  quality: "high" | "economy";
  focusIndex?: number;
  prediction?: string | null;
  advance(milliseconds: number): void;
  pause(): void;
};
export type Recording = {
  version: "practice-replay-v1";
  physicsVersion: typeof PHYSICS_VERSION;
  windVersion: Race["windVersion"];
  config: Pick<Race, "seed" | "scenario" | "withOpponent">;
  endTick: number;
  outcome: Race["status"];
  inputs: { tick: number; control: Control }[];
};

export function replayAt(recording: Recording, targetTick: number): Race {
  if (recording.physicsVersion !== PHYSICS_VERSION)
    throw new Error("Unsupported replay physics version");
  if (recording.windVersion !== "wind-v2")
    throw new Error("Unsupported replay wind version");
  let race: Race = { ...createRace(recording.config), status: "running" };
  let control: Control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
  let index = 0;
  for (
    let tick = 0;
    tick < Math.min(recording.endTick, Math.max(0, targetTick));
    tick++
  ) {
    while (recording.inputs[index]?.tick === tick)
      control = recording.inputs[index++].control;
    race = stepRace(race, control);
  }
  return race;
}

export class PracticeRuntime {
  race = createRace({ withOpponent: true });
  trails: [TrailPoint[], TrailPoint[]] = [[], []];
  view: "follow" | "helm" | "overview" = "follow";
  quality: "high" | "economy" = "high";
  control: Control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
  private accumulator = 0;
  private listeners = new Set<() => void>();
  private inputs: Recording["inputs"] = [];
  private lastInput = "";
  private frameRate = 60;
  private snapshot = this.makeSnapshot();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private makeSnapshot() {
    const boat = this.race.boats[0];
    return {
      race: this.race,
      fps: this.frameRate,
      view: this.view,
      quality: this.quality,
      wind: windAt(
        this.race.scenario,
        this.race.seed,
        this.race.tick * STEP,
        boat.x,
        boat.y,
      ),
      control: { ...this.control },
      trailLength: this.trails[0].length,
    };
  }
  private publish() {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
  configure(scenario: Scenario, withOpponent: boolean) {
    this.race = createRace({ scenario, seed: this.race.seed, withOpponent });
    this.trails = [[], []];
    this.inputs = [];
    this.lastInput = "";
    this.accumulator = 0;
    this.control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
    this.publish();
  }
  start() {
    if (this.race.status !== "ready") return;
    this.race = { ...this.race, status: "running" };
    this.publish();
  }
  pause() {
    this.releaseInput();
    if (this.race.status === "running")
      this.race = { ...this.race, status: "paused" };
    this.accumulator = 0;
    this.publish();
  }
  resume() {
    if (this.race.status !== "paused") return;
    this.race = { ...this.race, status: "running" };
    this.accumulator = 0;
    this.publish();
  }
  finish() {
    this.releaseInput();
    if (["running", "paused"].includes(this.race.status))
      this.race = { ...this.race, status: "aborted" };
    this.publish();
  }
  setControl(change: Partial<Control>) {
    this.control = { ...this.control, ...change };
    this.publish();
  }
  releaseInput() {
    this.control = { ...this.control, rudder: 0, maneuver: undefined };
  }
  setView(view: typeof this.view) {
    this.view = view;
    this.publish();
  }
  setQuality(quality: typeof this.quality) {
    this.quality = quality;
    this.publish();
  }
  advance(milliseconds: number) {
    if (this.race.status !== "running") {
      this.accumulator = 0;
      return;
    }
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    this.frameRate =
      this.frameRate * 0.9 + Math.min(144, 1000 / milliseconds) * 0.1;
    // Dropped frames must not create an unbounded catch-up loop.
    this.accumulator += Math.min(milliseconds, 250) / 1000;
    while (this.accumulator + 1e-9 >= STEP && this.race.status === "running") {
      const key = JSON.stringify(this.control);
      if (key !== this.lastInput) {
        this.inputs.push({
          tick: this.race.tick,
          control: { ...this.control },
        });
        this.lastInput = key;
      }
      this.race = stepRace(this.race, this.control);
      this.control = { ...this.control, maneuver: undefined };
      this.accumulator -= STEP;
      if (this.race.tick % 3 === 0) {
        this.race.boats.forEach((b, i) => {
          this.trails[i].push({
            tick: this.race.tick,
            x: b.x,
            y: b.y,
            heading: b.heading,
            speed: b.speed,
          });
        });
        this.publish();
      }
    }
    if (this.race.status !== "running") this.publish();
  }
  recording(): Recording {
    return {
      version: "practice-replay-v1",
      physicsVersion: PHYSICS_VERSION,
      windVersion: this.race.windVersion,
      config: {
        seed: this.race.seed,
        scenario: this.race.scenario,
        withOpponent: this.race.withOpponent,
      },
      endTick: this.race.tick,
      outcome: this.race.status,
      inputs: this.inputs.map((entry) => ({
        ...entry,
        control: { ...entry.control },
      })),
    };
  }
}
