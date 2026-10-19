import {
  Alert,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
import type { Advice } from "../api/generated/model";
import { PhotoCapture } from "../components/PhotoCapture";
import { Waiting } from "../components/Waiting";
import type { Photo } from "../features/session/photos";
import type { AnalysisRun } from "../features/session/useAnalysis";
import { useI18n } from "../i18n/I18nProvider";

export type TryStep = "advice" | "trying" | "recheck";

/** Screen 3: one suggestion at a time. While the user tidies up, no new advice appears. */
export function TryOne({
  step,
  advice,
  afterPhoto,
  run,
  notice,
  busy,
  onTry,
  onAnother,
  onFinish,
  onStartRecheck,
  onAfterCaptured,
  onSendAfter,
  onRetakeAfter,
  onRecheck,
}: {
  step: TryStep;
  advice?: Advice;
  afterPhoto?: Photo;
  run: AnalysisRun;
  notice?: string;
  busy: boolean;
  onTry: () => void;
  onAnother: () => void;
  onFinish: () => void;
  onStartRecheck: () => void;
  onAfterCaptured: (blob: Blob) => void;
  onSendAfter: () => void;
  onRetakeAfter: () => void;
  onRecheck: () => void;
}) {
  const { t } = useI18n();
  const working = run.status === "uploading" || run.status === "waiting";
  return (
    <Stack spacing={2}>
      {step === "advice" && advice ? (
        <Card variant="outlined">
          <CardContent>
            <Typography>{advice.text}</Typography>
          </CardContent>
        </Card>
      ) : null}
      {step !== "advice" ? (
        <Alert severity="info" icon={false}>
          {t("try.trying")}
        </Alert>
      ) : null}
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      {run.status === "failed" ? (
        <Alert
          severity="error"
          action={
            run.canRecheck ? (
              <Button onClick={onRecheck}>{t("door.recheck")}</Button>
            ) : undefined
          }
        >
          {run.message}
        </Alert>
      ) : null}
      {run.status === "timeout" ? (
        <Alert
          severity="warning"
          action={<Button onClick={onRecheck}>{t("door.recheck")}</Button>}
        >
          {t("run.timeout")}
        </Alert>
      ) : null}
      {working ? (
        <Waiting
          text={
            run.status === "uploading" ? t("run.uploading") : t("run.analysing")
          }
        />
      ) : null}

      {step === "advice" ? (
        <Stack spacing={1}>
          <Button
            variant="contained"
            size="large"
            onClick={onTry}
            disabled={busy || working}
          >
            {t("try.do")}
          </Button>
          <Button
            variant="outlined"
            onClick={onAnother}
            disabled={busy || working}
          >
            {t("try.another")}
          </Button>
        </Stack>
      ) : null}

      {step === "trying" ? (
        <Button
          variant="contained"
          size="large"
          onClick={onStartRecheck}
          disabled={busy}
        >
          {t("try.check")}
        </Button>
      ) : null}

      {step === "recheck" ? (
        afterPhoto ? (
          <>
            <img
              className="photo"
              src={afterPhoto.url}
              alt={t("try.afterAlt")}
            />
            <Stack spacing={1}>
              {run.status === "idle" ? (
                <Button variant="contained" size="large" onClick={onSendAfter}>
                  {t("try.sendAfter")}
                </Button>
              ) : null}
              <Button
                variant="outlined"
                onClick={onRetakeAfter}
                disabled={working}
              >
                {t("capture.retake")}
              </Button>
            </Stack>
          </>
        ) : (
          <PhotoCapture onCaptured={onAfterCaptured} />
        )
      ) : null}

      <Button color="inherit" onClick={onFinish}>
        {t("capture.finish")}
      </Button>
    </Stack>
  );
}
