import { CssBaseline, createTheme, ThemeProvider } from "@mui/material";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./ObserverApp";
import "./style.css";

const theme = createTheme({
  // Mirrors the :root tokens in style.css; MUI derives shades from literal values.
  palette: {
    primary: { main: "#244d61" },
    secondary: { main: "#ef8354" },
    background: { default: "#1b5268" },
    text: { primary: "#102f43", secondary: "#4b6573" },
  },
  typography: {
    fontFamily: '"Avenir Next", "Hiragino Sans", "Yu Gothic", sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 42 } },
    },
  },
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
