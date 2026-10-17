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
import { LanguageSwitch } from "./components/LanguageSwitch";
import { MockBanner } from "./components/MockBanner";
import { type AppConfig, ConfigContext, loadConfig } from "./config";
import { SessionFlow } from "./features/session/SessionFlow";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";
import { doorFromUrl } from "./mock/doors";
import { createMockApi } from "./mock/mock-api";
import { OfflineNotice, UpdateBanner } from "./pwa/PwaNotices";
import { theme } from "./theme";

function Header() {
  const { t } = useI18n();
  return (
    <Box component="header" sx={{ mb: 2 }}>
      <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 1 }}>
        <LanguageSwitch />
      </Stack>
      <Typography variant="h1" component="h1">
        {t("app.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("app.tagline")}
      </Typography>
    </Box>
  );
}

function Gate() {
  const auth = useAuth();
  const { t } = useI18n();
  if (auth.status === "loading")
    return <Typography>{t("gate.loading")}</Typography>;
  if (auth.status === "error") {
    return <Alert severity="error">{t("gate.error")}</Alert>;
  }
  if (auth.status === "signed-out") {
    return (
      <Stack spacing={2}>
        <Typography>{t("gate.signInPrompt")}</Typography>
        <Button variant="contained" size="large" onClick={auth.signIn}>
          {t("gate.signIn")}
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
      base.mock ??= createMockApi({
        door: doorFromUrl(window.location.search),
      });
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
      <I18nProvider>
        <ConfigContext.Provider value={config}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <UpdateBanner />
              <OfflineNotice />
              {config.mode === "mock" ? (
                <MockBanner mock={config.mock} />
              ) : null}
              <Container maxWidth="sm" sx={{ py: 3 }}>
                <Header />
                <Gate />
              </Container>
            </AuthProvider>
          </QueryClientProvider>
        </ConfigContext.Provider>
      </I18nProvider>
    </ThemeProvider>
  );
}
