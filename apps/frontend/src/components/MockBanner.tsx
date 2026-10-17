import { Alert, MenuItem, Select, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { DOORS } from "../mock/doors";
import type { MockApi, MockScenario } from "../mock/mock-api";

const LABELS: Record<MockScenario, string> = {
  normal: "通常",
  backlight: "逆光（撮り直しの案内）",
  vague: "あいまい（確認の質問）",
  error: "解析の失敗",
};

/** Always visible in mock mode: the user must never mistake replayed results for real analysis. */
export function MockBanner({ mock }: { mock?: MockApi }) {
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
          <strong>モック動作中。</strong>
          AWS上のAPIにはつながっていません。写真はこの端末の外へ送られず、助言は固定の再生データです。実際の解析ではありません。
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
            >
              モックの状況
            </Typography>
            <Select
              id="mock-scenario"
              size="small"
              value={scenario}
              onChange={(event) => {
                mock.setScenario(event.target.value as MockScenario);
                setScenario(event.target.value as MockScenario);
              }}
              inputProps={{ "aria-label": "モックの状況" }}
            >
              {(Object.keys(LABELS) as MockScenario[]).map((key) => (
                <MenuItem key={key} value={key}>
                  {LABELS[key]}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" component="label" htmlFor="mock-door">
              受付
            </Typography>
            <Select
              id="mock-door"
              size="small"
              value={doorKey}
              onChange={(event) => {
                mock.setDoor(DOORS[event.target.value].door);
                setDoorKey(event.target.value);
              }}
              inputProps={{ "aria-label": "受付の状態" }}
            >
              {Object.entries(DOORS).map(([key, { label }]) => (
                <MenuItem key={key} value={key}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  );
}
