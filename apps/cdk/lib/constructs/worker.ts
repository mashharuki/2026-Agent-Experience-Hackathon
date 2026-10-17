import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { acknowledge } from "../nag";
import type { Data } from "./data";
import { grantUploadAccess } from "./s3-access";

export interface WorkerProps {
  readonly data: Data;
  /** Bedrock foundation model the worker may call (in-region, no cross-region profile). */
  readonly bedrockModelId: string;
  /** Immutable tag of the worker image already pushed to the repository. */
  readonly imageTag: string;
}

/**
 * The AI worker: one Fargate task (4 vCPU / 16 GB, Linux/x86_64) that pulls job ids from SQS.
 *
 * Design for low idle cost and a small attack surface:
 * - The service starts at 0 tasks. Starting and stopping is done by the operations Lambda;
 *   a stopped worker costs nothing and the API says so instead of queueing work.
 * - Public subnet with a public IP and an internet gateway: no NAT gateway (fixed hourly
 *   cost) and no load balancer. The security group has NO inbound rule and only HTTPS out.
 *   Gateway endpoints for S3 and DynamoDB are free. This is not a private network.
 * - The image is built and pushed outside CDK (it carries ~5 GB of model weights); the
 *   repository is immutable so a tag always means the same image.
 */
export class Worker extends Construct {
  readonly repository: ecr.Repository;
  readonly cluster: ecs.Cluster;
  readonly service: ecs.FargateService;
  readonly securityGroup: ec2.SecurityGroup;
  readonly taskRole: iam.IRole;

  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
        DynamoDb: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB },
      },
    });

    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
      description: "Photoprep worker: no inbound, HTTPS outbound only",
      allowAllOutbound: false,
    });
    this.securityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      "HTTPS to AWS service endpoints (SQS, Bedrock, ECR, CloudWatch Logs)",
    );

    this.repository = new ecr.Repository(this, "Repository", {
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [
        { description: "keep the last 3 images", maxImageCount: 3 },
      ],
    });

    this.cluster = new ecs.Cluster(this, "Cluster", { vpc });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      cpu: 4096,
      memoryLimitMiB: 16384,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    taskDefinition.addContainer("Worker", {
      image: ecs.ContainerImage.fromEcrRepository(
        this.repository,
        props.imageTag,
      ),
      essential: true,
      // The model weights are baked into the image: nothing is downloaded at run time.
      environment: {
        TABLE_NAME: props.data.table.tableName,
        IMAGE_BUCKET: props.data.imageBucket.bucketName,
        QUEUE_URL: props.data.queue.queueUrl,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        AWS_REGION: stack.region,
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "worker",
        logGroup: new logs.LogGroup(this, "Logs", {
          retention: logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
      stopTimeout: cdk.Duration.seconds(120), // let the current job finish after SIGTERM
    });

    // Least privilege: consume the queue, read and delete temporary images, use the table,
    // and invoke exactly one Bedrock model.
    this.taskRole = taskDefinition.taskRole;
    props.data.queue.grantConsumeMessages(taskDefinition.taskRole);
    grantUploadAccess(taskDefinition.taskRole, props.data.imageBucket, {
      get: true,
      delete: true,
    });
    props.data.table.grantReadWriteData(taskDefinition.taskRole);
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"], // the Converse API is authorized by this action
        resources: [
          `arn:${stack.partition}:bedrock:${stack.region}::foundation-model/${props.bedrockModelId}`,
        ],
      }),
    );

    this.service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 0, // stopped until the operations Lambda starts it
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [this.securityGroup],
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { enable: true, rollback: true },
      enableExecuteCommand: false,
    });

    acknowledge(this, [
      {
        id: "AwsSolutions::AwsSolutions-ECS4",
        reason:
          "Container Insights adds a per-metric charge and the worker is stopped most of the time; task logs and the alarms in the Operations construct are enough for this small deployment (constitution principle II).",
      },
      {
        id: "AwsSolutions::AwsSolutions-ECS2",
        reason:
          "The container's environment holds only resource names (table, bucket, queue), the model id and the region. There are no secrets or credentials: access comes from the task role.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::*]",
        reason:
          "Generated for the task execution role: ecr:GetAuthorizationToken does not support resource-level permissions. Image pulls themselves are limited to this repository.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataTableFDBAD0F2.Arn>/index/*]",
        reason:
          "Generated by grantReadWriteData: includes the table's own secondary index (status-index) only.",
      },
      {
        id: "AwsSolutions::AwsSolutions-IAM5[Resource::<DataImageBucket04D7B968.Arn>/uploads/*]",
        reason:
          "Limited to the uploads/ prefix of the temporary image bucket (read, then delete after processing).",
      },
      {
        id: "AwsSolutions::AwsSolutions-VPC7",
        reason:
          "VPC flow logs are not enabled: the VPC holds only the worker, which has no inbound access, and flow logs would add cost and retain network metadata.",
      },
    ]);
  }
}
