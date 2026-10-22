import { describe, expect, it } from "vitest";
import {
  applyFleetTactic,
  createFleetRace,
  FLEET,
  type FleetRace,
  fleetObservation,
  fleetOptions,
  fleetRanking,
  fleetRemaining,
  fleetWinners,
  previewTactic,
  stepFleetRace,
} from "../src/index";

describe("spectator fleet", () => {
  it("creates four equal boats with stable identities and rotates starting slots", () => {
    const race = createFleetRace(12);
    expect(race.boats.map((b) => b.id)).toEqual(FLEET.map((b) => b.id));
    expect(new Set(race.boats.map((b) => b.speed)).size).toBe(1);
    expect(new Set(race.boats.map((b) => b.x)).size).toBe(4);
    expect(createFleetRace(13).boats[0].x).not.toBe(race.boats[0].x);
  });
  it("keeps seeds, future weather and predictions out of each boat observation", () => {
    const race = createFleetRace();
    for (const boat of race.boats) {
      const observation = fleetObservation(race, boat.id);
      expect(observation.others).toHaveLength(3);
      expect(JSON.stringify(observation)).not.toMatch(/seed|future|prediction/);
      observation.boat.x = 999;
      expect(boat.x).not.toBe(999);
    }
  });
  it("rejects a hidden gust or wrong-leg maneuver and changes actual tracks", () => {
    const race = {
      ...createFleetRace(12, "steady"),
      status: "running" as const,
    };
    expect(() => applyFleetTactic(race, "aurora", "jibe_now")).toThrow(
      "ineligible_tactic",
    );
    expect(() =>
      applyFleetTactic(race, "aurora", "seek_visible_pressure_gust_999"),
    ).toThrow("ineligible_tactic");
    let hold: FleetRace = race;
    let tack = applyFleetTactic(race, "aurora", "tack_now");
    for (let tick = 0; tick < 180; tick++) {
      hold = stepFleetRace(hold);
      tack = stepFleetRace(tack);
    }
    expect(Math.abs(tack.boats[0].x - hold.boats[0].x)).toBeGreaterThan(10);
    expect(tack.boats[0].tacks).toBe(1);
  });
  it("does not award a provisional leader when no boat finished or the race was aborted", () => {
    const race = createFleetRace();
    race.boats[0].y = 70;
    expect(fleetRanking(race)[0].id).toBe("aurora");
    expect(fleetWinners(race)).toEqual([]);
    race.boats[1] = { ...race.boats[1], leg: "finished", finishTime: 80 };
    race.boats[2] = { ...race.boats[2], leg: "finished", finishTime: 80 };
    expect(fleetWinners({ ...race, status: "finished" })).toEqual([
      "zephyr",
      "coral",
    ]);
    expect(fleetWinners({ ...race, status: "aborted" })).toEqual([]);
  });
  it("exposes the remaining distance that orders the provisional ranking", () => {
    const race = createFleetRace();
    race.boats[3].y = 60;
    const ranked = fleetRanking(race);
    const remaining = ranked.map(fleetRemaining);
    expect(remaining).toEqual([...remaining].sort((a, b) => a - b));
    expect(ranked[0].id).toBe("jade");
    expect(
      fleetRemaining({ ...race.boats[0], leg: "finished", finishTime: 70 }),
    ).toBe(-1);
  });
  for (const scenario of ["steady", "shift", "pressure", "dynamic"] as const) {
    it(`can complete a preview race in ${scenario} without modifying prior state`, () => {
      let race: FleetRace = {
        ...createFleetRace(12, scenario),
        status: "running",
      };
      const before = JSON.stringify(race);
      const original = race;
      for (let tick = 0; tick < 5400 && race.status === "running"; tick++) {
        if (tick % 240 === 0)
          for (const boat of race.boats) {
            const observation = fleetObservation(race, boat.id);
            const selected = previewTactic(observation);
            expect(fleetOptions(observation)).toContain(selected);
            race = applyFleetTactic(race, boat.id, selected);
          }
        race = stepFleetRace(race);
      }
      expect(JSON.stringify(original)).toBe(before);
      expect(race.tick).toBeLessThanOrEqual(5400);
      expect(fleetWinners(race).length).toBeGreaterThan(0);
      expect(
        race.boats.every(
          (b) => Number.isFinite(b.x) && Number.isFinite(b.speed),
        ),
      ).toBe(true);
    });
  }
});
