#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { PhotoPrepStack } from "../lib/cdk-stack";

const app = new cdk.App();

new PhotoPrepStack(app, "PhotoPrepStack", {
  // Region is fixed to Tokyo (docs/tech-stack.md). The account comes from the CLI
  // credentials; nothing here is deployed by synth or tests.
  env: { region: "ap-northeast-1", account: process.env.CDK_DEFAULT_ACCOUNT },
});

cdk.Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, { verbose: true }),
);
