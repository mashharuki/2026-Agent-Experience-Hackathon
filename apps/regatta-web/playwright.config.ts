import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // CI runners render WebGL in software; allow slower page interactions there.
  timeout: process.env.CI ? 60_000 : 30_000,
  use: { baseURL: "http://127.0.0.1:5175", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "vite --host 127.0.0.1 --port 5175 --strictPort",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: !process.env.CI,
  },
});
