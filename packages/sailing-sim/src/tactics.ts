import { distance, headingTo, radians, wrapAngle } from "./math";
import { MARK, type Race, STEP } from "./types";
import { visiblePressure, windAt } from "./wind";

export function createObservation(race: Race) {
  const boat = race.boats[1];
  return {
    version: "sailing-observation-v1",
    simulationTick: race.tick,
    boat: { ...boat },
    opponent: { ...race.boats[0] },
    localWind: windAt(
      race.scenario,
      race.seed,
      race.tick * STEP,
      boat.x,
      boat.y,
    ),
    visiblePressure: visiblePressure(
      race.scenario,
      race.seed,
      race.tick * STEP,
    ),
    mark: { ...MARK },
  };
}

export function eligibleTactics(
  observation: ReturnType<typeof createObservation>,
): string[] {
  if (observation.boat.leg === "finished") return ["hold_course"];
  const options = ["hold_course"];
  if (observation.boat.targetHeading !== null) return options;
  options.push(observation.boat.leg === "upwind" ? "tack_now" : "jibe_now");
  if (
    observation.boat.leg === "upwind" &&
    distance(observation.boat, observation.mark) < 35
  )
    options.push("approach_mark");
  for (const patch of observation.visiblePressure)
    options.push(`seek_visible_pressure_${patch.id}`);
  return options;
}

export function applyTactic(race: Race, selected: string): Race {
  const observation = createObservation(race);
  if (!eligibleTactics(observation).includes(selected))
    throw new Error("ineligible_tactic");
  if (race.status !== "running") throw new Error("race_not_running");
  const boat = race.boats[1];
  const wind = observation.localWind;
  let target = boat.heading;
  if (selected === "hold_course") target = boat.targetHeading ?? boat.heading;
  if (selected === "tack_now" || selected === "jibe_now") {
    target =
      wind.direction -
      (Math.sign(wrapAngle(boat.heading - wind.direction)) || 1) *
        radians(selected === "tack_now" ? 46 : 150);
  }
  if (selected === "approach_mark") {
    const waypoint =
      boat.markPhase === 2
        ? { x: -12, y: MARK.y }
        : boat.markPhase === 1
          ? { x: 0, y: MARK.y + 12 }
          : { x: 12, y: MARK.y - 2 };
    target = headingTo(boat, waypoint);
  }
  if (selected.startsWith("seek_visible_pressure_")) {
    const id = selected.slice("seek_visible_pressure_".length);
    const patch = observation.visiblePressure.find((p) => p.id === id);
    if (!patch) throw new Error("pressure_not_visible");
    target = headingTo(boat, patch);
  }
  if (Math.abs(wrapAngle(target - wind.direction)) < radians(38)) {
    target = wind.direction + boat.tackSide * radians(46);
  }
  return {
    ...race,
    boats: [race.boats[0], { ...boat, targetHeading: wrapAngle(target) }],
  };
}
