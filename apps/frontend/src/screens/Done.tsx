import { Button, Stack, Typography } from "@mui/material";

export function Done({
  onRestart,
  declined,
}: {
  onRestart: () => void;
  declined?: boolean;
}) {
  return (
    <Stack spacing={2}>
      <Typography>
        {declined
          ? "同意されなかったため、写真は送られていません。いつでもまたはじめられます。"
          : "相談を終えました。ここまでの写真は、この端末から消えます。クラウドの写真も削除されます。"}
      </Typography>
      <Button variant="outlined" onClick={onRestart}>
        もう一度はじめる
      </Button>
    </Stack>
  );
}
