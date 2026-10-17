import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { acknowledge } from "../nag";
import { type Data, UPLOAD_PREFIX } from "./data";
import { Identity } from "./identity";

export interface ApiProps {
  readonly identity: Identity;
  readonly data: Data;
  /** Origins allowed to call the API from a browser (the SPA origin). */
  readonly allowedOrigins: string[];
  /** Lambda deployment package. Replaced by the real build in task T038. */
  readonly code: lambda.Code;
}

/**
 * One route per operation in packages/api-spec/openapi.yaml. A test keeps this list in
 * step with the contract. EVERY route is behind the JWT authorizer and requires the
 * `photoprep/session` scope: there is no unauthenticated path to paid inference.
 */
export const ROUTES: ReadonlyArray<{
  method: apigwv2.HttpMethod;
  path: string;
}> = [
  { method: apigwv2.HttpMethod.GET, path: "/service-status" },
  { method: apigwv2.HttpMethod.POST, path: "/sessions" },
  { method: apigwv2.HttpMethod.DELETE, path: "/sessions/{sessionId}" },
  { method: apigwv2.HttpMethod.POST, path: "/sessions/{sessionId}/uploads" },
  { method: apigwv2.HttpMethod.POST, path: "/sessions/{sessionId}/analyses" },
  { method: apigwv2.HttpMethod.POST, path: "/sessions/{sessionId}/feedback" },
  { method: apigwv2.HttpMethod.GET, path: "/jobs/{jobId}" },
];

export class Api extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);

    const logGroup = new logs.LogGroup(this, "HandlerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Not in a VPC: it only talks to AWS service endpoints.
    this.handler = new lambda.Function(this, "Handler", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: "photoprep_api.lambda_handler.handler",
      code: props.code,
      memorySize: 512,
      timeout: cdk.Duration.seconds(10),
      logGroup,
      environment: {
        TABLE_NAME: props.data.table.tableName,
        IMAGE_BUCKET: props.data.imageBucket.bucketName,
        QUEUE_URL: props.data.queue.queueUrl,
        BEARERINFO_FUNC: "photoprep_api.auth.bearer_info",
      },
    });

    // Least privilege, per resource.
    props.data.table.grantReadWriteData(this.handler);
    props.data.imageBucket.grantPut(this.handler, `${UPLOAD_PREFIX}*`);
    props.data.imageBucket.grantDelete(this.handler, `${UPLOAD_PREFIX}*`);
    props.data.queue.grantSendMessages(this.handler);

    this.httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      description: "Pre-photo grooming assistant API",
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        maxAge: cdk.Duration.minutes(10),
      },
    });

    const authorizer = new authorizers.HttpJwtAuthorizer(
      "CognitoJwt",
      props.identity.issuerUrl,
      {
        // Cognito access tokens carry the app client id in `client_id`; API Gateway
        // accepts `aud` or `client_id` here.
        jwtAudience: [props.identity.client.userPoolClientId],
      },
    );
    const integration = new integrations.HttpLambdaIntegration(
      "HandlerIntegration",
      this.handler,
    );
    for (const route of ROUTES) {
      this.httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration,
        authorizer,
        authorizationScopes: [Identity.SESSION_SCOPE],
      });
    }

    const accessLogs = new logs.LogGroup(this, "AccessLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    new apigwv2.HttpStage(this, "DefaultStage", {
      httpApi: this.httpApi,
      stageName: "$default",
      autoDeploy: true,
      // Coarse abuse/cost guard in front of the per-user quotas enforced in the app.
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
        // No client IP, headers, query string or body: only what operations need.
        format: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: "$context.requestId",
            routeKey: "$context.routeKey",
            status: "$context.status",
            responseLatency: "$context.responseLatency",
            integrationError: "$context.integrationErrorMessage",
          }),
        ),
      },
    });

    // cdk-nag 3: each finding is acknowledged individually.
    acknowledge(this.handler, [
      {
        id: "AwsSolutions::AwsSolutions-L1",
        reason:
          "Python 3.12 is pinned deliberately: dependencies are locked and tested with it (uv.lock) and it matches the worker. Upgrading the runtime is a separate, tested change.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
        reason:
          "AWSLambdaBasicExecutionRole only grants CloudWatch Logs write access to the function's log group.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataTableFDBAD0F2.Arn>/index/*]",
        reason:
          "Generated by grantReadWriteData: allows the table's own secondary index (status-index) only.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataImageBucket04D7B968.Arn>/uploads/*]",
        reason:
          "Limited to the uploads/ prefix of the temporary image bucket (signed POST targets and deletion).",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Action::s3:Abort*]",
        reason:
          "Generated by grantPut: multipart-abort actions on the uploads/ prefix only.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Action::s3:DeleteObject*]",
        reason:
          "Generated by grantDelete: deleting temporary images under uploads/ only (images are removed after processing).",
      },
    ]);
  }
}
