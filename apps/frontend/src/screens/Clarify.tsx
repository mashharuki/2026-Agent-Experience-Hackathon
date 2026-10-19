import {
  Alert,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type {
  Advice,
  AnswerClarificationRequest,
} from "../api/generated/model";
import type { AnalysisRun } from "../features/session/useAnalysis";
import { useI18n } from "../i18n/I18nProvider";

export function Clarify({
  advice,
  busy,
  run,
  error,
  onAnswer,
  onFinish,
  onRecheck,
  onRetake,
}: {
  advice: Advice;
  busy: boolean;
  run: AnalysisRun;
  error?: string;
  onAnswer: (answer: AnswerClarificationRequest) => void;
  onFinish: () => void;
  onRecheck: () => void;
  onRetake: () => void;
}) {
  const { t } = useI18n();
  const question = advice.clarification;
  const [scope, setScope] = useState<"brow" | "bangs" | "">(
    question?.allowedScopes.length === 1 ? question.allowedScopes[0] : "",
  );
  const [detail, setDetail] = useState("");
  const working =
    busy || run.status === "uploading" || run.status === "waiting";
  return (
    <Stack
      spacing={2}
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (question && scope && !working)
          onAnswer({
            clarificationId: question.clarificationId,
            scope,
            ...(detail.trim() ? { detail: detail.trim() } : {}),
          });
      }}
    >
      <Typography>{advice.text}</Typography>
      {question ? (
        <>
          <FormControl disabled={working}>
            <FormLabel id="clarify-scope">{t("clarify.scope")}</FormLabel>
            <RadioGroup
              aria-labelledby="clarify-scope"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value as "brow" | "bangs")
              }
            >
              {question.allowedScopes.map((target) => (
                <FormControlLabel
                  key={target}
                  value={target}
                  control={<Radio />}
                  label={t(
                    target === "brow" ? "consult.brow" : "consult.bangs",
                  )}
                />
              ))}
            </RadioGroup>
          </FormControl>
          {question.requiresDetail ? (
            <TextField
              disabled={working}
              label={t("clarify.detail")}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          ) : null}
          <Button
            type="submit"
            variant="contained"
            disabled={
              working || !scope || (question.requiresDetail && !detail.trim())
            }
          >
            {t("clarify.submit")}
          </Button>
        </>
      ) : (
        <Alert severity="warning">{t("clarify.missing")}</Alert>
      )}
      {working ? (
        <Typography role="status">{t("run.analysing")}</Typography>
      ) : null}
      {error || run.status === "failed" ? (
        <Alert severity="error">
          {error ?? (run.status === "failed" ? run.message : "")}
        </Alert>
      ) : null}
      {run.status === "timeout" ||
      (run.status === "failed" && run.canRecheck) ? (
        <Alert
          severity="warning"
          action={<Button onClick={onRecheck}>{t("door.recheck")}</Button>}
        >
          {t("run.timeout")}
        </Alert>
      ) : null}
      {run.status === "failed" && !run.canRecheck ? (
        <Button onClick={onRetake}>{t("capture.retake")}</Button>
      ) : null}
      <Button color="inherit" onClick={onFinish}>
        {t("capture.finish")}
      </Button>
    </Stack>
  );
}
