import { Alert, Button, Stack, Typography } from "@mui/material";
import { PhotoCapture } from "../components/PhotoCapture";
import { Waiting } from "../components/Waiting";
import type { Photo } from "../features/session/photos";
import type { AnalysisRun } from "../features/session/useAnalysis";

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
  const busy = run.status === "uploading" || run.status === "waiting";
  return (
    <Stack spacing={2}>
      <Typography>顔が枠に入るように合わせて撮影してください。</Typography>
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

      {photo ? (
        <>
          <img className="photo" src={photo.url} alt="撮影した写真" />
          {busy ? (
            <Waiting
              text={
                run.status === "uploading"
                  ? "写真を送っています"
                  : "解析しています"
              }
            />
          ) : null}
          <Stack spacing={1}>
            {run.status === "idle" ? (
              <Button variant="contained" size="large" onClick={onSend}>
                この写真で相談する
              </Button>
            ) : null}
            <Button variant="outlined" onClick={onRetake} disabled={busy}>
              撮り直す
            </Button>
          </Stack>
        </>
      ) : (
        <PhotoCapture onCaptured={onCaptured} />
      )}
      <Button color="inherit" onClick={onFinish} disabled={busy}>
        このままで終える
      </Button>
    </Stack>
  );
}
