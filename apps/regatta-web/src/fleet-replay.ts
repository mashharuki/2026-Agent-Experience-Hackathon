import {
  applyFleetTactic,
  createFleetRace,
  type FleetRace,
  PHYSICS_VERSION,
  stepFleetRace,
} from "sailing-sim";
import type { FleetRecording } from "./fleet-runtime";
import { RaceEvents } from "./race-events";
import type { TrailPoint } from "./runtime";

/** Bounded, immutable presentation cache. Never owns a transport or calls a model. */
export class FleetReplay {
  readonly frames: FleetRace[] = [];
  readonly trails: TrailPoint[][] = [[], [], [], []];
  readonly tracker = new RaceEvents();
  constructor(record: FleetRecording) {
    if (
      record.version !== "fleet-replay-v1" ||
      record.physicsVersion !== PHYSICS_VERSION ||
      record.windVersion !== "wind-v2" ||
      !Number.isInteger(record.endTick) ||
      record.endTick < 0 ||
      record.endTick > 5400
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
    this.frames.push(race);
    while (race.tick < record.endTick && race.status === "running") {
      while (actions[index]?.appliedTick === race.tick) {
        const action = actions[index++];
        race = applyFleetTactic(race, action.boatId, action.selected);
      }
      const before = this.frames[this.frames.length - 1];
      race = stepFleetRace(race);
      this.tracker.update(before, race);
      this.frames.push(race);
      if (race.tick % 3 === 0)
        race.boats.forEach((b, i) => {
          this.trails[i].push({
            tick: race.tick,
            x: b.x,
            y: b.y,
            heading: b.heading,
            speed: b.speed,
          });
        });
    }
  }
  at(tick: number) {
    return this.frames[
      Math.max(0, Math.min(this.frames.length - 1, Math.floor(tick)))
    ];
  }
}
