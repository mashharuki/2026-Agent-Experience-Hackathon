import { createTheme } from "@mui/material/styles";

// CSS variables + both colour schemes, so the page follows the device's light/dark setting.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: { light: true, dark: true },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif',
    h1: { fontSize: "1.25rem", fontWeight: 700 },
    h2: { fontSize: "1.5rem", fontWeight: 700 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 48 } },
    },
  },
});
