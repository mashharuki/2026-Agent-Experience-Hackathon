// Publishing the SPA: build against the deployed stack (never the mock), upload, invalidate.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, parseOutputs, plan, verifyBuild, viteEnv } from "./publish";

const OUTPUTS = [
  { OutputKey: "SpaBucketName", OutputValue: "site-bucket" },
  { OutputKey: "DistributionId", OutputValue: "E123ABC" },
  { OutputKey: "SpaUrl", OutputValue: "https://d111.cloudfront.net" },
  {
    OutputKey: "ApiUrl",
    OutputValue: "https://api.execute-api.ap-northeast-1.amazonaws.com",
  },
  {
    OutputKey: "CognitoHostedUiUrl",
    OutputValue: "https://photoprep-1.auth.ap-northeast-1.amazoncognito.com",
  },
  { OutputKey: "UserPoolClientId", OutputValue: "client123" },
];

describe("reading the stack outputs", () => {
  it("accepts a complete set", () => {
    expect(parseOutputs(OUTPUTS).spaBucket).toBe("site-bucket");
  });

  it.each(OUTPUTS.map((o) => o.OutputKey))(
    "refuses to continue without %s",
    (missing) => {
      expect(() =>
        parseOutputs(OUTPUTS.filter((o) => o.OutputKey !== missing)),
      ).toThrow(missing);
    },
  );
});

describe("the build environment", () => {
  const env = viteEnv(parseOutputs(OUTPUTS));

  it("points the app at the deployed API and Cognito", () => {
    expect(env.VITE_API_BASE_URL).toBe(
      "https://api.execute-api.ap-northeast-1.amazonaws.com",
    );
    expect(env.VITE_COGNITO_DOMAIN).toBe(
      "https://photoprep-1.auth.ap-northeast-1.amazoncognito.com",
    );
    expect(env.VITE_COGNITO_CLIENT_ID).toBe("client123");
  });

  it("switches the mock off explicitly", () => {
    expect(env.VITE_USE_MOCK_API).toBe("false");
  });

  it("carries no secret of any kind (a public client has none)", () => {
    expect(Object.keys(env).sort()).toEqual([
      "VITE_API_BASE_URL",
      "VITE_COGNITO_CLIENT_ID",
      "VITE_COGNITO_DOMAIN",
      "VITE_USE_MOCK_API",
    ]);
  });
});

describe("the plan", () => {
  const steps = plan(parseOutputs(OUTPUTS));
  const text = steps.map((s) => [s.command, ...s.args].join(" "));

  it("builds first, then uploads, then invalidates, in that order", () => {
    expect(steps.map((s) => s.name)).toEqual([
      "build",
      "upload-assets",
      "upload-static",
      "upload-favicon",
      "upload-service-worker",
      "upload-manifest",
      "upload-index",
      "invalidate",
    ]);
  });

  it("only ever writes to the bucket and distribution from the stack outputs", () => {
    const s3 = text.filter((t) => t.includes("s3"));
    expect(s3.length).toBeGreaterThan(0);
    for (const line of s3) expect(line).toContain("s3://site-bucket");
    expect(text.find((t) => t.includes("cloudfront"))).toContain("E123ABC");
  });

  it("caches hashed assets for a long time but never the entry page", () => {
    const assets = text.find((t) => t.includes("assets")) ?? "";
    expect(assets).toContain("immutable");
    const index =
      text.find((t) => t.includes("index.html") && t.includes("s3")) ?? "";
    expect(index).toContain("no-cache");
  });

  it("never caches the service worker or the manifest, so a new version is noticed", () => {
    const worker = text.find((t) => t.includes("dist/sw.js")) ?? "";
    expect(worker).toContain("no-cache");
    expect(worker).toContain("text/javascript");
    const manifest = text.find((t) => t.includes("manifest.webmanifest")) ?? "";
    expect(manifest).toContain("no-cache");
    expect(manifest).toContain("application/manifest+json");
  });

  it("uploads the icons and favicon with a day of caching", () => {
    const icons = text.find((t) => t.includes("dist/icons")) ?? "";
    expect(icons).toContain("max-age=86400");
    const favicon = text.find((t) => t.includes("dist/favicon.svg")) ?? "";
    expect(favicon).toContain("image/svg+xml");
  });

  it("puts the entry page last, after everything it refers to is in place", () => {
    const names = steps.map((s) => s.name);
    expect(names.indexOf("upload-index")).toBe(names.indexOf("invalidate") - 1);
  });

  it("refreshes the entry page, the service worker and the manifest on the CDN", () => {
    const invalidation =
      text.find((t) => t.includes("create-invalidation")) ?? "";
    for (const path of ["/index.html", "/sw.js", "/manifest.webmanifest"]) {
      expect(invalidation).toContain(path);
    }
  });

  it("does not delete anything it did not upload", () => {
    for (const line of text) expect(line).not.toContain("--delete");
  });
});

describe("checking the build before uploading it", () => {
  const outputs = parseOutputs(OUTPUTS);
  const make = (js: string) => {
    const dir = mkdtempSync(join(tmpdir(), "dist-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "assets", "index-abc.js"), js);
    writeFileSync(join(dir, "sw.js"), 'const BUILD_ID = "0123456789ab";');
    writeFileSync(join(dir, "manifest.webmanifest"), "{}");
    return dir;
  };

  it("accepts a build that contains the deployed API address", () => {
    const dir = make(
      `const a="${outputs.apiUrl}";const c="${outputs.clientId}";`,
    );
    expect(() => verifyBuild(dir, outputs)).not.toThrow();
    rmSync(dir, { recursive: true });
  });

  it("refuses a service worker that was not stamped with a build id", () => {
    const dir = make(
      `const a="${outputs.apiUrl}";const c="${outputs.clientId}";`,
    );
    writeFileSync(join(dir, "sw.js"), 'const BUILD_ID = "__BUILD_ID__";');
    expect(() => verifyBuild(dir, outputs)).toThrow(/service worker/i);
    rmSync(dir, { recursive: true });
  });

  it("refuses a build without a service worker or a manifest", () => {
    const base = `const a="${outputs.apiUrl}";const c="${outputs.clientId}";`;
    const noWorker = make(base);
    rmSync(join(noWorker, "sw.js"));
    expect(() => verifyBuild(noWorker, outputs)).toThrow(/service worker/i);
    const noManifest = make(base);
    rmSync(join(noManifest, "manifest.webmanifest"));
    expect(() => verifyBuild(noManifest, outputs)).toThrow(/manifest/i);
    rmSync(noWorker, { recursive: true });
    rmSync(noManifest, { recursive: true });
  });

  it("refuses a build that would run in mock mode (no API address inside)", () => {
    const dir = make('const a="";');
    expect(() => verifyBuild(dir, outputs)).toThrow(/API/);
    rmSync(dir, { recursive: true });
  });
});

describe("running it", () => {
  const stackJson = JSON.stringify(OUTPUTS);
  const recorder = () => {
    const calls: string[] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      return {
        status: 0,
        stdout:
          command === "aws" && args.includes("describe-stacks")
            ? stackJson
            : "",
      };
    };
    return { calls, run };
  };

  it("without --yes only prints the plan: nothing is uploaded or changed", () => {
    const { calls, run } = recorder();
    const result = main([], { run, log: () => {}, verify: () => {} });
    expect(result).toBe(0);
    const changing = calls.filter((c) =>
      /s3 (cp|sync)|create-invalidation|vite|build/.test(c),
    );
    expect(changing).toEqual([]);
  });

  it("with --yes runs every step in order", () => {
    const { calls, run } = recorder();
    expect(main(["--yes"], { run, log: () => {}, verify: () => {} })).toBe(0);
    const order = ["build", "s3", "s3", "cloudfront"].map((k) =>
      calls.findIndex((c) => c.includes(k)),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(calls.some((c) => c.includes("create-invalidation"))).toBe(true);
  });

  it("stops at the first failing step", () => {
    const calls: string[] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      if (args.includes("describe-stacks"))
        return { status: 0, stdout: stackJson };
      return { status: calls.length > 2 ? 1 : 0, stdout: "" };
    };
    expect(main(["--yes"], { run, log: () => {}, verify: () => {} })).toBe(1);
    expect(calls.some((c) => c.includes("create-invalidation"))).toBe(false);
  });
});
