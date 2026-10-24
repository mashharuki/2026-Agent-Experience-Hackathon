import { createFleetRace, STEP } from "sailing-sim";
import { describe, expect, it, vi } from "vitest";
import { CameraDirector } from "./camera-director";
import { FleetReplay } from "./fleet-replay";
import { FleetRuntime, replayFleet } from "./fleet-runtime";
import { highlights, RaceEvents, spotlight } from "./race-events";
import { waveSample } from "./wave-field";

describe("spectator presentation stays independent of sailing", () => {
  it("detects observed maneuvers and completion without mutating the race", () => {
    const a = createFleetRace(12, "steady");
    const b = structuredClone(a);
    b.tick = 30;
    b.boats[0].tacks++;
    b.boats[0].targetHeading = 1;
    const events = new RaceEvents();
    events.update(a, b);
    expect(events.events.map((e) => e.kind)).toEqual(["tack"]);
    const c = structuredClone(b);
    c.tick = 100;
    c.boats[0].targetHeading = null;
    events.update(b, c);
    expect(events.events.at(-1)?.kind).toBe("settled");
    expect(a.boats[0].tacks).toBe(0);
    expect(spotlight(events.events, 100)?.kind).toBe("tack");
    expect(spotlight(events.events, 500)).toBeUndefined();
  });
  it("honors manual camera and minimum shot length", () => {
    const director = new CameraDirector();
    const events = [
      { id: "one", tick: 10, boatId: "jade", kind: "mark" as const },
    ];
    director.manual(0);
    expect(director.choose(events, 10)).toBeNull();
    const next = [{ ...events[0], id: "two", tick: 400 }];
    expect(director.choose(next, 400)).toBe("jade");
    expect(
      director.choose([{ ...next[0], id: "three", tick: 410 }], 410),
    ).toBeNull();
    expect(highlights([...events, ...next])).toHaveLength(2);
  });
  it("replays exactly without extra transport calls or changing the live outcome", () => {
    const transport = vi.fn();
    const runtime = new FleetRuntime(transport);
    runtime.predict("coral");
    runtime.start();
    for (let i = 0; i < 250; i++) runtime.advance(100);
    runtime.finish();
    const record = runtime.recording();
    const final = structuredClone(runtime.race);
    const cache = new FleetReplay(record);
    for (const tick of [0, 30, 300, 600, 750])
      expect(cache.at(tick)).toEqual(replayFleet(record, tick));
    runtime.setReplay(0);
    runtime.playReplay(2);
    runtime.advance(100);
    expect(runtime.getSnapshot().replayTick).toBeCloseTo(0.2 / STEP);
    expect(runtime.race).toEqual(final);
    expect(transport).not.toHaveBeenCalled();
    runtime.pause();
    runtime.advance(100);
    expect(runtime.getSnapshot().replayTick).toBeCloseTo(0.2 / STEP);
    runtime.configure("steady");
    expect(runtime.getSnapshot().replayTick).toBeNull();
  });
  it("does not allow replay to interrupt an active race", () => {
    const runtime = new FleetRuntime();
    runtime.predict("jade");
    runtime.start();
    runtime.setReplay(0);
    expect(runtime.replayTick).toBeNull();
  });
  it("matches analytic wave slopes to numeric surface derivatives", () => {
    for (const t of [0, 3, 100]) {
      const s = waveSample(12, 17, t),
        h = 0.0001;
      expect(s.dx).toBeCloseTo(
        (waveSample(12 + h, 17, t).height - waveSample(12 - h, 17, t).height) /
          (2 * h),
        6,
      );
      expect(s.dz).toBeCloseTo(
        (waveSample(12, 17 + h, t).height - waveSample(12, 17 - h, t).height) /
          (2 * h),
        6,
      );
    }
  });
});
