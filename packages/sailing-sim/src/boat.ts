import { clamp, radians, wrapAngle } from "./math";
import { type Boat, type Control, STEP, type Wind } from "./types";

// Game approximation, not measured Snipe polars. Inputs are TRUE wind.
const POLAR = [
  [0, 0],
  [34, 0],
  [38, 0.42],
  [45, 0.64],
  [60, 0.76],
  [90, 0.9],
  [120, 0.82],
  [150, 0.7],
  [180, 0.61],
];
export function polarSpeed(windSpeed: number, angle: number): number {
  const a = (Math.abs(wrapAngle(angle)) * 180) / Math.PI;
  for (let i = 1; i < POLAR.length; i++) {
    if (a <= POLAR[i][0]) {
      const [left, low] = POLAR[i - 1];
      const [right, high] = POLAR[i];
      return Math.min(
        4.3,
        Math.max(0, windSpeed) *
          (low + ((high - low) * (a - left)) / (right - left)),
      );
    }
  }
  return 0;
}

export function apparentWind(boat: Boat, wind: Wind): Wind {
  const x =
    -Math.sin(wind.direction) * wind.speed -
    Math.sin(boat.heading) * boat.speed;
  const y =
    -Math.cos(wind.direction) * wind.speed -
    Math.cos(boat.heading) * boat.speed;
  return { speed: Math.hypot(x, y), direction: Math.atan2(-x, -y) };
}

export function stepBoat(
  original: Boat,
  input: Control,
  wind: Wind,
  tick: number,
): Boat {
  if (original.leg === "finished") return original;
  const boat = { ...original };
  const relative = wrapAngle(boat.heading - wind.direction);
  if (input.maneuver && boat.targetHeading === null) {
    const angle = input.maneuver === "tack" ? radians(46) : radians(150);
    boat.targetHeading = wrapAngle(
      wind.direction - (Math.sign(relative) || 1) * angle,
    );
  }
  if (Math.abs(input.rudder) > 0.1) boat.targetHeading = null;
  let rudder = clamp(input.rudder, -1, 1);
  if (boat.targetHeading !== null) {
    const error = wrapAngle(boat.targetHeading - boat.heading);
    rudder = clamp(error * 4, -1, 1);
    if (Math.abs(error) < 0.025) boat.targetHeading = null;
  }
  boat.rudder = rudder;
  boat.heading = wrapAngle(
    // Shared player/opponent limit. Retain steerage in a game-model tack
    // instead of coupling a long no-go stall to an almost stationary turn.
    boat.heading + rudder * (0.55 + 0.45 * Math.min(1, boat.speed / 2)) * STEP,
  );
  const awa = Math.abs(
    wrapAngle(apparentWind(boat, wind).direction - boat.heading),
  );
  const idealSheet = clamp((awa - radians(28)) / radians(145), 0, 0.92);
  boat.autoTrim = input.autoTrim;
  boat.mainSheet = input.autoTrim ? idealSheet : clamp(input.mainSheet, 0, 1);
  const efficiency = Math.max(
    0.08,
    1 - Math.abs(boat.mainSheet - idealSheet) * 1.6,
  );
  const target =
    polarSpeed(wind.speed, boat.heading - wind.direction) * efficiency;
  const inIrons =
    Math.abs(wrapAngle(boat.heading - wind.direction)) < radians(34);
  // Momentum carries the hull across the no-go zone; a sustained head-to-wind
  // heading still loses all drive. This is a game approximation, not Snipe data.
  const deceleration = inIrons ? 0.45 : 0.85;
  boat.speed +=
    (target - boat.speed) * (target < boat.speed ? deceleration : 0.25) * STEP;
  boat.speed *= 1 - Math.abs(rudder) * 0.13 * STEP;
  const newRelative = wrapAngle(boat.heading - wind.direction);
  if (
    Math.abs(newRelative) > radians(5) &&
    Math.abs(newRelative) < radians(175)
  ) {
    const side = Math.sign(newRelative);
    if (
      side !== boat.tackSide &&
      Math.abs(rudder) > 0.05 &&
      tick - boat.lastManeuverTick > 20
    ) {
      const tack = Math.abs(newRelative) < Math.PI / 2;
      boat.speed *= tack ? 0.66 : 0.88;
      boat.tacks += Number(tack);
      boat.jibes += Number(!tack);
      boat.lastManeuverTick = tick;
    }
    boat.tackSide = side;
  }
  boat.x += Math.sin(boat.heading) * boat.speed * STEP;
  boat.y += Math.cos(boat.heading) * boat.speed * STEP;
  return boat;
}
