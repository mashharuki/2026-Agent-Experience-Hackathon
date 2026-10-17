import { Alert, MenuItem, Select, Stack, Typography } from "@mui/material";
import type { MockApi, MockScenario } from "../mock/mock-api";

const LABELS: Record<MockScenario, string> = {
  normal: "通常",
  backlight: "逆光（撮り直しの案内）",
  vague: "あいまい（確認の質問）",
  error: "解析の失敗",
};

/** Always visible in mock mode: the user must never mistake replayed results for real analysis. */
export function MockBanner({ mock }: { mock?: MockApi }) {
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
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
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
              value={mock.scenario}
              onChange={(event) =>
                mock.setScenario(event.target.value as MockScenario)
              }
              inputProps={{ "aria-label": "モックの状況" }}
            >
              {(Object.keys(LABELS) as MockScenario[]).map((key) => (
                <MenuItem key={key} value={key}>
                  {LABELS[key]}
                </MenuItem>
              ))}
            </Select>
          </Stack>
        ) : null}
      </Stack>
    </Alert>
  );
}
