/* oxlint-disable react/set-state-in-effect -- The run state mirrors the polled job (external data), so setting state in an effect is intended. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/custom-fetch";
import type { Advice, Job } from "../../api/generated/model";
import {
  createUpload,
  requestAnalysis,
  useGetJob,
} from "../../api/generated/photoprep";
import { unwrap } from "../../api/unwrap";
import { uploadPhoto } from "../../api/upload";
import { useConfig } from "../../config";
import { useI18n } from "../../i18n/I18nProvider";
import { shouldKeepPolling } from "../jobs/pollSchedule";
import { messageFor } from "./errors";

export type Phase = "before" | "after";

export type AnalysisRun =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "waiting" }
  | { status: "timeout" }
  | { status: "done"; advice: Advice }
  | { status: "failed"; message: string };

/**
 * Upload one photo, request the analysis and follow the job until it finishes.
 * Nothing here retries a request automatically; a user-triggered resend reuses the same
 * Idempotency-Key so it can never be counted twice.
 */
export function useAnalysis(sessionId: string | undefined) {
  const config = useConfig();
  const { t } = useI18n();
  const [run, setRun] = useState<AnalysisRun>({ status: "idle" });
  const [jobId, setJobId] = useState<string | undefined>();
  const startedAt = useRef(0);
  const idempotencyKey = useRef<string | undefined>(undefined);

  const job = useGetJob(jobId ?? "", {
    query: {
      enabled: Boolean(jobId),
      retry: false,
      refetchInterval: (query) => {
        const data = query.state.data as { data?: Job } | undefined;
        const status = data?.data?.status ?? "QUEUED";
        return shouldKeepPolling(status, Date.now() - startedAt.current)
          ? config.pollDelay(query.state.dataUpdateCount)
          : false;
      },
    },
  });

  const current = (job.data as { data?: Job } | undefined)?.data;
  // Mirrors the polled job (external data) into the run state; setting state here is intended.
  useEffect(() => {
    if (!jobId || !current) return;
    if (current.status === "SUCCEEDED" && current.advice) {
      setRun({ status: "done", advice: current.advice });
    } else if (["FAILED", "UNKNOWN", "CANCELLED"].includes(current.status)) {
      setRun({
        status: "failed",
        message: t("run.failed"),
      });
    } else if (
      !shouldKeepPolling(current.status, Date.now() - startedAt.current)
    ) {
      setRun({ status: "timeout" });
    }
  }, [jobId, current, t]);

  const start = useCallback(
    async (phase: Phase, photo: Blob) => {
      if (!sessionId) return;
      setJobId(undefined);
      setRun({ status: "uploading" });
      startedAt.current = Date.now();
      idempotencyKey.current = crypto.randomUUID().replaceAll("-", "");
      try {
        const upload = await unwrap(
          createUpload(sessionId, {
            phase,
            contentType: "image/jpeg",
            sizeBytes: Math.max(1, photo.size),
          }),
        );
        await uploadPhoto(
          upload,
          photo,
          config.mode === "mock" ? config.mock?.fetch : undefined,
        );
        const accepted = await unwrap(
          requestAnalysis(
            sessionId,
            { uploadId: upload.uploadId, phase },
            { headers: { "Idempotency-Key": idempotencyKey.current } },
          ),
        );
        startedAt.current = Date.now();
        setJobId(accepted.jobId);
        setRun({ status: "waiting" });
      } catch (error) {
        setRun({
          status: "failed",
          message:
            error instanceof ApiError
              ? messageFor(error, t)
              : t("run.uploadFailed"),
        });
      }
    },
    [sessionId, config, t],
  );

  const reset = useCallback(() => {
    setJobId(undefined);
    setRun({ status: "idle" });
  }, []);

  /** After a timeout: check once more (still the same job, no new cost). */
  const recheck = useCallback(() => {
    startedAt.current = Date.now();
    setRun({ status: "waiting" });
    void job.refetch();
  }, [job]);

  return { run, start, reset, recheck };
}
