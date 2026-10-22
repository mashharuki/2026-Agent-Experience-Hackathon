import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import { acknowledge } from "./nag";

/** No API or inference service: one manually launched, bounded latency task only. */
export class RegattaProbeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps = {}) {
    super(scope, id, props);
    const cpu = Number(this.node.tryGetContext("regatta:probeCpu") ?? 4096);
    if (![4096, 8192, 16384].includes(cpu)) {
      throw new Error("regatta:probeCpu must be 4096, 8192 or 16384");
    }
    const imageTag =
      this.node.tryGetContext("regatta:probeImageTag") ?? "fleet-v4-probe";
    if (
      typeof imageTag !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(imageTag)
    ) {
      throw new Error("An immutable probe image tag is required");
    }
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });
    const security = new ec2.SecurityGroup(this, "Security", {
      vpc,
      allowAllOutbound: false,
      description: "Bounded regatta latency probe; no inbound access",
    });
    security.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "ECR and logs",
    );
    const repository = new ecr.Repository(this, "Repository", {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 2 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu,
      memoryLimitMiB: cpu === 16384 ? 32768 : 16384,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    task.addContainer("Probe", {
      image: ecs.ContainerImage.fromEcrRepository(repository, imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "probe" }),
      stopTimeout: cdk.Duration.seconds(10),
    });
    acknowledge(vpc, [
      {
        id: "AwsSolutions::AwsSolutions-VPC7",
        reason:
          "Temporary no-inbound benchmark VPC; task logs suffice without paid flow logs.",
      },
    ]);
    acknowledge(task, [
      {
        id: "AwsSolutions::AwsSolutions-ECS2",
        reason:
          "No credentials or secrets in environment; no AWS SDK calls from this task.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::*]",
        reason:
          "ECR authorization token does not support resource-level permissions; image access is restricted to this repository.",
      },
    ]);
    acknowledge(cluster, [
      {
        id: "AwsSolutions::AwsSolutions-ECS4",
        reason:
          "One short-lived benchmark uses task logs; paid Container Insights is unnecessary.",
      },
    ]);
    for (const [name, value] of Object.entries({
      RepositoryUri: repository.repositoryUri,
      Cluster: cluster.clusterArn,
      TaskDefinition: task.taskDefinitionArn,
      SecurityGroup: security.securityGroupId,
      Subnet: vpc.publicSubnets[0].subnetId,
      LogGroup: logGroup.logGroupName,
    }))
      new cdk.CfnOutput(this, `${name}Output`, { value });
    cdk.Tags.of(this).add("Project", "SnipeAIRegatta");
    cdk.Tags.of(this).add("Purpose", "bounded-latency-gate");
  }
}
