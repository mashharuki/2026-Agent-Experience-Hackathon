import { Button, Stack, Typography } from "@mui/material";
import { useI18n } from "../i18n/I18nProvider";

export function Done({
  onRestart,
  declined,
}: {
  onRestart: () => void;
  declined?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Stack spacing={2}>
      <Typography>
        {declined ? t("done.declined") : t("done.finished")}
      </Typography>
      <Button variant="outlined" onClick={onRestart}>
        {t("done.restart")}
      </Button>
    </Stack>
  );
}
