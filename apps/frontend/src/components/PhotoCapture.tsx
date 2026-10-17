import { Alert, Button, Stack } from "@mui/material";
import { useEffect, useState } from "react";
import { useConfig } from "../config";
import { captureFrame } from "../features/camera/capture";
import { createTestImage } from "../features/camera/testImage";
import { useCamera } from "../features/camera/useCamera";

/** Live preview + shutter. Photos are held in memory by the caller and never stored. */
export function PhotoCapture({
  onCaptured,
}: {
  onCaptured: (photo: Blob) => void;
}) {
  const config = useConfig();
  const { videoRef, status, start } = useCamera();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void start();
  }, [start]);

  const shoot = async () => {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      onCaptured(await captureFrame(videoRef.current));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <video
        ref={videoRef}
        className="preview"
        playsInline
        muted
        aria-label="カメラのプレビュー"
      />
      {status === "denied" ? (
        <Alert severity="info">
          カメラの使用が許可されていません。ブラウザの設定で許可してください。
        </Alert>
      ) : null}
      {status === "unavailable" ? (
        <Alert severity="info">カメラを使えませんでした。</Alert>
      ) : null}
      <Button
        variant="contained"
        size="large"
        onClick={shoot}
        disabled={status !== "ready" || busy}
      >
        撮影する
      </Button>
      {config.mode === "mock" ? (
        <Button
          variant="outlined"
          onClick={async () => onCaptured(await createTestImage("モック"))}
        >
          テスト用の画像を使う
        </Button>
      ) : null}
    </Stack>
  );
}
