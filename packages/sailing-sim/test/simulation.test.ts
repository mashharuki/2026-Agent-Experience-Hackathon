import { describe, expect, it } from "vitest";
import {
  advanceMark,
  createObservation,
  createRace,
  headingTo,
  MARK,
  polarSpeed,
  stepBoat,
  stepRace,
  windAt,
  wrapAngle,
} from "../src/index";

const control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
const wind = { direction: 0, speed: 5 };

describe("sailing model", () => {
  it("normalizes the 359→0 degree boundary without a full rotation", () => {
    expect(wrapAngle((359 * Math.PI) / 180)).toBeCloseTo(-Math.PI / 180);
    expect(headingTo({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(0);
  });
  it("stalls into the wind, but sails upwind on a close-hauled heading", () => {
    expect(polarSpeed(5, 0)).toBe(0);
    expect(polarSpeed(5, Math.PI / 4)).toBeGreaterThan(2);
  });
  it("uses deterministic wind without frame-dependent randomness", () => {
    expect(windAt("pressure", 12, 50, 20, 80)).toEqual(
      windAt("pressure", 12, 50, 20, 80),
    );
    expect(windAt("shift", 12, 0, 0, 0).direction).not.toBe(
      windAt("shift", 12, 20, 0, 0).direction,
    );
  });
  it("loses speed after steering through the wind, exactly once", () => {
    let boat = { ...createRace().boats[0], heading: 0.3, speed: 2.5 };
    for (let tick = 0; tick < 100; tick++) {
      boat = stepBoat(
        boat,
        { ...control, maneuver: tick === 0 ? "tack" : undefined },
        wind,
        tick,
      );
    }
    expect(boat.heading).toBeLessThan(-0.4);
    expect(boat.tacks).toBe(1);
    expect(boat.speed).toBeLessThan(2.5);
  });
  it("makes bad manual trim slower than automatic trim", () => {
    const original = {
      ...createRace().boats[0],
      heading: Math.PI / 2,
      speed: 0,
    };
    let auto = original;
    let manual = original;
    for (let tick = 0; tick < 300; tick++) {
      auto = stepBoat(auto, control, wind, tick);
      manual = stepBoat(
        manual,
        { ...control, autoTrim: false, mainSheet: 0 },
        wind,
        tick,
      );
    }
    expect(auto.speed).toBeGreaterThan(manual.speed * 1.3);
  });
  it("does not mistake a downwind jibe for a tack", () => {
    let boat = { ...createRace().boats[0], heading: 2.6, speed: 2 };
    for (let tick = 0; tick < 100; tick++) {
      boat = stepBoat(
        boat,
        { ...control, maneuver: tick === 0 ? "jibe" : undefined },
        wind,
        tick,
      );
    }
    expect(boat.jibes).toBe(1);
    expect(boat.tacks).toBe(0);
  });
});

describe("course and race lifecycle", () => {
  it("requires east, north, west gates in order before the downwind leg", () => {
    const boat = createRace().boats[0];
    const west = advanceMark(boat, { ...boat, x: -12, y: MARK.y }, 1);
    expect(west.leg).toBe("upwind");
    const east = advanceMark(west, { ...west, x: 12, y: MARK.y }, 2);
    const north = advanceMark(east, { ...east, x: 0, y: MARK.y + 12 }, 3);
    const rounded = advanceMark(north, { ...north, x: -12, y: MARK.y }, 4);
    expect(rounded.leg).toBe("downwind");
  });
  it("rejects reverse crossing and interpolates a valid finish", () => {
    const boat = {
      ...createRace().boats[0],
      leg: "downwind" as const,
      x: 0,
      y: -1,
    };
    expect(advanceMark(boat, { ...boat, y: 1 }, 10).finishTime).toBeNull();
    const before = { ...boat, y: 0.02 };
    expect(
      advanceMark(before, { ...before, y: -0.02 }, 10).finishTime,
    ).toBeCloseTo(10 - 1 / 60);
  });
  it("keeps paused and terminal states unchanged", () => {
    for (const status of [
      "paused",
      "finished",
      "timed_out",
      "aborted",
    ] as const) {
      const race = { ...createRace(), status };
      expect(stepRace(race, control)).toBe(race);
    }
  });
  it("ends at 180 simulation seconds", () => {
    const race = { ...createRace(), status: "running" as const, tick: 5399 };
    expect(stepRace(race, control).status).toBe("timed_out");
  });
  it("replays equal inputs deterministically and never mutates old states", () => {
    const original = { ...createRace(), status: "running" as const };
    const copy = JSON.stringify(original);
    let one: ReturnType<typeof createRace> = original;
    let two: ReturnType<typeof createRace> = original;
    for (let i = 0; i < 90; i++) {
      one = stepRace(one, control);
      two = stepRace(two, control);
    }
    expect(one).toEqual(two);
    expect(JSON.stringify(original)).toBe(copy);
    expect(one.boats[0].y).toBeGreaterThan(0);
  });
  it("does not expose seed or future wind to tactical observations", () => {
    const observation = createObservation(createRace());
    const text = JSON.stringify(observation);
    expect(text).not.toMatch(/seed|future|windVersion/);
    expect(observation.visiblePressure.length).toBeLessThanOrEqual(3);
  });
});
