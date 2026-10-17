import {
  Alert,
  Box,
  Button,
  Container,
  CssBaseline,
  Stack,
  ThemeProvider,
  Typography,
} from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { setFetchImplementation } from "./api/custom-fetch";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/context";
import { MockBanner } from "./components/MockBanner";
import { type AppConfig, ConfigContext, loadConfig } from "./config";
import { SessionFlow } from "./features/session/SessionFlow";
import { createMockApi } from "./mock/mock-api";
import { theme } from "./theme";

function Gate() {
  const auth = useAuth();
  if (auth.status === "loading")
    return <Typography>確認しています…</Typography>;
  if (auth.status === "error") {
    return (
      <Alert severity="error">
        ログインできませんでした。もう一度お試しください。
      </Alert>
    );
  }
  if (auth.status === "signed-out") {
    return (
      <Stack spacing={2}>
        <Typography>はじめるにはログインが必要です（招待制）。</Typography>
        <Button variant="contained" size="large" onClick={auth.signIn}>
          ログイン
        </Button>
      </Stack>
    );
  }
  return <SessionFlow />;
}

export default function App({
  config: override,
}: {
  config?: Partial<AppConfig>;
}) {
  const [config] = useState<AppConfig>(() => {
    const base = { ...loadConfig(), ...override };
    if (base.mode === "mock") {
      // All API calls, including the signed photo upload, are answered inside this tab.
      base.mock ??= createMockApi();
      setFetchImplementation(base.mock.fetch);
    } else {
      setFetchImplementation((...args) => fetch(...args));
    }
    return base;
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            gcTime: 60_000,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ConfigContext.Provider value={config}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {config.mode === "mock" ? <MockBanner mock={config.mock} /> : null}
            <Container maxWidth="sm" sx={{ py: 3 }}>
              <Box component="header" sx={{ mb: 2 }}>
                <Typography variant="h1" component="h1">
                  撮る前のひと手間
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  撮影前に、眉か前髪を一つだけ整えて試せます。
                </Typography>
              </Box>
              <Gate />
            </Container>
          </AuthProvider>
        </QueryClientProvider>
      </ConfigContext.Provider>
    </ThemeProvider>
  );
}
