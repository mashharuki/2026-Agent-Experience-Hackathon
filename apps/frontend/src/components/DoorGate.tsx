import { Alert, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ServiceStatus } from "../api/generated/model";
import { useGetServiceStatus } from "../api/generated/photoprep";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/ja";
import { Waiting } from "./Waiting";

const REASON_KEY: Record<ServiceStatus["reason"], MessageKey | undefined> = {
  open: undefined,
  worker_stopped: "door.worker_stopped",
  warming_up: "door.warming_up",
  quota_exhausted: "door.quota_exhausted",
  maintenance: "door.maintenance",
};

/**
 * Asked as soon as the first screen opens (FR-027). Until the service says it is accepting
 * work, nothing else is offered: no form, no consent, no camera, no upload. If the check itself
 * fails, the app behaves as if the service were closed.
 */
export function DoorGate({ children }: { children: ReactNode }) {
  const { t, language } = useI18n();
  const status = useGetServiceStatus({
    query: { retry: false, staleTime: 0, gcTime: 0 },
  });

  if (status.isPending) return <Waiting text={t("door.checking")} />;

  const door = status.data?.data as ServiceStatus | undefined;
  if (status.isError || !door) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">{t("door.checkFailed")}</Alert>
        <Button variant="outlined" onClick={() => status.refetch()}>
          {t("door.recheck")}
        </Button>
      </Stack>
    );
  }
  if (!door.accepting) {
    return (
      <Stack spacing={2}>
        <Alert severity="info">
          <Typography>
            {REASON_KEY[door.reason]
              ? t(REASON_KEY[door.reason] as MessageKey)
              : ""}
          </Typography>
          {door.reason === "warming_up" ? (
            <Typography>
              {door.expectedReopenAt
                ? t("door.reopen", {
                    time: new Date(door.expectedReopenAt).toLocaleTimeString(
                      language === "ja" ? "ja-JP" : "en-US",
                      { hour: "2-digit", minute: "2-digit" },
                    ),
                  })
                : ""}
            </Typography>
          ) : null}
        </Alert>
        <Button
          variant="outlined"
          onClick={() => status.refetch()}
          disabled={status.isFetching}
        >
          {t("door.recheck")}
        </Button>
      </Stack>
    );
  }
  return <>{children}</>;
}
