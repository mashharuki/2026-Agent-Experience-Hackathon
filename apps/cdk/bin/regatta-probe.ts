#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { RegattaProbeStack } from "../lib/regatta-probe-stack";

const app = new cdk.App();
new RegattaProbeStack(app, "RegattaProbeStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
});
cdk.Validations.of(app).addPlugins(
  new AwsSolutionsChecks(app, { verbose: true }),
);
