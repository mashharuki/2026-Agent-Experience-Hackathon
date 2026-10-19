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
  Typography,
} from "@mui/material";
import type {
  Advice,
  FeedbackRequestComparisonChoice,
} from "../api/generated/model";
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
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        <Stack sx={{ flex: 1 }} spacing={0.5}>
          <img
            className="photo"
            src={before.url}
            alt={t("compare.beforeLabel")}
          />
          <Typography variant="caption" align="center">
            {t("compare.beforeLabel")}
          </Typography>
        </Stack>
        <Stack sx={{ flex: 1 }} spacing={0.5}>
          <img
            className="photo"
            src={after.url}
            alt={t("compare.afterLabel")}
          />
          <Typography variant="caption" align="center">
            {t("compare.afterLabel")}
          </Typography>
        </Stack>
      </Stack>

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
