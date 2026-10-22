import type { Vec } from "./types";

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const wrapAngle = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));
export const headingTo = (from: Vec, to: Vec) =>
  Math.atan2(to.x - from.x, to.y - from.y);
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const degrees = (radians: number) =>
  ((radians * 180) / Math.PI + 360) % 360;
export const radians = (degrees: number) => (degrees * Math.PI) / 180;
