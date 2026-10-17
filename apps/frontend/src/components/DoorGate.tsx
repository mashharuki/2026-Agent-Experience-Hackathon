import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ServiceStatus } from "../api/generated/model";
import { useGetServiceStatus } from "../api/generated/photoprep";
import { Waiting } from "./Waiting";

const REASON_TEXT: Record<ServiceStatus["reason"], string> = {
  open: "",
  worker_stopped:
    "いまは停止しています。しばらくしてからもう一度お試しください。",
  warming_up: "準備中です。",
  quota_exhausted: "本日の利用枠に達しました。明日またお試しください。",
  maintenance: "メンテナンス中です。しばらくしてからもう一度お試しください。",
};

function reopenText(iso?: string): string {
  if (!iso) return "";
  const time = new Date(iso).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${time}ごろに再開できる見込みです。`;
}

/**
 * Asked as soon as the first screen opens (FR-027). Until the service says it is accepting
 * work, nothing else is offered: no form, no consent, no camera, no upload. If the check itself
 * fails, the app behaves as if the service were closed.
 */
export function DoorGate({ children }: { children: ReactNode }) {
  const status = useGetServiceStatus({
    query: { retry: false, staleTime: 0, gcTime: 0 },
  });

  if (status.isPending) return <Waiting text="受付の状態を確認しています" />;

  const door = status.data?.data as ServiceStatus | undefined;
  if (status.isError || !door) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          受付の状態を確認できませんでした。通信の状態を確かめて、もう一度お試しください。
        </Alert>
        <Button variant="outlined" onClick={() => status.refetch()}>
          もう一度確認
        </Button>
      </Stack>
    );
  }
  if (!door.accepting) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          <Typography>{REASON_TEXT[door.reason]}</Typography>
          {door.reason === "warming_up" ? (
            <Typography>{reopenText(door.expectedReopenAt)}</Typography>
          ) : null}
        </Alert>
        <Button
          variant="outlined"
          onClick={() => status.refetch()}
          disabled={status.isFetching}
        >
          もう一度確認
        </Button>
      </Stack>
    );
  }
  return <>{children}</>;
}
