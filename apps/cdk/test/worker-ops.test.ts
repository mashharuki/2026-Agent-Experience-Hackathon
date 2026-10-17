import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { PhotoPrepStack } from "../lib/cdk-stack";

// Nothing here deploys anything: templates are synthesized in memory only.
const stubCode = lambda.Code.fromInline(
  "def handler(event, context):\n    return None\n",
);

function build(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context });
  const stack = new PhotoPrepStack(app, "TestStack", {
    env: { region: "ap-northeast-1", account: "123456789012" },
    apiCode: stubCode,
  });
  return { stack, template: Template.fromStack(stack) };
}

type Statement = {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
};

function statementsFor(template: Template, rolePattern: RegExp): Statement[] {
  const roles = template.findResources("AWS::IAM::Role");
  const logicalIds = Object.keys(roles).filter((id) => rolePattern.test(id));
  const statements: Statement[] = [];
  for (const policy of Object.values(
    template.findResources("AWS::IAM::Policy"),
  )) {
    const attached = (policy.Properties.Roles ?? []) as Array<{ Ref: string }>;
    if (attached.some((r) => logicalIds.includes(r.Ref))) {
      statements.push(
        ...(policy.Properties.PolicyDocument.Statement as Statement[]),
      );
    }
  }
  return statements;
}

describe("worker: Fargate, public subnet, nothing listening", () => {
  const { template } = build();

  test("no NAT gateway and no load balancer are created (idle cost control)", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
  });

  test("the VPC has only public subnets and free gateway endpoints for S3 and DynamoDB", () => {
    const subnets = Object.values(template.findResources("AWS::EC2::Subnet"));
    expect(subnets.length).toBeGreaterThan(0);
    for (const subnet of subnets) {
      expect(subnet.Properties.MapPublicIpOnLaunch).toBe(true);
    }
    const endpoints = Object.values(
      template.findResources("AWS::EC2::VPCEndpoint"),
    );
    expect(endpoints.map((e) => e.Properties.VpcEndpointType)).toEqual([
      "Gateway",
      "Gateway",
    ]);
    const services = JSON.stringify(
      endpoints.map((e) => e.Properties.ServiceName),
    );
    expect(services).toContain("s3");
    expect(services).toContain("dynamodb");
  });

  test("the worker's security group has no inbound rule and only HTTPS outbound", () => {
    const groups = Object.entries(
      template.findResources("AWS::EC2::SecurityGroup"),
    ).filter(([id]) => /Worker/.test(id));
    expect(groups).toHaveLength(1);
    const [, group] = groups[0];
    expect(group.Properties.SecurityGroupIngress ?? []).toEqual([]);
    expect(group.Properties.SecurityGroupEgress).toEqual([
      expect.objectContaining({
        IpProtocol: "tcp",
        FromPort: 443,
        ToPort: 443,
        CidrIp: "0.0.0.0/0",
      }),
    ]);
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
  });

  test("the service starts stopped (no cost until someone starts it) on public IP, Fargate", () => {
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 0,
      LaunchType: "FARGATE",
      EnableExecuteCommand: false,
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "ENABLED" }),
      },
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  test("the task is 4 vCPU / 16 GB on Linux x86_64 and exposes no port", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Cpu: "4096",
      Memory: "16384",
      RuntimePlatform: {
        CpuArchitecture: "X86_64",
        OperatingSystemFamily: "LINUX",
      },
      ContainerDefinitions: [
        Match.objectLike({
          Essential: true,
          PortMappings: Match.absent(),
          Environment: Match.arrayWith([
            Match.objectLike({ Name: "TABLE_NAME" }),
            Match.objectLike({ Name: "IMAGE_BUCKET" }),
            Match.objectLike({ Name: "QUEUE_URL" }),
            Match.objectLike({
              Name: "BEDROCK_MODEL_ID",
              Value: "amazon.nova-lite-v1:0",
            }),
          ]),
        }),
      ],
    });
  });

  test("the image repository is immutable, scanned, and keeps only a few images", () => {
    template.hasResourceProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
      LifecyclePolicy: Match.anyValue(),
    });
  });

  test("the container never uses a floating image tag", () => {
    const text = JSON.stringify(template.toJSON().Resources);
    expect(text).not.toMatch(/:latest"/);
  });

  test("logs are kept for a week", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });
});

describe("worker: least privilege", () => {
  const { template } = build();
  const statements = statementsFor(template, /WorkerTaskDefTaskRole/);

  test("the task role has no wildcard action and no wildcard resource", () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      for (const action of ([] as string[]).concat(s.Action)) {
        expect(action).not.toContain("*"); // no "s3:*", "s3:GetObject*", "s3:List*" ...
      }
      expect(JSON.stringify(s.Resource)).not.toBe('"*"');
    }
  });

  test("Bedrock access is limited to the one foundation model in Tokyo", () => {
    const bedrock = statements.filter((s) =>
      JSON.stringify(s.Action).includes("bedrock:"),
    );
    expect(bedrock).toHaveLength(1);
    expect(([] as string[]).concat(bedrock[0].Action).sort()).toEqual([
      "bedrock:InvokeModel",
    ]);
    expect(JSON.stringify(bedrock[0].Resource)).toContain(
      "foundation-model/amazon.nova-lite-v1:0",
    );
    expect(JSON.stringify(bedrock[0].Resource)).toContain("ap-northeast-1");
    expect(JSON.stringify(bedrock[0].Resource)).not.toContain(
      "inference-profile",
    );
  });

  test("it can read and delete temporary images only under uploads/, and only consume the queue", () => {
    const objectAccess = statements.filter((s) =>
      JSON.stringify(s.Action).includes("s3:GetObject"),
    );
    expect(objectAccess).toHaveLength(1);
    expect(([] as string[]).concat(objectAccess[0].Action).sort()).toEqual([
      "s3:DeleteObject",
      "s3:GetObject",
    ]);
    expect(JSON.stringify(objectAccess[0].Resource)).toContain("/uploads/*");
    // Without s3:ListBucket a missing photo would look like 403 instead of 404.
    const listing = statements.filter((s) =>
      JSON.stringify(s.Action).includes("s3:ListBucket"),
    );
    expect(listing).toHaveLength(1);
    expect(JSON.stringify(listing[0])).toContain("uploads/*"); // limited to the prefix
    const sqsActions = statements
      .filter((s) => JSON.stringify(s.Action).includes("sqs:"))
      .flatMap((s) => ([] as string[]).concat(s.Action));
    expect(sqsActions).not.toContain("sqs:SendMessage");
    expect(sqsActions).toContain("sqs:ReceiveMessage");
    expect(sqsActions).toContain("sqs:DeleteMessage");
  });
});

describe("operations", () => {
  const { template } = build();
  const functions = Object.values(
    template.findResources("AWS::Lambda::Function"),
  ).filter(
    (f) =>
      typeof f.Properties.Handler === "string" &&
      f.Properties.Handler.startsWith("photoprep_api.ops."),
  );

  test("the sweeper can list uploads/ and delete there, nothing else in S3", () => {
    const statements = statementsFor(
      template,
      /OperationsSweeper.*ServiceRole/,
    );
    const s3 = statements.filter((s) =>
      JSON.stringify(s.Action).includes("s3:"),
    );
    const actions = s3.flatMap((s) => ([] as string[]).concat(s.Action)).sort();
    expect(actions).toEqual(["s3:DeleteObject", "s3:ListBucket"]);
    for (const s of s3) expect(JSON.stringify(s)).toContain("uploads/*");
  });

  test("each operations Lambda points at a module that exists in apps/api", () => {
    expect(functions.map((f) => f.Properties.Handler).sort()).toEqual([
      "photoprep_api.ops.dispatch.handler",
      "photoprep_api.ops.sweeper.handler",
      "photoprep_api.ops.worker_control.handler",
    ]);
    for (const f of functions) {
      const [pkg, sub, module, fn] = (f.Properties.Handler as string).split(
        ".",
      );
      const file = path.join(
        __dirname,
        "../../api/src",
        pkg,
        sub,
        `${module}.py`,
      );
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toMatch(new RegExp(`def ${fn}\\(`));
    }
  });

  test("the worker-control Lambda knows the service and queue, and can only update that service", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "photoprep_api.ops.worker_control.handler",
      Environment: {
        Variables: Match.objectLike({
          CLUSTER_NAME: Match.anyValue(),
          SERVICE_NAME: Match.anyValue(),
          QUEUE_URL: Match.anyValue(),
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
    const statements = statementsFor(
      template,
      /OperationsWorkerControl.*ServiceRole/,
    );
    const ecs = statements.filter((s) =>
      JSON.stringify(s.Action).includes("ecs:"),
    );
    const actions = ecs
      .flatMap((s) => ([] as string[]).concat(s.Action))
      .sort();
    expect(actions).toEqual(["ecs:DescribeServices", "ecs:UpdateService"]);
    for (const s of ecs) expect(JSON.stringify(s.Resource)).not.toBe('"*"');
  });

  test("the worker is stopped every night and reconciled every five minutes; starting is manual", () => {
    const schedules = Object.values(
      template.findResources("AWS::Scheduler::Schedule"),
    );
    const byAction = (action: string) =>
      schedules.filter((s) =>
        (s.Properties.Target.Input as string).includes(`"action":"${action}"`),
      );
    const stop = byAction("stop");
    expect(stop).toHaveLength(1);
    expect(stop[0].Properties).toMatchObject({
      ScheduleExpression: "cron(0 3 * * ? *)",
      ScheduleExpressionTimezone: "Asia/Tokyo",
      State: "ENABLED",
    });
    expect(byAction("reconcile")[0].Properties.ScheduleExpression).toBe(
      "rate(5 minutes)",
    );
    expect(byAction("start")).toHaveLength(0); // never started by a timer: that costs money
  });

  test("jobs saved but not queued are re-dispatched every minute; leftovers are swept every 15", () => {
    const rules = Object.values(
      template.findResources("AWS::Events::Rule"),
    ).map((r) => r.Properties.ScheduleExpression);
    expect(rules).toEqual(
      expect.arrayContaining(["rate(1 minute)", "rate(15 minutes)"]),
    );
  });

  test("a message in the dead-letter queue raises an alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateNumberOfMessagesVisible",
      Namespace: "AWS/SQS",
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmActions: Match.anyValue(),
    });
  });
});

describe("budget notification", () => {
  test("with an alert address: $30 monthly, before credits, at 50 / 80 / 100 percent of actual spend", () => {
    const { template } = build({ "photoprep:alertEmail": "owner@example.com" });
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: 30, Unit: "USD" },
        CostTypes: Match.objectLike({ IncludeCredit: false }),
      }),
      NotificationsWithSubscribers: [
        Match.objectLike({
          Notification: Match.objectLike({
            Threshold: 50,
            NotificationType: "ACTUAL",
          }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({
            Threshold: 80,
            NotificationType: "ACTUAL",
          }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({
            Threshold: 100,
            NotificationType: "ACTUAL",
          }),
        }),
      ],
    });
  });

  test("without an alert address no budget is made and the stack warns that none exists", () => {
    const { stack, template } = build();
    template.resourceCountIs("AWS::Budgets::Budget", 0);
    Annotations.fromStack(stack).hasWarning(
      "*",
      Match.stringLikeRegexp("photoprep:alertEmail"),
    );
  });

  test("a notification is not a limit: the app's own quota and the nightly stop still exist", () => {
    const { template } = build({ "photoprep:alertEmail": "owner@example.com" });
    expect(
      Object.keys(template.findResources("AWS::Scheduler::Schedule")).length,
    ).toBeGreaterThan(0);
  });
});
