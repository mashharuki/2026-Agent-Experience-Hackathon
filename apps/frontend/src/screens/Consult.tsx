import {
  Alert,
  Button,
  Checkbox,
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
import type { Scope } from "../api/generated/model";

const OPTIONS: { value: Scope; label: string }[] = [
  { value: "brow", label: "眉" },
  { value: "bangs", label: "前髪" },
  { value: "look_first", label: "まず見てほしい" },
];

export interface ConsultResult {
  scope: Scope;
  wish?: string;
}

/** Screen 1: choose what to look at, optionally say what you want, and consent before any photo. */
export function Consult({
  onSubmit,
  onDecline,
  busy,
  error,
}: {
  onSubmit: (result: ConsultResult) => void;
  /** The person does not agree: leave without sending anything. */
  onDecline: () => void;
  busy: boolean;
  error?: string;
}) {
  const [scope, setScope] = useState<Scope | "">("");
  const [wish, setWish] = useState("");
  const [consent, setConsent] = useState(false);

  return (
    <Stack spacing={3} component="form" onSubmit={(e) => e.preventDefault()}>
      <FormControl>
        <FormLabel id="scope-label">どこを見ますか？</FormLabel>
        <RadioGroup
          aria-labelledby="scope-label"
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
        >
          {OPTIONS.map((option) => (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={<Radio />}
              label={option.label}
            />
          ))}
        </RadioGroup>
      </FormControl>

      <TextField
        label="希望（任意）"
        helperText="例：眉の形は変えたくないが、毛の流れは整えたい（200文字まで）"
        value={wish}
        onChange={(event) => setWish(event.target.value)}
        slotProps={{ htmlInput: { maxLength: 200 } }}
        multiline
        minRows={2}
      />

      <Alert severity="info" icon={false}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          撮影した写真は、助言をつくるためにクラウド（AWS）に送られて解析されます。処理が終わるとすぐ削除し、失敗しても24時間以内に削除されます。比べるための写真は、この端末の中にだけ残ります。
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
          }
          label="クラウドで解析されることに同意します"
        />
      </Alert>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={!scope || !consent || busy}
        onClick={() =>
          scope && onSubmit({ scope, wish: wish.trim() || undefined })
        }
      >
        撮影へ進む
      </Button>
      <Button color="inherit" onClick={onDecline} disabled={busy}>
        同意しない（終了する）
      </Button>
    </Stack>
  );
}
