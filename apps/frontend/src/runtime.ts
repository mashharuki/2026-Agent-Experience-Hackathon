import { setFetchImplementation } from "./api/custom-fetch";
import { type AppConfig, loadConfig } from "./config";
import { doorFromUrl } from "./mock/doors";
import { createMockApi } from "./mock/mock-api";

/** Construct once, before React renders. All mock consumers share this instance. */
export function createAppRuntime(override: Partial<AppConfig> = {}): AppConfig {
  const config = { ...loadConfig(), ...override };
  if (config.mode === "mock") {
    config.mock ??= createMockApi({
      door: doorFromUrl(window.location.search),
    });
    setFetchImplementation(config.mock.fetch);
  } else {
    setFetchImplementation((...args) => fetch(...args));
  }
  return config;
}
