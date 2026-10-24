import { type Scenario, windAt } from "sailing-sim";
/** Height-field waves: horizontal displacement deliberately omitted to keep CPU/GPU sampling exact. */
export const PRESENTATION_VERSION = "sea-v3";
export const WAVES = [
  { x: 0.1, z: 0.17, speed: 0.88, amplitude: 0.22 },
  { x: -0.29, z: 0.19, speed: 1.33, amplitude: 0.1 },
  { x: 0.61, z: 0.42, speed: 2.12, amplitude: 0.038 },
  { x: -0.93, z: 0.82, speed: 2.75, amplitude: 0.016 },
] as const;
export type WaveEnvironment = { angle: number; amplitude: number };
export function waveEnvironment(
  scenario: Scenario,
  seed: number,
  time: number,
): WaveEnvironment {
  // Trailing samples only, independent of camera, frame rate and future weather.
  const winds = [0, 6, 12].map((age) =>
    windAt(scenario, seed, Math.max(0, time - age), 0, 0),
  );
  const x = winds.reduce((v, w) => v + Math.sin(w.direction), 0);
  const z = winds.reduce((v, w) => v + Math.cos(w.direction), 0);
  return {
    angle: Math.atan2(x, z),
    amplitude: Math.max(
      0.55,
      Math.min(1.5, winds.reduce((v, w) => v + w.speed, 0) / 21),
    ),
  };
}
export function waveSample(
  x: number,
  z: number,
  time: number,
  env: WaveEnvironment = { angle: 0, amplitude: 1 },
) {
  const c = Math.cos(env.angle),
    s = Math.sin(env.angle);
  const px = c * x - s * z,
    pz = s * x + c * z;
  let height = 0,
    dx = 0,
    dz = 0;
  for (const w of WAVES) {
    const phase = px * w.x + pz * w.z - time * w.speed;
    // A small harmonic sharpens crests without pretending to simulate fluid dynamics.
    height += w.amplitude * (Math.sin(phase) + 0.16 * Math.sin(2 * phase));
    const slope = w.amplitude * (Math.cos(phase) + 0.32 * Math.cos(2 * phase));
    dx += slope * w.x;
    dz += slope * w.z;
  }
  return {
    height: height * env.amplitude,
    dx: (dx * c + dz * s) * env.amplitude,
    dz: (-dx * s + dz * c) * env.amplitude,
  };
}
const f = (v: number) => v.toFixed(6);
export const waveGLSL = `uniform vec2 uWaveEnv; float heightAt(vec2 p) { float c=cos(uWaveEnv.x),s=sin(uWaveEnv.x); p=vec2(c*p.x-s*p.y,s*p.x+c*p.y); return uWaveEnv.y*(${WAVES.map(
  (w) => {
    const phase = `(dot(p,vec2(${f(w.x)},${f(w.z)}))-uTime*${f(w.speed)})`;
    return `${f(w.amplitude)}*(sin(${phase})+.16*sin(2.*${phase}))`;
  },
).join("+")}); }`;
