import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { createAppRuntime } from "./runtime";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");
const config = createAppRuntime();
createRoot(root).render(
  <StrictMode>
    <App config={config} />
  </StrictMode>,
);
