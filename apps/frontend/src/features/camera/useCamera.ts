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
  const requestVersion = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("idle");

  const stop = useCallback(() => {
    requestVersion.current++;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    const version = ++requestVersion.current;
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
      if (version !== requestVersion.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      if (version === requestVersion.current) setStatus("ready");
    } catch (error) {
      if (version !== requestVersion.current) return;
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
