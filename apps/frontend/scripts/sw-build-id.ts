// Gives every build its own service worker file. Browsers only look for an update when sw.js
// changes byte for byte, so without this a release made of new hashed assets alone is invisible
// to a tab that is already open.
//
// The worker's source lives in src/pwa/sw.js (not public/) and is emitted by this plugin as part
// of the build, so nothing can copy an unstamped file over it afterwards.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const PLACEHOLDER = "__BUILD_ID__";

export function stampBuildId(source: string, seed: string): string {
  if (!source.includes(PLACEHOLDER)) {
    throw new Error(`sw.js has no ${PLACEHOLDER} placeholder to stamp`);
  }
  const id = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return source.replaceAll(PLACEHOLDER, id);
}

/**
 * The emitted file names carry content hashes, so their list changes whenever any code does.
 * The worker's source is found from Vite's project root, so the build works from any directory.
 */
export function swBuildId(sourcePath?: string): Plugin {
  let root = process.cwd();
  return {
    name: "sw-build-id",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      const seed = Object.keys(bundle).sort().join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: stampBuildId(
          readFileSync(sourcePath ?? resolve(root, "src/pwa/sw.js"), "utf8"),
          seed,
        ),
      });
    },
  };
}
