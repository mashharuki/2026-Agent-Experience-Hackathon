import { stepBoat } from "./boat";
import { clamp, distance, headingTo, radians, wrapAngle } from "./math";
import {
  type Boat,
  COURSE,
  type Control,
  MARK,
  MAX_TICKS,
  PHYSICS_VERSION,
  type Race,
  STEP,
} from "./types";
import { windAt } from "./wind";

export function createRace(
  config: Partial<Pick<Race, "scenario" | "seed" | "withOpponent">> = {},
): Race {
  const boat = (id: Boat["id"], x: number): Boat => ({
    id,
    x,
    y: 0,
    heading: radians(46),
    speed: 1.3,
    mainSheet: 0.2,
    autoTrim: true,
    rudder: 0,
    targetHeading: null,
    tackSide: 1,
    tacks: 0,
    jibes: 0,
    lastManeuverTick: -100,
    leg: "upwind",
    markPhase: 0,
    finishTime: null,
  });
  return {
    version: PHYSICS_VERSION,
    windVersion: "wind-v2",
    scenario: "steady",
    seed: 12,
    withOpponent: false,
    ...config,
    tick: 0,
    status: "ready",
    boats: [boat("player", -7), boat("rival", 7)],
    contacts: 0,
    lastContactTick: -100,
  };
}

export function advanceMark(previous: Boat, current: Boat, time: number): Boat {
  const boat = { ...current };
  if (boat.leg === "upwind") {
    const dy = boat.y - MARK.y;
    if (
      boat.markPhase === 0 &&
      boat.x >= 6 &&
      boat.x <= 20 &&
      Math.abs(dy) <= 14
    )
      boat.markPhase = 1;
    else if (
      boat.markPhase === 1 &&
      dy >= 6 &&
      dy <= 20 &&
      Math.abs(boat.x) <= 20
    )
      boat.markPhase = 2;
    else if (
      boat.markPhase === 2 &&
      boat.x <= -6 &&
      boat.x >= -20 &&
      Math.abs(dy) <= 18
    ) {
      boat.markPhase = 3;
      boat.leg = "downwind";
    }
  }
  if (boat.leg === "downwind" && previous.y > 0 && boat.y <= 0) {
    const fraction = previous.y / (previous.y - boat.y);
    const x = previous.x + (boat.x - previous.x) * fraction;
    if (Math.abs(x) <= 30) {
      boat.finishTime = time - STEP + STEP * fraction;
      boat.leg = "finished";
      boat.speed = 0;
    }
  }
  return boat;
}

// An explicit, deterministic practice opponent. Never labelled a model decision.
export function ruleControl(boat: Boat, race: Race): Control {
  const wind = windAt(
    race.scenario,
    race.seed,
    race.tick * STEP,
    boat.x,
    boat.y,
  );
  const waypoint =
    boat.leg === "downwind"
      ? { x: 0, y: -8 }
      : boat.markPhase === 2
        ? { x: -12, y: MARK.y }
        : boat.markPhase === 1
          ? { x: 0, y: MARK.y + 12 }
          : { x: 12, y: MARK.y - 2 };
  let target = headingTo(boat, waypoint);
  const relative = wrapAngle(target - wind.direction);
  if (Math.abs(relative) < radians(44)) {
    let side = boat.tackSide;
    const toMark = waypoint.y - boat.y;
    if (Math.abs(waypoint.x - boat.x) > Math.max(12, toMark * 0.75))
      side = Math.sign(waypoint.x - boat.x) || 1;
    target = wind.direction + side * radians(46);
  }
  return {
    rudder: clamp(wrapAngle(target - boat.heading) * 2.5, -1, 1),
    mainSheet: 0.3,
    autoTrim: true,
  };
}

export function stepRace(
  race: Race,
  control: Control,
  rivalInput?: Control,
): Race {
  if (race.status !== "running") return race;
  const time = (race.tick + 1) * STEP;
  const next = race.boats.map((old, index) => {
    if (index === 1 && !race.withOpponent) return old;
    const wind = windAt(
      race.scenario,
      race.seed,
      race.tick * STEP,
      old.x,
      old.y,
    );
    let boat = stepBoat(
      old,
      index === 0 ? control : (rivalInput ?? ruleControl(old, race)),
      wind,
      race.tick,
    );
    if (
      boat.x < COURSE.minX ||
      boat.x > COURSE.maxX ||
      boat.y < COURSE.minY ||
      boat.y > COURSE.maxY
    ) {
      boat = {
        ...boat,
        x: clamp(boat.x, COURSE.minX, COURSE.maxX),
        y: clamp(boat.y, COURSE.minY, COURSE.maxY),
        speed: boat.speed * 0.8,
        targetHeading: headingTo(boat, { x: 0, y: 70 }),
      };
    }
    return boat;
  }) as [Boat, Boat];
  let contacts = race.contacts;
  let lastContactTick = race.lastContactTick;
  if (
    race.withOpponent &&
    next.every((b) => b.leg !== "finished") &&
    distance(next[0], next[1]) < 3
  ) {
    const dx = next[0].x - next[1].x || 0.1;
    const dy = next[0].y - next[1].y;
    const d = Math.hypot(dx, dy);
    const push = (3.1 - d) / 2;
    const penalty = race.tick - lastContactTick >= 30;
    next[0] = {
      ...next[0],
      x: next[0].x + (dx / d) * push,
      y: next[0].y + (dy / d) * push,
      speed: next[0].speed * (penalty ? 0.88 : 1),
    };
    next[1] = {
      ...next[1],
      x: next[1].x - (dx / d) * push,
      y: next[1].y - (dy / d) * push,
      speed: next[1].speed * (penalty ? 0.88 : 1),
    };
    if (penalty) {
      contacts++;
      lastContactTick = race.tick;
    }
  }
  next[0] = advanceMark(race.boats[0], next[0], time);
  next[1] = advanceMark(race.boats[1], next[1], time);
  const finished =
    next[0].leg === "finished" &&
    (!race.withOpponent || next[1].leg === "finished");
  return {
    ...race,
    tick: race.tick + 1,
    boats: next,
    contacts,
    lastContactTick,
    status: finished
      ? "finished"
      : race.tick + 1 >= MAX_TICKS
        ? "timed_out"
        : "running",
  };
}
