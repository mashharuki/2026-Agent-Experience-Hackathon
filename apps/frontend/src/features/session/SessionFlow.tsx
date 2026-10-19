/* oxlint-disable react/set-state-in-effect -- The flow reacts once to a finished analysis (an async result), so setting state in an effect is intended. */
import { Alert, Box, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Advice,
  AnswerClarificationRequest,
  FeedbackRequest,
  FeedbackRequestComparisonChoice,
} from "../../api/generated/model";
import {
  answerClarification,
  createSession,
  endSession,
  recordFeedback,
} from "../../api/generated/photoprep";
import { unwrap } from "../../api/unwrap";
import { DoorGate } from "../../components/DoorGate";
import { CONSENT_VERSION } from "../../config";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/ja";
import { Clarify } from "../../screens/Clarify";
import { Compare } from "../../screens/Compare";
import { Consult, type ConsultResult } from "../../screens/Consult";
import { Done } from "../../screens/Done";
import { TrialCapture } from "../../screens/TrialCapture";
import { TryOne, type TryStep } from "../../screens/TryOne";
import { messageFor } from "./errors";
import { dropPhoto, makePhoto, type Photo } from "./photos";
import { type Phase, useAnalysis } from "./useAnalysis";

type Screen = "consult" | "clarify" | "capture" | "advice" | "compare" | "done";

const HEADINGS: Record<Screen, MessageKey> = {
  consult: "heading.consult",
  clarify: "clarify.heading",
  capture: "heading.capture",
  advice: "heading.advice",
  compare: "heading.compare",
  done: "heading.done",
};
const MAX_CHANGES = 2;

/**
 * Drives the four screens. Server state is tracked from the API's answers; photos live only
 * in this component's memory (never in the query cache or web storage).
 */
export function SessionFlow() {
  const { t, language } = useI18n();
  const [screen, setScreen] = useState<Screen>("consult");
  const [step, setStep] = useState<TryStep>("advice");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [advice, setAdvice] = useState<Advice | undefined>();
  const answerKey = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  const [nextAdvice, setNextAdvice] = useState<Advice | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [changesUsed, setChangesUsed] = useState(0);
  const [choice, setChoice] = useState<
    FeedbackRequestComparisonChoice | undefined
  >();
  const [before, setBefore] = useState<Photo | undefined>();
  const [after, setAfter] = useState<Photo | undefined>();
  const analysis = useAnalysis(sessionId);
  const pendingPhase = useRef<Phase>("before");
  const ended = useRef(false);
  const flowVersion = useRef(0);
  const answerController = useRef<AbortController | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const photosRef = useRef({ before, after });

  // biome-ignore lint/correctness/useExhaustiveDependencies: move focus to the new heading whenever the screen changes
  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);
  useEffect(
    () => () => {
      flowVersion.current++;
      answerController.current?.abort();
      for (const photo of new Set(Object.values(photosRef.current)))
        dropPhoto(photo);
      photosRef.current = { before: undefined, after: undefined };
    },
    [],
  );

  const replacePhotos = useCallback(
    (next: { before: Photo | undefined; after: Photo | undefined }) => {
      const previous = photosRef.current;
      photosRef.current = next;
      for (const old of new Set(Object.values(previous))) {
        if (old && old !== next.before && old !== next.after) dropPhoto(old);
      }
      setBefore(next.before);
      setAfter(next.after);
    },
    [],
  );
  const replaceBefore = useCallback(
    (photo: Photo | undefined) => {
      replacePhotos({ ...photosRef.current, before: photo });
    },
    [replacePhotos],
  );
  const replaceAfter = useCallback(
    (photo: Photo | undefined) => {
      replacePhotos({ ...photosRef.current, after: photo });
    },
    [replacePhotos],
  );

  const finish = useCallback(() => {
    ended.current = true;
    flowVersion.current++;
    answerController.current?.abort();
    setBusy(false);
    answerKey.current = undefined;
    setAdvice(undefined);
    setNextAdvice(undefined);
    replacePhotos({ before: undefined, after: undefined });
    setScreen("done");
  }, [replacePhotos]);

  // End on the server too, so the cloud copies of the photos are deleted now rather than later.
  // Best effort: if it fails, the worker and the sweeper still remove them within a day.
  const endOnServer = useCallback(async () => {
    if (sessionId) await endSession(sessionId).catch(() => undefined);
  }, [sessionId]);

  // React to a finished analysis exactly once, then clear it. This is a reaction to an async
  // result (an external event), so setting state here is intended.
  const { run, reset } = analysis;
  useEffect(() => {
    if (ended.current || run.status !== "done") return;
    const result = run.advice;
    reset();
    if (pendingPhase.current === "after") {
      if (result.comparable) {
        // Always compare after tidying up, even when no further change is offered.
        setNotice(undefined);
        setNextAdvice(result.kind === "grooming_tip" ? result : undefined);
        setScreen("compare");
      } else {
        setNotice(result.text ?? t("try.notComparable"));
        replaceAfter(undefined);
      }
      return;
    }
    if (result.kind === "offer_finish") {
      setNotice(undefined);
      void endOnServer();
      finish();
    } else if (result.kind === "grooming_tip") {
      setAdvice(result);
      setNotice(undefined);
      setStep("advice");
      setScreen("advice");
    } else if (result.kind === "clarify") {
      setAdvice(result);
      setScreen("clarify");
    } else {
      // capture_setup_tip: show the one tip and ask for a retake.
      setNotice(result.text);
      replaceBefore(undefined);
      setScreen((s) => (s === "advice" ? "advice" : "capture"));
    }
  }, [run, reset, finish, endOnServer, replaceBefore, replaceAfter, t]);

  const send = async (feedback: FeedbackRequest): Promise<boolean> => {
    if (!sessionId) return false;
    const version = flowVersion.current;
    setBusy(true);
    setError(undefined);
    try {
      await recordFeedback(sessionId, feedback);
      return !ended.current && version === flowVersion.current;
    } catch (e) {
      if (version === flowVersion.current) setError(messageFor(e, t));
      return false;
    } finally {
      if (version === flowVersion.current) setBusy(false);
    }
  };

  const onConsult = async (result: ConsultResult) => {
    const version = flowVersion.current;
    setBusy(true);
    setError(undefined);
    try {
      const created = await unwrap(
        createSession(
          {
            consentVersion: CONSENT_VERSION,
            scope: result.scope,
            restrictions: result.restrictions,
            wish: result.wish,
            language,
          },
          {
            headers: {
              "Idempotency-Key": crypto.randomUUID().replaceAll("-", ""),
            },
          },
        ),
      );
      if (ended.current || version !== flowVersion.current) {
        void endSession(created.sessionId).catch(() => undefined);
        return;
      }
      setSessionId(created.sessionId);
      setScreen("capture");
    } catch (e) {
      if (version === flowVersion.current) setError(messageFor(e, t));
    } finally {
      if (version === flowVersion.current) setBusy(false);
    }
  };

  const analyse = (phase: Phase, photo: Photo | undefined) => {
    if (!photo) return;
    pendingPhase.current = phase;
    void analysis.start(phase, photo.blob);
  };

  const onAnswer = async (answer: AnswerClarificationRequest) => {
    if (!sessionId) return;
    const version = flowVersion.current;
    const active = new AbortController();
    answerController.current = active;
    const payload = JSON.stringify(answer);
    if (answerKey.current?.payload !== payload)
      answerKey.current = {
        payload,
        key: crypto.randomUUID().replaceAll("-", ""),
      };
    setBusy(true);
    setError(undefined);
    try {
      const result = await unwrap(
        answerClarification(sessionId, answer, {
          signal: active.signal,
          headers: { "Idempotency-Key": answerKey.current.key },
        }),
      );
      if (ended.current || version !== flowVersion.current) return;
      pendingPhase.current = "before";
      if ("jobId" in result) analysis.follow(result.jobId);
      else {
        setNotice(t("clarify.captureRequired"));
        replaceBefore(undefined);
        setScreen("capture");
      }
    } catch (failure) {
      if (!ended.current && version === flowVersion.current)
        setError(messageFor(failure, t));
    } finally {
      if (version === flowVersion.current) setBusy(false);
    }
  };

  const finishNow = () => {
    ended.current = true;
    analysis.cancel();
    finish();
    if (sessionId)
      void recordFeedback(sessionId, {
        type: "advice_response",
        adviceResponse: "finish",
      }).catch(() => undefined);
    void endOnServer();
  };

  return (
    <Box className="screen-enter" key={screen}>
      <Typography
        variant="h2"
        component="h2"
        tabIndex={-1}
        ref={headingRef}
        sx={{ mb: 2, outline: "none" }}
      >
        {t(HEADINGS[screen])}
      </Typography>

      {screen === "consult" ? (
        <DoorGate>
          <Consult
            onSubmit={onConsult}
            onDecline={() => {
              setDeclined(true);
              finish();
            }}
            busy={busy}
            error={error}
          />
        </DoorGate>
      ) : null}

      {screen === "clarify" && advice ? (
        <Clarify
          key={advice.clarification?.clarificationId ?? "legacy"}
          advice={advice}
          busy={busy}
          run={analysis.run}
          error={error}
          onAnswer={onAnswer}
          onFinish={finishNow}
          onRecheck={analysis.recheck}
          onRetake={() => {
            analysis.reset();
            replaceBefore(undefined);
            setScreen("capture");
          }}
        />
      ) : null}

      {screen === "capture" ? (
        <TrialCapture
          photo={before}
          run={analysis.run}
          notice={notice}
          onCaptured={(blob) => {
            if (ended.current) return;
            setNotice(notice);
            replaceBefore(makePhoto(blob));
          }}
          onSend={() => analyse("before", before)}
          onRetake={() => {
            analysis.reset();
            replaceBefore(undefined);
          }}
          onFinish={finishNow}
          onRecheck={analysis.recheck}
        />
      ) : null}

      {screen === "advice" ? (
        <TryOne
          step={step}
          advice={advice}
          beforePhoto={before}
          afterPhoto={after}
          run={analysis.run}
          notice={notice}
          busy={busy}
          onTry={async () => {
            if (
              await send({ type: "advice_response", adviceResponse: "try" })
            ) {
              setChangesUsed((n) => n + 1);
              setNotice(undefined);
              setStep("trying");
            }
          }}
          onAnother={async () => {
            if (
              await send({ type: "advice_response", adviceResponse: "another" })
            ) {
              analyse("before", before);
            }
          }}
          onFinish={finishNow}
          onStartRecheck={() => setStep("recheck")}
          onAfterCaptured={(blob) => {
            if (!ended.current) replaceAfter(makePhoto(blob));
          }}
          onSendAfter={() => analyse("after", after)}
          onRetakeAfter={() => {
            analysis.reset();
            replaceAfter(undefined);
          }}
          onRecheck={analysis.recheck}
        />
      ) : null}

      {screen === "compare" && before && after ? (
        <Compare
          before={before}
          after={after}
          choice={choice}
          nextAdvice={nextAdvice}
          canTryAgain={changesUsed < MAX_CHANGES}
          busy={busy}
          error={error}
          onChoose={async (picked) => {
            if (await send({ type: "comparison", comparisonChoice: picked }))
              setChoice(picked);
          }}
          onFinish={finishNow}
          onTryAgain={async () => {
            // The check already produced the next suggestion: start that change directly.
            if (
              !(await send({ type: "advice_response", adviceResponse: "try" }))
            )
              return;
            replacePhotos({ before: after, after: undefined });
            setChoice(undefined);
            setAdvice(nextAdvice);
            setNextAdvice(undefined);
            setChangesUsed((n) => n + 1);
            setNotice(undefined);
            setStep("trying");
            setScreen("advice");
          }}
        />
      ) : null}

      {screen === "done" ? (
        <Done
          declined={declined}
          onRestart={() => {
            flowVersion.current++;
            ended.current = false;
            setDeclined(false);
            setSessionId(undefined);
            setAdvice(undefined);
            setNextAdvice(undefined);
            setChoice(undefined);
            setChangesUsed(0);
            setNotice(undefined);
            setError(undefined);
            analysis.reset();
            setScreen("consult");
          }}
        />
      ) : null}

      {screen === "advice" && notice && step === "advice" && !advice ? (
        <Alert severity="info">{notice}</Alert>
      ) : null}
    </Box>
  );
}
