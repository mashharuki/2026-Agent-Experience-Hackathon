export const PHYSICS_VERSION = "sailing-v2";
export type Scenario = "steady" | "shift" | "pressure" | "dynamic";
export type Vec = { x: number; y: number };
export type Wind = { direction: number; speed: number };
export type Pressure = Vec & { id: string; radius: number; extraSpeed: number };
export type Control = {
  rudder: number;
  mainSheet: number;
  autoTrim: boolean;
  maneuver?: "tack" | "jibe";
};
export type Boat = Vec & {
  id: "player" | "rival";
  heading: number;
  speed: number;
  mainSheet: number;
  autoTrim: boolean;
  rudder: number;
  targetHeading: number | null;
  tackSide: number;
  tacks: number;
  jibes: number;
  lastManeuverTick: number;
  leg: "upwind" | "downwind" | "finished";
  markPhase: number;
  finishTime: number | null;
};
export type RaceStatus =
  | "ready"
  | "running"
  | "paused"
  | "finished"
  | "timed_out"
  | "aborted";
export type Race = {
  version: typeof PHYSICS_VERSION;
  windVersion: "wind-v2";
  scenario: Scenario;
  seed: number;
  withOpponent: boolean;
  tick: number;
  status: RaceStatus;
  boats: [Boat, Boat];
  contacts: number;
  lastContactTick: number;
};
export const STEP = 1 / 30;
export const MAX_TICKS = 5400;
export const MARK = { x: 0, y: 100 };
export const COURSE = { minX: -160, maxX: 160, minY: -35, maxY: 185 };
