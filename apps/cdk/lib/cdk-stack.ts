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
  /** Extra local origins for development (also used as OAuth redirect hosts). */
  readonly devOrigins?: string[];
  /** Overrides the default Lambda package (tests pass an inline stub). */
  readonly apiCode?: lambda.Code;
}

/**
 * Identity, Data, Frontend, Api (T020-T024), then the Worker and Operations (T049/T050).
 *
 * Stateful resources follow the context flag `photoprep:destroyData`: false (default)
 * retains the Cognito user pool and the metadata table on stack deletion; true allows a
 * full teardown. Nothing here is deployed by the test suite.
 */
export class PhotoPrepStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PhotoPrepStackProps = {}) {
    super(scope, id, props);

    const destroyData =
      this.node.tryGetContext("photoprep:destroyData") === true;
    const removalPolicy = destroyData
      ? cdk.RemovalPolicy.DESTROY
      : cdk.RemovalPolicy.RETAIN;
    const devOrigins = props.devOrigins ?? ["http://localhost:5173"];

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

    // Placeholder package (source only, no dependencies). The real build is task T038.
    const code =
      props.apiCode ??
      lambda.Code.fromAsset(path.join(__dirname, "..", "..", "api", "src"));

    const api = new Api(this, "Api", { identity, data, allowedOrigins, code });

    const worker = new Worker(this, "Worker", {
      data,
      bedrockModelId:
        this.node.tryGetContext("photoprep:bedrockModelId") ??
        "amazon.nova-lite-v1:0",
      // Pushed separately (the image carries the model weights); never a floating tag.
      imageTag: this.node.tryGetContext("photoprep:workerImageTag") ?? "unset",
    });

    const operations = new Operations(this, "Operations", {
      data,
      worker,
      code,
      alertEmail: this.node.tryGetContext("photoprep:alertEmail"),
      budgetUsd: 30, // approved 2026-10-17 (docs/architecture/cost-estimate.md)
    });

    new cdk.CfnOutput(this, "SpaUrl", { value: spaOrigin });
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
