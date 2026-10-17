import type { MessageKey } from "../i18n/ja";
import type { MockDoor } from "./mock-api";

export const DOORS: Record<string, { label: MessageKey; door: MockDoor }> = {
  open: { label: "mock.door.open", door: { accepting: true, reason: "open" } },
  stopped: {
    label: "mock.door.stopped",
    door: { accepting: false, reason: "worker_stopped" },
  },
  warming: {
    label: "mock.door.warming",
    door: {
      accepting: false,
      reason: "warming_up",
      expectedReopenAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
  },
  quota: {
    label: "mock.door.quota",
    door: { accepting: false, reason: "quota_exhausted" },
  },
};

/** Which door the mock starts with: ?door=stopped|warming|quota (for demos and checks). */
export function doorFromUrl(search: string): MockDoor | undefined {
  return DOORS[new URLSearchParams(search).get("door") ?? ""]?.door;
}
