import { describe, expect, it } from "vitest";
import {
  createObservation,
  createRace,
  STEP,
  visiblePressure,
  windAt,
  wrapAngle,
} from "../src/index";

describe("evolving sea conditions", () => {
  it("changes both background wind speed and direction across weather periods", () => {
    const samples = [0, 25, 45, 65, 85].map((time) =>
      windAt("dynamic", 12, time, 400, 400),
    );
    expect(
      Math.max(...samples.map((wind) => wind.speed)) -
        Math.min(...samples.map((wind) => wind.speed)),
    ).toBeGreaterThan(0.5);
    expect(
      Math.max(...samples.map((wind) => wind.direction)) -
        Math.min(...samples.map((wind) => wind.direction)),
    ).toBeGreaterThan(0.15);
  });
  it("never jumps at a weather boundary or when gusts enter/leave", () => {
    for (const x of [-80, 0, 80]) {
      for (const y of [0, 100, 170]) {
        let before = windAt("dynamic", 12, 0, x, y);
        for (let tick = 1; tick <= 5400; tick++) {
          const next = windAt("dynamic", 12, tick * STEP, x, y);
          expect(
            Math.abs(wrapAngle(next.direction - before.direction)),
          ).toBeLessThan(0.005);
          // Includes the gradient of a moving/fading gust, not just base wind.
          expect(
            Math.abs(next.speed - before.speed),
            `x=${x} y=${y} tick=${tick}`,
          ).toBeLessThan(0.1);
          expect(next.speed).toBeGreaterThanOrEqual(4.3);
          expect(next.speed).toBeLessThan(13.3);
          before = next;
        }
      }
    }
  });
  it("has no discontinuity at the 20-second target changes", () => {
    for (let seed = 0; seed < 10; seed++) {
      for (let time = 20; time <= 180; time += 20) {
        const before = windAt("dynamic", seed, time - 0.00001, 0, 100);
        const after = windAt("dynamic", seed, time + 0.00001, 0, 100);
        expect(Math.abs(after.speed - before.speed)).toBeLessThan(0.0001);
        expect(Math.abs(after.direction - before.direction)).toBeLessThan(
          0.0001,
        );
      }
    }
  });
  it("moves and renews visible gusts while preserving the identity of each packet", () => {
    const first = visiblePressure("dynamic", 12, 10);
    const later = visiblePressure("dynamic", 12, 11);
    const shared = first.find((patch) =>
      later.some((next) => next.id === patch.id),
    );
    expect(shared).toBeDefined();
    const moved = later.find((patch) => patch.id === shared?.id);
    expect(moved?.y).toBeCloseTo((shared?.y ?? 0) - 5);
    expect(visiblePressure("dynamic", 12, 70).map((p) => p.id)).not.toEqual(
      first.map((p) => p.id),
    );
    for (let time = 0; time <= 180; time++) {
      const patches = visiblePressure("dynamic", 12, time);
      expect(patches.length).toBeLessThanOrEqual(3);
      expect(new Set(patches.map((patch) => patch.id)).size).toBe(
        patches.length,
      );
    }
  });
  it("applies only the current visible gust footprint to local wind", () => {
    const patch = visiblePressure("dynamic", 12, 10)[0];
    expect(patch).toBeDefined();
    const center = windAt("dynamic", 12, 10, patch.x, patch.y);
    const outside = windAt("dynamic", 12, 10, 400, 400);
    expect(center.speed - outside.speed).toBeGreaterThanOrEqual(
      patch.extraSpeed - 1e-9,
    );
  });
  it("is deterministic and observations contain only the present sea state", () => {
    const race = { ...createRace({ scenario: "dynamic" }), tick: 900 };
    const observation = createObservation(race);
    expect(observation.visiblePressure).toEqual(
      visiblePressure("dynamic", race.seed, 30),
    );
    expect(JSON.stringify(observation)).not.toMatch(
      /seed|future|period|windVersion/,
    );
    expect(windAt("dynamic", 12, 30, 0, 0)).toEqual(
      windAt("dynamic", 12, 30, 0, 0),
    );
    expect(windAt("dynamic", 13, 30, 0, 0)).not.toEqual(
      windAt("dynamic", 12, 30, 0, 0),
    );
  });
});
