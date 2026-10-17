import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  | "idle"
  | "starting"
  | "ready"
  | "denied"
  | "unavailable";

/** Front camera preview. The stream is stopped whenever the screen using it goes away. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "denied"
          : "unavailable",
      );
    }
  }, []);

  useEffect(() => stop, [stop]);
  return { videoRef, status, start, stop };
}
