import { Button, Stack, Typography } from "@mui/material";

export function Done({ onRestart }: { onRestart: () => void }) {
  return (
    <Stack spacing={2}>
      <Typography>
        相談を終えました。撮影の前に、ここまでの写真はこの端末から消えます。
      </Typography>
      <Button variant="outlined" onClick={onRestart}>
        もう一度はじめる
      </Button>
    </Stack>
  );
}
