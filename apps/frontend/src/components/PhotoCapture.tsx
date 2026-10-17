import { Alert, Button, Stack } from "@mui/material";
import { useEffect, useState } from "react";
import { useConfig } from "../config";
import { captureFrame } from "../features/camera/capture";
import { createTestImage } from "../features/camera/testImage";
import { useCamera } from "../features/camera/useCamera";
import { useI18n } from "../i18n/I18nProvider";

/** Live preview + shutter. Photos are held in memory by the caller and never stored. */
export function PhotoCapture({
  onCaptured,
}: {
  onCaptured: (photo: Blob) => void;
}) {
  const config = useConfig();
  const { t } = useI18n();
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
        aria-label={t("camera.preview")}
      />
      {status === "denied" ? (
        <Alert severity="info">{t("camera.denied")}</Alert>
      ) : null}
      {status === "unavailable" ? (
        <Alert severity="info">{t("camera.unavailable")}</Alert>
      ) : null}
      <Button
        variant="contained"
        size="large"
        onClick={shoot}
        disabled={status !== "ready" || busy}
      >
        {t("camera.shoot")}
      </Button>
      {config.mode === "mock" ? (
        <Button
          variant="outlined"
          onClick={async () =>
            onCaptured(await createTestImage(t("camera.testImageLabel")))
          }
        >
          {t("camera.testImage")}
        </Button>
      ) : null}
    </Stack>
  );
}
