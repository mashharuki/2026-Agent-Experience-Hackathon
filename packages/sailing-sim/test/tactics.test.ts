import { describe, expect, it } from "vitest";
import {
  applyTactic,
  createObservation,
  createRace,
  distance,
  eligibleTactics,
  MARK,
  type Race,
  stepRace,
} from "../src/index";

describe("tactical interface", () => {
  it("rejects unsupported actions, hidden targets and terminal races", () => {
    const race: Race = {
      ...createRace({ withOpponent: true }),
      status: "running",
    };
    expect(() => applyTactic(race, "teleport")).toThrow("ineligible_tactic");
    expect(() => applyTactic(race, "seek_visible_pressure_patch_0")).toThrow(
      "ineligible_tactic",
    );
    expect(() =>
      applyTactic({ ...race, status: "aborted" }, "hold_course"),
    ).toThrow("race_not_running");
  });
  it("does not allow a new tactic during a maneuver", () => {
    const race = createRace();
    race.boats[1] = { ...race.boats[1], targetHeading: -0.8 };
    expect(eligibleTactics(createObservation(race))).toEqual(["hold_course"]);
  });
  it("separates observations from the mutable world", () => {
    const race = createRace({ scenario: "pressure" });
    const observation = createObservation(race);
    observation.boat.x = 900;
    observation.mark.x = 100;
    expect(race.boats[1].x).toBe(7);
    expect(MARK.x).toBe(0);
    expect(JSON.stringify(observation)).not.toMatch(/seed|future/);
  });
  it("different selected tools produce different actual tracks", () => {
    const race: Race = {
      ...createRace({ withOpponent: true }),
      status: "running",
    };
    let hold = applyTactic(race, "hold_course");
    let tack = applyTactic(race, "tack_now");
    const control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
    for (let i = 0; i < 240; i++) {
      hold = stepRace(hold, control, control);
      tack = stepRace(tack, control, control);
    }
    expect(distance(hold.boats[1], tack.boats[1])).toBeGreaterThan(10);
    expect(tack.boats[1].tacks).toBe(1);
  });
});
