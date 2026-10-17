// Publish the SPA to the deployed stack: build against the real API (never the mock), upload,
// invalidate the entry page. Everything it writes comes from the stack's own outputs.
//
//   node scripts/publish.ts          # print the plan, change nothing
//   node scripts/publish.ts --yes    # do it
//
// Needs AWS credentials in the environment (the same ones used to deploy). No secrets are put
// into the build: the app is a public client.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const STACK_NAME = "PhotoPrepStack";

export interface Outputs {
  spaBucket: string;
  distributionId: string;
  spaUrl: string;
  apiUrl: string;
  cognitoDomain: string;
  clientId: string;
}

export interface Step {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type StackOutput = { OutputKey: string; OutputValue: string };

const REQUIRED: Record<keyof Outputs, string> = {
  spaBucket: "SpaBucketName",
  distributionId: "DistributionId",
  spaUrl: "SpaUrl",
  apiUrl: "ApiUrl",
  cognitoDomain: "CognitoHostedUiUrl",
  clientId: "UserPoolClientId",
};

export function parseOutputs(raw: StackOutput[]): Outputs {
  const byKey = new Map(raw.map((o) => [o.OutputKey, o.OutputValue]));
  const result = {} as Record<keyof Outputs, string>;
  for (const [field, key] of Object.entries(REQUIRED) as [
    keyof Outputs,
    string,
  ][]) {
    const value = byKey.get(key);
    if (!value) throw new Error(`stack output missing: ${key}`);
    result[field] = value;
  }
  return result;
}

export function viteEnv(outputs: Outputs): Record<string, string> {
  return {
    VITE_USE_MOCK_API: "false", // explicit: a deployed build must never fall back to the mock
    VITE_API_BASE_URL: outputs.apiUrl,
    VITE_COGNITO_DOMAIN: outputs.cognitoDomain,
    VITE_COGNITO_CLIENT_ID: outputs.clientId,
  };
}

export function plan(outputs: Outputs): Step[] {
  const bucket = `s3://${outputs.spaBucket}`;
  return [
    {
      name: "build",
      command: "pnpm",
      args: ["exec", "vite", "build"],
      env: viteEnv(outputs),
    },
    {
      name: "upload-assets",
      command: "aws",
      args: [
        "s3",
        "sync",
        "dist/assets",
        `${bucket}/assets`,
        "--cache-control",
        "public,max-age=31536000,immutable",
      ],
    },
    {
      name: "upload-index",
      command: "aws",
      args: [
        "s3",
        "cp",
        "dist/index.html",
        `${bucket}/index.html`,
        "--cache-control",
        "no-cache",
        "--content-type",
        "text/html; charset=utf-8",
      ],
    },
    {
      name: "invalidate",
      command: "aws",
      args: [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        outputs.distributionId,
        "--paths",
        "/index.html",
      ],
    },
  ];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** A build that does not contain the deployed API address would run in mock mode: refuse it. */
export function verifyBuild(distDir: string, outputs: Outputs): void {
  const scripts = walk(distDir).filter((f) => f.endsWith(".js"));
  const text = scripts.map((f) => readFileSync(f, "utf8")).join("\n");
  if (!text.includes(outputs.apiUrl)) {
    throw new Error(
      "the build does not contain the deployed API address (it would run as the mock)",
    );
  }
  if (!text.includes(outputs.clientId)) {
    throw new Error("the build does not contain the Cognito client id");
  }
}

interface Io {
  run: (
    command: string,
    args: string[],
    env?: Record<string, string>,
  ) => { status: number | null; stdout: string };
  log: (line: string) => void;
  verify: (distDir: string, outputs: Outputs) => void;
}

const real: Io = {
  run: (command, args, env) => {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "inherit"],
    });
    return { status: result.status, stdout: result.stdout ?? "" };
  },
  log: (line) => console.log(line),
  verify: verifyBuild,
};

export function main(argv: string[], io: Io = real): number {
  const apply = argv.includes("--yes");
  const described = io.run("aws", [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    STACK_NAME,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json",
  ]);
  if (described.status !== 0) {
    io.log(
      `Could not read the outputs of ${STACK_NAME}. Is it deployed, and are you signed in?`,
    );
    return 1;
  }
  let outputs: Outputs;
  try {
    outputs = parseOutputs(JSON.parse(described.stdout) as StackOutput[]);
  } catch (error) {
    io.log(String(error instanceof Error ? error.message : error));
    return 1;
  }
  const steps = plan(outputs);
  io.log(`Publish to ${outputs.spaUrl}`);
  for (const step of steps)
    io.log(`  ${step.name}: ${[step.command, ...step.args].join(" ")}`);
  if (!apply) {
    io.log("Nothing was changed. Run again with --yes to publish.");
    return 0;
  }
  for (const step of steps) {
    const result = io.run(step.command, step.args, step.env);
    if (result.status !== 0) {
      io.log(`Step "${step.name}" failed; stopped before the following steps.`);
      return 1;
    }
    if (step.name === "build") {
      const dist = resolve("dist");
      if (!existsSync(dist) && io.verify === verifyBuild) {
        io.log("dist/ was not created by the build.");
        return 1;
      }
      try {
        io.verify(dist, outputs);
      } catch (error) {
        io.log(String(error instanceof Error ? error.message : error));
        return 1;
      }
    }
  }
  io.log(`Published: ${outputs.spaUrl}`);
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  process.exit(main(process.argv.slice(2)));
}
