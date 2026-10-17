import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";
import { Api } from "./constructs/api";
import { Data } from "./constructs/data";
import { Frontend } from "./constructs/frontend";
import { Identity } from "./constructs/identity";
import { Operations } from "./constructs/operations";
import { Worker } from "./constructs/worker";

export interface PhotoPrepStackProps extends cdk.StackProps {
  /**
   * Extra local origins for development (also OAuth redirect hosts and CORS origins). Empty by
   * default: a production stack must not trust a port on someone's laptop. Opt in with
   * `-c photoprep:devOrigin=http://localhost:5173`.
   */
  readonly devOrigins?: string[];
  /** Overrides the Lambda package (tests pass an inline stub). */
  readonly apiCode?: lambda.Code;
  /** Folder produced by `pnpm build:lambda` (apps/api/build/lambda by default). */
  readonly lambdaPackageDir?: string;
}

/**
 * Identity, Data, Frontend, Api (T020-T024), then the Worker and Operations (T049/T050).
 *
 * Stateful resources follow the context flag `photoprep:destroyData`: false (default)
 * retains the Cognito user pool and the metadata table on stack deletion; true allows a
 * full teardown. Nothing here is deployed by the test suite.
 */
/** `-c photoprep:devOrigin=http://localhost:5173`: one local http origin, nothing else. */
function devOriginFromContext(scope: Construct): string[] {
  const value = scope.node.tryGetContext("photoprep:devOrigin");
  if (value === undefined || value === "") return [];
  if (
    typeof value !== "string" ||
    !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(value)
  ) {
    throw new Error(
      "photoprep:devOrigin must be a local http origin such as http://localhost:5173 (no path)",
    );
  }
  return [value];
}

/**
 * `-c photoprep:workerDesiredCount=1` keeps a running worker running through a deploy. The
 * template otherwise pins the service to 0, so every deploy would stop it (and cut off a job).
 */
function workerDesiredCountFromContext(scope: Construct): 0 | 1 {
  const value = Number(
    scope.node.tryGetContext("photoprep:workerDesiredCount") ?? 0,
  );
  if (value !== 0 && value !== 1) {
    throw new Error(
      "photoprep:workerDesiredCount must be 0 or 1 (the worker handles one job at a time)",
    );
  }
  return value;
}

export class PhotoPrepStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PhotoPrepStackProps = {}) {
    super(scope, id, props);

    const destroyData =
      this.node.tryGetContext("photoprep:destroyData") === true;
    const removalPolicy = destroyData
      ? cdk.RemovalPolicy.DESTROY
      : cdk.RemovalPolicy.RETAIN;
    const devOrigins = props.devOrigins ?? devOriginFromContext(this);

    const frontend = new Frontend(this, "Frontend");
    const spaOrigin = `https://${frontend.distribution.distributionDomainName}`;
    const allowedOrigins = [spaOrigin, ...devOrigins];

    const identity = new Identity(this, "Identity", {
      callbackUrls: allowedOrigins.map((o) => `${o}/auth/callback`),
      logoutUrls: allowedOrigins.map((o) => `${o}/`),
      domainPrefix: `photoprep-${cdk.Aws.ACCOUNT_ID}`,
      removalPolicy,
    });

    const data = new Data(this, "Data", { allowedOrigins, removalPolicy });

    // The real package (code + pinned dependencies + the OpenAPI file) built by
    // scripts/build_lambda.py. Without it the Lambdas could not start, so refuse to synthesize
    // rather than deploy something broken.
    const packageDir =
      props.lambdaPackageDir ??
      path.join(__dirname, "..", "..", "api", "build", "lambda");
    if (!props.apiCode && !fs.existsSync(packageDir)) {
      throw new Error(
        `Lambda package not found at ${packageDir}. Run \`pnpm build:lambda\` first.`,
      );
    }
    const code = props.apiCode ?? lambda.Code.fromAsset(packageDir);

    const api = new Api(this, "Api", { identity, data, allowedOrigins, code });

    const worker = new Worker(this, "Worker", {
      data,
      bedrockModelId:
        this.node.tryGetContext("photoprep:bedrockModelId") ??
        "amazon.nova-lite-v1:0",
      // Pushed separately (the image carries the model weights); never a floating tag.
      imageTag: this.node.tryGetContext("photoprep:workerImageTag") ?? "unset",
      desiredCount: workerDesiredCountFromContext(this),
    });

    const operations = new Operations(this, "Operations", {
      data,
      worker,
      code,
      alertEmail: this.node.tryGetContext("photoprep:alertEmail"),
      budgetUsd: 30, // approved 2026-10-17 (docs/architecture/cost-estimate.md)
    });

    new cdk.CfnOutput(this, "SpaUrl", { value: spaOrigin });
    new cdk.CfnOutput(this, "SpaBucketName", {
      value: frontend.bucket.bucketName,
    });
    new cdk.CfnOutput(this, "DistributionId", {
      value: frontend.distribution.distributionId,
    });
    new cdk.CfnOutput(this, "CognitoHostedUiUrl", {
      value: identity.hostedUiUrl,
    });
    new cdk.CfnOutput(this, "ApiUrl", { value: api.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "UserPoolId", {
      value: identity.userPool.userPoolId,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: identity.client.userPoolClientId,
    });
    new cdk.CfnOutput(this, "CognitoIssuer", { value: identity.issuerUrl });
    new cdk.CfnOutput(this, "WorkerRepositoryUri", {
      value: worker.repository.repositoryUri,
    });
    new cdk.CfnOutput(this, "WorkerClusterName", {
      value: worker.cluster.clusterName,
    });
    new cdk.CfnOutput(this, "WorkerServiceName", {
      value: worker.service.serviceName,
    });
    new cdk.CfnOutput(this, "WorkerControlFunction", {
      value: operations.workerControl.functionName,
    });
  }
}
