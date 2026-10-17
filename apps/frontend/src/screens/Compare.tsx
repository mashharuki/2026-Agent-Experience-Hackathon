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

const CHOICES: { value: FeedbackRequestComparisonChoice; label: string }[] = [
  { value: "prefer_before", label: "前が好き" },
  { value: "prefer_after", label: "後が好き" },
  { value: "unclear", label: "差が分からない" },
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
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        <Stack sx={{ flex: 1 }} spacing={0.5}>
          <img className="photo" src={before.url} alt="整える前" />
          <Typography variant="caption" align="center">
            整える前
          </Typography>
        </Stack>
        <Stack sx={{ flex: 1 }} spacing={0.5}>
          <img className="photo" src={after.url} alt="整えた後" />
          <Typography variant="caption" align="center">
            整えた後
          </Typography>
        </Stack>
      </Stack>

      <FormControl>
        <FormLabel id="choice-label">どちらが好きですか？</FormLabel>
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
              label={c.label}
              disabled={busy}
            />
          ))}
        </RadioGroup>
      </FormControl>
      {choice ? (
        <Alert severity="success">
          選んだ内容を記録しました。どれを選んでも大丈夫です。
        </Alert>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        variant="contained"
        size="large"
        onClick={onFinish}
        disabled={busy}
      >
        終える
      </Button>
      {canTryAgain && nextAdvice ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              希望すれば、もう一手
            </Typography>
            <Typography sx={{ mb: 1 }}>{nextAdvice.text}</Typography>
            <Button variant="outlined" onClick={onTryAgain} disabled={busy}>
              もう一手試す
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}
