import { createFleetRace } from "sailing-sim";
import { describe, expect, it } from "vitest";
import {
  labelPosition,
  raceOutcome,
  standings,
  tacticKind,
} from "./presentation";

describe("raceOutcome", () => {
  it("is no_result when nobody finished", () =>
    expect(raceOutcome([], "aurora")).toBe("no_result"));
  it("is hit or miss against the winner", () => {
    expect(raceOutcome(["zephyr"], "zephyr")).toBe("hit");
    expect(raceOutcome(["zephyr"], "aurora")).toBe("miss");
  });
  it("treats a tie containing the prediction as a hit", () =>
    expect(raceOutcome(["coral", "jade"], "jade")).toBe("hit"));
  it("never reports hit or miss without a prediction", () =>
    expect(raceOutcome(["coral"], null)).toBe("unscored"));
});

describe("standings", () => {
  it("ranks with gaps to the leading unfinished boat and flags the prediction", () => {
    const rows = standings(createFleetRace(1, "steady"), "coral");
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(rows[0].gapMeters).toBe(0);
    expect(rows.every((r) => r.gapMeters !== null && r.gapMeters >= 0)).toBe(
      true,
    );
    expect(rows.filter((r) => r.isPrediction).map((r) => r.id)).toEqual([
      "coral",
    ]);
  });
  it("shows finish time for finishers and no gap for unfinished boats after timeout", () => {
    const race = createFleetRace(1, "steady");
    race.boats[0] = { ...race.boats[0], leg: "finished", finishTime: 80 };
    race.boats[2].y = 40;
    const rows = standings({ ...race, status: "timed_out" }, null);
    expect(rows[0]).toMatchObject({
      id: "aurora",
      finishTime: 80,
      gapMeters: null,
    });
    expect(rows[1]).toMatchObject({ id: "coral", gapMeters: 0 });
    expect(rows.slice(1).every((r) => typeof r.gapMeters === "number")).toBe(
      true,
    );
    expect(rows.some((r) => r.isPrediction)).toBe(false);
  });
});

describe("standings leader", () => {
  it("marks exactly one leader even when the next boat rounds to a 0 m gap", () => {
    const race = createFleetRace(1, "steady");
    race.boats[1] = {
      ...race.boats[1],
      x: race.boats[0].x,
      y: race.boats[0].y + 0.2,
    };
    const rows = standings(race, null);
    expect(rows.filter((r) => r.isLeader)).toHaveLength(1);
    expect(rows[0].isLeader).toBe(true);
  });
});

describe("tacticKind", () => {
  it("classifies tactics", () => {
    expect(tacticKind("hold_course")).toBe("hold");
    expect(tacticKind("tack_now")).toBe("maneuver");
    expect(tacticKind("jibe_now")).toBe("maneuver");
    expect(tacticKind("seek_visible_pressure_gust_3")).toBe("pressure");
    expect(tacticKind("approach_mark")).toBe("mark");
    expect(tacticKind("head_to_finish")).toBe("mark");
  });
});

describe("labelPosition", () => {
  it("maps the view center to the middle of the canvas", () =>
    expect(labelPosition({ x: 0, y: 0, z: 0.5 }, 800, 600)).toEqual({
      x: 400,
      y: 300,
    }));
  it("hides labels behind the camera or outside the view", () => {
    expect(labelPosition({ x: 0, y: 0, z: 1.2 }, 800, 600)).toBeNull();
    expect(labelPosition({ x: 1.3, y: 0, z: 0.5 }, 800, 600)).toBeNull();
    expect(labelPosition({ x: 0, y: -1.2, z: 0.5 }, 800, 600)).toBeNull();
  });
});
