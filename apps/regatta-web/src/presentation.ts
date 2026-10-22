// Display-only derivations for the spectator screen. Nothing here feeds the simulation or the Decider.

export type Outcome = "hit" | "miss" | "no_result" | "unscored";

export function raceOutcome(
  winners: readonly string[],
  prediction: string | null,
): Outcome {
  if (winners.length === 0) return "no_result";
  if (prediction === null) return "unscored";
  return winners.includes(prediction) ? "hit" : "miss";
}
