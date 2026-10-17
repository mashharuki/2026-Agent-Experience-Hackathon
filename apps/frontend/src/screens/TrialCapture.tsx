import { Alert, Button, Stack, Typography } from "@mui/material";
import { PhotoCapture } from "../components/PhotoCapture";
import { Waiting } from "../components/Waiting";
import type { Photo } from "../features/session/photos";
import type { AnalysisRun } from "../features/session/useAnalysis";
import { useI18n } from "../i18n/I18nProvider";

/** Screen 2: take the first photo. If it cannot be read, one capture tip is shown here. */
export function TrialCapture({
  photo,
  run,
  notice,
  onCaptured,
  onSend,
  onRetake,
  onFinish,
  onRecheck,
}: {
  photo?: Photo;
  run: AnalysisRun;
  notice?: string;
  onCaptured: (blob: Blob) => void;
  onSend: () => void;
  onRetake: () => void;
  onFinish: () => void;
  onRecheck: () => void;
}) {
  const { t } = useI18n();
  const busy = run.status === "uploading" || run.status === "waiting";
  return (
    <Stack spacing={2}>
      <Typography>{t("capture.instruction")}</Typography>
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      {run.status === "failed" ? (
        <Alert severity="error">{run.message}</Alert>
      ) : null}
      {run.status === "timeout" ? (
        <Alert
          severity="warning"
          action={<Button onClick={onRecheck}>{t("door.recheck")}</Button>}
        >
          {t("run.timeout")}
        </Alert>
      ) : null}

      {photo ? (
        <>
          <img className="photo" src={photo.url} alt={t("capture.photoAlt")} />
          {busy ? (
            <Waiting
              text={
                run.status === "uploading"
                  ? t("run.uploading")
                  : t("run.analysing")
              }
            />
          ) : null}
          <Stack spacing={1}>
            {run.status === "idle" ? (
              <Button variant="contained" size="large" onClick={onSend}>
                {t("capture.send")}
              </Button>
            ) : null}
            <Button variant="outlined" onClick={onRetake} disabled={busy}>
              {t("capture.retake")}
            </Button>
          </Stack>
        </>
      ) : (
        <PhotoCapture onCaptured={onCaptured} />
      )}
      <Button color="inherit" onClick={onFinish} disabled={busy}>
        {t("capture.finish")}
      </Button>
    </Stack>
  );
}
