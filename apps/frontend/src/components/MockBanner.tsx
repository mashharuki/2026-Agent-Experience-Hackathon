import { Alert, MenuItem, Select, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/ja";
import { DOORS } from "../mock/doors";
import type { MockApi, MockScenario } from "../mock/mock-api";

const LABELS: Record<MockScenario, MessageKey> = {
  normal: "mock.scenario.normal",
  backlight: "mock.scenario.backlight",
  vague: "mock.scenario.vague",
  error: "mock.scenario.error",
};

/** Always visible in mock mode: the user must never mistake replayed results for real analysis. */
export function MockBanner({ mock }: { mock?: MockApi }) {
  const { t } = useI18n();
  // The mock itself is not reactive, so the selects keep their own copy of the choice.
  const [scenario, setScenario] = useState<MockScenario>(
    mock?.scenario ?? "normal",
  );
  const [doorKey, setDoorKey] = useState<string>(
    () =>
      Object.keys(DOORS).find(
        (k) => DOORS[k].door.reason === mock?.door.reason,
      ) ?? "open",
  );
  return (
    <Alert
      severity="warning"
      role="status"
      data-testid="mock-banner"
      sx={{ borderRadius: 0 }}
    >
      <Stack spacing={1}>
        <Typography variant="body2">
          <strong>{t("mock.title")}</strong> {t("mock.notice")}
        </Typography>
        {mock ? (
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography
              variant="caption"
              component="label"
              htmlFor="mock-scenario"
              id="mock-scenario-label"
            >
              {t("mock.scenario")}
            </Typography>
            <Select
              id="mock-scenario"
              labelId="mock-scenario-label"
              size="small"
              value={scenario}
              onChange={(event) => {
                mock.setScenario(event.target.value as MockScenario);
                setScenario(event.target.value as MockScenario);
              }}
              inputProps={{ "aria-label": t("mock.scenario") }}
            >
              {(Object.keys(LABELS) as MockScenario[]).map((key) => (
                <MenuItem key={key} value={key}>
                  {t(LABELS[key])}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" component="label" htmlFor="mock-door">
              {t("mock.door")}
            </Typography>
            <Select
              id="mock-door"
              size="small"
              value={doorKey}
              onChange={(event) => {
                mock.setDoor(DOORS[event.target.value].door);
                setDoorKey(event.target.value);
              }}
              inputProps={{ "aria-label": t("mock.doorState") }}
            >
              {Object.entries(DOORS).map(([key, { label }]) => (
                <MenuItem key={key} value={key}>
                  {t(label)}
                </MenuItem>
              ))}
            </Select>
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  );
}
