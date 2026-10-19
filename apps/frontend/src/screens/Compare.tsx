import {
  Alert,
  Button,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type {
  Advice,
  FeedbackRequestComparisonChoice,
} from "../api/generated/model";
import { PhotoDownloads } from "../components/PhotoDownloads";
import type { Photo } from "../features/session/photos";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/ja";

const CHOICES: { value: FeedbackRequestComparisonChoice; key: MessageKey }[] = [
  { value: "prefer_before", key: "compare.preferBefore" },
  { value: "prefer_after", key: "compare.preferAfter" },
  { value: "unclear", key: "compare.unclear" },
];

/** Screen 4: before and after side by side. Any choice is a good outcome; finishing is the main action. */
export function Compare({
  before,
  after,
  choice,
  nextAdvice,
  canTryAgain,
  busy,
  error,
  onChoose,
  onFinish,
  onTryAgain,
}: {
  before: Photo;
  after: Photo;
  choice?: FeedbackRequestComparisonChoice;
  /** The next suggestion from the same check, if there is one (no extra analysis needed). */
  nextAdvice?: Advice;
  canTryAgain: boolean;
  busy: boolean;
  error?: string;
  onChoose: (choice: FeedbackRequestComparisonChoice) => void;
  onFinish: () => void;
  onTryAgain: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"side" | "single">("side");
  const [view, setView] = useState<"before" | "after">("before");
  const images = { before, after };
  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        value={mode}
        aria-label={t("compare.mode")}
        onChange={(_, value: "side" | "single" | null) => {
          if (value) setMode(value);
        }}
      >
        <ToggleButton value="side">{t("compare.side")}</ToggleButton>
        <ToggleButton value="single">{t("compare.single")}</ToggleButton>
      </ToggleButtonGroup>
      {mode === "single" ? (
        <ToggleButtonGroup
          exclusive
          value={view}
          aria-label={t("compare.view")}
          onChange={(_, value: "before" | "after" | null) => {
            if (value) setView(value);
          }}
        >
          <ToggleButton value="before">{t("compare.beforeLabel")}</ToggleButton>
          <ToggleButton value="after">{t("compare.afterLabel")}</ToggleButton>
        </ToggleButtonGroup>
      ) : null}
      <Stack direction="row" spacing={1}>
        {(["before", "after"] as const)
          .filter((target) => mode === "side" || target === view)
          .map((target) => (
            <Stack key={target} sx={{ flex: 1, minWidth: 0 }} spacing={0.5}>
              <img
                className="comparison-photo"
                src={images[target].url}
                alt={t(`compare.${target}Label`)}
              />
              <Typography variant="caption" align="center">
                {t(`compare.${target}Label`)}
              </Typography>
            </Stack>
          ))}
      </Stack>

      <PhotoDownloads before={before} after={after} />

      <FormControl>
        <FormLabel id="choice-label">{t("compare.question")}</FormLabel>
        <RadioGroup
          aria-labelledby="choice-label"
          value={choice ?? ""}
          onChange={(event) =>
            onChoose(event.target.value as FeedbackRequestComparisonChoice)
          }
        >
          {CHOICES.map((c) => (
            <FormControlLabel
              key={c.value}
              value={c.value}
              control={<Radio />}
              label={t(c.key)}
              disabled={busy}
            />
          ))}
        </RadioGroup>
      </FormControl>
      {choice ? (
        <Alert severity="success">{t("compare.recorded")}</Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button variant="contained" size="large" onClick={onFinish}>
        {t("compare.finish")}
      </Button>
      {canTryAgain && nextAdvice ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              {t("compare.nextLabel")}
            </Typography>
            <Typography sx={{ mb: 1 }}>{nextAdvice.text}</Typography>
            <Button variant="outlined" onClick={onTryAgain} disabled={busy}>
              {t("compare.nextButton")}
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
