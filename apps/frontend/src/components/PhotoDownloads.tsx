import { Alert, Button, Stack, Typography } from "@mui/material";
import { useState } from "react";
import {
  downloadPhoto,
  type PhotoTarget,
} from "../features/session/downloadPhoto";
import type { Photo } from "../features/session/photos";
import { useI18n } from "../i18n/I18nProvider";

/** Download targets are explicit actions, independent of server feedback and image viewing. */
export function PhotoDownloads(photos: Partial<Record<PhotoTarget, Photo>>) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "requested" | "failed">("idle");
  return (
    <Stack spacing={1}>
      <Typography variant="body2">{t("save.help")}</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {(["current", "before", "after"] as const).map((target) => {
          const photo = photos[target];
          return photo ? (
            <Button
              key={target}
              variant="outlined"
              onClick={() => {
                try {
                  downloadPhoto(photo, target);
                  setStatus("requested");
                } catch {
                  setStatus("failed");
                }
              }}
            >
              {t(`save.${target}`)}
            </Button>
          ) : null;
        })}
      </Stack>
      {status === "requested" ? (
        <Typography role="status" variant="body2">
          {t("save.requested")}
        </Typography>
      ) : null}
      {status === "failed" ? (
        <Alert severity="error">{t("save.failed")}</Alert>
      ) : null}
    </Stack>
  );
}
