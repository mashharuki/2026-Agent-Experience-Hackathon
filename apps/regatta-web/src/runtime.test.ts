import { describe, expect, it } from "vitest";
import { PracticeRuntime, replayAt } from "./runtime";

describe("practice runtime", () => {
  it("keeps presentation choices out of physics and replay commands", () => {
    const baseline = new PracticeRuntime();
    const changed = new PracticeRuntime();
    baseline.start();
    changed.start();
    for (let tick = 0; tick < 300; tick++) {
      if (tick === 20) {
        changed.setView("helm");
        changed.setQuality("economy");
      }
      if (tick === 60) {
        changed.setView("overview");
        changed.setQuality("high");
      }
      if (tick === 120) changed.setView("follow");
      baseline.advance(1000 / 30);
      changed.advance(1000 / 30);
    }
    expect(changed.race).toEqual(baseline.race);
    expect(changed.recording()).toEqual(baseline.recording());
    expect(changed.getSnapshot().quality).toBe("high");
  });
  it("pauses both boats and wind, then resumes without fast-forward", () => {
    const runtime = new PracticeRuntime();
    runtime.start();
    runtime.advance(200);
    runtime.setControl({ rudder: 1 });
    runtime.pause();
    const before = runtime.race;
    runtime.advance(50000);
    expect(runtime.race).toBe(before);
    expect(runtime.control.rudder).toBe(0);
    runtime.resume();
    runtime.advance(1000 / 30);
    expect(runtime.race.tick).toBe(before.tick + 1);
  });
  it("bounds catch-up after dropped frames", () => {
    const runtime = new PracticeRuntime();
    runtime.start();
    runtime.advance(60000);
    expect(runtime.race.tick).toBeLessThanOrEqual(8);
    expect(runtime.race.tick).toBeGreaterThan(0);
  });
  it("rejects resume after end and resets all input and history on a new race", () => {
    const runtime = new PracticeRuntime();
    runtime.start();
    runtime.setControl({ rudder: -1 });
    runtime.advance(200);
    runtime.finish();
    const tick = runtime.race.tick;
    runtime.resume();
    runtime.advance(200);
    expect(runtime.race.tick).toBe(tick);
    runtime.configure("pressure", false);
    expect(runtime.race.status).toBe("ready");
    expect(runtime.race.tick).toBe(0);
    expect(runtime.trails[0]).toEqual([]);
    expect(runtime.recording().inputs).toEqual([]);
  });
  it("replays commands without a model or network", () => {
    const runtime = new PracticeRuntime();
    runtime.start();
    runtime.advance(200);
    runtime.setControl({ maneuver: "tack" });
    runtime.advance(200);
    runtime.setControl({ autoTrim: false, mainSheet: 0.8 });
    for (let i = 0; i < 60; i++) runtime.advance(1000 / 30);
    expect(replayAt(runtime.recording(), runtime.race.tick)).toEqual(
      runtime.race,
    );
    const record = runtime.recording();
    record.inputs[0].control.rudder = 1;
    expect(runtime.recording().inputs[0].control.rudder).toBe(0);
  });
  it("does not silently replay records made with different physics", () => {
    const runtime = new PracticeRuntime();
    const record = runtime.recording();
    expect(record.physicsVersion).toBe(runtime.race.version);
    Object.assign(record, { physicsVersion: "sailing-v1" });
    expect(() => replayAt(record, 0)).toThrow(
      "Unsupported replay physics version",
    );
  });
  it("freezes evolving weather on pause and reproduces it from a recording", () => {
    const runtime = new PracticeRuntime();
    runtime.configure("dynamic", false);
    runtime.start();
    for (let tick = 0; tick < 750; tick++) runtime.advance(1000 / 30);
    runtime.pause();
    const snapshot = runtime.getSnapshot();
    runtime.advance(60000);
    expect(runtime.getSnapshot().wind).toEqual(snapshot.wind);
    expect(runtime.race).toBe(snapshot.race);
    runtime.resume();
    runtime.advance(1000 / 30);
    expect(replayAt(runtime.recording(), runtime.race.tick)).toEqual(
      runtime.race,
    );
    const record = runtime.recording();
    Object.assign(record, { windVersion: "wind-v1" });
    expect(() => replayAt(record, 0)).toThrow(
      "Unsupported replay wind version",
    );
  });
});
