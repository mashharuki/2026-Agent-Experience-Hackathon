#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { RegattaStack } from "../lib/regatta-stack";

const app = new cdk.App();
const context = (key: string) => app.node.tryGetContext(`regatta:${key}`);
const cpu = Number(context("workerCpu") ?? 16384);
if (cpu !== 4096 && cpu !== 8192 && cpu !== 16384)
  throw new Error("regatta:workerCpu must be 4096, 8192 or 16384");
const desired = Number(context("desiredCount") ?? 0);
if (desired !== 0 && desired !== 1)
  throw new Error("regatta:desiredCount must be 0 or 1");
const repositoryName = context("repositoryName");
if (typeof repositoryName !== "string" || repositoryName.length === 0)
  throw new Error("regatta:repositoryName is required");

new RegattaStack(app, "SnipeRegattaStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
  repositoryName,
  imageTag: String(context("imageTag") ?? ""),
  workerCpu: cpu,
  desiredCount: desired,
  budgetMs: Number(context("budgetMs") ?? 6000),
});
cdk.Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, { verbose: true }),
);
