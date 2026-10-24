import type { RaceEvent } from "./race-events";
import { spotlight } from "./race-events";

/** Simulation-time shot selection. Manual selection takes priority for 12 seconds. */
export class CameraDirector {
  private lastCut = -300;
  private manualUntil = -1;
  private lastEvent = "";
  manual(tick: number) {
    this.manualUntil = tick + 360;
  }
  choose(events: readonly RaceEvent[], tick: number): string | null {
    if (tick < this.manualUntil || tick - this.lastCut < 240) return null;
    const event = spotlight(events, tick);
    if (!event || event.id === this.lastEvent) return null;
    this.lastEvent = event.id;
    this.lastCut = tick;
    return event.boatId;
  }
}
