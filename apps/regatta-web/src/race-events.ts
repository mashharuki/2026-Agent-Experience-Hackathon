import {
  type FleetRace,
  fleetRanking,
  STEP,
  visiblePressure,
} from "sailing-sim";

export type RaceEvent = {
  id: string;
  tick: number;
  boatId: string;
  kind:
    | "tack"
    | "jibe"
    | "settled"
    | "pressure"
    | "mark"
    | "finish"
    | "leader"
    | "crossing";
};
export const eventPriority: Record<RaceEvent["kind"], number> = {
  finish: 8,
  mark: 7,
  leader: 6,
  crossing: 5,
  tack: 4,
  jibe: 4,
  pressure: 3,
  settled: 1,
};

/** Observed facts only. No claimed model reasoning or future weather. */
export class RaceEvents {
  events: RaceEvent[] = [];
  private leader = "";
  private candidate = "";
  private since = 0;
  private maneuver = new Map<string, number>();
  private pressure = new Map<string, boolean>();
  private cooldown = new Map<string, number>();
  update(before: FleetRace, after: FleetRace) {
    const add = (
      boatId: string,
      kind: RaceEvent["kind"],
      key = `${boatId}:${kind}`,
    ) => {
      if (after.tick - (this.cooldown.get(key) ?? -10000) < 90) return;
      this.cooldown.set(key, after.tick);
      this.events.push({
        id: `${after.tick}:${key}`,
        tick: after.tick,
        boatId,
        kind,
      });
    };
    for (const [i, boat] of after.boats.entries()) {
      const old = before.boats[i];
      if (boat.tacks > old.tacks) {
        add(boat.id, "tack");
        this.maneuver.set(boat.id, after.tick);
      }
      if (boat.jibes > old.jibes) {
        add(boat.id, "jibe");
        this.maneuver.set(boat.id, after.tick);
      }
      const crossing = this.maneuver.get(boat.id);
      if (
        crossing !== undefined &&
        after.tick - crossing >= 15 &&
        Math.abs(boat.rudder) < 0.15
      ) {
        add(boat.id, "settled");
        this.maneuver.delete(boat.id);
      }
      if (old.leg === "upwind" && boat.leg === "downwind") add(boat.id, "mark");
      if (old.finishTime === null && boat.finishTime !== null)
        add(boat.id, "finish");
    }
    if (after.tick % 15 === 0) {
      const patches = visiblePressure(
        after.scenario,
        after.seed,
        after.tick * STEP,
      );
      for (const boat of after.boats) {
        const was = this.pressure.get(boat.id) ?? false;
        const inside = patches.some(
          (p) =>
            Math.hypot(boat.x - p.x, boat.y - p.y) <
            p.radius * (was ? 0.85 : 0.65),
        );
        if (inside && !was && boat.leg !== "finished") add(boat.id, "pressure");
        this.pressure.set(boat.id, inside);
      }
      for (let i = 0; i < after.boats.length; i++) {
        for (let j = i + 1; j < after.boats.length; j++) {
          const a = after.boats[i],
            b = after.boats[j];
          if (
            a.leg !== "finished" &&
            b.leg !== "finished" &&
            a.tackSide !== b.tackSide &&
            Math.hypot(a.x - b.x, a.y - b.y) < 9
          )
            add(a.id, "crossing", `${a.id}:${b.id}:crossing`);
        }
      }
    }
    const lead = fleetRanking(after)[0].id;
    if (!this.leader) this.leader = lead;
    if (lead !== this.candidate) {
      this.candidate = lead;
      this.since = after.tick;
    }
    if (lead !== this.leader && after.tick - this.since >= 30) {
      this.leader = lead;
      add(lead, "leader");
    }
    if (this.events.length > 256)
      this.events.splice(0, this.events.length - 256);
  }
}

export function spotlight(events: readonly RaceEvent[], tick: number) {
  return events
    .filter((e) => e.tick <= tick && tick - e.tick < 180)
    .sort(
      (a, b) =>
        eventPriority[b.kind] - eventPriority[a.kind] || b.tick - a.tick,
    )[0];
}

export function highlights(events: readonly RaceEvent[]): RaceEvent[] {
  const chosen: RaceEvent[] = [];
  for (const e of [...events].sort(
    (a, b) => eventPriority[b.kind] - eventPriority[a.kind] || a.tick - b.tick,
  )) {
    if (!chosen.some((c) => Math.abs(c.tick - e.tick) < 90)) chosen.push(e);
    if (chosen.length === 3) break;
  }
  return chosen.sort((a, b) => a.tick - b.tick);
}

const labels = {
  ja: {
    tack: "タック・風を横切る",
    jibe: "ジャイブ・帆が反転",
    settled: "旋回完了",
    pressure: "ブローに進入",
    mark: "風上マークを通過",
    finish: "フィニッシュ",
    leader: "暫定首位へ",
    crossing: "反対タックの艇と接近",
  },
  en: {
    tack: "Tack · crossed the wind",
    jibe: "Jibe · sails crossed",
    settled: "Turn completed",
    pressure: "Entered pressure",
    mark: "Rounded windward mark",
    finish: "Finished",
    leader: "Took provisional lead",
    crossing: "Close opposite-tack encounter",
  },
};
export const eventLabel = (kind: RaceEvent["kind"], language: "ja" | "en") =>
  labels[language][kind];
