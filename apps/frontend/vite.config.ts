import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { swBuildId } from "./scripts/sw-build-id.ts";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swBuildId()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Real hooks and a mock API; nothing here talks to the network.
    testTimeout: 15000,
  },
});
