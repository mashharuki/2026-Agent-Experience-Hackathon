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
          整えたら、同じ位置と光でもう一度撮影してください。整えている間は、新しい提案は出しません。
        </Alert>
      ) : null}
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      {run.status === "failed" ? (
        <Alert severity="error">{run.message}</Alert>
      ) : null}
      {run.status === "timeout" ? (
        <Alert
          severity="warning"
          action={<Button onClick={onRecheck}>もう一度確認</Button>}
        >
          結果の確認に時間がかかっています。
        </Alert>
      ) : null}
      {working ? (
        <Waiting
          text={
            run.status === "uploading" ? "写真を送っています" : "解析しています"
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
            やってみる
          </Button>
          <Button
            variant="outlined"
            onClick={onAnother}
            disabled={busy || working}
          >
            別の提案
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
          整えたので確認
        </Button>
      ) : null}

      {step === "recheck" ? (
        afterPhoto ? (
          <>
            <img className="photo" src={afterPhoto.url} alt="整えた後の写真" />
            <Stack spacing={1}>
              {run.status === "idle" ? (
                <Button variant="contained" size="large" onClick={onSendAfter}>
                  この写真で確認する
                </Button>
              ) : null}
              <Button
                variant="outlined"
                onClick={onRetakeAfter}
                disabled={working}
              >
                撮り直す
              </Button>
            </Stack>
          </>
        ) : (
          <PhotoCapture onCaptured={onAfterCaptured} />
        )
      ) : null}

      <Button color="inherit" onClick={onFinish} disabled={busy || working}>
        このままで終える
      </Button>
    </Stack>
  );
}
