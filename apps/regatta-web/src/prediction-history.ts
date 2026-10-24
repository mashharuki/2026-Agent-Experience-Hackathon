export type PredictionResult = {
  id: string;
  mode: "preview" | "decider";
  scenario: string;
  hit: boolean;
};
const KEY = "regatta-predictions-v1";
export function readHistory(): PredictionResult[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is PredictionResult =>
          v &&
          typeof v.id === "string" &&
          ["preview", "decider"].includes(v.mode) &&
          typeof v.scenario === "string" &&
          typeof v.hit === "boolean",
      )
      .slice(-100);
  } catch {
    return [];
  }
}
export function saveResult(result: PredictionResult): PredictionResult[] {
  const old = readHistory();
  const next = old.some((v) => v.id === result.id)
    ? old
    : [...old, result].slice(-100);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Storage is optional. */
  }
  return next;
}
export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Optional. */
  }
}
