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
import type { Restriction, Scope } from "../api/generated/model";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/ja";

const OPTIONS: { value: Scope; key: MessageKey }[] = [
  { value: "brow", key: "consult.brow" },
  { value: "bangs", key: "consult.bangs" },
  { value: "look_first", key: "consult.lookFirst" },
];

export interface ConsultResult {
  scope: Scope;
  wish?: string;
  restrictions: Restriction[];
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
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope | "">("");
  const [wish, setWish] = useState("");
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [consent, setConsent] = useState(false);

  return (
    <Stack spacing={3} component="form" onSubmit={(e) => e.preventDefault()}>
      <Typography variant="body2">{t("consult.journey")}</Typography>
      <FormControl>
        <FormLabel id="scope-label">{t("consult.scopeLabel")}</FormLabel>
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
              label={t(option.key)}
            />
          ))}
        </RadioGroup>
      </FormControl>

      <FormControl component="fieldset">
        <FormLabel component="legend">{t("consult.restrictions")}</FormLabel>
        {(["no_touch_brow", "keep_brow_shape", "no_touch_bangs"] as const).map(
          (restriction) => (
            <FormControlLabel
              key={restriction}
              label={t(`restriction.${restriction}`)}
              control={
                <Checkbox
                  checked={restrictions.includes(restriction)}
                  onChange={(event) => {
                    setRestrictions((current) =>
                      event.target.checked
                        ? [...current, restriction]
                        : current.filter((r) => r !== restriction),
                    );
                  }}
                />
              }
            />
          ),
        )}
        <Typography variant="caption">
          {t("consult.restrictionsHelp")}
        </Typography>
      </FormControl>
      <TextField
        label={t("consult.wishLabel")}
        helperText={t("consult.wishHelp")}
        value={wish}
        onChange={(event) => setWish(event.target.value)}
        slotProps={{ htmlInput: { maxLength: 200 } }}
        multiline
        minRows={2}
      />

      <Alert severity="info" icon={false}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t("consult.consentText")}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
          }
          label={t("consult.consentCheck")}
        />
      </Alert>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={!scope || !consent || busy}
        onClick={() =>
          scope &&
          onSubmit({ scope, restrictions, wish: wish.trim() || undefined })
        }
      >
        {t("consult.submit")}
      </Button>
      <Button color="inherit" onClick={onDecline}>
        {t("consult.decline")}
      </Button>
    </Stack>
  );
}
