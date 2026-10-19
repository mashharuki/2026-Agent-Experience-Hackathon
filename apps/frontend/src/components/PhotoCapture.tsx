import {
  Alert,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useConfig } from "../config";
import { captureFrame } from "../features/camera/capture";
import { createTestImage } from "../features/camera/testImage";
import { useCamera } from "../features/camera/useCamera";
import { useI18n } from "../i18n/I18nProvider";

/** Live preview + shutter. The caller owns photos in memory; no automatic persistence. */
export function PhotoCapture({
  onCaptured,
  referenceUrl,
}: {
  onCaptured: (photo: Blob) => void;
  referenceUrl?: string;
}) {
  const config = useConfig();
  const { t } = useI18n();
  const { videoRef, status, start } = useCamera();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const lifetime = useRef({ active: false });
  const capturing = useRef(false);

  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    void start();
    return () => {
      current.active = false;
    };
  }, [start]);

  const take = async (create: () => Promise<Blob>) => {
    if (capturing.current) return;
    capturing.current = true;
    const current = lifetime.current;
    setBusy(true);
    setFailed(false);
    try {
      const blob = await create();
      if (current.active) onCaptured(blob);
    } catch {
      if (current.active) setFailed(true);
    } finally {
      capturing.current = false;
      if (current.active) setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <div className="camera-frame">
        <video
          ref={videoRef}
          className="preview"
          playsInline
          muted
          aria-label={t("camera.preview")}
        />
        {referenceUrl && showGuide ? (
          <img
            className="reference-guide"
            src={referenceUrl}
            alt={t("camera.reference")}
          />
        ) : null}
      </div>
      {referenceUrl ? (
        <Stack>
          <FormControlLabel
            control={
              <Switch
                checked={showGuide}
                onChange={(_, checked) => setShowGuide(checked)}
              />
            }
            label={t("camera.guide")}
          />
          <Typography variant="caption">{t("camera.guideHelp")}</Typography>
        </Stack>
      ) : null}
      {failed ? <Alert severity="error">{t("camera.failed")}</Alert> : null}
      {status === "denied" ? (
        <Alert severity="info">{t("camera.denied")}</Alert>
      ) : null}
      {status === "unavailable" ? (
        <Alert severity="info">{t("camera.unavailable")}</Alert>
      ) : null}
      <Button
        variant="contained"
        size="large"
        onClick={() => {
          const video = videoRef.current;
          if (video) void take(() => captureFrame(video));
        }}
        disabled={status !== "ready" || busy}
      >
        {t("camera.shoot")}
      </Button>
      {config.mode === "mock" ? (
        <Button
          variant="outlined"
          disabled={busy}
          onClick={() =>
            void take(() => createTestImage(t("camera.testImageLabel")))
          }
        >
          {t("camera.testImage")}
        </Button>
      ) : null}
    </Stack>
  );
}
