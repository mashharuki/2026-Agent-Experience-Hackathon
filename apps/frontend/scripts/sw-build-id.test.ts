// Every release must change sw.js, or browsers never notice there is something to update.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stampBuildId, swBuildId } from "./sw-build-id";

// The real file mentions the placeholder in its header comment too: every mention must go.
const SOURCE =
  '/* __BUILD_ID__ is replaced */\nconst BUILD_ID = "__BUILD_ID__";\nconst x = 1;';

describe("stampBuildId", () => {
  it("replaces the placeholder with a short id derived from the page", () => {
    const stamped = stampBuildId(SOURCE, "<html>a</html>");
    expect(stamped).not.toContain("__BUILD_ID__");
    expect(stamped).toMatch(/BUILD_ID = "[0-9a-f]{12}"/);
  });

  it("gives the same id for the same build and a different one for another", () => {
    const a = stampBuildId(SOURCE, "<html>a</html>");
    expect(stampBuildId(SOURCE, "<html>a</html>")).toBe(a);
    expect(stampBuildId(SOURCE, "<html>b</html>")).not.toBe(a);
  });

  it("fails loudly when the placeholder is missing, instead of shipping an unversioned worker", () => {
    expect(() => stampBuildId("const x = 1;", "<html></html>")).toThrow(
      /BUILD_ID/,
    );
  });
});

describe("the plugin", () => {
  it("reads the worker from the project root, not from wherever the build was started", () => {
    const root = mkdtempSync(join(tmpdir(), "vite-root-"));
    mkdirSync(join(root, "src", "pwa"), { recursive: true });
    writeFileSync(
      join(root, "src", "pwa", "sw.js"),
      'const FROM_THE_ROOT = true;\nconst BUILD_ID = "__BUILD_ID__";',
    );
    const plugin = swBuildId();
    const emitted: { fileName: string; source: string }[] = [];
    (plugin.configResolved as (config: { root: string }) => void)({ root });
    (
      plugin.generateBundle as (
        this: {
          emitFile: (file: { fileName: string; source: string }) => void;
        },
        options: unknown,
        bundle: Record<string, unknown>,
      ) => void
    ).call(
      { emitFile: (file) => emitted.push(file) },
      {},
      { "assets/a.js": {} },
    );
    rmSync(root, { recursive: true });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe("sw.js");
    expect(emitted[0].source).toContain("FROM_THE_ROOT");
    expect(emitted[0].source).toMatch(/BUILD_ID = "[0-9a-f]{12}"/);
  });
});
