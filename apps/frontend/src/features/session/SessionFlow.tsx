/* oxlint-disable react/set-state-in-effect -- The flow reacts once to a finished analysis (an async result), so setting state in an effect is intended. */
import { Alert, Box, Typography } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Advice,
  FeedbackRequest,
  FeedbackRequestComparisonChoice,
} from "../../api/generated/model";
import {
  createSession,
  endSession,
  recordFeedback,
} from "../../api/generated/photoprep";
import { unwrap } from "../../api/unwrap";
import { DoorGate } from "../../components/DoorGate";
import { CONSENT_VERSION } from "../../config";
import { useI18n } from "../../i18n/I18nProvider";
import type { MessageKey } from "../../i18n/ja";
import { Compare } from "../../screens/Compare";
import { Consult, type ConsultResult } from "../../screens/Consult";
import { Done } from "../../screens/Done";
import { TrialCapture } from "../../screens/TrialCapture";
import { TryOne, type TryStep } from "../../screens/TryOne";
import { messageFor } from "./errors";
import { dropPhoto, makePhoto, type Photo } from "./photos";
import { type Phase, useAnalysis } from "./useAnalysis";

type Screen = "consult" | "capture" | "advice" | "compare" | "done";

const HEADINGS: Record<Screen, MessageKey> = {
  consult: "heading.consult",
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  const photosRef = useRef({ before, after });
  useEffect(() => {
    photosRef.current = { before, after };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: move focus to the new heading whenever the screen changes
  useEffect(() => {
    headingRef.current?.focus();
  }, [screen]);
  useEffect(
    () => () => {
      dropPhoto(photosRef.current.before);
      dropPhoto(photosRef.current.after);
    },
    [],
  );

  const replaceBefore = useCallback((photo: Photo | undefined) => {
    setBefore((old) => {
      if (old && old !== photo && old !== photosRef.current.after)
        dropPhoto(old);
      return photo;
    });
  }, []);
  const replaceAfter = useCallback((photo: Photo | undefined) => {
    setAfter((old) => {
      if (old && old !== photo && old !== photosRef.current.before)
        dropPhoto(old);
      return photo;
    });
  }, []);

  const finish = useCallback(() => {
    replaceBefore(undefined);
    replaceAfter(undefined);
    setScreen("done");
  }, [replaceBefore, replaceAfter]);

  // End on the server too, so the cloud copies of the photos are deleted now rather than later.
  // Best effort: if it fails, the worker and the sweeper still remove them within a day.
  const endOnServer = useCallback(async () => {
    if (sessionId) await endSession(sessionId).catch(() => undefined);
  }, [sessionId]);

  // React to a finished analysis exactly once, then clear it. This is a reaction to an async
  // result (an external event), so setting state here is intended.
  const { run, reset } = analysis;
  useEffect(() => {
    if (run.status !== "done") return;
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
    } else {
      // capture_setup_tip or clarify: show the one tip and ask for a retake.
      setNotice(result.text);
      replaceBefore(undefined);
      setScreen((s) => (s === "advice" ? "advice" : "capture"));
    }
  }, [run, reset, finish, endOnServer, replaceBefore, replaceAfter, t]);

  const send = async (feedback: FeedbackRequest): Promise<boolean> => {
    if (!sessionId) return false;
    setBusy(true);
    setError(undefined);
    try {
      await recordFeedback(sessionId, feedback);
      return true;
    } catch (e) {
      setError(messageFor(e, t));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onConsult = async (result: ConsultResult) => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await unwrap(
        createSession(
          {
            consentVersion: CONSENT_VERSION,
            scope: result.scope,
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
      setSessionId(created.sessionId);
      setScreen("capture");
    } catch (e) {
      setError(messageFor(e, t));
    } finally {
      setBusy(false);
    }
  };

  const analyse = (phase: Phase, photo: Photo | undefined) => {
    if (!photo) return;
    pendingPhase.current = phase;
    void analysis.start(phase, photo.blob);
  };

  const finishNow = async () => {
    await send({ type: "advice_response", adviceResponse: "finish" }); // records the choice
    await endOnServer();
    finish();
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
              setDeclined(true); // nothing has been sent, no session exists
              setScreen("done");
            }}
            busy={busy}
            error={error}
          />
        </DoorGate>
      ) : null}

      {screen === "capture" ? (
        <TrialCapture
          photo={before}
          run={analysis.run}
          notice={notice}
          onCaptured={(blob) => {
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
          onAfterCaptured={(blob) => replaceAfter(makePhoto(blob))}
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
            replaceBefore(after);
            setAfter(undefined);
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
