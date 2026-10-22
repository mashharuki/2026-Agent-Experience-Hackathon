import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as servicediscovery from "aws-cdk-lib/aws-servicediscovery";
import type { Construct } from "constructs";
import { Frontend } from "./constructs/frontend";
import { Identity } from "./constructs/identity";
import { acknowledge } from "./nag";

export interface RegattaStackProps extends cdk.StackProps {
  /** Existing ECR repository holding the pinned Decider image (pushed separately). */
  readonly repositoryName: string;
  /** Immutable image tag in that repository. */
  readonly imageTag: string;
  /** Fargate CPU units for the Decider task. */
  readonly workerCpu: 4096 | 8192 | 16384;
  /** 0 keeps the paid worker stopped; it is started only for demos. */
  readonly desiredCount: 0 | 1;
  /** Server-side decision budget, measured from receipt on the task's own clock (ms). */
  readonly budgetMs: number;
}

/** Routes that reach the Decider task; every route requires the regatta scope. */
export const DECIDER_ROUTES = [
  { method: apigwv2.HttpMethod.GET, path: "/health" },
  { method: apigwv2.HttpMethod.POST, path: "/decide" },
] as const;

/**
 * Snipe AI Regatta: SPA (S3 + CloudFront), Cognito, an HTTP API with a JWT
 * authorizer, a Decider task on Fargate reached through a VPC link (no ALB, no NAT),
 * and a Lambda that writes one Bedrock debrief per finished race.
 */
export class RegattaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RegattaStackProps) {
    super(scope, id, props);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(props.imageTag))
      throw new Error("An immutable image tag is required");
    if (!(props.budgetMs >= 1000 && props.budgetMs <= 20000))
      throw new Error("budgetMs must be 1000-20000");

    const site = new Frontend(this, "Site", {
      comment: "Snipe AI Regatta SPA",
      permissionsPolicy: "camera=(), microphone=(), geolocation=()",
    });
    const origin = `https://${site.distribution.distributionDomainName}`;
    const identity = new Identity(this, "Identity", {
      callbackUrls: [
        `${origin}/auth/callback`,
        "http://localhost:5174/auth/callback",
      ],
      logoutUrls: [`${origin}/`, "http://localhost:5174/"],
      domainPrefix: `snipe-regatta-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      resourceServerId: "regatta",
      scopeName: "race",
      scopeDescription:
        "Watch Snipe AI Regatta races decided by Strands Decider",
    });

    // --- Decider task -------------------------------------------------------
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "Public", subnetType: ec2.SubnetType.PUBLIC },
      ],
    });
    const linkSecurityGroup = new ec2.SecurityGroup(
      this,
      "VpcLinkSecurityGroup",
      {
        vpc,
        description: "API Gateway VPC link to the Decider task",
        allowAllOutbound: false,
      },
    );
    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      description: "Decider task: inbound only from the VPC link",
      allowAllOutbound: true, // ECR image pull and CloudWatch Logs over HTTPS.
    });
    taskSecurityGroup.addIngressRule(
      linkSecurityGroup,
      ec2.Port.tcp(8080),
      "VPC link",
    );
    linkSecurityGroup.addEgressRule(
      taskSecurityGroup,
      ec2.Port.tcp(8080),
      "Decider",
    );

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });
    const namespace = new servicediscovery.PrivateDnsNamespace(
      this,
      "Namespace",
      {
        name: "regatta.internal",
        vpc,
      },
    );
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const task = new ecs.FargateTaskDefinition(this, "DeciderTask", {
      cpu: props.workerCpu,
      memoryLimitMiB: props.workerCpu === 16384 ? 32768 : 16384,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const repository = ecr.Repository.fromRepositoryName(
      this,
      "DeciderRepository",
      props.repositoryName,
    );
    task.addContainer("Decider", {
      image: ecs.ContainerImage.fromEcrRepository(repository, props.imageTag),
      command: [
        "python",
        "cloud_server.py",
        "--port",
        "8080",
        "--threads",
        String(props.workerCpu / 1024),
      ],
      environment: {
        REGATTA_BUDGET_MS: String(props.budgetMs),
        REGATTA_USER_DAILY_LIMIT: "300",
        REGATTA_PROCESS_LIMIT: "1500",
      },
      portMappings: [{ containerPort: 8080, name: "decider" }],
      healthCheck: {
        command: [
          "CMD-SHELL",
          "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/ping', timeout=3)\"",
        ],
        startPeriod: cdk.Duration.seconds(120),
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup: workerLogs,
        streamPrefix: "decider",
      }),
      stopTimeout: cdk.Duration.seconds(10),
    });
    const service = new ecs.FargateService(this, "DeciderService", {
      cluster,
      taskDefinition: task,
      desiredCount: props.desiredCount,
      // Never two paid tasks at once, even during a deployment.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      assignPublicIp: true,
      securityGroups: [taskSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      circuitBreaker: { rollback: false },
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: "decider",
        dnsRecordType: servicediscovery.DnsRecordType.SRV,
        containerPort: 8080,
      },
    });
    const cloudMapService = service.cloudMapService;
    if (!cloudMapService) throw new Error("Cloud Map service missing");

    // --- Debrief Lambda ------------------------------------------------------
    const quota = new dynamodb.Table(this, "QuotaTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const debriefLogs = new logs.LogGroup(this, "DebriefLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const modelId = "amazon.nova-lite-v1:0";
    const debrief = new lambda.Function(this, "Debrief", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../regatta-debrief"),
        {
          exclude: [
            "tests",
            "tests/**",
            "__pycache__",
            "**/__pycache__",
            "pyproject.toml",
            ".ruff_cache",
          ],
        },
      ),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: debriefLogs,
      environment: {
        QUOTA_TABLE: quota.tableName,
        MODEL_ID: modelId,
        USER_DAILY_LIMIT: "5",
        GLOBAL_DAILY_LIMIT: "20",
      },
    });
    quota.grant(debrief, "dynamodb:UpdateItem");
    debrief.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/${modelId}`,
        ],
      }),
    );

    // --- HTTP API ---------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      description: "Snipe AI Regatta API",
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [origin, "http://localhost:5174"],
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST],
        allowHeaders: ["Authorization", "Content-Type"],
        maxAge: cdk.Duration.minutes(10),
      },
    });
    const authorizer = new authorizers.HttpJwtAuthorizer(
      "CognitoJwt",
      identity.issuerUrl,
      {
        jwtAudience: [identity.client.userPoolClientId],
      },
    );
    const vpcLink = new apigwv2.VpcLink(this, "VpcLink", {
      vpc,
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [linkSecurityGroup],
    });
    const deciderIntegration = new integrations.HttpServiceDiscoveryIntegration(
      "DeciderIntegration",
      cloudMapService,
      {
        vpcLink,
        // Only API Gateway sets the user id; a client-supplied header is overwritten.
        parameterMapping: new apigwv2.ParameterMapping().overwriteHeader(
          "x-regatta-user",
          apigwv2.MappingValue.contextVariable("authorizer.claims.sub"),
        ),
      },
    );
    for (const route of DECIDER_ROUTES) {
      httpApi.addRoutes({
        path: route.path,
        methods: [route.method],
        integration: deciderIntegration,
        authorizer,
        authorizationScopes: [identity.scope],
      });
    }
    httpApi.addRoutes({
      path: "/debrief",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "DebriefIntegration",
        debrief,
      ),
      authorizer,
      authorizationScopes: [identity.scope],
    });
    const accessLogs = new logs.LogGroup(this, "AccessLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const stage = new apigwv2.HttpStage(this, "DefaultStage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 5, burstLimit: 10 },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
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

    // --- Outputs used by the publish script -----------------------------------------
    for (const [name, value] of Object.entries({
      SiteUrl: origin,
      SiteBucket: site.bucket.bucketName,
      DistributionId: site.distribution.distributionId,
      ApiUrl: stage.url,
      CognitoDomain: identity.hostedUiUrl,
      ClientId: identity.client.userPoolClientId,
      Scope: identity.scope,
      ClusterName: cluster.clusterName,
      ServiceName: service.serviceName,
    }))
      new cdk.CfnOutput(this, name, { value });
    cdk.Tags.of(this).add("Project", "SnipeAIRegatta");

    acknowledge(vpc, [
      {
        id: "AwsSolutions::AwsSolutions-VPC7",
        reason:
          "VPC flow logs add cost; the VPC holds only one Decider task with no inbound access except from the VPC link security group.",
      },
    ]);
    acknowledge(task, [
      {
        id: "AwsSolutions::AwsSolutions-ECS2",
        reason:
          "Environment variables hold only non-secret limits (deadline, quotas); no credentials are passed to the task.",
      },
    ]);
    if (task.executionRole)
      acknowledge(task.executionRole, [
        {
          id: "AwsSolutions::AwsSolutions-IAM5[Resource::*]",
          reason:
            "ecr:GetAuthorizationToken has no resource-level permissions; image pulls are limited to the named repository by CDK.",
        },
      ]);
    acknowledge(quota, [
      {
        id: "AwsSolutions::AwsSolutions-DDB3",
        reason:
          "The table holds only daily debrief counters that expire after two days; there is nothing to restore.",
      },
    ]);
    acknowledge(cluster, [
      {
        id: "AwsSolutions::AwsSolutions-ECS4",
        reason:
          "Container Insights adds cost for a single demo task; task logs and API access logs are kept for one week.",
      },
    ]);
    acknowledge(debrief, [
      {
        id: "AwsSolutions::AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]",
        reason: "Standard Lambda execution role for writing its own logs.",
      },
      {
        id: "AwsSolutions::AwsSolutions-L1",
        reason: "Python 3.12 matches the tested worker and API runtime.",
      },
    ]);
    acknowledge(httpApi, [
      {
        id: "AwsSolutions::AwsSolutions-APIG4",
        reason:
          "Every route has the Cognito JWT authorizer and scope; only CORS preflight (OPTIONS) is unauthenticated, as browsers require.",
      },
    ]);
  }
}
