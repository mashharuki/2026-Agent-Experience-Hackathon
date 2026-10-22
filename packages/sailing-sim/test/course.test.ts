import { expect, it } from "vitest";
import { createRace, type Race, stepRace } from "../src/index";

for (const scenario of ["steady", "shift", "pressure", "dynamic"] as const) {
  it(`the practice opponent can round and finish in ${scenario}`, () => {
    let race: Race = {
      ...createRace({ scenario, withOpponent: true }),
      status: "running",
    };
    // Keep the test player clear of the opponent's course; collisions are tested separately.
    race.boats[0] = { ...race.boats[0], x: -145, y: -20, speed: 0, heading: 0 };
    for (let i = 0; i < 5400 && race.status === "running"; i++) {
      race = stepRace(race, { rudder: 0, mainSheet: 0.3, autoTrim: true });
    }
    expect({
      leg: race.boats[1].leg,
      phase: race.boats[1].markPhase,
      x: race.boats[1].x,
      y: race.boats[1].y,
    }).toMatchObject({ leg: "finished", phase: 3 });
    expect(race.boats[1].finishTime).toBeLessThan(180);
  });
}
