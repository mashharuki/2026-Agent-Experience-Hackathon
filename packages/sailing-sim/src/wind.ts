import { clamp, distance, radians } from "./math";
import { COURSE, type Pressure, type Scenario, type Wind } from "./types";

// Seeded targets are internal only; tactical observations expose current wind.
function sample(seed: number, period: number, channel: number): number {
  const value =
    Math.sin(seed * 12.9898 + period * 78.233 + channel * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function smooth(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function evolvingWind(seed: number, time: number): Wind {
  const period = Math.floor(time / 20);
  const previous = Math.max(0, period - 1);
  const blend = smooth((time - period * 20) / 5);
  const lerp = (channel: number) =>
    sample(seed, previous, channel) * (1 - blend) +
    sample(seed, period, channel) * blend;
  return {
    direction: radians(-17 + 34 * lerp(0) + 2 * Math.sin(time / 7)),
    speed: 4.3 + 1.8 * lerp(1),
  };
}

function evolvingPressure(seed: number, time: number): Pressure[] {
  const latest = Math.floor(time / 20);
  const patches: Pressure[] = [];
  // Each packet lasts 60 seconds; at most three exist. New packets form
  // upwind, drift through the course, and fade without wrapping/teleporting.
  for (let birth = latest - 2; birth <= latest; birth++) {
    const age = time - birth * 20;
    const fade = smooth(age / 5) * smooth((60 - age) / 10);
    if (fade <= 0) continue;
    const patch: Pressure = {
      id: `gust_${birth + 2}`,
      x: -90 + 180 * sample(seed, birth, 2) + 10 * Math.sin(age / 13 + birth),
      y: 210 - age * 5,
      radius: (26 + 10 * sample(seed, birth, 3)) * fade,
      extraSpeed: (1.2 + 1.2 * sample(seed, birth, 4)) * fade,
    };
    if (
      patch.y - patch.radius <= COURSE.maxY &&
      patch.y + patch.radius >= COURSE.minY
    )
      patches.push(patch);
  }
  return patches;
}

export function visiblePressure(
  scenario: Scenario,
  seed: number,
  time: number,
): Pressure[] {
  if (scenario === "dynamic") return evolvingPressure(seed, Math.max(0, time));
  if (scenario !== "pressure") return [];
  const phase = ((seed % 17) + 17) % 17;
  return [0, 1].map((i) => ({
    id: `patch_${i}`,
    x: i === 0 ? -55 : 58,
    y: 170 - ((time * 1.35 + i * 100 + phase) % 230),
    radius: 30,
    extraSpeed: i === 0 ? 2.4 : 1.7,
  }));
}

export function windAt(
  scenario: Scenario,
  seed: number,
  time: number,
  x: number,
  y: number,
): Wind {
  const base =
    scenario === "dynamic" ? evolvingWind(seed, Math.max(0, time)) : null;
  const phase = (seed % 31) / 31;
  const direction =
    scenario === "steady"
      ? 0
      : radians(12 * Math.sin(time / 13 + phase) + 5 * Math.sin(time / 5));
  const gust = visiblePressure(scenario, seed, time).reduce((sum, patch) => {
    const ratio = distance({ x, y }, patch) / patch.radius;
    return sum + patch.extraSpeed * Math.max(0, 1 - ratio * ratio);
  }, 0);
  return {
    direction: base?.direction ?? direction,
    speed: (base?.speed ?? 5) + gust,
  };
}
