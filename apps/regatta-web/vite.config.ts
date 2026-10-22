import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/local-decider": {
        target: "http://127.0.0.1:8766",
        rewrite: (path) => path.replace(/^\/local-decider/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            try {
              request.setHeader(
                "X-Regatta-Local-Token",
                readFileSync(
                  new URL("../../.local/regatta/token", import.meta.url),
                  "utf8",
                ).trim(),
              );
            } catch {
              /* An offline bridge must not enable inference. */
            }
          });
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
