// Display-only derivations for the spectator screen. Nothing here feeds the simulation or the Decider.
import { type FleetRace, fleetRanking, fleetRemaining } from "sailing-sim";

export type Outcome = "hit" | "miss" | "no_result" | "unscored";

export function raceOutcome(
  winners: readonly string[],
  prediction: string | null,
): Outcome {
  if (winners.length === 0) return "no_result";
  if (prediction === null) return "unscored";
  return winners.includes(prediction) ? "hit" : "miss";
}

export type StandingRow = {
  id: string;
  rank: number;
  isPrediction: boolean;
  finishTime: number | null;
  gapMeters: number | null;
};

export function standings(
  race: FleetRace,
  prediction: string | null,
): StandingRow[] {
  const ranked = fleetRanking(race);
  const racing = ranked.filter((boat) => boat.finishTime === null);
  const lead = racing.length
    ? Math.min(...racing.map(fleetRemaining))
    : 0;
  return ranked.map((boat, index) => ({
    id: boat.id,
    rank: index + 1,
    isPrediction: boat.id === prediction,
    finishTime: boat.finishTime,
    gapMeters:
      boat.finishTime === null
        ? Math.round(fleetRemaining(boat) - lead)
        : null,
  }));
}

export type TacticKind = "hold" | "maneuver" | "pressure" | "mark";

export function tacticKind(selected: string): TacticKind {
  if (selected === "tack_now" || selected === "jibe_now") return "maneuver";
  if (selected.startsWith("seek_visible_pressure_")) return "pressure";
  if (selected === "approach_mark" || selected === "head_to_finish")
    return "mark";
  return "hold";
}
