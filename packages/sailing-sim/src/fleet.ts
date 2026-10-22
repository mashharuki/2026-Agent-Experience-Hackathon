import { stepBoat } from "./boat";
import {
  clamp,
  degrees,
  distance,
  headingTo,
  radians,
  wrapAngle,
} from "./math";
import { advanceMark, createRace } from "./race";
import {
  type Boat,
  COURSE,
  MARK,
  MAX_TICKS,
  type Race,
  STEP,
  type Vec,
} from "./types";
import { visiblePressure, windAt } from "./wind";

export const FLEET = [
  {
    id: "aurora",
    name: "Aurora",
    color: 0xef8354,
    profile: "balanced",
    ja: "堅実にコースをつなぐ",
    en: "Balance progress and risk",
  },
  {
    id: "zephyr",
    name: "Zephyr",
    color: 0x4fa8ce,
    profile: "pressure",
    ja: "ブローを拾って伸ばす",
    en: "Seek visible pressure",
  },
  {
    id: "coral",
    name: "Coral",
    color: 0xd9a548,
    profile: "windward",
    ja: "風上への効率を重視",
    en: "Prioritize windward progress",
  },
  {
    id: "jade",
    name: "Jade",
    color: 0x4ca991,
    profile: "opportunist",
    ja: "風の変化から好機を狙う",
    en: "Exploit shifts and openings",
  },
] as const;
export type TacticPlan = {
  mode: "angle" | "pressure" | "mark" | "finish";
  angle: number;
  target: Vec | null;
  changedTick: number;
};
export type FleetRace = Race & {
  plans: Record<string, TacticPlan>;
  contactTicks: Record<string, number>;
};

export function createFleetRace(
  seed = 12,
  scenario: Race["scenario"] = "dynamic",
): FleetRace {
  const race = createRace({ seed, scenario, withOpponent: true });
  const slots = [-15, -5, 5, 15];
  // Rotate starting slots between races; profile never changes physical performance.
  const offset = ((seed % 4) + 4) % 4;
  const boats = FLEET.map((meta, i) => ({
    ...race.boats[0],
    id: meta.id,
    color: meta.color,
    x: slots[(i + offset) % 4],
  }));
  return {
    ...race,
    boats,
    plans: Object.fromEntries(
      boats.map((b) => [
        b.id,
        { mode: "angle", angle: radians(46), target: null, changedTick: -240 },
      ]),
    ),
    contactTicks: {},
  };
}

export function fleetObservation(race: FleetRace, boatId: string) {
  const boat = race.boats.find((b) => b.id === boatId);
  if (!boat) throw new Error("unknown_boat");
  const wind = windAt(
    race.scenario,
    race.seed,
    race.tick * STEP,
    boat.x,
    boat.y,
  );
  const view = (b: Boat) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    headingDeg: degrees(b.heading),
    speedMps: b.speed,
    tackSide: b.tackSide,
    leg: b.leg,
    markPhase: b.markPhase,
  });
  return {
    version: "fleet-observation-v2" as const,
    simulationTick: race.tick,
    boat: view(boat),
    others: race.boats.filter((b) => b.id !== boatId).map(view),
    wind: { directionDeg: degrees(wind.direction), speedMps: wind.speed },
    pressure: visiblePressure(race.scenario, race.seed, race.tick * STEP),
    mark: { ...MARK },
    profile: FLEET.find((b) => b.id === boatId)?.profile ?? "balanced",
    currentPlan: {
      mode: race.plans[boatId].mode,
      relativeWindDeg: (race.plans[boatId].angle * 180) / Math.PI,
      target: race.plans[boatId].target
        ? { ...race.plans[boatId].target }
        : null,
    },
  };
}
export type FleetObservation = ReturnType<typeof fleetObservation>;

export function fleetOptions(observation: FleetObservation): string[] {
  if (observation.boat.leg === "finished") return ["hold_course"];
  const options = ["hold_course"];
  if (observation.boat.leg === "downwind")
    options.push("jibe_now", "head_to_finish");
  else {
    options.push("tack_now");
    if (distance(observation.boat, observation.mark) < 45)
      options.push("approach_mark");
  }
  for (const patch of observation.pressure) {
    if (
      observation.boat.leg === "upwind" &&
      !(patch.y > observation.boat.y + 5 && patch.y < 120)
    )
      continue;
    if (
      observation.boat.leg === "downwind" &&
      !(patch.y < observation.boat.y - 5 && patch.y > -15)
    )
      continue;
    options.push(`seek_visible_pressure_${patch.id}`);
  }
  return options;
}

export function applyFleetTactic(
  race: FleetRace,
  boatId: string,
  selected: string,
): FleetRace {
  if (race.status !== "running") throw new Error("race_not_running");
  const observation = fleetObservation(race, boatId);
  if (!fleetOptions(observation).includes(selected))
    throw new Error("ineligible_tactic");
  const boat = race.boats.find((b) => b.id === boatId) as Boat;
  const relative = wrapAngle(
    boat.heading - radians(observation.wind.directionDeg),
  );
  const current = race.plans[boatId];
  let plan: TacticPlan = { ...current, changedTick: race.tick };
  if (selected === "tack_now" || selected === "jibe_now")
    plan = {
      mode: "angle",
      angle:
        -(Math.sign(relative) || boat.tackSide) *
        radians(selected === "tack_now" ? 46 : 150),
      target: null,
      changedTick: race.tick,
    };
  if (selected === "approach_mark")
    plan = { ...plan, mode: "mark", target: null };
  if (selected === "head_to_finish")
    plan = { ...plan, mode: "finish", target: null };
  if (selected.startsWith("seek_visible_pressure_")) {
    const patch = observation.pressure.find(
      (p) => selected === `seek_visible_pressure_${p.id}`,
    );
    if (!patch) throw new Error("pressure_not_visible");
    plan = { ...plan, mode: "pressure", target: { x: patch.x, y: patch.y } };
  }
  return { ...race, plans: { ...race.plans, [boatId]: plan } };
}

function markTarget(boat: Boat): Vec {
  return boat.markPhase === 2
    ? { x: -12, y: MARK.y }
    : boat.markPhase === 1
      ? { x: 0, y: MARK.y + 12 }
      : { x: 12, y: MARK.y - 2 };
}

function desiredHeading(boat: Boat, race: FleetRace): number {
  const plan = race.plans[boat.id];
  const wind = windAt(
    race.scenario,
    race.seed,
    race.tick * STEP,
    boat.x,
    boat.y,
  );
  const outside =
    boat.x <= COURSE.minX + 3 ||
    boat.x >= COURSE.maxX - 3 ||
    boat.y >= COURSE.maxY - 3 ||
    boat.y <= COURSE.minY + 3;
  let target: number;
  if (outside) target = headingTo(boat, { x: 0, y: 65 });
  else if (plan.mode === "angle") target = wind.direction + plan.angle;
  else
    target = headingTo(
      boat,
      plan.mode === "mark"
        ? boat.leg === "downwind"
          ? { x: 0, y: -8 }
          : markTarget(boat)
        : plan.mode === "finish"
          ? { x: 0, y: -8 }
          : (plan.target ?? boat),
    );
  // A low-level no-go guard retains the current tack. Tactical reversals belong
  // to Decider; this does not secretly choose an optimal upwind route.
  if (Math.abs(wrapAngle(target - wind.direction)) < radians(38))
    target = wind.direction + boat.tackSide * radians(46);
  return wrapAngle(target);
}

export function stepFleetRace(race: FleetRace): FleetRace {
  if (race.status !== "running") return race;
  const next = race.boats.map((boat) => {
    const target = desiredHeading(boat, race);
    const result = stepBoat(
      boat,
      {
        rudder: clamp(wrapAngle(target - boat.heading) * 4, -1, 1),
        autoTrim: true,
        mainSheet: 0.3,
      },
      windAt(race.scenario, race.seed, race.tick * STEP, boat.x, boat.y),
      race.tick,
    );
    return {
      ...result,
      x: clamp(result.x, COURSE.minX, COURSE.maxX),
      y: clamp(result.y, COURSE.minY, COURSE.maxY),
    };
  });
  const contactTicks = { ...race.contactTicks };
  let contacts = race.contacts;
  for (let i = 0; i < next.length; i++)
    for (let j = i + 1; j < next.length; j++) {
      if (next[i].leg === "finished" || next[j].leg === "finished") continue;
      const d = distance(next[i], next[j]);
      if (d >= 3) continue;
      const dx = d > 0.001 ? (next[i].x - next[j].x) / d : 1;
      const dy = d > 0.001 ? (next[i].y - next[j].y) / d : 0;
      const key = `${i}_${j}`;
      const penalty = race.tick - (contactTicks[key] ?? -30) >= 30;
      for (const [index, sign] of [
        [i, 1],
        [j, -1],
      ])
        next[index] = {
          ...next[index],
          x: next[index].x + dx * (3.1 - d) * 0.5 * sign,
          y: next[index].y + dy * (3.1 - d) * 0.5 * sign,
          speed: next[index].speed * (penalty ? 0.88 : 1),
        };
      if (penalty) {
        contacts++;
        contactTicks[key] = race.tick;
      }
    }
  const boats = next.map((boat, i) =>
    advanceMark(race.boats[i], boat, (race.tick + 1) * STEP),
  );
  return {
    ...race,
    boats,
    contacts,
    contactTicks,
    tick: race.tick + 1,
    status: boats.every((b) => b.leg === "finished")
      ? "finished"
      : race.tick + 1 >= MAX_TICKS
        ? "timed_out"
        : "running",
  };
}

// Only the explicitly labelled, network-free preview uses this rule policy.
export function previewTactic(observation: FleetObservation): string {
  const { boat, mark, profile } = observation;
  if (boat.leg === "finished") return "hold_course";
  if (boat.leg === "downwind") return "head_to_finish";
  if (distance(boat, mark) < 42) return "approach_mark";
  const wind = radians(observation.wind.directionDeg);
  const toMark = headingTo(boat, mark);
  const threshold =
    profile === "windward" ? 0.55 : profile === "opportunist" ? 0.9 : 0.7;
  if (
    Math.abs(boat.x - mark.x) > Math.max(12, (mark.y - boat.y) * threshold) &&
    Math.sign(wrapAngle(toMark - wind)) !== boat.tackSide
  )
    return "tack_now";
  if (profile === "pressure") {
    const patch = observation.pressure.find(
      (p) =>
        p.y > boat.y + 10 &&
        p.y < mark.y &&
        Math.sign(p.x - boat.x) === boat.tackSide,
    );
    if (patch) return `seek_visible_pressure_${patch.id}`;
  }
  return "hold_course";
}

/** Approximate course distance still to sail; -1 once finished. */
export function fleetRemaining(boat: Boat): number {
  return boat.leg === "finished"
    ? -1
    : boat.leg === "downwind"
      ? distance(boat, { x: 0, y: 0 })
      : MARK.y + 40 + distance(boat, MARK) - boat.markPhase * 10;
}
export function fleetRanking(race: FleetRace): Boat[] {
  return [...race.boats].sort((a, b) =>
    a.finishTime !== null && b.finishTime !== null
      ? a.finishTime - b.finishTime
      : fleetRemaining(a) - fleetRemaining(b),
  );
}
export function fleetWinners(race: FleetRace): string[] {
  if (race.status === "aborted") return [];
  const finishers = race.boats.filter((b) => b.finishTime !== null);
  if (!finishers.length) return [];
  const first = Math.min(...finishers.map((b) => b.finishTime as number));
  return finishers
    .filter((b) => Math.abs((b.finishTime as number) - first) < 1e-6)
    .map((b) => b.id);
}
