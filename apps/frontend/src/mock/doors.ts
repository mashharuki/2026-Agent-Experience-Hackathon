import type { MockDoor } from "./mock-api";

export const DOORS: Record<string, { label: string; door: MockDoor }> = {
  open: { label: "受付中", door: { accepting: true, reason: "open" } },
  stopped: {
    label: "停止中",
    door: { accepting: false, reason: "worker_stopped" },
  },
  warming: {
    label: "準備中",
    door: {
      accepting: false,
      reason: "warming_up",
      expectedReopenAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
  },
  quota: {
    label: "利用枠切れ",
    door: { accepting: false, reason: "quota_exhausted" },
  },
};

/** Which door the mock starts with: ?door=stopped|warming|quota (for demos and checks). */
export function doorFromUrl(search: string): MockDoor | undefined {
  return DOORS[new URLSearchParams(search).get("door") ?? ""]?.door;
}
