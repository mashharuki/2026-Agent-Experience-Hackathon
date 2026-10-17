import { Box, LinearProgress, Typography } from "@mui/material";

export function Waiting({ text }: { text: string }) {
  return (
    <Box role="status" aria-live="polite" sx={{ py: 2 }}>
      <Typography sx={{ mb: 1 }}>{text}</Typography>
      <LinearProgress aria-label={text} />
    </Box>
  );
}
