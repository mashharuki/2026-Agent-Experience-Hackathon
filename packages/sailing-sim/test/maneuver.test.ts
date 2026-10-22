import { describe, expect, it } from "vitest";
import { createRace, STEP, stepBoat, wrapAngle } from "../src/index";

const control = { rudder: 0, mainSheet: 0.3, autoTrim: true };
const wind = { direction: 0, speed: 5 };

describe("tack responsiveness", () => {
  it("still stalls when held head to wind", () => {
    let boat = { ...createRace().boats[0], heading: 0, speed: 2.5 };
    for (let tick = 0; tick < 600; tick++)
      boat = stepBoat(boat, control, wind, tick);
    expect(boat.speed).toBeLessThan(0.001);
  });
  it("lets manual rudder cancel the assisted tack immediately", () => {
    let boat = stepBoat(
      createRace().boats[0],
      {
        ...control,
        maneuver: "tack",
      },
      wind,
      0,
    );
    const before = boat.heading;
    boat = stepBoat(boat, { ...control, rudder: 1 }, wind, 1);
    expect(boat.targetHeading).toBeNull();
    expect(boat.heading).toBeGreaterThan(before);
  });
  it("uses identical turn and loss behavior for both boats", () => {
    const [player, rival] = createRace().boats;
    const input = { ...control, maneuver: "tack" as const };
    const one = stepBoat(player, input, wind, 0);
    const two = stepBoat({ ...rival, x: player.x }, input, wind, 0);
    expect({ ...one, id: "rival" }).toEqual(two);
  });
  for (const speed of [0.5, 1.3, 2.5]) {
    for (const side of [-1, 1]) {
      it(`finishes a continuous tack from ${speed} m/s on side ${side}`, () => {
        const heading = (side * 46 * Math.PI) / 180;
        let boat = {
          ...createRace().boats[0],
          heading,
          speed,
          tackSide: side,
        };
        let elapsed = 0;
        let minimumSpeed = speed;
        for (let tick = 0; tick < 450; tick++) {
          const before = boat;
          boat = stepBoat(
            boat,
            {
              ...control,
              maneuver: tick === 0 ? "tack" : undefined,
            },
            wind,
            tick,
          );
          minimumSpeed = Math.min(minimumSpeed, boat.speed);
          expect(
            Math.abs(wrapAngle(boat.heading - before.heading)),
          ).toBeLessThanOrEqual(STEP + 1e-9);
          elapsed = (tick + 1) * STEP;
          if (boat.targetHeading === null) break;
        }
        expect(boat.targetHeading).toBeNull();
        expect(Math.abs(wrapAngle(boat.heading + heading))).toBeLessThan(0.025);
        expect(boat.tacks).toBe(1);
        expect(minimumSpeed).toBeLessThan(speed);
        expect(elapsed).toBeLessThanOrEqual(3.5);
      });
    }
  }
});
