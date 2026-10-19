/* oxlint-disable react/set-state-in-effect -- Run state follows asynchronous query results and deadlines. */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Advice,
  Job,
  RequestAnalysisRequest,
} from "../../api/generated/model";
import {
  createUpload,
  getGetJobQueryKey,
  requestAnalysis,
  useGetJob,
} from "../../api/generated/photoprep";
import { unwrap } from "../../api/unwrap";
import { uploadPhoto } from "../../api/upload";
import { useConfig } from "../../config";
import { useI18n } from "../../i18n/I18nProvider";
import { MAX_WAIT_MS, shouldKeepPolling } from "../jobs/pollSchedule";
import { messageFor } from "./errors";

export type Phase = "before" | "after";
export type AnalysisRun =
  | { status: "idle" | "uploading" | "waiting" | "timeout" | "cancelled" }
  | { status: "done"; advice: Advice }
  | { status: "failed"; message: string; canRecheck?: boolean };

/** A run owns its requests. A newer run or cancellation invalidates every older response. */
export function useAnalysis(sessionId: string | undefined) {
  const config = useConfig();
  const { t } = useI18n();
  const client = useQueryClient();
  const [run, setRun] = useState<AnalysisRun>({ status: "idle" });
  const [jobId, setJobId] = useState<string>();
  const [waitingSince, setWaitingSince] = useState(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const jobRef = useRef<string | undefined>(undefined);
  const pending = useRef<
    { request: RequestAnalysisRequest; key: string } | undefined
  >(undefined);
  const job = useGetJob(jobId ?? "", {
    query: {
      enabled: Boolean(jobId) && run.status === "waiting",
      retry: false,
      refetchInterval: (query) => {
        const current = (query.state.data as { data?: Job } | undefined)?.data;
        return !query.state.error &&
          shouldKeepPolling(
            current?.status ?? "QUEUED",
            Date.now() - waitingSince,
          )
          ? config.pollDelay(query.state.dataUpdateCount)
          : false;
      },
    },
  });

  useEffect(() => {
    if (run.status !== "waiting") return;
    const timer = setTimeout(
      () => setRun({ status: "timeout" }),
      Math.max(0, MAX_WAIT_MS - (Date.now() - waitingSince)),
    );
    return () => clearTimeout(timer);
  }, [run.status, waitingSince]);

  const current = (job.data as { data?: Job } | undefined)?.data;
  useEffect(() => {
    if (!jobId || run.status !== "waiting") return;
    if (job.error)
      setRun({
        status: "failed",
        message: messageFor(job.error, t),
        canRecheck: true,
      });
    else if (current?.status === "SUCCEEDED" && current.advice)
      setRun({ status: "done", advice: current.advice });
    else if (
      current &&
      ["FAILED", "UNKNOWN", "CANCELLED"].includes(current.status)
    )
      setRun({ status: "failed", message: t("run.failed") });
  }, [jobId, current, job.error, run.status, t]);

  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    if (jobRef.current)
      void client.cancelQueries({
        queryKey: getGetJobQueryKey(jobRef.current),
        exact: true,
      });
    jobRef.current = undefined;
  }, [client]);
  useEffect(() => () => invalidate(), [invalidate]);

  const follow = useCallback((id: string) => {
    jobRef.current = id;
    setJobId(id);
    setWaitingSince(Date.now());
    setRun({ status: "waiting" });
  }, []);

  const submit = useCallback(
    async (version: number, signal: AbortSignal) => {
      if (!sessionId || !pending.current) return;
      const accepted = await unwrap(
        requestAnalysis(sessionId, pending.current.request, {
          signal,
          headers: { "Idempotency-Key": pending.current.key },
        }),
      );
      if (version === generation.current) follow(accepted.jobId);
    },
    [sessionId, follow],
  );

  const start = useCallback(
    async (phase: Phase, photo: Blob) => {
      if (!sessionId) return;
      invalidate();
      const version = generation.current;
      const active = new AbortController();
      controller.current = active;
      pending.current = undefined;
      setJobId(undefined);
      setRun({ status: "uploading" });
      try {
        const upload = await unwrap(
          createUpload(
            sessionId,
            {
              phase,
              contentType: "image/jpeg",
              sizeBytes: Math.max(1, photo.size),
            },
            { signal: active.signal },
          ),
        );
        if (version !== generation.current) return;
        await uploadPhoto(
          upload,
          photo,
          config.mode === "mock" ? config.mock?.fetch : undefined,
          active.signal,
        );
        if (version !== generation.current) return;
        pending.current = {
          request: { uploadId: upload.uploadId, phase },
          key: crypto.randomUUID().replaceAll("-", ""),
        };
        await submit(version, active.signal);
      } catch (error) {
        if (version === generation.current)
          setRun({
            status: "failed",
            message: messageFor(error, t),
            canRecheck: Boolean(pending.current),
          });
      }
    },
    [sessionId, config, invalidate, submit, t],
  );

  const reset = useCallback(() => {
    invalidate();
    pending.current = undefined;
    setJobId(undefined);
    setRun({ status: "idle" });
  }, [invalidate]);
  const cancel = useCallback(() => {
    reset();
    setRun({ status: "cancelled" });
  }, [reset]);
  const recheck = useCallback(async () => {
    if (jobId) {
      setWaitingSince(Date.now());
      setRun({ status: "waiting" });
      void job.refetch();
    } else if (pending.current) {
      const version = generation.current;
      const active = new AbortController();
      controller.current = active;
      setRun({ status: "uploading" });
      try {
        await submit(version, active.signal);
      } catch (error) {
        if (version === generation.current)
          setRun({
            status: "failed",
            message: messageFor(error, t),
            canRecheck: Boolean(pending.current),
          });
      }
    }
  }, [jobId, job, submit, t]);
  return { run, start, reset, cancel, recheck, follow };
}
